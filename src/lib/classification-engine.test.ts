import { describe, expect, test } from "bun:test";
import {
  ClassifierSession,
  pickCompetitors,
  resolveRun,
  type CachedVerdict,
  type ClassifyOutcome,
  type EngineDeps,
  type SerpRow,
} from "@/lib/classification-engine";

function fakeDeps(opts: {
  cache?: Record<string, CachedVerdict>;
  ai?: (domains: string[]) => ClassifyOutcome;
}) {
  const calls: string[][] = [];
  const saved: string[] = [];
  const deps: EngineDeps = {
    loadCache: async (ds) => new Map(ds.filter((d) => opts.cache?.[d]).map((d) => [d, opts.cache![d]!])),
    saveVerdict: async (d) => void saved.push(d),
    classify: async (ds) => {
      calls.push(ds);
      return opts.ai ? opts.ai(ds) : { verdicts: [], error: null };
    },
  };
  return { deps, calls, saved };
}

const row = (position: number, domain: string, path = "/services/web-design/"): SerpRow => ({
  position,
  domain,
  url: `https://${domain}${path}`,
});

const agencyAi = (ds: string[]): ClassifyOutcome => ({
  verdicts: ds.map((d) => ({ domain: d, isAgency: true, companyName: d, reason: "Agency (test)" })),
  error: null,
});

describe("classification engine", () => {
  test("known rule domains need zero AI", async () => {
    const { deps, calls } = fakeDeps({ ai: agencyAi });
    const s = new ClassifierSession(deps);
    await resolveRun([[row(1, "www.reddit.com", "/r/x"), row(2, "clutch.co", "/web-developers")]], s);
    expect(calls.length).toBe(0);
    expect(s.get("reddit.com")?.isAgency).toBe(false);
  });

  test("cached domains need zero AI", async () => {
    const cache: Record<string, CachedVerdict> = {
      "a-agency.co.uk": { isAgency: true, reason: "cached", source: "cache", stored: "ai" },
      "b-agency.com": { isAgency: true, reason: "cached", source: "cache", stored: "ai" },
    };
    const { deps, calls } = fakeDeps({ cache, ai: agencyAi });
    const s = new ClassifierSession(deps);
    const serp = [row(1, "www.a-agency.co.uk"), row(2, "b-agency.com")];
    await resolveRun([serp], s);
    expect(calls.length).toBe(0);
    expect(pickCompetitors(serp, s).competitors.map((c) => c.url)).toEqual(serp.map((r) => r.url));
  });

  test("manual override beats rules", async () => {
    const cache = { "reddit.com": { isAgency: true, reason: "manual", source: "manual", stored: "manual" } as CachedVerdict };
    const { deps } = fakeDeps({ cache });
    const s = new ClassifierSession(deps);
    await s.resolveLocal(["reddit.com"]);
    expect(s.get("reddit.com")?.source).toBe("manual");
  });

  test("duplicate unknown domains across keywords are deduped into one AI request", async () => {
    const { deps, calls } = fakeDeps({ ai: agencyAi });
    const s = new ClassifierSession(deps);
    const serps = Array.from({ length: 10 }, () => [row(1, "x-studio.com"), row(2, "www.y-studio.co.uk"), row(3, "z.com")]);
    await resolveRun(serps, s);
    expect(calls.length).toBe(1);
    expect(calls[0]!.sort()).toEqual(["x-studio.com", "y-studio.co.uk"]);
  });

  test("informational URLs never trigger AI", async () => {
    const { deps, calls } = fakeDeps({ ai: agencyAi });
    const s = new ClassifierSession(deps);
    await resolveRun([[row(1, "blogger.com", "/blog/what-is-seo-and-why-it-matters/")]], s);
    expect(calls.length).toBe(0);
  });

  test("AI credit exhaustion stops further AI calls but every keyword finishes", async () => {
    const { deps, calls, saved } = fakeDeps({
      ai: () => ({ verdicts: [], error: { kind: "credits", message: "AI credits exhausted" } }),
    });
    const s = new ClassifierSession(deps);
    const serps = Array.from({ length: 30 }, (_, k) =>
      Array.from({ length: 5 }, (_, i) => row(i + 1, `unknown${k * 5 + i}.com`)),
    );
    await resolveRun(serps, s);
    expect(calls.length).toBe(1); // 150 domains = 4 batches, only the first is attempted
    expect(saved.length).toBe(0); // failures are never cached
    for (const serp of serps) {
      const r = pickCompetitors(serp, s);
      expect(r.needsReview).toBe(true);
      expect(r.competitors.length).toBe(0);
      expect(r.evaluated[0]!.reason).toContain("AI classification unavailable");
    }
  });

  test("a thrown AI error on one batch does not stop others", async () => {
    let n = 0;
    const { deps } = fakeDeps({});
    deps.classify = async (ds) => {
      if (n++ === 0) throw new Error("network");
      return agencyAi(ds);
    };
    const s = new ClassifierSession(deps);
    const serp = Array.from({ length: 45 }, (_, i) => row(i + 1, `d${i}.com`));
    await s.resolveWithAi(serp.map((r) => r.domain));
    expect(s.get("d0.com")?.isAgency).toBe(null);
    expect(s.get("d44.com")?.isAgency).toBe(true);
  });

  test("recheck retries only undecided cached domains", async () => {
    const cache: Record<string, CachedVerdict> = {
      "known.com": { isAgency: true, reason: "c", source: "cache", stored: "ai" },
      "unsure.com": { isAgency: null, reason: "c", source: "cache", stored: "ai" },
    };
    const { deps, calls } = fakeDeps({ cache, ai: agencyAi });
    await resolveRun([[row(1, "unsure.com"), row(2, "known.com")]], new ClassifierSession(deps));
    expect(calls.length).toBe(0);
    await resolveRun([[row(1, "unsure.com"), row(2, "known.com")]], new ClassifierSession(deps, { retryUndecided: true }));
    expect(calls).toEqual([["unsure.com"]]);
  });
});
