# Batch files

Up to 100 independent page batches per run. Use in the app (Batch queue → Import batches)
or in GitHub Actions (Actions → "Competitor analysis batches" → Run workflow → `batch_file`).

JSON:
```json
{ "batches": [ { "name": "Page", "rank": "33", "targetUrl": "/us/x/", "country": "USA", "database": "us", "keywords": ["kw 1", "kw 2"] } ] }
```

CSV (one row per keyword; rows with the same page_name + target_url + database form one batch):
```
page_name,rank,target_url,country,database,keyword
Houston Web Design — USA,33,/us/houston-web-design/,USA,us,web design houston
```

Output: one UTF-8 TXT per batch (page metadata + keyword + #1/#2 exact ranking URLs, no KD/volume),
`manifest.json` with per-batch success/failure and failed keywords, and a combined ZIP.

GitHub setup (once):
1. Create a long random value (e.g. `openssl rand -hex 32`).
2. Save it as `BATCH_RUNNER_TOKEN` in Lovable Project Settings → Secrets, then publish the app.
3. Save the same value as repository secret `BATCH_RUNNER_TOKEN` (GitHub → Settings → Secrets and variables → Actions).
4. Optional: repository variable `APP_URL` (defaults to https://find-agency.lovable.app).
