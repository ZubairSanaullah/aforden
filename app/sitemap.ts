import type { MetadataRoute } from "next";

/**
 * Technical SEO: Dynamic Sitemap Generator (Phase 1.22.9)
 *
 * Scope:
 * - Emits canonical URLs for genuinely public, indexable routes.
 * - Currently indexes the root landing route (`/`).
 * - Documented expansion hook for Phase 1.25 (Public Marketing Site):
 *   Will incorporate `/features`, `/pricing`, `/terms`, `/privacy`, and `/contact`.
 * - Excludes all private application planes and authentication routes.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://aforden.aformix.com").replace(/\/+$/, "");
  const currentDate = new Date();

  return [
    {
      url: baseUrl,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    // Expansion Hook for Phase 1.25:
    // When marketing content routes are introduced in Phase 1.25, append them here:
    // { url: `${baseUrl}/features`, lastModified: currentDate, changeFrequency: "weekly", priority: 0.8 },
    // { url: `${baseUrl}/pricing`, lastModified: currentDate, changeFrequency: "weekly", priority: 0.8 },
    // { url: `${baseUrl}/terms`, lastModified: currentDate, changeFrequency: "monthly", priority: 0.3 },
    // { url: `${baseUrl}/privacy`, lastModified: currentDate, changeFrequency: "monthly", priority: 0.3 },
    // { url: `${baseUrl}/contact`, lastModified: currentDate, changeFrequency: "monthly", priority: 0.5 },
  ];
}
