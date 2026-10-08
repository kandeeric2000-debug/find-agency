/**
 * Pure batch-queue logic shared by the app UI, the public batch API route and
 * the GitHub Actions runner script. No network, no "@/" imports.
 */

export const MAX_BATCHES = 100;

export type BatchInput = {
  id: string;
  name: string;
  rank: string;
  targetUrl: string;
  country: string;
  database: string;
  keywords: string[];
};

/** Minimal shape of a keyword result needed for exports. */
export type BatchKeywordResult = {
  keyword: string;
  competitors: { position: number; url: string }[];
  needsReview?: boolean;
  error: string | null;
};

export type BatchStatus = "pending" | "running" | "done" | "partial" | "failed";

export type BatchState = {
  batch: BatchInput;
  status: BatchStatus;
  results: BatchKeywordResult[];
  error: string | null;
  attempts: number;
  finishedAt: string | null;
};

// ---------- parsing ----------

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Remove a trailing search-volume value: "kw — 1,300", "kw - 590", "kw (Volume: 320)",
 * "kw — Volume: 1.2k", "kw\t880". Plain trailing numbers without a separator are kept.
 */
export function stripVolume(s: string): string {
  return s
    .replace(/\s*\(\s*(?:(?:search\s*)?vol(?:ume)?\.?\s*[:=]?\s*)?[\d][\d,.]*\s*[kKmM]?\s*\)\s*$/i, "")
    .replace(/\s+[—–-]+\s*(?:(?:search\s*)?vol(?:ume)?\.?\s*[:=]?\s*)?[\d][\d,.]*\s*[kKmM]?\s*$/i, "")
    .replace(/\s*[—–-]?\s*(?:search\s*)?vol(?:ume)?\.?\s*[:=]\s*[\d][\d,.]*\s*[kKmM]?\s*$/i, "")
    .replace(/\t+[\d][\d,.]*\s*[kKmM]?\s*$/, "")
    .trim();
}

function splitKeywords(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map(str) : str(v).split(/\r?\n|;/).map((s) => s.trim());
  return list.map(stripVolume).filter(Boolean); // duplicates are kept on purpose: never drop entries
}

