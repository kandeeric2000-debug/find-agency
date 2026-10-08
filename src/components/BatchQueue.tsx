import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Play, Square, Download, Archive, Trash2, Loader2 } from "lucide-react";
import { analyzeBatch } from "@/lib/analysis";
import { TextImport } from "@/components/TextImport";
import {
  MAX_BATCHES,
  batchFileName,
  buildManifest,
  formatBatchTxt,
  initialStates,
  parseBatchesFile,
  runQueue,
  type AnalyzeFn,
  type BatchState,
} from "@/lib/batch-core";

const QUEUE_KEY = "agency-serp-finder:queue:v1";

const analyzeLive: AnalyzeFn = async (keywords, database) => {
  const { results } = await analyzeBatch(keywords.map((keyword) => ({ keyword, database })), () => {});
  return results.map((r) => ({
    keyword: r.keyword,
    error: r.error,
    needsReview: r.needsReview,
    competitors: r.competitors.map((c) => ({ position: c.position, url: c.url })),
  }));
};

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function BatchQueue() {
  const [states, setStates] = useState<BatchState[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as BatchState[];
        // A batch interrupted mid-run resumes from where it stopped.
        setStates(saved.map((s) => (s.status === "running" ? { ...s, status: "pending" } : s)));
      }
    } catch (e) {
      console.error("Could not restore batch queue", e);
    }
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(QUEUE_KEY, JSON.stringify(states));
  }, [states, hydrated]);

  const importFile = async (file: File) => {
    try {
      const batches = parseBatchesFile(file.name, await file.text());
      if (states.length + batches.length > MAX_BATCHES) throw new Error(`Queue limit is ${MAX_BATCHES} batches`);
      setStates((prev) => [...prev, ...initialStates(batches)]);
      toast.success(`Imported ${batches.length} batches (${batches.reduce((n, b) => n + b.keywords.length, 0)} keywords).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    try {
      const out = await runQueue(states, analyzeLive, {
        concurrency: 2,
        retries: 2,
        backoffMs: 4000,
        shouldStop: () => stopRef.current,
        onUpdate: (i, s) => setStates((prev) => prev.map((p, j) => (j === i ? s : p))),
      });
      setStates(out);
      const m = buildManifest(out);
      toast.message(`Queue finished: ${m.succeeded} done, ${m.partial} partial, ${m.failed} not complete.`);
    } finally {
      setRunning(false);
    }
  };

  const downloadZip = async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    states.forEach((s, i) => zip.file(batchFileName(s.batch, i), formatBatchTxt(s)));
    zip.file("manifest.json", JSON.stringify(buildManifest(states), null, 2));
    download(`competitor-batches-${new Date().toISOString().slice(0, 10)}.zip`, await zip.generateAsync({ type: "blob" }));
  };

  const done = states.filter((s) => s.status === "done" || s.status === "partial" || s.status === "failed").length;
  const remaining = states.filter((s) => s.status !== "done").length;

  return (
    <section className="panel mt-10 p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Batch queue</h2>
          <p className="text-xs text-muted-foreground">
            Import up to {MAX_BATCHES} page batches (JSON or CSV). Each batch gets its own TXT file.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
          <button className="btn-base btn-ghost" disabled={running} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Import batches
          </button>
          {running ? (
            <button className="btn-base btn-ghost" onClick={() => (stopRef.current = true)}>
              <Square className="size-4" /> Stop after current
            </button>
          ) : (
            <button className="btn-base btn-primary" disabled={remaining === 0} onClick={run}>
              <Play className="size-4" /> {done > 0 && remaining > 0 ? "Resume queue" : "Run queue"}
            </button>
          )}
          <button className="btn-base btn-ghost" disabled={states.length === 0} onClick={downloadZip}>
            <Archive className="size-4" /> Download ZIP
          </button>
          <button className="btn-base btn-ghost" disabled={running || states.length === 0} onClick={() => setStates([])}>
            <Trash2 className="size-4" /> Clear
          </button>
        </div>
      </header>

      <TextImport
        disabled={running}
        room={MAX_BATCHES - states.length}
        onAdd={(b) => setStates((prev) => [...prev, ...initialStates(b)])}
      />

      {states.length > 0 && (
        <>
          <p className="mb-2 font-mono text-xs text-muted-foreground">
            {done} / {states.length} batches processed {running && <Loader2 className="inline size-3 animate-spin" />}
          </p>
          <ul className="divide-y divide-border text-sm">
            {states.map((s, i) => {
              const failed = s.results.filter((r) => r.error).length;
              return (
                <li key={s.batch.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-20 font-mono text-xs uppercase text-muted-foreground">{s.status}</span>
                  <span className="flex-1 font-medium">
                    {s.batch.name} <span className="text-xs text-muted-foreground">({s.batch.database}, {s.batch.keywords.length} keywords)</span>
                    {(s.error || failed > 0) && (
                      <span className="block text-xs text-destructive">
                        {failed > 0 ? `${failed} keyword(s) failed` : ""} {s.error ?? ""}
                      </span>
                    )}
                  </span>
                  <button
                    className="btn-base btn-ghost"
                    disabled={s.status === "pending" || s.status === "running"}
                    onClick={() => download(batchFileName(s.batch, i), new Blob([formatBatchTxt(s)], { type: "text/plain;charset=utf-8" }))}
                  >
                    <Download className="size-4" /> TXT
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
