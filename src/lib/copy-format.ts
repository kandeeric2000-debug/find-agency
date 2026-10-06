/**
 * Plain-text copy formatting for the Copy Results button.
 * Pure functions only — no network, database or app imports so it can be
 * unit-tested deterministically.
 */
import type { KeywordResult, PageResult } from "@/lib/analysis";

/**
 * Competitors are numbered in ranking order: #1 is the selected competitor
 * with the better (lower) SERP position, #2 the next one. The actual selection
 * happens in the analysis engine; this only orders and labels the copy output.
 */
function rankOrderedCompetitors(r: KeywordResult) {
  return [...r.competitors].sort(
    (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
  );
}

export function formatKeywordBlock(r: KeywordResult): string {
  const head = `${r.keyword} — KD ${r.kd ?? "??"}`;
  if (r.error) return `${head}\nNeeds Review (${r.error})`;
  const ordered = rankOrderedCompetitors(r);
  if (ordered.length === 0) return `${head}\nNo competitors`;
  if (ordered.length === 1) return `${head}\n#1\n${ordered[0]!.url}\nNo second competitor`;
  return `${head}\n#1\n${ordered[0]!.url}\n#2\n${ordered[1]!.url}`;
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
