// Shared, client-safe rules. Deterministic answers first, AI only for unknowns.

export const NON_AGENCY_DOMAINS: Record<string, string> = {
  "upwork.com": "Freelance marketplace, not an agency",
  "fiverr.com": "Freelance marketplace, not an agency",
  "reddit.com": "Forum / social network, not an agency",
  "youtube.com": "Video platform, not an agency",
  "clutch.co": "Directory of agencies, not an agency",
  "designrush.com": "Directory of agencies, not an agency",
  "semrush.com": "SaaS platform / agency directory, not an agency",
  "agencies.semrush.com": "Semrush agency directory, not an agency",
  "toptal.com": "Talent marketplace, not an agency",
  "wix.com": "SaaS website builder, not an agency",
  "freelancer.com": "Freelance marketplace, not an agency",
  "contra.com": "Freelance marketplace, not an agency",
  "arc.dev": "Developer talent marketplace, not an agency",
  "goodfirms.co": "Directory, not an agency",
  "sortlist.com": "Directory / marketplace, not an agency",
  "trustpilot.com": "Review platform, not an agency",
  "g2.com": "Software review platform, not an agency",
  "capterra.com": "Software review platform, not an agency",
  "linkedin.com": "Social network, not an agency",
  "facebook.com": "Social network, not an agency",
  "instagram.com": "Social network, not an agency",
  "x.com": "Social network, not an agency",
  "twitter.com": "Social network, not an agency",
  "quora.com": "Forum, not an agency",
  "medium.com": "Publishing platform, not an agency",
  "glassdoor.com": "Jobs / reviews platform, not an agency",
  "indeed.com": "Job board, not an agency",
  "ziprecruiter.com": "Job board, not an agency",
  "squarespace.com": "SaaS website builder, not an agency",
  "shopify.com": "SaaS platform, not an agency",
  "wordpress.com": "SaaS platform, not an agency",
  "hubspot.com": "SaaS platform, not an agency",
  "ahrefs.com": "SaaS platform, not an agency",
  "moz.com": "SaaS platform, not an agency",
  "forbes.com": "Publisher, not an agency",
  "entrepreneur.com": "Publisher, not an agency",
  "businessofapps.com": "Publisher / directory, not an agency",
  "builtin.com": "Publisher / job platform, not an agency",
  "techbehemoths.com": "Directory, not an agency",
  "manifest.ly": "Directory, not an agency",
  "themanifest.com": "Directory, not an agency",
  "expertise.com": "Directory, not an agency",
  "yelp.com": "Directory / reviews, not an agency",
  "wikipedia.org": "Encyclopedia, not an agency",
  "gartner.com": "Research firm platform, not an agency",
  "producthunt.com": "Directory, not an agency",
  "stackoverflow.com": "Forum, not an agency",
  "github.com": "Code platform, not an agency",
  "pwc.com": "Professional services / accounting firm, not an agency",
};

export const KNOWN_AGENCY_DOMAINS: Record<string, string> = {
  "seowebdesign.com": "SEO Web Design LLC — agency",
  "seo.com": "SEO.com — agency",
  "seoinc.com": "SEO Inc — agency",
  "visualwebz.com": "Visualwebz — agency",
  "s-pro.io": "S-PRO — agency",
  "cleveroad.com": "Cleveroad — agency",
  "esparkbiz.com": "eSparkBiz — agency",
  "techstepsolutions.com": "TechStep Solutions — agency",
  "elsner.com": "Elsner Technologies — agency",
  "thriveagency.com": "Thrive Internet Marketing Agency — agency",
};

