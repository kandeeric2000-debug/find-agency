import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ClipboardPaste, FileUp, ListChecks, X } from "lucide-react";
import { DATABASES } from "@/lib/analysis";
import {
  MAX_BATCHES,
  draftErrors,
  draftToBatch,
  parseBatchesText,
  validateDraft,
  type BatchInput,
  type TextBatchDraft,
} from "@/lib/batch-core";

type Props = { disabled: boolean; room: number; onAdd: (batches: BatchInput[]) => void };

export function TextImport({ disabled, room, onAdd }: Props) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<TextBatchDraft[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parse = (source = text) => {
    try {
      const d = parseBatchesText(source);
      if (d.length === 0) throw new Error('No pages found. Start each section with "Page:" or "PAGE".');
      setDrafts(d);
      setConfirmed(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the text");
    }
  };

  const update = (i: number, patch: Partial<TextBatchDraft>) =>
    setDrafts((prev) => prev && prev.map((d, j) => (j === i ? validateDraft({ ...d, ...patch }) : d)));

  const blocking = (drafts ?? []).some((d) => draftErrors(d).length > 0);
  const needsConfirm = (drafts ?? []).some((d) => d.warnings.length > draftErrors(d).length);
  const totalKw = (drafts ?? []).reduce((n, d) => n + d.keywords.length, 0);

  const add = () => {
    if (!drafts) return;
    if (drafts.length > room) return toast.error(`Only ${room} more batches fit (max ${MAX_BATCHES}).`);
    onAdd(drafts.map(draftToBatch));
    toast.success(`Added ${drafts.length} batches (${totalKw} keywords) to the queue.`);
    setDrafts(null);
    setText("");
  };

  return (
    <div id="paste-txt" className="mb-6 rounded-lg border-2 border-primary/50 bg-surface p-4">
      <h3 className="font-display mb-1 flex items-center gap-2 text-base font-bold">
        <ClipboardPaste className="size-4 text-primary" /> Paste TXT / Import Text
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Paste up to {MAX_BATCHES} pages. Start each with "Page:" (or PAGE), then Page Rank:, URL:, Country:, Keywords:, etc.
        Put one keyword per line, or separate them with ";".
      </p>

      {!drafts ? (
        <>
          <textarea
            className="field field-focus min-h-48 font-mono text-xs leading-5"
            value={text}
            placeholder={"Page: Houston Web Design — USA\nPage Rank: #33\nURL: /us/houston-web-design/\nCountry: USA\nKeywords: 39 → 42\nweb design houston\nhouston website design"}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-base btn-primary" disabled={disabled || !text.trim()} onClick={() => parse()}>
              <ListChecks className="size-4" /> Parse & preview
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const t = await f.text();
                setText(t);
                parse(t);
              }}
            />
            <button className="btn-base btn-ghost" disabled={disabled} onClick={() => fileRef.current?.click()}>
              <FileUp className="size-4" /> Upload .txt
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 font-mono text-xs text-muted-foreground">
            {drafts.length} pages · {totalKw} keywords found. Check and edit below before adding.
          </p>
          <div className="space-y-4">
            {drafts.map((d, i) => (
              <div key={i} className="panel p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs text-muted-foreground">Page name</span>
                    <input className="field field-focus" value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">Page rank</span>
                    <input className="field field-focus font-mono" value={d.rank} onChange={(e) => update(i, { rank: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">URL</span>
                    <input className="field field-focus font-mono" value={d.targetUrl} onChange={(e) => update(i, { targetUrl: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">Country label</span>
                    <input className="field field-focus" value={d.country} onChange={(e) => update(i, { country: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">Semrush database</span>
                    <select className="field field-focus" value={d.database} onChange={(e) => update(i, { database: e.target.value })}>
                      <option value="">Choose…</option>
                      {DATABASES.map((db) => (
                        <option key={db.code} value={db.code}>{db.country} ({db.code})</option>
                      ))}
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>Keywords (one per line)</span>
                      <span className="font-mono">
                        {d.keywords.length}{d.expectedCount !== null ? ` / expected ${d.expectedCount}` : ""}
                      </span>
                    </span>
                    <textarea
                      className="field field-focus min-h-32 font-mono text-xs leading-5"
                      value={d.keywords.join("\n")}
                      onChange={(e) =>
                        update(i, {
                          keywords: e.target.value.split("\n").flatMap((l) => (l.includes(";") ? l.split(";") : [l])).map((k) => k.trim()).filter(Boolean),
                        })
                      }
                    />
                  </label>
                </div>
                {Object.keys(d.meta).length > 0 && (
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {Object.entries(d.meta).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                  </p>
                )}
                {d.warnings.map((w) => (
                  <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
                  </p>
                ))}
                {d.ambiguous.map((a) => (
                  <p key={a} className="ml-5 font-mono text-[11px] text-destructive">“{a}”</p>
                ))}
              </div>
            ))}
          </div>
          {needsConfirm && !blocking && (
            <label className="mt-3 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I checked the warnings above and want to run these keywords as listed.
            </label>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-base btn-primary" disabled={disabled || blocking || (needsConfirm && !confirmed)} onClick={add}>
              <ListChecks className="size-4" /> Add {drafts.length} batches to queue
            </button>
            <button className="btn-base btn-ghost" onClick={() => setDrafts(null)}>
              <X className="size-4" /> Back to text
            </button>
          </div>
        </>
      )}
    </div>
  );
}
