import { Trash2 } from "lucide-react";
import { DATABASES, type PageInput } from "@/lib/analysis";

type Props = {
  page: PageInput;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<PageInput>) => void;
  onRemove: () => void;
};

export function PageConfig({ page, index, canRemove, onChange, onRemove }: Props) {
  const keywordCount = page.keywords
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean).length;

  return (
    <section className="panel p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Target page {index + 1}
        </h2>
        {canRemove && (
          <button className="btn-base btn-ghost" onClick={onRemove} aria-label="Remove page">
            <Trash2 className="size-4" /> Remove
          </button>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Page name</span>
          <input
            className="field field-focus"
            value={page.name}
            placeholder="Web Design &amp; SEO"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Page rank</span>
          <input
            className="field field-focus font-mono"
            value={page.rank}
            placeholder="4"
            onChange={(e) => onChange({ rank: e.target.value })}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Target URL</span>
          <input
            className="field field-focus font-mono"
            value={page.targetUrl}
            placeholder="/us/web-design-and-seo/"
            onChange={(e) => onChange({ targetUrl: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Country / Semrush database
          </span>
          <select
            className="field field-focus"
            value={page.database}
            onChange={(e) => {
              const db = DATABASES.find((d) => d.code === e.target.value);
              onChange({ database: e.target.value, country: db?.country ?? page.country });
            }}
          >
            {DATABASES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.country} ({d.code})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Country label (shown in results)
          </span>
          <input
            className="field field-focus"
            value={page.country}
            onChange={(e) => onChange({ country: e.target.value })}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Keywords (one per line)</span>
            <span className="font-mono">{keywordCount} keywords</span>
          </span>
          <textarea
            className="field field-focus min-h-40 font-mono leading-6"
            value={page.keywords}
            placeholder={"seo agency\nhire web developers\nweb design company"}
            onChange={(e) => onChange({ keywords: e.target.value })}
          />
        </label>
      </div>
    </section>
  );
}
