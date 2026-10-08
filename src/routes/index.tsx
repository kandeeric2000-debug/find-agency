import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Play, RefreshCw, ScanSearch, Download, Copy, Plus, Loader2, FileText } from "lucide-react";
import { PageConfig } from "@/components/PageConfig";
import { ResultsView } from "@/components/ResultsView";
import { BatchQueue } from "@/components/BatchQueue";
import {
  analyzeBatch,
  classifyResults,
  formatPageBlock,
  type RunSummary,
  saveVerdict,
  toCsv,
  type KeywordResult,
  type PageInput,
  type PageResult,
} from "@/lib/analysis";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agency SERP Finder — Live Semrush Competitor Research" },
      {
        name: "description",
        content:
          "Batch keywords, pull live Semrush keyword difficulty and organic SERPs, and capture the first two agency competitors per keyword with a full audit trail.",
      },
      { property: "og:title", content: "Agency SERP Finder — Live Semrush Competitor Research" },
      {
        property: "og:description",
        content:
          "Automate agency competitor research: live Semrush KD and SERP data, agency-only classification, exact ranking URLs, CSV export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const STORAGE_KEY = "agency-serp-finder:v1";

function newPage(): PageInput {
  return {
    id: crypto.randomUUID(),
    name: "",
    rank: "",
    targetUrl: "",
    country: "USA",
    database: "us",
    keywords: "",
  };
}

type Progress = { done: number; total: number; label: string } | null;

function Index() {
  const [pages, setPages] = useState<PageInput[]>([newPage()]);
  const [results, setResults] = useState<PageResult[]>([]);
  const [progress, setProgress] = useState<Progress>(null);
  const [view, setView] = useState<"grouped" | "table">("grouped");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { pages?: PageInput[]; results?: PageResult[] };
      if (saved.pages?.length) setPages(saved.pages);
      if (saved.results?.length) setResults(saved.results);
    } catch (e) {
      console.error("Could not restore saved session", e);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pages, results }));
  }, [pages, results, hydrated]);

  const keywordJobs = useMemo(
    () =>
      pages.flatMap((p) =>
        p.keywords
          .split("\n")
          .map((k) => k.trim())
          .filter(Boolean)
          .map((keyword) => ({ page: p, keyword })),
      ),
    [pages],
  );

  const running = progress !== null;

  const regroup = useCallback(
    (source: { pageId: string }[], flat: KeywordResult[], template: PageResult[] | PageInput[]) => {
      const byPage = new Map<string, KeywordResult[]>();
      source.forEach((s, i) => {
        const list = byPage.get(s.pageId) ?? [];
        list.push(flat[i]!);
        byPage.set(s.pageId, list);
      });
      return template
        .map((t) => ("pageId" in t ? t.pageId : t.id))
        .filter((id) => byPage.has(id))
        .map((id) => {
          const existing = results.find((r) => r.pageId === id);
          const input = pages.find((p) => p.id === id);
          const page = input
            ? (({ keywords: _kw, ...rest }) => rest)(input)
            : existing!.page;
          return { pageId: id, page, keywords: byPage.get(id)! };
        });
    },
    [pages, results],
  );

  const reportSummary = (summary: RunSummary, failures: number, total: number, verb: string) => {
    if (summary.aiUnavailable) {
      toast.warning(
        `${verb} all ${total} keywords. AI classification unavailable (${summary.aiUnavailable}) — undecided companies are marked Needs Review.`,
      );
    } else if (failures > 0) toast.warning(`${failures} of ${total} keywords need review.`);
    else toast.success(`${total} keywords ${verb.toLowerCase()}.`);
  };

  const runAnalysis = useCallback(async () => {
    if (keywordJobs.length === 0) {
      toast.error("Add at least one keyword first.");
      return;
    }
    const total = keywordJobs.length;
    setProgress({ done: 0, total, label: "Starting" });
    try {
      const { results: flat, summary } = await analyzeBatch(
        keywordJobs.map((j) => ({ keyword: j.keyword, database: j.page.database })),
        (done, label) => setProgress({ done, total, label }),
      );
      setResults(regroup(keywordJobs.map((j) => ({ pageId: j.page.id })), flat, pages));
      reportSummary(summary, flat.filter((r) => r.error).length, total, "Analyzed");
    } catch (e) {
      console.error(e);
      toast.error("Analysis failed unexpectedly.");
    } finally {
      setProgress(null);
    }
  }, [keywordJobs, pages, regroup]);

  const recheckClassification = useCallback(async () => {
    if (results.length === 0) {
      toast.error("Run an analysis first.");
      return;
    }
    const refs = results.flatMap((p) => p.keywords.map(() => ({ pageId: p.pageId })));
    const flat = results.flatMap((p) => p.keywords);
    setProgress({ done: 0, total: flat.length, label: "Re-checking classifications" });
    try {
      const { results: next, summary } = await classifyResults(flat, undefined, { retryUndecided: true });
      setResults(regroup(refs, next, results));
      reportSummary(summary, 0, flat.length, "Re-checked");
    } finally {
      setProgress(null);
    }
  }, [results, regroup]);

  const handleOverride = useCallback(
    async (domain: string, isAgency: boolean) => {
      await saveVerdict(domain, {
        isAgency,
        reason: `Manually marked as ${isAgency ? "AGENCY" : "NOT AGENCY"}`,
        source: "manual",
      });
      const refs = results.flatMap((p) => p.keywords.map(() => ({ pageId: p.pageId })));
      const { results: next } = await classifyResults(results.flatMap((p) => p.keywords));
      setResults(regroup(refs, next, results));
      toast.success(`${domain} marked ${isAgency ? "AGENCY" : "NOT AGENCY"}.`);
    },
    [results, regroup],
  );

  const exportCsv = () => {
    if (results.length === 0) {
      toast.error("Nothing to export yet.");
      return;
    }
    const blob = new Blob([toCsv(results)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agency-competitors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDocx = async () => {
    if (results.length === 0) {
      toast.error("Nothing to export yet.");
      return;
    }
    const { buildResultsDocx } = await import("@/lib/docx-export");
    const blob = await buildResultsDocx(results);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agency-competitors-${new Date().toISOString().slice(0, 10)}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Word document downloaded.");
  };

  const copyResults = async () => {
    if (results.length === 0) {
      toast.error("Nothing to copy yet.");
      return;
    }
    await navigator.clipboard.writeText(results.map(formatPageBlock).join("\n\n\n"));
    toast.success("Results copied.");
  };


  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs tracking-widest text-primary uppercase">
          Live Semrush data · AI agency classifier
        </p>
        <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Agency SERP Finder
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Paste a batch of keywords. For each one we pull the live keyword difficulty and organic
          SERP from Semrush, walk the results from position #1, and keep the exact ranking URLs of
          the first two results published by an actual agency.
        </p>
        <a href="#paste-txt" className="btn-base btn-primary mt-4 inline-flex">
          Paste TXT / Import Text (up to 100 pages)
        </a>
      </header>

      <div className="space-y-5">
        {pages.map((page, i) => (
          <PageConfig
            key={page.id}
            page={page}
            index={i}
            canRemove={pages.length > 1}
            onChange={(patch) =>
              setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, ...patch } : p)))
            }
            onRemove={() => setPages((prev) => prev.filter((p) => p.id !== page.id))}
          />
        ))}
        <button className="btn-base btn-ghost" onClick={() => setPages((prev) => [...prev, newPage()])}>
          <Plus className="size-4" /> Add another target page
        </button>
      </div>

      <div className="panel mt-6 flex flex-wrap items-center gap-2 p-4">
        <button className="btn-base btn-primary" disabled={running} onClick={() => runAnalysis()}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Run Analysis
        </button>
        <button
          className="btn-base btn-ghost"
          disabled={running}
          onClick={() => runAnalysis()}
        >
          <RefreshCw className="size-4" /> Refresh Live SERPs
        </button>
        <button className="btn-base btn-ghost" disabled={running} onClick={recheckClassification}>
          <ScanSearch className="size-4" /> Recheck Classification
        </button>
        <button className="btn-base btn-ghost" onClick={exportCsv}>
          <Download className="size-4" /> Export CSV
        </button>
        <button className="btn-base btn-ghost" onClick={exportDocx}>
          <FileText className="size-4" /> Download DOCX
        </button>
        <button className="btn-base btn-ghost" onClick={copyResults}>
          <Copy className="size-4" /> Copy Results
        </button>

        {progress && (
          <div className="ml-auto flex items-center gap-3">
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {progress.done} / {progress.total} keywords analyzed
            </span>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div className="mt-10 mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold">Results</h2>
            <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
              {(["grouped", "table"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded px-3 py-1 text-xs font-semibold capitalize ${
                    view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {v === "grouped" ? "Grouped" : "Table"}
                </button>
              ))}
            </div>
          </div>
          <ResultsView pages={results} view={view} onOverride={handleOverride} />
        </>
      )}
      <BatchQueue />
    </main>
  );
}
