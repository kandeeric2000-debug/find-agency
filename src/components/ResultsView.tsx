import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, AlertTriangle } from "lucide-react";
import type { Evaluated, KeywordResult, PageResult } from "@/lib/analysis";

function UrlLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs break-all text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
    >
      {url}
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

function StatusPill({ result }: { result: KeywordResult }) {
  if (result.error) {
    return (
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
        Needs Review
      </span>
    );
  }
  if (result.competitors.length === 2) {
    return (
      <span className="rounded-full bg-agency/15 px-2 py-0.5 text-[11px] font-semibold text-agency">
        2 agencies
      </span>
    );
  }
  if (result.competitors.length === 1) {
    return (
      <span className="rounded-full bg-review/15 px-2 py-0.5 text-[11px] font-semibold text-review">
        1 agency only
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      No competitors
    </span>
  );
}

function AuditRow({
  row,
  onOverride,
}: {
  row: Evaluated;
  onOverride: (domain: string, isAgency: boolean) => void;
}) {
  const verdict =
    row.isAgency === true ? "AGENCY" : row.isAgency === false ? "NOT AGENCY" : "UNDETERMINED";
  const color =
    row.isAgency === true
      ? "text-agency"
      : row.isAgency === false
        ? "text-muted-foreground"
        : "text-review";

  return (
    <li className="border-t border-border/60 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="font-mono text-muted-foreground">#{row.position}</span>
        <span className="font-semibold">{row.companyName || row.domain}</span>
        <span className={`font-mono font-semibold ${color}`}>→ {verdict}</span>
        <span className="text-muted-foreground">
          → {row.selected ? "selected as competitor" : row.isAgency === true ? "extra agency" : "rejected"}
        </span>
        <span className="text-[11px] text-muted-foreground/80">({row.source})</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <UrlLink url={row.url} />
      </div>
      <div className="mt-1.5 flex gap-2">
        <button className="btn-base btn-ghost !px-2 !py-1 !text-[11px]" onClick={() => onOverride(row.domain, true)}>
          Mark AGENCY
        </button>
        <button className="btn-base btn-ghost !px-2 !py-1 !text-[11px]" onClick={() => onOverride(row.domain, false)}>
          Mark NOT AGENCY
        </button>
      </div>
    </li>
  );
}

function KeywordCard({
  result,
  onOverride,
}: {
  result: KeywordResult;
  onOverride: (domain: string, isAgency: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <article className="rounded-lg border border-border bg-surface-raised/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-base font-semibold">{result.keyword}</h4>
        <span className="font-mono text-sm text-accent">KD {result.kd ?? "??"}</span>
        <StatusPill result={result} />
        {result.needsReview && !result.error && (
          <span className="inline-flex items-center gap-1 text-[11px] text-review">
            <AlertTriangle className="size-3" /> some results undetermined
          </span>
        )}
      </div>

      <div className="mt-3 space-y-1">
        {result.error && <p className="text-xs text-destructive">{result.error}</p>}
        {!result.error && result.competitors.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground">No competitors</p>
        )}
        {result.competitors.map((c) => (
          <div key={c.url} className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">#{c.position}</span>
            <UrlLink url={c.url} />
          </div>
        ))}
        {!result.error && result.competitors.length === 1 && (
          <p className="font-mono text-xs text-muted-foreground">No second competitor</p>
        )}
      </div>

      {result.evaluated.length > 0 && (
        <>
          <button
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Audit trail ({result.evaluated.length} SERP results evaluated)
          </button>
          {open && (
            <ul className="mt-1">
              {result.evaluated.map((row) => (
                <AuditRow key={`${row.position}-${row.url}`} row={row} onOverride={onOverride} />
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

export function ResultsView({
  pages,
  view,
  onOverride,
}: {
  pages: PageResult[];
  view: "grouped" | "table";
  onOverride: (domain: string, isAgency: boolean) => void;
}) {
  return (
    <div className="space-y-8">
      {pages.map((page) => (
        <section key={page.pageId} className="panel p-5">
          <header className="mb-4 border-b border-border pb-3">
            <h3 className="font-display text-lg font-bold">
              Page: {page.page.name || "(unnamed)"} — {page.page.country}
            </h3>
            <dl className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
              {page.page.rank && <div>Page Rank: #{page.page.rank}</div>}
              {page.page.targetUrl && <div>URL: {page.page.targetUrl}</div>}
              <div>Country: {page.page.country}</div>
            </dl>
          </header>

          {view === "grouped" ? (
            <div className="space-y-3">
              {page.keywords.map((k) => (
                <KeywordCard key={k.keyword} result={k} onOverride={onOverride} />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="py-2 pr-3">Keyword</th>
                    <th className="py-2 pr-3">KD</th>
                    <th className="py-2 pr-3">Competitor 1</th>
                    <th className="py-2 pr-3">SERP Pos.</th>
                    <th className="py-2 pr-3">Competitor 2</th>
                    <th className="py-2">SERP Pos.</th>
                  </tr>
                </thead>
                <tbody>
                  {page.keywords.map((k) => (
                    <tr key={k.keyword} className="border-t border-border align-top">
                      <td className="py-2 pr-3 font-semibold">{k.keyword}</td>
                      <td className="py-2 pr-3 font-mono text-accent">{k.kd ?? "??"}</td>
                      <td className="max-w-[22rem] py-2 pr-3">
                        {k.competitors[0] ? (
                          <UrlLink url={k.competitors[0].url} />
                        ) : (
                          <span className="text-muted-foreground">
                            {k.error || k.needsReview ? "Needs Review" : "No competitors"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono">{k.competitors[0]?.position ?? "—"}</td>
                      <td className="max-w-[22rem] py-2 pr-3">
                        {k.competitors[1] ? (
                          <UrlLink url={k.competitors[1].url} />
                        ) : (
                          <span className="text-muted-foreground">No second competitor</span>
                        )}
                      </td>
                      <td className="py-2 font-mono">{k.competitors[1]?.position ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
