// @ts-expect-error bun:test types are provided by the Bun runtime
import { describe, expect, test } from "bun:test";
import {
  MAX_BATCHES,
  buildManifest,
  formatBatchTxt,
  initialStates,
  parseBatchesCsv,
  parseBatchesJson,
  runQueue,
  type AnalyzeFn,
} from "./batch-core";

const ok = (k: string, urls: [number, string][]) => ({ keyword: k, error: null, competitors: urls.map(([position, url]) => ({ position, url })) });

describe("batch parsing", () => {
  test("allows 100 batches and rejects 101", () => {
    const mk = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `P${i}`, keywords: ["a"] })));
    expect(parseBatchesJson(mk(MAX_BATCHES)).length).toBe(100);
    expect(() => parseBatchesJson(mk(101))).toThrow();
  });
  test("CSV groups by page and keeps duplicate keywords", () => {
    const b = parseBatchesCsv("page_name,target_url,database,keyword\nA,/a/,us,x\nA,/a/,us,x\nB,/b/,uk,y\n");
    expect(b.length).toBe(2);
    expect(b[0]!.keywords).toEqual(["x", "x"]);
    expect(b[1]!.database).toBe("uk");
  });
});

describe("export", () => {
  test("TXT lists every keyword, ranks by position, no KD", () => {
    const [s] = initialStates(parseBatchesJson(JSON.stringify([{ name: "P", keywords: ["k1", "k1", "k2"] }])));
    s!.results = [ok("k1", [[8, "https://b"], [3, "https://a"]]), ok("k1", [[1, "https://c"]]), { keyword: "k2", competitors: [], error: "boom" }];
    const txt = formatBatchTxt(s!);
    expect(txt).toContain("k1\n#1\nhttps://a\n#2\nhttps://b");
    expect(txt).toContain("k1\n#1\nhttps://c\nNo second competitor");
    expect(txt).toContain("k2\nNeeds Review (boom)");
    expect(txt).not.toContain("KD");
  });
});

describe("queue", () => {
  test("retries failed keywords, keeps going after a failed batch, drops nothing", async () => {
    const states = initialStates(
      parseBatchesJson(JSON.stringify([
        { name: "A", keywords: ["a1", "a2"] },
        { name: "B", keywords: ["b1"] },
        { name: "C", keywords: ["c1"] },
      ])),
    );
    let a2Calls = 0;
    const analyze: AnalyzeFn = async (kws) => {
      if (kws.includes("b1")) throw new Error("Semrush down");
      return kws.map((k) => {
        if (k === "a2" && ++a2Calls === 1) return { keyword: k, competitors: [], error: "429" };
        return ok(k, [[1, `https://${k}`]]);
      });
    };
    const out = await runQueue(states, analyze, { sleep: async () => {}, retries: 2 });
    expect(out.map((s) => s.status)).toEqual(["done", "failed", "done"]);
    expect(a2Calls).toBe(2);
    const m = buildManifest(out);
    expect(m.entries[1]!.failedKeywords).toEqual([{ keyword: "b1", error: "Semrush down" }]);
    expect(formatBatchTxt(out[1]!)).toContain("b1\nNeeds Review");
  });
});

import { parseBatchesText } from "./batch-core";
describe("text import", () => {
  const txt = `PAGE Houston Web Design — USA
Page Rank: #33
URL: /us/houston-web-design/
Country: USA
Keywords: 39 → 42
Volume: 9450 → 9680
Avg KD: 24.62 → 24.10
Opportunity: 319.09 → 332.70
web design houston; houston website design; houston website design

Page: St Petersburg Web Design — USA
Page Rank: #34
URL: /us/st-petersburg-web-design/
Country: USA
Keywords: 2
Hierarchy Changes: None
st petersburg web design
st. petersburg web design
web design st petersburg fl website design firm st petersburg st petersburg web design`;
  test("splits pages, keeps metadata out of keywords, keeps duplicates", () => {
    const d = parseBatchesText(txt);
    expect(d.length).toBe(2);
    expect(d[0]!.keywords).toEqual(["web design houston", "houston website design", "houston website design"]);
    expect(d[0]!.rank).toBe("33");
    expect(d[0]!.database).toBe("us");
    expect(d[0]!.expectedCount).toBe(42);
    expect(d[0]!.meta["Avg KD"]).toBe("24.62 → 24.10");
    expect(d[0]!.warnings.some((w) => w.includes("mismatch"))).toBe(true);
  });
  test("flags run-together phrases instead of guessing", () => {
    const d = parseBatchesText(txt)[1]!;
    expect(d.keywords.length).toBe(3);
    expect(d.ambiguous.length).toBe(1);
    expect(d.warnings.some((w) => w.includes("several phrases"))).toBe(true);
  });
});
