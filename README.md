# Agency Finder Pro

Yes. The tool should automate exactly this collection process.

I tried to move this into Work mode so I could build/connect the Lovable tool directly, but that handoff was declined. You can still use the following specification as the build prompt in Lovable:

Build an SEO competitor research tool connected to live Semrush data.

The tool must accept a batch of keywords and a selected Semrush country/database (for example USA).

For every keyword:

Retrieve the current Keyword Difficulty (KD) from Semrush.

Retrieve the live organic Google SERP results, including ranking position and exact ranking URL.

Starting from position #1, determine whether the COMPANY behind each result is an agency.

The ONLY competitor qualification criterion is whether the company is an agency. Do NOT reject an agency because the ranking URL is a blog, article, listicle, homepage, or service page.

Exclude non-agencies such as Reddit, YouTube, Clutch, DesignRush, Semrush directories, Upwork, Fiverr, Toptal, Wix, Freelancer, Contra, SaaS/software platforms, directories, marketplaces, forums, social networks, individual freelancers, and talent/staffing marketplaces.

Continue through the SERP until TWO agencies have been found.

Preserve the exact live URL ranking in Semrush. Do not replace it with the agency's homepage or another service URL.

Never fabricate a URL or competitor.

Classification examples:

SEO Web Design LLC = AGENCY

SEO.com = AGENCY

SEO Inc = AGENCY

Visualwebz = AGENCY

S-PRO = AGENCY

Cleveroad = AGENCY

eSparkBiz = AGENCY

TechStep Solutions = AGENCY

Elsner Technologies = AGENCY

Upwork = NOT AGENCY

Reddit = NOT AGENCY

Fiverr = NOT AGENCY

Toptal = NOT AGENCY

Wix = NOT AGENCY

Arc.dev = NOT AGENCY

Freelancer.com = NOT AGENCY

Contra = NOT AGENCY

Clutch = NOT AGENCY

DesignRush = NOT AGENCY

Semrush Agency Directory = NOT AGENCY

IMPORTANT: Agency classification must be based on what the company actually is, not simply URL patterns. A /blog/ URL can still qualify if the company publishing it is an agency.

For each evaluated SERP result, internally store:

Keyword

KD

SERP position

Ranking URL

Domain

Agency: YES/NO

Classification reason

Selected as competitor: YES/NO

Final output for each keyword must be:

keyword — KD XX

https://exact-live-ranking-url-1.com/...

https://exact-live-ranking-url-2.com/...

If only one agency can be found:

keyword — KD XX

https://agency-url.com/...

No second competitor

If no agencies can be found:

keyword — KD XX

No competitors

Add a detailed audit view where I can expand a keyword and see WHY individual SERP results were accepted/rejected.

Example:

hire web developers

#1 Upwork → NOT AGENCY → rejected
#2 Reddit → NOT AGENCY → rejected
#3 Fiverr → NOT AGENCY → rejected
#4 Toptal → NOT AGENCY → rejected
#5 Wix → NOT AGENCY → rejected
#6 Arc.dev → NOT AGENCY → rejected
#7 Freelancer → NOT AGENCY → rejected
#8 Contra → NOT AGENCY → rejected

Result: No competitors

Add these inputs:

Page Name

Page Rank

Target URL

Country

Semrush database

Keyword list (one keyword per line)

Add these controls:

Run Analysis

Refresh Live SERPs

Recheck Classification

Export CSV

Copy Results

Process keywords in batches. Show progress such as 18 / 35 keywords analyzed.

Cache classifications for known domains to reduce unnecessary AI/API calls, but always allow manual reclassification. Refresh SERP positions/URLs from Semrush when I explicitly request fresh data.

The final results screen should group everything by target page, for example:

Page: Web Design & SEO — USA
Page Rank: #4
URL: /us/web-design-and-seo/
Country: USA

followed by all keywords, KD scores and two agency competitors.

Then:

Page: Web Development — USA
Page Rank: #5
URL: /us/web-development/
Country: USA

followed by its keywords and competitors.

Also provide a table view:

KeywordKDCompetitor 1SERP Pos.Competitor 2SERP Pos.

URLs must be clickable and open in a new tab.

Do not invent KD, SERP positions, URLs, or agency classifications when evidence is unavailable. Mark the record Needs Review.

The purpose of this tool is to eliminate the manual workflow of opening Semrush SERPs, checking each result one by one, determining which companies are agencies, copying the first two agency URLs, and formatting the results manually.

The key design decision is Semrush supplies the live data; the classifier decides AGENCY vs NOT AGENCY. That separation will make this much more reliable than asking AI to generate competitor URLs itself.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8897b9d7-c587-47fe-bdbb-5ea7ac2464dd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
