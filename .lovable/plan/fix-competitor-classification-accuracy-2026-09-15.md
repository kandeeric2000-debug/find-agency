# Fix competitor classification accuracy

## What will change
- Classify each company using evidence from its own website, instead of guessing from the domain name alone.
- Keep page type and URL structure completely out of the qualification decision.
- Invalidate old AI-cached decisions created by the weaker classifier while preserving manual decisions.
- Keep the exact Semrush ranking URL and select the first two verified agencies in rank order.
- Mark uncertain or inaccessible companies as Needs Review rather than guessing.

## Verification
- Re-run representative live searches, including agency-owned article URLs and known non-agency platforms.
- Confirm the audit trail explains each company-level decision and the visible list updates.
- Check the current build and browser flow for errors.

## Technical details
- Fetch limited public homepage evidence server-side for unknown domains and pass it to the classifier.
- Version AI cache entries so stale classifications are not silently reused.
- Normalize all classification keys consistently by root domain.