export function rootDomain(domain: string): string {
  const clean = domain.toLowerCase().replace(/^www\./, "");
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;
  const twoLevelTlds = ["co.uk", "com.au", "co.nz", "com.br", "co.za", "co.in", "com.mx"];
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevelTlds.includes(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

export type Verdict = {
  isAgency: boolean | null;
  reason: string;
  source: "rule" | "cache" | "ai" | "manual";
  companyName?: string | null;
};

/**
 * Test 2: the exact ranking URL must be a commercial business/service page.
 * Informational / editorial / article-style URLs are skipped even for real agencies.
 * Commercial service paths with many words (/services/custom-web-development/) stay GOOD.
 */
const SECTION_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\/blogs?(\/|$)/i, reason: "Ranking URL is a blog post" },
  { re: /\/articles?(\/|$)/i, reason: "Ranking URL is an article" },
  { re: /\/news(\/|$)/i, reason: "Ranking URL is a news post" },
  { re: /\/press(-|\/|$)/i, reason: "Ranking URL is a press item" },
  { re: /\/guides?(\/|$)/i, reason: "Ranking URL is a guide" },
  { re: /\/insights?(\/|$)/i, reason: "Ranking URL is an insights article" },
  { re: /\/resources?(\/|$)/i, reason: "Ranking URL is a resource article" },
  { re: /\/magazine(\/|$)/i, reason: "Ranking URL is a magazine article" },
  { re: /\/journal(\/|$)/i, reason: "Ranking URL is a journal post" },
  { re: /\/posts?(\/|$)/i, reason: "Ranking URL is a post" },
  { re: /\/stories(\/|$)/i, reason: "Ranking URL is a story" },
  { re: /\/learn(\/|$)/i, reason: "Ranking URL is a learning article" },
  { re: /\/tips(\/|$)/i, reason: "Ranking URL is a tips article" },
  { re: /\/(faqs?|glossary|wiki)(\/|$)/i, reason: "Ranking URL is a reference page" },
  { re: /\/(careers?|jobs?|hiring|vacanc)(\/|$)/i, reason: "Ranking URL is a jobs/careers page" },
  { re: /\/\d{4}\/\d{2}\//, reason: "Ranking URL is a dated editorial post" },
];

/** Question-style / article-title-style slugs. Matched against the last path segment. */
const INFORMATIONAL_SLUG_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /^(what|why|how|does|do|is|are|can|should|when|which|who|will|if)-/i, reason: "Ranking URL is a question-style article" },
  { re: /-(guide|guides|checklist|explained|examples|ideas|mistakes|trends|statistics|stats|faq)$/i, reason: "Ranking URL is an informational article" },
  { re: /(^|-)(everything-you-need-to-know|need-to-know|ultimate-guide|complete-guide|beginners-guide|step-by-step)(-|$)/i, reason: "Ranking URL is a guide article" },
  { re: /(^|-)(the-connection-between|difference-between|vs)(-|$)/i, reason: "Ranking URL is a comparison article" },
  { re: /^(top|best)-/i, reason: "Ranking URL is a listicle" },
  { re: /^\d+-/i, reason: "Ranking URL is a listicle" },
  { re: /(^|-)(tips|reasons|benefits|examples|trends)(-|$)/i, reason: "Ranking URL is an informational article" },
  { re: /(^|-)(guide-to|how-to|introduction-to)(-|$)/i, reason: "Ranking URL is a how-to article" },
  { re: /(^|-)case-stud(y|ies)(-|$)/i, reason: "Ranking URL is a case study" },
];

/** Paths that are clearly commercial, even when long or multi-word. */
const COMMERCIAL_PATTERNS = [
  /\/(services?|service-areas?|solutions?|packages?|pricing|plans?|rates?|quote|contact|about|portfolio|work|industries|locations?|our-work)(\/|$)/i,
  /(web-design|web-development|website-design|website-development|seo|digital-marketing|branding|app-development|software-development|ppc|ecommerce|e-commerce)-(services?|company|companies|agency|agencies|packages?|pricing)(\/|$)/i,
];

export function contentPageReason(url: string): string | null {
  let path = url;
  try {
    path = new URL(url.startsWith("http") ? url : `https://${url}`).pathname;
  } catch {
    // fall back to raw string matching
  }
  const clean = path.replace(/\/+$/, "");
  // Homepage is always a proper business URL.
  if (clean === "" || /^\/(en|us|uk|de|fr|es|it|nl|in|br|mx|ae|se|no|dk)$/i.test(clean)) return null;

  for (const { re, reason } of SECTION_PATTERNS) {
    if (re.test(path)) return reason;
  }

  if (COMMERCIAL_PATTERNS.some((re) => re.test(clean))) return null;

  const slug = clean.split("/").filter(Boolean).pop() ?? "";
  const bare = slug.replace(/\.(html?|php|aspx?)$/i, "");
  for (const { re, reason } of INFORMATIONAL_SLUG_PATTERNS) {
    if (re.test(bare)) return reason;
  }
  // Long article-title-style slugs (6+ words) are editorial, not commercial pages.
  if (bare.split("-").filter(Boolean).length >= 6) {
    return "Ranking URL is an article-style page";
  }
  return null;
}

export function ruleVerdict(domain: string): Verdict | null {
  const clean = domain.toLowerCase().replace(/^www\./, "");
  const root = rootDomain(domain);
  for (const key of [clean, root]) {
    if (NON_AGENCY_DOMAINS[key]) {
      return { isAgency: false, reason: NON_AGENCY_DOMAINS[key], source: "rule" };
    }
    if (KNOWN_AGENCY_DOMAINS[key]) {
      return { isAgency: true, reason: KNOWN_AGENCY_DOMAINS[key], source: "rule" };
    }
  }
  return null;
}
