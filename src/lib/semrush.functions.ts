import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/semrush";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type SerpRow = { position: number; url: string; domain: string };

export type KeywordData = {
  keyword: string;
  kd: number | null;
  serp: SerpRow[];
  error: string | null;
};

async function semrush(path: string, params: Record<string, string>) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const semrushKey = process.env["SEMRUSH_API_KEY"];
  if (!lovableKey || !semrushKey) {
    throw new Error("Semrush is not connected to this project.");
  }
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GATEWAY_URL}${path}?${qs}`, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": semrushKey,
      "Allow-Limit-Offset": "true",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Semrush request failed [${res.status}]: ${text}`);
    if (/TOTAL LIMIT EXCEEDED/i.test(text)) {
      throw new Error("Semrush API quota exhausted — upgrade the plan or wait for the reset.");
    }
    throw new Error(`Semrush request failed [${res.status}]: ${text}`);
  }
  const json = JSON.parse(text) as {
    data?: { columnNames: string[]; rows: string[][] };
    error?: string;
  };
  if (json.error) {
    if (/TOTAL LIMIT EXCEEDED/i.test(json.error)) {
      throw new Error("Semrush API quota exhausted — upgrade the plan or wait for the reset.");
    }
    throw new Error(json.error);
  }
  const columnNames = json.data?.columnNames ?? [];
  const rows = json.data?.rows ?? [];
  return rows.map((row) => {
    const record: Record<string, string> = {};
    columnNames.forEach((name, i) => {
      record[name] = row[i] ?? "";
    });
    return record;
  });
}

/** Live KD + organic SERP for one keyword, straight from Semrush. */
export const fetchKeywordData = createServerFn({ method: "POST" })
  .inputValidator((input: { keyword: string; database: string; serpDepth?: number }) => {
    const keyword = String(input.keyword ?? "").trim();
    if (!keyword) throw new Error("keyword is required");
    const database = String(input.database ?? "us").trim().toLowerCase();
    const serpDepth = Math.min(Math.max(Number(input.serpDepth ?? 20), 5), 50);
    return { keyword, database, serpDepth };
  })
  .handler(async ({ data }): Promise<KeywordData> => {
    const { keyword, database, serpDepth } = data;
    try {
      const [kdRows, serpRows] = await Promise.all([
        semrush("/keywords/phrase_kdi", {
          phrase: keyword,
          database,
          export_columns: "Ph,Kd",
        }).catch((e) => {
          console.error("KD fetch failed", e);
          return [] as Record<string, string>[];
        }),
        semrush("/keywords/phrase_organic", {
          phrase: keyword,
          database,
          export_columns: "Dn,Ur,Po",
          display_limit: String(serpDepth),
        }),
      ]);

      const kdRaw = kdRows[0]?.["Keyword Difficulty Index"];
      const kd = kdRaw != null && kdRaw !== "" ? Math.round(Number(kdRaw)) : null;

      const serp: SerpRow[] = serpRows
        .map((row, i) => ({
          position: Number(row["Position"] ?? i + 1) || i + 1,
          url: row["Url"] ?? "",
          domain: (row["Domain"] ?? "").toLowerCase(),
        }))
        .filter((r) => r.url && r.domain)
        .sort((a, b) => a.position - b.position);

      return { keyword, kd: Number.isFinite(kd as number) ? kd : null, serp, error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown Semrush error";
      return { keyword, kd: null, serp: [], error: message };
    }
  });

export type AiVerdict = {
  domain: string;
  isAgency: boolean | null;
  companyName: string | null;
  reason: string;
};

const SYSTEM_PROMPT = `You classify the COMPANY behind a website as AGENCY or NOT AGENCY.

AGENCY = a company that sells client services delivered by its own team: SEO agency, digital marketing agency, web design/development agency, software development company / dev shop, IT services or consulting firm (e.g. SEO Web Design LLC, SEO.com, SEO Inc, Visualwebz, S-PRO, Cleveroad, eSparkBiz, TechStep Solutions, Elsner Technologies).

NOT AGENCY = marketplaces and talent platforms (Upwork, Fiverr, Toptal, Freelancer.com, Contra, Arc.dev), directories and review sites (Clutch, DesignRush, Semrush Agency Directory, GoodFirms, Sortlist), SaaS/software products (Wix, Squarespace, Semrush, HubSpot), forums and social networks (Reddit, Quora, LinkedIn, YouTube), publishers and news sites, job boards, staffing marketplaces, and individual freelancers/solo portfolios.

Rules:
- Judge ONLY the COMPANY behind the domain. Page type and URL structure are irrelevant: a blog post, article, guide, listicle, or any other page published by an agency still qualifies. Never reject an agency because of its ranking page type.
- Accounting firms, big consultancies, publishers and media companies are NOT agencies for this purpose.
- If you do not recognise the company and cannot reasonably determine what it is, return isAgency: null.
- Never invent company names.

Return ONLY JSON: {"results":[{"domain":"...","companyName":"...","isAgency":true|false|null,"reason":"short reason"}]}`;

/** AI classification for domains with no rule/cache verdict. */
export const classifyDomains = createServerFn({ method: "POST" })
  .inputValidator((input: { domains: string[] }) => {
    const domains = Array.from(
      new Set((input.domains ?? []).map((d) => String(d).toLowerCase().trim()).filter(Boolean)),
    ).slice(0, 40);
    return { domains };
  })
  .handler(async ({ data }): Promise<AiVerdict[]> => {
    if (data.domains.length === 0) return [];
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI classification is unavailable.");

    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Classify these domains:\n${data.domains.join("\n")}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`AI classification failed [${res.status}]: ${text}`);
      if (res.status === 429) throw new Error("AI rate limit reached — try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted for this workspace.");
      throw new Error(`AI classification failed [${res.status}]`);
    }

    let parsed: { results?: AiVerdict[] } = {};
    try {
      const body = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
      parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}");
    } catch (e) {
      console.error("Could not parse AI classification response", e);
    }

    const byDomain = new Map<string, AiVerdict>();
    for (const item of parsed.results ?? []) {
      const domain = String(item?.domain ?? "").toLowerCase().trim();
      if (!domain) continue;
      byDomain.set(domain, {
        domain,
        isAgency: typeof item.isAgency === "boolean" ? item.isAgency : null,
        companyName: item.companyName ? String(item.companyName) : null,
        reason: item.reason ? String(item.reason) : "No determination available",
      });
    }

    return data.domains.map(
      (domain) =>
        byDomain.get(domain) ?? {
          domain,
          isAgency: null,
          companyName: null,
          reason: "Classifier returned no verdict — needs review",
        },
    );
  });
