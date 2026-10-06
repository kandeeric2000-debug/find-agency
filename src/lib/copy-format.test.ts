// @ts-expect-error bun:test types are provided by the Bun runtime
import { describe, expect, test } from "bun:test";
import { formatKeywordBlock, formatPageBlock } from "@/lib/copy-format";
import type { KeywordResult, PageResult } from "@/lib/analysis";

const competitor = (position: number, url: string) => ({
  position,
  url,
  domain: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]!,
  isAgency: true as const,
  reason: "Agency (test)",
  source: "manual" as const,
  selected: true,
});

const result = (overrides: Partial<KeywordResult>): KeywordResult => ({
  keyword: "website design calgary",
  kd: 18,
  serp: [],
  evaluated: [],
  competitors: [],
  needsReview: false,
  error: null,
  fetchedAt: "2026-10-06T00:00:00.000Z",
  ...overrides,
});

describe("Copy Results formatting", () => {
  test("reversed internal competitor order copies as #1 = better SERP position", () => {
    const r = result({
      competitors: [
        competitor(8, "https://www.example8.com/services"),
        competitor(3, "https://www.example3.com/services"),
      ],
    });
    expect(formatKeywordBlock(r)).toBe(
      "website design calgary — KD 18\n#1\nhttps://www.example3.com/services\n#2\nhttps://www.example8.com/services",
    );
  });

  test("already-ordered competitors keep #1 then #2", () => {
    const r = result({
      competitors: [
        competitor(2, "https://www.first.com/"),
        competitor(11, "https://www.second.com/"),
      ],
    });
    const out = formatKeywordBlock(r);
    expect(out).toBe(
      "website design calgary — KD 18\n#1\nhttps://www.first.com/\n#2\nhttps://www.second.com/",
    );
    expect(out.startsWith("website design calgary — KD 18\n#1\n")).toBe(true);
  });

  test("labels are #1/#2 order, not the actual SERP positions", () => {
    const r = result({
      competitors: [
        competitor(14, "https://www.a.com/"),
        competitor(21, "https://www.b.com/"),
      ],
    });
    const out = formatKeywordBlock(r);
    expect(out).toContain("#1");
    expect(out).toContain("#2");
    expect(out).not.toMatch(/#14|#21/);
  });

  test("missing position falls after positioned competitors", () => {
    const r = result({
      competitors: [
        { ...competitor(9, "https://www.nopos.com/"), position: undefined as unknown as number },
        competitor(4, "https://www.fourth.com/"),
      ],
    });
    expect(formatKeywordBlock(r)).toBe(
      "website design calgary — KD 18\n#1\nhttps://www.fourth.com/\n#2\nhttps://www.nopos.com/",
    );
  });

  test("single competitor and error cases stay terminal", () => {
    expect(formatKeywordBlock(result({ competitors: [competitor(5, "https://www.only.com/")] }))).toBe(
      "website design calgary — KD 18\n#1\nhttps://www.only.com/\nNo second competitor",
    );
    expect(formatKeywordBlock(result({ error: "boom" }))).toBe(
      "website design calgary — KD 18\nNeeds Review (boom)",
    );
    expect(formatKeywordBlock(result({ competitors: [] }))).toBe(
      "website design calgary — KD 18\nNo competitors",
    );
  });

  test("keyword blocks inside a page are separated by one blank line", () => {
    const page: PageResult = {
      pageId: "p1",
      page: { id: "p1", name: "Web Dev", rank: "13", targetUrl: "/uk/web-development/", country: "UK", database: "uk" },
      keywords: [
        result({ keyword: "custom web development", competitors: [competitor(1, "https://www.a.com/"), competitor(2, "https://www.b.com/")] }),
        result({ keyword: "hire web developer", competitors: [competitor(3, "https://www.c.com/"), competitor(9, "https://www.d.com/")] }),
      ],
    };
    const block = formatPageBlock(page);
    expect(block).toContain("#1\nhttps://www.a.com/\n#2\nhttps://www.b.com/\n\nhire web developer");
  });
});
