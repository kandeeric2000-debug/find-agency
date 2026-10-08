import { createFileRoute } from "@tanstack/react-router";
import { analyzeBatch } from "@/lib/analysis";

/**
 * Token-protected endpoint used by the GitHub Actions batch runner.
 * POST { database, keywords: string[] (max 5) } with header
 * "x-batch-token: <BATCH_RUNNER_TOKEN>". Runs the same live Semrush +
 * classification pipeline as the app and returns exact ranking URLs only.
 */
const MAX_KEYWORDS = 5;

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/public/batch-keywords")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["BATCH_RUNNER_TOKEN"];
        if (!expected) return json(503, { error: "BATCH_RUNNER_TOKEN is not configured on the app" });
        const given = request.headers.get("x-batch-token") ?? "";
        if (!sameToken(given, expected)) return json(401, { error: "Invalid batch token" });

        let body: { database?: unknown; keywords?: unknown };
        try {
          body = await request.json();
        } catch {
          return json(400, { error: "Body must be JSON" });
        }
        const database = String(body.database ?? "").trim().toLowerCase();
        if (!/^[a-z]{2}$/.test(database)) return json(400, { error: "Invalid database" });
        const keywords = Array.isArray(body.keywords)
          ? body.keywords.map((k) => String(k).trim()).filter(Boolean)
          : [];
        if (keywords.length === 0 || keywords.length > MAX_KEYWORDS)
          return json(400, { error: `Send 1-${MAX_KEYWORDS} keywords per request` });

        const { results, summary } = await analyzeBatch(
          keywords.map((keyword) => ({ keyword, database })),
          () => {},
        );
        return json(200, {
          summary,
          results: results.map((r) => ({
            keyword: r.keyword,
            error: r.error,
            needsReview: r.needsReview,
            competitors: r.competitors.map((c) => ({ position: c.position, url: c.url })),
          })),
        });
      },
    },
  },
});
