<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Classification runs through src/lib/classification-engine.ts: manual > rules > cache > one deduplicated AI pass per run; AI errors never throw (classifyDomains returns {verdicts,error}) — keeps runs finishing and AI credit use minimal.
- Batch queue logic lives in src/lib/batch-core.ts (pure, no "@/" imports) and is shared by the app UI, /api/public/batch-keywords and scripts/run-batches.ts — one parser/exporter so app and GitHub Actions outputs never diverge.
- GitHub Actions never holds Semrush/AI keys; it calls the published app's token-protected /api/public/batch-keywords (BATCH_RUNNER_TOKEN) — keeps provider credentials inside Lovable.
