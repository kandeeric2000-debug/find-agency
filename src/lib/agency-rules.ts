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
