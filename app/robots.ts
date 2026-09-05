import type { MetadataRoute } from "next";

/**
 * Technical SEO: Dynamic Robots Specification (Phase 1.22.9)
 *
 * Directives:
 * 1. Allows search engine crawlers on genuinely public routes (currently `/`).
 *    Note: This list expands in Phase 1.25 to include `/features`, `/pricing`, `/terms`, `/privacy`, `/contact`.
 * 2. Strictly disallows all private application planes, authentication endpoints, and internal API routes.
 * 3. Dynamically references the canonical sitemap index at `${baseUrl}/sitemap.xml`.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://aforden.aformix.com").replace(/\/+$/, "");

  return {
    rules: {
      userAgent: "*",
      allow: ["/"],
      disallow: [
        // Backend & API Infrastructure
        "/api/",
        // Core Authenticated Workspace & Application Planes
        "/dashboard/",
        "/work-orders/",
        "/invoices/",
        "/quotes/",
        "/inventory/",
        "/schedules/",
        "/customers/",
        "/settings/",
        "/workspaces/",
        "/platform/",
        "/technician/",
        // Public Authentication Entrypoints (Defense in Depth: Blocked from Crawlers)
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
