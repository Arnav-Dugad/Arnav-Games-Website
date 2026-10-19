import type { MetadataRoute } from "next";
import { popularSlugs } from "@/lib/games/source";
import { igdbTopFranchises, igdbTopStudios } from "@/lib/games/providers/igdb";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const revalidate = 0;

/**
 * Static routes plus a sample of currently popular game pages. Enumerating
 * every live-provider slug would mean hundreds of thousands of entries for a
 * catalogue that changes constantly, so this lists what's trending, top rated
 * and upcoming right now — the titles most worth a crawler's attention —
 * rather than attempting completeness.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/upcoming`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/browse`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/discover`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/search`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/stats`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/genres`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/platforms`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/steam`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/studios`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/franchises`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
  ];

  /*
   * Entity pages are included, games are sampled.
   *
   * Studios and franchises are bounded sets that change slowly, so the directory
   * can be enumerated honestly. Games cannot: listing every slug would mean
   * hundreds of thousands of entries for a catalogue that changes constantly,
   * so this lists what is trending, top rated and upcoming right now — the
   * titles most worth a crawler's attention — rather than attempting
   * completeness.
   *
   * All three run together, and any that fails contributes nothing rather than
   * failing the sitemap: a partial sitemap is far better than a 500.
   */
  const [slugs, studios, franchises] = await Promise.all([
    popularSlugs(200).catch(() => [] as string[]),
    igdbTopStudios(120).catch(() => null),
    igdbTopFranchises(120).catch(() => null),
  ]);

  const gameRoutes: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${BASE}/game/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const studioRoutes: MetadataRoute.Sitemap = (studios ?? []).map((studio) => ({
    url: `${BASE}/studio/${studio.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  const franchiseRoutes: MetadataRoute.Sitemap = (franchises ?? []).map((entry) => ({
    url: `${BASE}/franchise/${entry.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...gameRoutes, ...studioRoutes, ...franchiseRoutes];
}
