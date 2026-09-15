import { supabase } from "@/integrations/supabase/client";
import { classifyDomains, fetchKeywordData, type SerpRow } from "@/lib/semrush.functions";
import { ruleVerdict, rootDomain, type Verdict } from "@/lib/agency-rules";

export type Evaluated = SerpRow & {
  isAgency: boolean | null;
  reason: string;
  source: Verdict["source"];
  companyName?: string | null;
  selected: boolean;
};

export type KeywordResult = {
  keyword: string;
  kd: number | null;
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

export async function loadCache(domains: string[]): Promise<Map<string, Verdict>> {
  const map = new Map<string, Verdict>();
  const keys = Array.from(new Set(domains.map(rootDomain)));
  if (keys.length === 0) return map;
  const { data, error } = await supabase
    .from("domain_classifications")
    .select("domain, is_agency, reason, source, company_name")
    .in("domain", keys);
  if (error) {
    console.error("Classification cache read failed", error);
    return map;
  }
  for (const row of (data ?? []) as CacheRow[]) {
    map.set(row.domain, {
      isAgency: row.is_agency,
      reason: row.reason,
      source: row.source === "manual" ? "manual" : "cache",
      companyName: row.company_name,
    });
  }
  return map;
}

export async function saveVerdict(
  domain: string,
  verdict: { isAgency: boolean | null; reason: string; source: "ai" | "manual"; companyName?: string | null },
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

/** Resolve verdicts for a set of domains: rules -> cache -> AI (cached afterwards). */
export async function resolveVerdicts(
  domains: string[],
  opts: { skipCache?: boolean } = {},
): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  const unknown: string[] = [];

  const cache = opts.skipCache ? new Map<string, Verdict>() : await loadCache(domains);

  for (const domain of new Set(domains)) {
    const rule = ruleVerdict(domain);
    if (rule) {
      out.set(domain, rule);
      continue;
    }
    const cached = cache.get(rootDomain(domain));
    // Manual overrides always win, even on a forced re-check.
    if (cached && (cached.source === "manual" || !opts.skipCache) && cached.isAgency !== null) {
      out.set(domain, cached);
      continue;
    }
    if (opts.skipCache) {
      const manual = (await loadCache([domain])).get(rootDomain(domain));
      if (manual?.source === "manual") {
        out.set(domain, manual);
        continue;
      }
    }
    unknown.push(domain);
  }

  if (unknown.length > 0) {
    for (let i = 0; i < unknown.length; i += 20) {
      const batch = unknown.slice(i, i + 20);
      const verdicts = await classifyDomains({ data: { domains: batch } });
      for (const v of verdicts) {
        out.set(v.domain, {
          isAgency: v.isAgency,
          reason: v.reason,
          source: "ai",
          companyName: v.companyName,
        });
        if (v.isAgency !== null) {
          await saveVerdict(v.domain, {
            isAgency: v.isAgency,
            reason: v.reason,
            source: "ai",
            companyName: v.companyName,
          });
        }
      }
    }
  }

  return out;
}

/** Walk the SERP from #1 and take the first two agencies, preserving the live URL. */
export function pickCompetitors(
  serp: SerpRow[],
  verdicts: Map<string, Verdict>,
): { evaluated: Evaluated[]; competitors: Evaluated[]; needsReview: boolean } {
  const evaluated: Evaluated[] = [];
  const competitors: Evaluated[] = [];
  let needsReview = false;

  for (const row of serp) {
    const verdict = verdicts.get(row.domain) ?? {
      isAgency: null,
      reason: "No classification available",
      source: "ai" as const,
    };
    const alreadyPicked = competitors.some((c) => rootDomain(c.domain) === rootDomain(row.domain));
    const select = verdict.isAgency === true && competitors.length < 2 && !alreadyPicked;
    const item: Evaluated = {
      ...row,
      isAgency: verdict.isAgency,
      reason: verdict.reason,
      source: verdict.source,
      companyName: verdict.companyName ?? null,
      selected: select,
    };
    if (verdict.isAgency === null) needsReview = true;
    if (select) competitors.push(item);
    evaluated.push(item);
    if (competitors.length === 2) break;
  }

  return { evaluated, competitors, needsReview };
}

export async function analyzeKeyword(
  keyword: string,
  database: string,
  opts: { skipCache?: boolean } = {},
): Promise<KeywordResult> {
  const data = await fetchKeywordData({ data: { keyword, database, serpDepth: 20 } });
  if (data.error) {
    return {
      keyword,
      kd: data.kd,
      evaluated: [],
      competitors: [],
      needsReview: true,
      error: data.error,
      fetchedAt: new Date().toISOString(),
    };
  }
  const verdicts = await resolveVerdicts(
    data.serp.map((r) => r.domain),
    opts,
  );
  const { evaluated, competitors, needsReview } = pickCompetitors(data.serp, verdicts);
  return {
    keyword,
    kd: data.kd,
    evaluated,
    competitors,
    needsReview: needsReview || data.kd === null,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Re-run classification on already fetched SERP rows (no new Semrush calls). */
export async function reclassify(
  result: KeywordResult,
  opts: { skipCache?: boolean } = {},
): Promise<KeywordResult> {
  if (result.evaluated.length === 0) return result;
  const serp: SerpRow[] = result.evaluated.map(({ position, url, domain }) => ({ position, url, domain }));
  const verdicts = await resolveVerdicts(
    serp.map((r) => r.domain),
    opts,
  );
  const { evaluated, competitors, needsReview } = pickCompetitors(serp, verdicts);
  return { ...result, evaluated, competitors, needsReview: needsReview || result.kd === null };
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
