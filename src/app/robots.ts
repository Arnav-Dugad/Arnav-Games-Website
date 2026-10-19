import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Account surfaces hold nothing useful to a crawler and shouldn't be indexed.
      disallow: ["/api/", "/profile", "/watchlist", "/notifications", "/login", "/signup"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
