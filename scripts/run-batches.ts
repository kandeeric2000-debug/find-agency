/**
 * GitHub Actions runner: reads a batch file (JSON or CSV, up to 100 batches),
 * sends keywords in small chunks to the published app's token-protected
 * endpoint (real Semrush + classification), and writes one TXT per batch
 * plus manifest.json into OUT_DIR. Exits non-zero if credentials are missing.
 *
 * Env: APP_URL, BATCH_RUNNER_TOKEN, BATCH_FILE, OUT_DIR (default out),
 *      ONLY (optional comma list of batch-name slugs), CONCURRENCY (default 2).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  batchFileName,
  buildManifest,
  formatBatchTxt,
  initialStates,
  parseBatchesFile,
  runQueue,
  slugify,
  type AnalyzeFn,
  type BatchKeywordResult,
} from "../src/lib/batch-core";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.BATCH_RUNNER_TOKEN ?? "";
const FILE = process.env.BATCH_FILE ?? "";
const OUT = process.env.OUT_DIR || "out";
const CHUNK = 5;

function fail(msg: string): never {
  console.error(`::error::${msg}`);
  process.exit(1);
}
if (!APP_URL) fail("APP_URL is not set (repository variable or workflow input).");
if (!TOKEN) fail("BATCH_RUNNER_TOKEN secret is not set in GitHub Actions secrets.");
if (!FILE) fail("BATCH_FILE is not set.");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postChunk(keywords: string[], database: string): Promise<BatchKeywordResult[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${APP_URL}/api/public/batch-keywords`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-batch-token": TOKEN },
      body: JSON.stringify({ database, keywords }),
    });
    const text = await res.text();
    if (res.ok) return (JSON.parse(text) as { results: BatchKeywordResult[] }).results;
    if (res.status === 401 || res.status === 503) fail(`App rejected the runner [${res.status}]: ${text}`);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 3000 * 2 ** attempt;
      console.warn(`HTTP ${res.status}, retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

const analyze: AnalyzeFn = async (keywords, database) => {
  const out: BatchKeywordResult[] = [];
  for (let i = 0; i < keywords.length; i += CHUNK) {
    const chunk = keywords.slice(i, i + CHUNK);
    try {
      out.push(...(await postChunk(chunk, database)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push(...chunk.map((keyword) => ({ keyword, competitors: [], error: msg })));
    }
  }
  return out;
};

let batches = parseBatchesFile(FILE, readFileSync(FILE, "utf8"));
const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (only.length) {
  batches = batches.filter((b) => only.includes(slugify(b.name)));
  if (batches.length === 0) fail(`No batches match ONLY=${only.join(",")}`);
}
console.log(`Running ${batches.length} batches (${batches.reduce((n, b) => n + b.keywords.length, 0)} keywords)`);

let done = 0;
const states = await runQueue(initialStates(batches), analyze, {
  concurrency: Number(process.env.CONCURRENCY ?? 2),
  retries: 2,
  backoffMs: 5000,
  onUpdate: (i, s) => {
    if (s.status !== "running") console.log(`[${++done}/${batches.length}] ${s.batch.name}: ${s.status}${s.error ? ` (${s.error})` : ""}`);
  },
});

mkdirSync(OUT, { recursive: true });
states.forEach((s, i) => writeFileSync(join(OUT, batchFileName(s.batch, i)), formatBatchTxt(s), "utf8"));
const manifest = buildManifest(states);
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`Done: ${manifest.succeeded} ok, ${manifest.partial} partial, ${manifest.failed} failed`);
if (manifest.succeeded + manifest.partial === 0) process.exit(1);
