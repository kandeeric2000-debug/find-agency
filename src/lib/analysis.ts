import { supabase } from "@/integrations/supabase/client";
import { classifyDomains, fetchKeywordData } from "@/lib/semrush.functions";
import { rootDomain } from "@/lib/agency-rules";
import {
  ClassifierSession,
  pickCompetitors,
  resolveRun,
  type CachedVerdict,
  type EngineDeps,
  type Evaluated,
  type SerpRow,
} from "@/lib/classification-engine";

export type { Evaluated };
export { pickCompetitors };

export type KeywordResult = {
  keyword: string;
  kd: number | null;
  serp?: SerpRow[];
  evaluated: Evaluated[];
  competitors: Evaluated[];
  needsReview: boolean;
  error: string | null;
  fetchedAt: string;
};

export type PageInput = {
  id: string;
  name: string;
  rank: string;
  targetUrl: string;
  country: string;
  database: string;
  keywords: string;
};

export type PageResult = {
  pageId: string;
  page: Omit<PageInput, "keywords">;
  keywords: KeywordResult[];
};

export const DATABASES: { code: string; country: string }[] = [
  { code: "us", country: "USA" },
  { code: "uk", country: "United Kingdom" },
  { code: "ca", country: "Canada" },
  { code: "au", country: "Australia" },
  { code: "de", country: "Germany" },
  { code: "fr", country: "France" },
  { code: "es", country: "Spain" },
  { code: "it", country: "Italy" },
  { code: "nl", country: "Netherlands" },
  { code: "in", country: "India" },
  { code: "br", country: "Brazil" },
  { code: "mx", country: "Mexico" },
  { code: "ae", country: "United Arab Emirates" },
  { code: "se", country: "Sweden" },
  { code: "no", country: "Norway" },
  { code: "dk", country: "Denmark" },
];

type CacheRow = {
  domain: string;
  is_agency: boolean | null;
  reason: string;
  source: string;
  company_name: string | null;
};

export async function loadCache(domains: string[]): Promise<Map<string, CachedVerdict>> {
  const map = new Map<string, CachedVerdict>();
  const keys = Array.from(new Set(domains.map(rootDomain)));
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabase
      .from("domain_classifications")
      .select("domain, is_agency, reason, source, company_name")
      .in("domain", keys.slice(i, i + 200));
    if (error) {
      console.error("Classification cache read failed", error);
      continue;
    }
    for (const row of (data ?? []) as CacheRow[]) {
      // Older AI rows were based only on a domain name. Do not reuse them.
      if (row.source !== "manual" && row.source !== "ai-evidence-v2") continue;
      map.set(row.domain, {
        isAgency: row.is_agency,
        reason: row.reason,
        source: row.source === "manual" ? "manual" : "cache",
        companyName: row.company_name,
        stored: row.source === "manual" ? "manual" : "ai",
      });
    }
  }
  return map;
}

export async function saveVerdict(
  domain: string,
  verdict: {
    isAgency: boolean | null;
    reason: string;
    source: "ai-evidence-v2" | "manual";
    companyName?: string | null;
  },
) {
  const { error } = await supabase.from("domain_classifications").upsert(
    {
      domain: rootDomain(domain),
      is_agency: verdict.isAgency,
      reason: verdict.reason,
      source: verdict.source,
      company_name: verdict.companyName ?? null,
    },
    { onConflict: "domain" },
  );
  if (error) console.error("Classification cache write failed", error);
}

export function liveDeps(): EngineDeps {
  return {
    loadCache,
    saveVerdict: (domain, v) => saveVerdict(domain, { ...v, source: "ai-evidence-v2" }),
    classify: (domains) => classifyDomains({ data: { domains } }),
  };
}

export type RunSummary = { aiRequests: number; aiUnavailable: string | null };

function buildResult(base: Omit<KeywordResult, "evaluated" | "competitors" | "needsReview">, session: ClassifierSession): KeywordResult {
  const serp = base.serp ?? [];
  const sel = pickCompetitors(serp, session);
  return { ...base, serp, ...sel, needsReview: sel.needsReview || base.kd === null };
}