let idCounter = 0;
function makeId(i: number): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}-${i}-${idCounter}`;
}

type RawBatch = { name?: unknown; page?: unknown; page_name?: unknown; pageName?: unknown; database?: unknown; db?: unknown; keywords?: unknown; rank?: unknown; page_rank?: unknown; pageRank?: unknown; targetUrl?: unknown; target_url?: unknown; url?: unknown; country?: unknown };

function normalizeBatch(raw: RawBatch, i: number): BatchInput {
  const name = str(raw.name ?? raw.page ?? raw.page_name ?? raw.pageName);
  const database = (str(raw.database ?? raw.db) || "us").toLowerCase();
  const keywords = splitKeywords(raw.keywords);
  if (!name) throw new Error(`Batch ${i + 1}: page name is required`);
  if (!/^[a-z]{2}$/.test(database)) throw new Error(`Batch ${i + 1} (${name}): invalid database "${database}"`);
  if (keywords.length === 0) throw new Error(`Batch ${i + 1} (${name}): no keywords`);
  return {
    id: makeId(i),
    name,
    rank: str(raw.rank ?? raw.page_rank ?? raw.pageRank).replace(/^#/, ""),
    targetUrl: str(raw.targetUrl ?? raw.target_url ?? raw.url),
    country: str(raw.country) || database.toUpperCase(),
    database,
    keywords,
  };
}

function checkCount(batches: BatchInput[]): BatchInput[] {
  if (batches.length === 0) throw new Error("No batches found");
  if (batches.length > MAX_BATCHES) throw new Error(`Too many batches: ${batches.length} (max ${MAX_BATCHES})`);
  return batches;
}

/** JSON: an array of batches, or { batches: [...] }. */
export function parseBatchesJson(text: string): BatchInput[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : (data as { batches?: unknown[] })?.batches;
  if (!Array.isArray(list)) throw new Error('JSON must be an array or { "batches": [...] }');
  return checkCount(list.map((b, i) => normalizeBatch(b as RawBatch, i)));
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * CSV: header row with page_name, keyword (required) and optional
 * target_url, country, database, rank. One row per keyword; rows sharing
 * page_name + target_url + database form one batch, in first-seen order.
 */
export function parseBatchesCsv(text: string): BatchInput[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one keyword row");
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = col("page_name", "page", "name");
  const iKw = col("keyword", "keywords");
  if (iName < 0 || iKw < 0) throw new Error("CSV must have page_name and keyword columns");
  const iUrl = col("target_url", "url");
  const iCountry = col("country");
  const iDb = col("database", "db");
  const iRank = col("rank", "page_rank");
  const groups = new Map<string, RawBatch & { keywords: string[] }>();
  rows.slice(1).forEach((r, n) => {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const name = get(iName);
    const kw = get(iKw);
    if (!name) throw new Error(`CSV row ${n + 2}: page_name is empty`);
    if (!kw) throw new Error(`CSV row ${n + 2}: keyword is empty`);
    const db = (get(iDb) || "us").toLowerCase();
    const key = `${name}\u0000${get(iUrl)}\u0000${db}`;
    let g = groups.get(key);
    if (!g) {
      g = { name, targetUrl: get(iUrl), country: get(iCountry), database: db, rank: get(iRank), keywords: [] };
      groups.set(key, g);
    }
    g.keywords.push(...splitKeywords(kw));
  });
  return checkCount([...groups.values()].map((g, i) => normalizeBatch(g, i)));
}

export function parseBatchesFile(fileName: string, text: string): BatchInput[] {
  const trimmed = text.trim();
  if (/\.json$/i.test(fileName) || trimmed.startsWith("[") || trimmed.startsWith("{")) return parseBatchesJson(text);
  return parseBatchesCsv(text);
}

// ---------- export ----------

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "batch";
}

export function batchFileName(batch: BatchInput, index: number): string {
  return `${String(index + 1).padStart(3, "0")}-${slugify(batch.name)}.txt`;
}

/** UTF-8 TXT: page metadata, then every input keyword with #1/#2 URLs. No KD/volume. */
export function formatBatchTxt(state: BatchState): string {
  const b = state.batch;
  const lines = [`Page: ${b.name}`];
  if (b.rank) lines.push(`Page Rank: #${b.rank}`);
  if (b.targetUrl) lines.push(`URL: ${b.targetUrl}`);
  lines.push(`Country: ${b.country}`, `Database: ${b.database}`, "");
  // Pair results to inputs by position so repeated keywords stay separate.
  const pool = [...state.results];
  for (const kw of b.keywords) {
    const idx = pool.findIndex((r) => r.keyword.toLowerCase() === kw.toLowerCase());
    const r = idx >= 0 ? pool.splice(idx, 1)[0]! : null;
    lines.push(kw);
    if (!r) lines.push(`Needs Review (not analyzed${state.error ? `: ${state.error}` : ""})`);
    else if (r.error) lines.push(`Needs Review (${r.error})`);
    else {
      const c = [...r.competitors].sort((a, b) => a.position - b.position).slice(0, 2);
      if (c.length === 0) lines.push(r.needsReview ? "Needs Review (no confirmed agency)" : "No competitors");
      c.forEach((x, i) => lines.push(`#${i + 1}`, x.url));
      if (c.length === 1) lines.push("No second competitor");
    }
    lines.push("");
  }
  return lines.join("\n");
}

export type ManifestEntry = {
  index: number;
  file: string;
  page: string;
  database: string;
  status: BatchStatus;
  keywords: number;
  analyzed: number;
  failedKeywords: { keyword: string; error: string }[];
  error: string | null;
};

