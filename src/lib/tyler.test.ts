// @ts-expect-error bun:test types are provided by the Bun runtime
import { describe, expect, test } from "bun:test";
import { parseBatchesText, parseBatchesJson, parseBatchesCsv, stripVolume } from "./batch-core";

const TYLER = `## Page Rank #36 — Tyler Web Design — USA
**URL:** /us/tyler-web-design/
**Country:** USA
**Keywords:** 6
**Total Volume:** 2,700

### Primary Keywords
- web design tyler tx — 1,300
- tyler web design - 590

### Secondary Keywords (2)
- website design tyler (Volume: 320)
- tyler web design - 590

### Tertiary
- web designer tyler texas — 260
- tyler tx website design (Volume: 40)
`;

describe("Tyler Web Design markdown import", () => {
  const [d] = parseBatchesText(TYLER);
  test("keeps page metadata", () => {
    expect(d!.rank).toBe("36");
    expect(d!.name).toBe("Tyler Web Design — USA");
    expect(d!.targetUrl).toBe("/us/tyler-web-design/");
    expect(d!.country).toBe("USA");
    expect(d!.database).toBe("us");
  });
  test("strips volumes, skips headings/metadata, keeps order and duplicates", () => {
    expect(d!.keywords).toEqual([
      "web design tyler tx", "tyler web design", "website design tyler",
      "tyler web design", "web designer tyler texas", "tyler tx website design",
    ]);
    expect(d!.expectedCount).toBe(6);
    expect(d!.warnings).toEqual([]);
  });
});

describe("volume stripping on JSON and CSV", () => {
  test("stripVolume formats", () => {
    expect(stripVolume("keyword — 1,300")).toBe("keyword");
    expect(stripVolume("keyword - 590")).toBe("keyword");
    expect(stripVolume("keyword (Volume: 320)")).toBe("keyword");
    expect(stripVolume("web design 2024")).toBe("web design 2024");
    expect(stripVolume("st. petersburg web design")).toBe("st. petersburg web design");
  });
  test("JSON", () => {
    const [b] = parseBatchesJson(JSON.stringify([{ name: "Tyler", keywords: ["web design tyler tx — 1,300", "tyler web design - 590", "tyler web design - 590"] }]));
    expect(b!.keywords).toEqual(["web design tyler tx", "tyler web design", "tyler web design"]);
  });
  test("CSV", () => {
    const [b] = parseBatchesCsv('page_name,keyword\nTyler,"web design tyler tx — 1,300"\nTyler,website design tyler (Volume: 320)\n');
    expect(b!.keywords).toEqual(["web design tyler tx", "website design tyler"]);
  });
});
