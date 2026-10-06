/**
 * Pure classification/selection engine. No network or database imports so it can be
 * unit-tested with fakes. Order of authority: manual override -> deterministic rule ->
 * persistent cache -> AI (only for domains whose verdict can still change a pick).
 */
import { contentPageReason, rootDomain, ruleVerdict, type Verdict } from "@/lib/agency-rules";

export type SerpRow = { position: number; url: string; domain: string };

export type Evaluated = SerpRow & {
  isAgency: boolean | null;
  reason: string;
  source: Verdict["source"];
  companyName?: string | null;
  selected: boolean;
};

export type AiVerdict = {
  domain: string;
  isAgency: boolean | null;
  companyName: string | null;
  reason: string;
};

export type ClassifyOutcome = {
  verdicts: AiVerdict[];
  error: null | { kind: "credits" | "rate" | "other"; message: string };
};

export type CachedVerdict = Verdict & { stored: "manual" | "ai" };

export type EngineDeps = {
  loadCache: (domains: string[]) => Promise<Map<string, CachedVerdict>>;
  saveVerdict: (
    domain: string,
    v: { isAgency: boolean | null; reason: string; companyName: string | null },
  ) => Promise<void>;
  classify: (domains: string[]) => Promise<ClassifyOutcome>;
};

export const AI_UNAVAILABLE_REASON = "AI classification unavailable — manual review required";
export const AI_BATCH_SIZE = 40;

export class ClassifierSession {
  private verdicts = new Map<string, Verdict>();
  private cacheLoaded = new Set<string>();
  private aiAttempted = new Set<string>();
  aiRequests = 0;
  aiDisabledReason: string | null = null;

  constructor(
    private deps: EngineDeps,
    private opts: { retryUndecided?: boolean } = {},
  ) {}

  get(domain: string): Verdict | undefined {
    return this.verdicts.get(rootDomain(domain));
  }

  /** Rules + cache only. Never calls AI. */
  async resolveLocal(domains: string[]): Promise<void> {
    const keys = Array.from(new Set(domains.map(rootDomain))).filter(
      (d) => !this.cacheLoaded.has(d),
    );
    if (keys.length === 0) return;
    let cache = new Map<string, CachedVerdict>();
    try {
      cache = await this.deps.loadCache(keys);
    } catch (e) {
      console.error("Classification cache read failed", e);
    }
    for (const d of keys) {
      this.cacheLoaded.add(d);
      const cached = cache.get(d);
      if (cached?.stored === "manual") {
        this.verdicts.set(d, { ...cached, source: "manual" });
        continue;
      }
      const rule = ruleVerdict(d);
      if (rule) {
        this.verdicts.set(d, rule);
        continue;
      }
      if (cached && (cached.isAgency !== null || !this.opts.retryUndecided)) {
        this.verdicts.set(d, { ...cached, source: "cache" });
      }
    }
  }

  /** AI for still-unresolved domains, deduplicated, in as few requests as possible. */
  async resolveWithAi(domains: string[]): Promise<void> {
    const pending = Array.from(new Set(domains.map(rootDomain))).filter(
      (d) => !this.verdicts.has(d) && !this.aiAttempted.has(d),
    );
    for (let i = 0; i < pending.length; i += AI_BATCH_SIZE) {
      const batch = pending.slice(i, i + AI_BATCH_SIZE);
      batch.forEach((d) => this.aiAttempted.add(d));
      if (this.aiDisabledReason) {
        this.markUnavailable(batch, this.aiDisabledReason);
        continue;
      }
      let outcome: ClassifyOutcome;
      this.aiRequests++;
      try {
        outcome = await this.deps.classify(batch);
      } catch (e) {
        outcome = {
          verdicts: [],
          error: { kind: "other", message: e instanceof Error ? e.message : "AI request failed" },
        };
      }
      if (outcome.error) {
        if (outcome.error.kind !== "other") this.aiDisabledReason = outcome.error.message;
        this.markUnavailable(batch, outcome.error.message);
        continue;
      }
      const byDomain = new Map(outcome.verdicts.map((v) => [rootDomain(v.domain), v]));
      for (const d of batch) {
        const v = byDomain.get(d);
        const verdict: Verdict = v
          ? { isAgency: v.isAgency, reason: v.reason, source: "ai", companyName: v.companyName }
          : { isAgency: null, reason: "Classifier returned no verdict — needs review", source: "ai" };
        this.verdicts.set(d, verdict);
        if (v) {
          try {
            await this.deps.saveVerdict(d, {
              isAgency: v.isAgency,
              reason: v.reason,
              companyName: v.companyName,
            });
          } catch (e) {
            console.error("Classification cache write failed", e);
          }
        }
      }
    }
  }

  private markUnavailable(domains: string[], cause: string) {
    for (const d of domains) {
      this.verdicts.set(d, { isAgency: null, reason: `${AI_UNAVAILABLE_REASON} (${cause})`, source: "ai" });
    }
  }
}

/** Domains whose verdict is unknown and could still affect the first two picks. */
export function neededDomains(serp: SerpRow[], session: ClassifierSession): string[] {
  const needed: string[] = [];
  const picked = new Set<string>();
  for (const row of serp) {
    const root = rootDomain(row.domain);
    if (picked.has(root) || contentPageReason(row.url)) continue;
    const v = session.get(root);
    if (!v) needed.push(root);
    else if (v.isAgency === true) {
      picked.add(root);
      if (picked.size === 2) break;
    }
  }
  return needed;
}

/** Resolve every SERP in a run with one shared, deduplicated AI queue. */
export async function resolveRun(serps: SerpRow[][], session: ClassifierSession): Promise<void> {
  await session.resolveLocal(serps.flat().map((r) => r.domain));
  // A few rounds: a domain that turns out NOT to be an agency may expose deeper rows.
  for (let round = 0; round < 6; round++) {
    const needed = Array.from(new Set(serps.flatMap((s) => neededDomains(s, session))));
    if (needed.length === 0) return;
    await session.resolveWithAi(needed);
  }
}

/** Walk the SERP from #1 and take the first two agencies, preserving the live URL. */
export function pickCompetitors(
  serp: SerpRow[],
  session: { get: (d: string) => Verdict | undefined },
): { evaluated: Evaluated[]; competitors: Evaluated[]; needsReview: boolean } {
  const evaluated: Evaluated[] = [];
  const competitors: Evaluated[] = [];
  let needsReview = false;

  for (const row of serp) {
    const contentReason = contentPageReason(row.url);
    const known = session.get(row.domain);
    const verdict: Verdict =
      known ??
      (contentReason
        ? { isAgency: null, reason: "Not classified (page would be skipped anyway)", source: "rule" }
        : { isAgency: null, reason: AI_UNAVAILABLE_REASON, source: "ai" });
    const alreadyPicked = competitors.some((c) => rootDomain(c.domain) === rootDomain(row.domain));
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
    if (verdict.isAgency === null && !(contentReason && !known)) needsReview = true;
    if (select) competitors.push(item);
    evaluated.push(item);
    if (competitors.length === 2) break;
  }

  return { evaluated, competitors, needsReview };
}
