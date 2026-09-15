---
name: Classification rules
description: Competitor qualification — company must be an agency AND the exact ranking URL must be a commercial business/service page
type: feature
---

Two tests, both required (user spec 2026-09-15):

TEST 1 — Company: is the business behind the domain an agency / professional services company? Judge from website evidence, never from the domain name or URL shape. NO → skip.

TEST 2 — Exact Semrush ranking URL must be a commercial business page: homepage, service page, services section, packages/pricing, web design / web development / SEO service page, location-service page, contact/about/portfolio. Informational/editorial URLs are skipped even for genuine agencies.

Informational signals (reject): /blog/, /articles/, /news/, /resources/, /guides/, /insights/, /magazine/, /journal/, /posts/, /learn/, /tips/, faq/glossary, careers-jobs, dated paths; question-style slugs (what-, why-, how-, does-, is-, can-...), "everything-you-need-to-know", "the-connection-between", "guide-to", "top-10-", "best-...-companies", listicles, case studies, and article-title-style slugs of 6+ words.
Do NOT reject just for being multi-word: /services/custom-web-development/ is GOOD. Commercial paths (services, solutions, packages, pricing, contact, about, portfolio, locations, industries, and "<topic>-services/company/agency/packages") override slug heuristics.

- The exact live Semrush ranking URL is preserved for selected competitors — never swap it for a homepage or another page, never fabricate URLs.
- Reject non-agencies: marketplaces (Upwork, Fiverr, Toptal, Freelancer, Contra), directories/review sites (Clutch, DesignRush, Semrush, GoodFirms, Sortlist), SaaS (Wix, Squarespace, HubSpot), forums/social (Reddit, YouTube, Quora, LinkedIn), publishers/media, job boards, staffing/talent marketplaces, individual freelancers, accounting firms / big consultancies (e.g. PwC).
- A company offering web design, web development, SEO, marketing, branding, or related client services qualifies — it need not specialize exclusively in the researched keyword.
- Manual user overrides always win over rule/cache/AI verdicts.
- Selection: walk live SERP from #1, take first two results passing both tests, stop at 2; "No second competitor" / "No competitors" when fewer. Missing evidence → Needs Review, never guess.