export function buildManifest(states: BatchState[]) {
  const entries: ManifestEntry[] = states.map((s, i) => {
    const failed: { keyword: string; error: string }[] = [];
    const pool = [...s.results];
    for (const kw of s.batch.keywords) {
      const idx = pool.findIndex((r) => r.keyword.toLowerCase() === kw.toLowerCase());
      const r = idx >= 0 ? pool.splice(idx, 1)[0]! : null;
      if (!r) failed.push({ keyword: kw, error: s.error ?? "not analyzed" });
      else if (r.error) failed.push({ keyword: kw, error: r.error });
    }
    return {
      index: i + 1,
      file: batchFileName(s.batch, i),
      page: s.batch.name,
      database: s.batch.database,
      status: s.status,
      keywords: s.batch.keywords.length,
      analyzed: s.batch.keywords.length - failed.length,
      failedKeywords: failed,
      error: s.error,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    batches: entries.length,
    succeeded: entries.filter((e) => e.status === "done").length,
    partial: entries.filter((e) => e.status === "partial").length,
    failed: entries.filter((e) => e.status === "failed" || e.status === "pending" || e.status === "running").length,
    entries,
  };
}

// ---------- queue runner ----------

export type AnalyzeFn = (keywords: string[], database: string) => Promise<BatchKeywordResult[]>;

export type RunOptions = {
  concurrency?: number;
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onUpdate?: (index: number, state: BatchState) => void;
  shouldStop?: () => boolean;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Merge retried results back into the original slots (by keyword occurrence). */
function mergeRetries(prev: BatchKeywordResult[], retried: BatchKeywordResult[]): BatchKeywordResult[] {
  const pool = [...retried];
  return prev.map((r) => {
    if (!r.error) return r;
    const i = pool.findIndex((x) => x.keyword.toLowerCase() === r.keyword.toLowerCase());
    return i >= 0 ? pool.splice(i, 1)[0]! : r;
  });
}

export async function runBatch(state: BatchState, analyze: AnalyzeFn, opts: RunOptions = {}): Promise<BatchState> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? 2000;
  const sleep = opts.sleep ?? defaultSleep;
  const b = state.batch;
  // Resume: keep successful results, redo only what is missing or failed.
  let results: BatchKeywordResult[] = state.results.length === b.keywords.length ? state.results : [];
  let error: string | null = null;
  let attempts = state.attempts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const todo = results.length ? results.filter((r) => r.error).map((r) => r.keyword) : b.keywords;
    if (todo.length === 0) break;
    if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
    attempts++;
    try {
      const got = await analyze(todo, b.database);
      if (got.length !== todo.length) throw new Error(`Expected ${todo.length} results, got ${got.length}`);
      results = results.length ? mergeRetries(results, got) : got;
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const failed = results.length === 0 ? b.keywords.length : results.filter((r) => r.error).length;
  const status: BatchStatus = failed === 0 ? "done" : failed === b.keywords.length ? "failed" : "partial";
  return { ...state, results, error, attempts, status, finishedAt: new Date().toISOString() };
}

/** Run every unfinished batch with a bounded worker pool. Never throws per batch. */
export async function runQueue(states: BatchState[], analyze: AnalyzeFn, opts: RunOptions = {}): Promise<BatchState[]> {
  const out = [...states];
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, 6));
  const queue = out.map((s, i) => i).filter((i) => out[i]!.status !== "done");
  const worker = async () => {
    while (queue.length && !opts.shouldStop?.()) {
      const i = queue.shift()!;
      out[i] = { ...out[i]!, status: "running" };
      opts.onUpdate?.(i, out[i]!);
      try {
        out[i] = await runBatch(out[i]!, analyze, opts);
      } catch (e) {
        out[i] = { ...out[i]!, status: "failed", error: e instanceof Error ? e.message : String(e) };
      }
      opts.onUpdate?.(i, out[i]!);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

export function initialStates(batches: BatchInput[]): BatchState[] {
  return batches.map((batch) => ({ batch, status: "pending", results: [], error: null, attempts: 0, finishedAt: null }));
}

// ---------- free-text (pasted TXT) import ----------

export type TextBatchDraft = {
  name: string;
  rank: string;
  targetUrl: string;
  country: string;
  database: string;
  keywords: string[];
  /** Raw metadata lines exactly as pasted (label -> value). */
  meta: Record<string, string>;
  expectedCount: number | null;
  /** Keyword lines that may hold several phrases with no separator. */
  ambiguous: string[];
  warnings: string[];
};

const COUNTRY_DB: Record<string, string> = {
  usa: "us", us: "us", "united states": "us", uk: "uk", "united kingdom": "uk", gb: "uk", canada: "ca", ca: "ca",
  australia: "au", au: "au", germany: "de", france: "fr", spain: "es", italy: "it", netherlands: "nl", india: "in",
  brazil: "br", mexico: "mx", uae: "ae", "united arab emirates": "ae", sweden: "se", norway: "no", denmark: "dk", singapore: "sg",
};

const META_RE = /^\s*(page\s*rank|rank|url|target\s*url|country|database|db|total\s*(?:search\s*)?volume|total\s*keywords?|keyword\s*count|search\s*volume|volume|avg\.?\s*kd|opportunity|hierarchy\s*changes|keywords?)\b[^:]*:\s*(.*)$/i;
const PAGE_RE = /^\s*page(?!\s*rank)\s*[:\-–—]?\s+(.+)$|^\s*page\s*:\s*(.+)$/i;

/** Last number in a value such as "39 → 42" or "20". */
function lastNumber(v: string): number | null {
  const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  return m ? Number(m[m.length - 1]) : null;
}

function cleanKeyword(s: string): string {
  const t = s.replace(/^\s*(?:[-*+•·]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return stripVolume(t).replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

/** A separator-free line this long is probably several phrases run together. */
function looksAmbiguous(line: string): boolean {
  return line.split(/\s+/).length >= 7;
}

export function parseBatchesText(text: string): TextBatchDraft[] {
  const drafts: TextBatchDraft[] = [];
  let cur: TextBatchDraft | null = null;
  const start = (name: string) => {
    cur = { name: name.trim(), rank: "", targetUrl: "", country: "", database: "", keywords: [], meta: {}, expectedCount: null, ambiguous: [], warnings: [] };
    drafts.push(cur);
  };
  const addKeywords = (raw: string) => {
    if (!cur) return;
    const parts = raw.includes(";") || raw.includes("|") ? raw.split(/[;|]/) : [raw];
    for (const p of parts) {
      const kw = cleanKeyword(p);
      if (!kw) continue;
      if (parts.length === 1 && looksAmbiguous(kw)) cur.ambiguous.push(kw);
      cur.keywords.push(kw);
    }
  };
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    // Markdown: strip bullets/bold so "- **URL:** /x/" reads as metadata.
    const heading = rawLine.match(/^\s*(#{1,6})\s+(.*)$/);
    let line = (heading ? heading[2]! : rawLine).replace(/\*\*|__/g, "").replace(/^\s*[-*+]\s+(?=[^:]{1,40}:)/, "");
    if (!line.trim() || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    // "Page Rank #36 — Tyler Web Design — USA" heading/line starts a page.
    const rankHead = line.match(/^\s*page\s*rank\s*:?\s*#?\s*(\d+)\s*[—–\-:|]+\s*(.+)$/i);
    if (rankHead) {
      start(rankHead[2]!.replace(/^page\s*[:\-–—]?\s*/i, ""));
      cur!.rank = rankHead[1]!;
      continue;
    }
    // Primary / Secondary / Tertiary (and "Keywords") section headings are never keywords.
    const section = line.match(/^\s*(primary|secondary|tertiary|keywords?)\b([^:]*)(?::\s*(.*))?$/i);
    if (section && (heading || section[3] !== undefined || /^\s*(keywords?|\(.*\))?\s*$/i.test(section[2]!))) {
      const inline = (section[3] ?? "").trim();
      const isCount = /^[\d\s.,→\->()]*(?:keywords?)?[\s)]*$/i.test(inline);
      if (cur && inline) {
        const c: TextBatchDraft = cur;
        if (isCount) {
          if (/^keywords?$/i.test(section[1]!)) { c.meta[section[1]!.trim()] = inline; c.expectedCount = lastNumber(inline); }
        } else addKeywords(inline);
      }
      continue;
    }
    if (heading) {
      const page = line.match(PAGE_RE);
      if (heading[1]!.length <= 2 || page) start(page ? (page[1] ?? page[2] ?? "") : line);
      continue;
    }
    const page = line.match(PAGE_RE);
    if (page && !META_RE.test(line)) {
      start((page[1] ?? page[2] ?? "").replace(/^[:\s]+/, ""));
      continue;
    }
    const meta = line.match(META_RE);
    if (meta && cur) {
      const c: TextBatchDraft = cur;
      const label = meta[1]!.toLowerCase().replace(/\s+/g, " ");
      const value = meta[2]!.trim();
      c.meta[meta[1]!.trim()] = value;
      if (/volume/.test(label)) {
        // volume metadata — kept raw, never a keyword
      } else if (/^(total keywords?|keyword count)$/.test(label)) {
        c.expectedCount = lastNumber(value);
      } else if (label.startsWith("keyword")) {
        // "Keywords: 39 → 42" is a count; anything else is an inline keyword list.
        if (/^[\d\s.,→\->]*$/.test(value)) c.expectedCount = lastNumber(value);
        else addKeywords(value);
      } else if (label.includes("rank")) c.rank = value.replace(/^#/, "").trim();
      else if (label.includes("url")) c.targetUrl = value;
      else if (label === "country") c.country = value;
      else if (label === "database" || label === "db") c.database = value.toLowerCase();
      continue;
    }
    addKeywords(line);
  }
  for (const d of drafts) {
    if (!d.database) d.database = COUNTRY_DB[d.country.toLowerCase()] ?? (d.name.match(/—\s*(\w[\w ]*)$/)?.[1] ? COUNTRY_DB[d.name.match(/—\s*(\w[\w ]*)$/)![1]!.toLowerCase()] ?? "" : "");
    if (!d.country && d.database) d.country = d.database.toUpperCase();
    validateDraft(d);
  }
  if (drafts.length > MAX_BATCHES) throw new Error(`Too many batches: ${drafts.length} (max ${MAX_BATCHES})`);
  return drafts;
}

/** Recompute warnings after parsing or editing. */
export function validateDraft(d: TextBatchDraft): TextBatchDraft {
  const w: string[] = [];
  if (!d.name) w.push("Page name is missing");
  if (!/^[a-z]{2}$/.test(d.database)) w.push("Semrush database is missing or invalid");
  if (d.keywords.length === 0) w.push("No keywords found");
  if (d.expectedCount !== null && d.expectedCount !== d.keywords.length)
    w.push(`Keyword count mismatch: metadata says ${d.expectedCount}, found ${d.keywords.length}`);
  d.ambiguous = d.ambiguous.filter((a) => d.keywords.includes(a));
  if (d.ambiguous.length)
    w.push(`${d.ambiguous.length} line(s) may contain several phrases with no separator — put one keyword per line or separate with ";"`);
  d.warnings = w;
  return d;
}

/** Blocking problems (warnings like count mismatch can be confirmed instead). */
export function draftErrors(d: TextBatchDraft): string[] {
  return d.warnings.filter((w) => !w.startsWith("Keyword count mismatch") && !w.includes("several phrases"));
}

export function draftToBatch(d: TextBatchDraft, i: number): BatchInput {
  return normalizeBatch({ name: d.name, rank: d.rank, targetUrl: d.targetUrl, country: d.country, database: d.database, keywords: d.keywords }, i);
}