/**
 * Analyze a whole batch: live Semrush per keyword first, then one shared,
 * deduplicated classification pass. AI failures never abort the run.
 */
export async function analyzeBatch(
  jobs: { keyword: string; database: string }[],
  onProgress: (done: number, label: string) => void,
  deps: EngineDeps = liveDeps(),
): Promise<{ results: KeywordResult[]; summary: RunSummary }> {
  const fetched: KeywordResult[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    onProgress(i, job.keyword);
    try {
      const data = await fetchKeywordData({ data: { keyword: job.keyword, database: job.database, serpDepth: 50 } });
      fetched.push({ keyword: job.keyword, kd: data.kd, serp: data.serp, evaluated: [], competitors: [], needsReview: true, error: data.error, fetchedAt: new Date().toISOString() });
    } catch (e) {
      fetched.push({ keyword: job.keyword, kd: null, serp: [], evaluated: [], competitors: [], needsReview: true, error: e instanceof Error ? e.message : "Unknown error", fetchedAt: new Date().toISOString() });
    }
  }
  onProgress(jobs.length, "Classifying companies");
  const { results, summary } = await classifyResults(fetched, deps, {});
  return { results, summary };
}

/** Classify already-fetched results (no Semrush calls). Used by Run, Recheck and overrides. */
export async function classifyResults(
  results: KeywordResult[],
  deps: EngineDeps = liveDeps(),
  opts: { retryUndecided?: boolean } = {},
): Promise<{ results: KeywordResult[]; summary: RunSummary }> {
  const session = new ClassifierSession(deps, opts);
  const serps = results.map((r) =>
    r.error ? [] : r.serp?.length ? r.serp : r.evaluated.map(({ position, url, domain }) => ({ position, url, domain })),
  );
  try {
    await resolveRun(serps, session);
  } catch (e) {
    console.error("Classification pass failed; continuing with what is known", e);
  }
  const out = results.map((r, i) =>
    r.error ? { ...r, needsReview: true } : buildResult({ ...r, serp: serps[i] }, session),
  );
  return { results: out, summary: { aiRequests: session.aiRequests, aiUnavailable: session.aiDisabledReason } };
}

export function formatKeywordBlock(r: KeywordResult): string {
  const head = `${r.keyword} — KD ${r.kd ?? "??"}`;
  if (r.error) return `${head}\nNeeds Review (${r.error})`;
  if (r.competitors.length === 0) return `${head}\nNo competitors`;
  if (r.competitors.length === 1) return `${head}\n${r.competitors[0]!.url}\nNo second competitor`;
  return `${head}\n${r.competitors[0]!.url}\n${r.competitors[1]!.url}`;
}

export function formatPageBlock(page: PageResult): string {
  const header = [
    `Page: ${page.page.name || "(unnamed)"} — ${page.page.country}`,
    page.page.rank ? `Page Rank: #${page.page.rank}` : null,
    page.page.targetUrl ? `URL: ${page.page.targetUrl}` : null,
    `Country: ${page.page.country}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\n${page.keywords.map(formatKeywordBlock).join("\n\n")}`;
}

export function toCsv(pages: PageResult[]): string {
  const header = [
    "Page Name",
    "Page Rank",
    "Target URL",
    "Country",
    "Database",
    "Keyword",
    "KD",
    "Competitor 1",
    "Competitor 1 Position",
    "Competitor 2",
    "Competitor 2 Position",
    "Status",
  ];
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = pages.flatMap((p) =>
    p.keywords.map((k) => {
      const status = k.error
        ? "Needs Review"
        : k.competitors.length === 2
          ? "OK"
          : k.competitors.length === 1
            ? "No second competitor"
            : k.needsReview
              ? "Needs Review"
              : "No competitors";
      return [
        p.page.name,
        p.page.rank,
        p.page.targetUrl,
        p.page.country,
        p.page.database,
        k.keyword,
        k.kd ?? "",
        k.competitors[0]?.url ?? "",
        k.competitors[0]?.position ?? "",
        k.competitors[1]?.url ?? "",
        k.competitors[1]?.position ?? "",
        status,
      ]
        .map(esc)
        .join(",");
    }),
  );
  return [header.map(esc).join(","), ...rows].join("\n");
}
