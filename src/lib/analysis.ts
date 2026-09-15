import { supabase } from "@/integrations/supabase/client";
import { classifyDomains, fetchKeywordData, type SerpRow } from "@/lib/semrush.functions";
import { ruleVerdict, rootDomain, contentPageReason, type Verdict } from "@/lib/agency-rules";

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
    // Older AI rows were based only on a domain name. Do not reuse them.
    if (row.source !== "manual" && row.source !== "ai-evidence-v2") continue;
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

/** Resolve verdicts for a set of domains: rules -> cache -> AI (cached afterwards). */
export async function resolveVerdicts(
  domains: string[],
  opts: { skipCache?: boolean } = {},
): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  const unknown: string[] = [];

  const normalized = Array.from(new Set(domains.map(rootDomain)));
  const cache = await loadCache(normalized);

  for (const domain of normalized) {
    const cached = cache.get(domain);
    // A person's decision is authoritative, including over deterministic rules.
    if (cached?.source === "manual") {
      out.set(domain, cached);
      continue;
    }
    const rule = ruleVerdict(domain);
    if (rule) {
      out.set(domain, rule);
      continue;
    }
    if (cached && !opts.skipCache) {
      out.set(domain, cached);
      continue;
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
            source: "ai-evidence-v2",
            companyName: v.companyName,
          });
        } else {
          await saveVerdict(v.domain, {
            isAgency: null,
            reason: v.reason,
            source: "ai-evidence-v2",
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
    // Only the company behind the domain matters — page type / URL structure is irrelevant.
    const verdict = verdicts.get(rootDomain(row.domain)) ?? {
        isAgency: null,
        reason: "No classification available",
        source: "ai" as const,
      };
    const alreadyPicked = competitors.some((c) => rootDomain(c.domain) === rootDomain(row.domain));
    // Blog/article ranking pages are skipped, even for agencies.
    const contentReason = contentPageReason(row.url);
    const select =
      verdict.isAgency === true && !contentReason && competitors.length < 2 && !alreadyPicked;
    const item: Evaluated = {
      ...row,
      isAgency: verdict.isAgency,
      reason: contentReason
        ? `${verdict.reason} — skipped: ${contentReason.toLowerCase()}`
        : verdict.reason,
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
  const data = await fetchKeywordData({ data: { keyword, database, serpDepth: 50 } });
  if (data.error) {
    return {
      keyword,
      kd: data.kd,
      serp: [],
      evaluated: [],
      competitors: [],
      needsReview: true,
      error: data.error,
      fetchedAt: new Date().toISOString(),
    };
  }
  const verdicts = new Map<string, Verdict>();
  let selection = { evaluated: [] as Evaluated[], competitors: [] as Evaluated[], needsReview: false };
  for (let i = 0; i < data.serp.length; i += 10) {
    const rows = data.serp.slice(i, i + 10);
    const batch = await resolveVerdicts(rows.map((r) => r.domain), opts);
    for (const [domain, verdict] of batch) verdicts.set(domain, verdict);
    selection = pickCompetitors(data.serp.slice(0, i + 10), verdicts);
    if (selection.competitors.length === 2) break;
  }
  const { evaluated, competitors, needsReview } = selection;
  return {
    keyword,
    kd: data.kd,
    serp: data.serp,
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
  const serp: SerpRow[] = result.serp?.length
    ? result.serp
    : result.evaluated.map(({ position, url, domain }) => ({ position, url, domain }));
  if (serp.length === 0) return result;
  const verdicts = new Map<string, Verdict>();
  let selection = { evaluated: [] as Evaluated[], competitors: [] as Evaluated[], needsReview: false };
  for (let i = 0; i < serp.length; i += 10) {
    const batch = await resolveVerdicts(serp.slice(i, i + 10).map((r) => r.domain), opts);
    for (const [domain, verdict] of batch) verdicts.set(domain, verdict);
    selection = pickCompetitors(serp.slice(0, i + 10), verdicts);
    if (selection.competitors.length === 2) break;
  }
  return {
    ...result,
    serp,
    ...selection,
    needsReview: selection.needsReview || result.kd === null,
  };
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
