import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/font/google", () => ({
    Geist: () => ({ variable: "--font-geist-sans" }),
    Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { metadata } from "@/app/layout";
import {
    createOrganizationSchema,
    createWebSiteSchema,
} from "@/lib/seo/structuredData";
import { JsonLd } from "@/components/seo/JsonLd";
import {
    resolveRobotsTag,
    applyIndexationHeaders,
} from "@/lib/api/securityHeaders";
import { proxy } from "@/proxy";

describe("Phase 1.22.9 — Technical SEO Architecture & Scaffolding", () => {
    const originalEnv = process.env.NEXT_PUBLIC_APP_URL;
    const originalVercelEnv = process.env.VERCEL_ENV;

    beforeEach(() => {
        process.env.NEXT_PUBLIC_APP_URL = "https://aforden.aformix.com";
        delete process.env.VERCEL_ENV;
    });

    afterEach(() => {
        if (originalEnv) {
            process.env.NEXT_PUBLIC_APP_URL = originalEnv;
        } else {
            delete process.env.NEXT_PUBLIC_APP_URL;
        }
        if (originalVercelEnv) {
            process.env.VERCEL_ENV = originalVercelEnv;
        } else {
            delete process.env.VERCEL_ENV;
        }
    });

    // =========================================================================
    // 1. Root Layout Metadata Conventions
    // =========================================================================
    describe("1. Root Layout Metadata Architecture", () => {
        it("defines metadataBase resolving to canonical origin", () => {
            expect(metadata.metadataBase).toBeInstanceOf(URL);
            expect(metadata.metadataBase?.toString()).toBe("https://aforden.aformix.com/");
        });

        it("defines a structured title template with fallback default", () => {
            expect(typeof metadata.title).toBe("object");
            const titleObj = metadata.title as { default: string; template: string };
            expect(titleObj.default).toContain("Aforden");
            expect(titleObj.template).toBe("%s | Aforden");
        });

        it("defines platform meta description and application metadata", () => {
            expect(metadata.description).toBeTruthy();
            expect(metadata.description).toContain("field service");
            expect(metadata.applicationName).toBe("Aforden");
            expect(metadata.creator).toBe("Aforden");
            expect(metadata.publisher).toBe("Aforden");
        });

        it("configures canonical URL alternates referencing current location", () => {
            expect(metadata.alternates?.canonical).toBe("./");
        });

        it("configures Open Graph protocol defaults", () => {
            const og = metadata.openGraph as Record<string, any>;
            expect(og?.type).toBe("website");
            expect(og?.siteName).toBe("Aforden");
            expect(og?.locale).toBe("en_US");
            expect(og?.images).toBeDefined();
        });

        it("configures X / Twitter summary_large_image card", () => {
            const tw = metadata.twitter as Record<string, any>;
            expect(tw?.card).toBe("summary_large_image");
            expect(tw?.title).toBeDefined();
            expect(tw?.images).toBeDefined();
        });

        it("configures default robots crawling directives for public pages", () => {
            const robots = metadata.robots as {
                index: boolean;
                follow: boolean;
                googleBot?: {
                    index: boolean;
                    follow: boolean;
                    "max-image-preview": string;
                };
            };
            expect(robots.index).toBe(true);
            expect(robots.follow).toBe(true);
            expect(robots.googleBot?.index).toBe(true);
            expect(robots.googleBot?.["max-image-preview"]).toBe("large");
        });

        it("configures favicon icon reference", () => {
            expect(metadata.icons).toEqual({ icon: "/favicon.ico" });
        });
    });

    // =========================================================================
    // 2. robots.txt Dynamic Route Handler
    // =========================================================================
    describe("2. Dynamic robots.ts Specification", () => {
        it("allows public crawling on the root route ('/')", () => {
            const result = robots();
            const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
            expect(rules.allow).toContain("/");
        });

        it("strictly disallows all private, authenticated, and API paths", () => {
            const result = robots();
            const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
            const disallow = Array.isArray(rules.disallow)
                ? rules.disallow
                : [rules.disallow];

            // Verify API
            expect(disallow).toContain("/api/");

            // Verify Application Planes
            expect(disallow).toContain("/dashboard/");
            expect(disallow).toContain("/work-orders/");
            expect(disallow).toContain("/invoices/");
            expect(disallow).toContain("/quotes/");
            expect(disallow).toContain("/inventory/");
            expect(disallow).toContain("/schedules/");
            expect(disallow).toContain("/customers/");
            expect(disallow).toContain("/settings/");
            expect(disallow).toContain("/workspaces/");
            expect(disallow).toContain("/platform/");
            expect(disallow).toContain("/technician/");

            // Verify Auth Entrypoints
            expect(disallow).toContain("/login");
            expect(disallow).toContain("/register");
            expect(disallow).toContain("/forgot-password");
            expect(disallow).toContain("/reset-password");
            expect(disallow).toContain("/verify-email");
        });

        it("dynamically resolves sitemap reference using NEXT_PUBLIC_APP_URL", () => {
            process.env.NEXT_PUBLIC_APP_URL = "https://custom.aforden.com";
            const result = robots();
            expect(result.sitemap).toBe("https://custom.aforden.com/sitemap.xml");
        });
    });

    // =========================================================================
    // 3. sitemap.xml Dynamic Route Handler
    // =========================================================================
    describe("3. Dynamic sitemap.ts Specification", () => {
        it("emits the root indexable public page with high priority", () => {
            const result = sitemap();
            expect(result.length).toBe(1);
            expect(result[0].url).toBe("https://aforden.aformix.com");
            expect(result[0].priority).toBe(1.0);
            expect(result[0].changeFrequency).toBe("weekly");
            expect(result[0].lastModified).toBeInstanceOf(Date);
        });

        it("resolves URLs dynamically from NEXT_PUBLIC_APP_URL", () => {
            process.env.NEXT_PUBLIC_APP_URL = "https://preview.aformix.com";
            const result = sitemap();
            expect(result[0].url).toBe("https://preview.aformix.com");
        });
    });

    // =========================================================================
    // 4. Structured Data (JSON-LD) Foundation
    // =========================================================================
    describe("4. Structured Data (JSON-LD) Schemas & Component", () => {
        it("generates Schema.org compliant Organization schema with real attributes", () => {
            const schema = createOrganizationSchema("https://aforden.aformix.com");
            expect(schema["@context"]).toBe("https://schema.org");
            expect(schema["@type"]).toBe("Organization");
            expect(schema.name).toBe("Aforden");
            expect(schema.url).toBe("https://aforden.aformix.com");
            expect(schema.logo).toBe("https://aforden.aformix.com/logo.png");
            expect(schema.description).toContain("field service operations platform");
        });

        it("generates Schema.org compliant WebSite schema", () => {
            const schema = createWebSiteSchema("https://aforden.aformix.com");
            expect(schema["@context"]).toBe("https://schema.org");
            expect(schema["@type"]).toBe("WebSite");
            expect(schema.name).toBe("Aforden");
            expect(schema.url).toBe("https://aforden.aformix.com");
            expect(schema.description).toBeDefined();
        });

        it("renders JsonLd script tag with safely escaped JSON", () => {
            const testData = {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: "Test <script>alert(1)</script>",
            };
            const element = JsonLd({ data: testData as any });
            expect(element.type).toBe("script");
            expect(element.props.type).toBe("application/ld+json");
            expect(element.props.dangerouslySetInnerHTML?.__html).not.toContain("<script>");
            expect(element.props.dangerouslySetInnerHTML?.__html).toContain("\\u003cscript>");
        });
    });

    // =========================================================================
    // 5. Multi-Tier Indexation Controls & Defense in Depth
    // =========================================================================
    describe("5. Defense-in-Depth Indexation Directives (X-Robots-Tag)", () => {
        it("injects blanket 'noindex, nofollow, noarchive' on VERCEL_ENV=preview", () => {
            const tag = resolveRobotsTag("/", "aforden-git-feat.vercel.app", "preview");
            expect(tag).toBe("noindex, nofollow, noarchive");
        });

        it("injects blanket 'noindex, nofollow, noarchive' on any *.vercel.app hostname", () => {
            const tag = resolveRobotsTag("/", "my-preview-deployment.vercel.app", undefined);
            expect(tag).toBe("noindex, nofollow, noarchive");
        });

        it("injects 'noindex, nofollow' on private application and API routes in production", () => {
            const routes = [
                "/api/v1/ping",
                "/api/cron/session-cleanup",
                "/dashboard",
                "/dashboard/overview",
                "/work-orders",
                "/work-orders/wo_123",
                "/invoices/inv_456",
                "/quotes",
                "/inventory/locations",
                "/schedules",
                "/customers",
                "/settings/billing",
                "/workspaces/ws_1",
                "/platform/operators",
                "/technician/work-orders",
            ];

            for (const route of routes) {
                const tag = resolveRobotsTag(route, "aforden.aformix.com", "production");
                expect(tag).toBe("noindex, nofollow");
            }
        });

        it("injects 'noindex, follow' on public authentication entrypoints in production", () => {
            const authRoutes = [
                "/login",
                "/register",
                "/forgot-password",
                "/reset-password",
                "/verify-email",
            ];

            for (const route of authRoutes) {
                const tag = resolveRobotsTag(route, "aforden.aformix.com", "production");
                expect(tag).toBe("noindex, follow");
            }
        });

        it("returns null for public landing page ('/') on canonical production domain", () => {
            const tag = resolveRobotsTag("/", "aforden.aformix.com", "production");
            expect(tag).toBeNull();
        });

        it("proxy attaches X-Robots-Tag to downstream response for private paths", () => {
            const req = new NextRequest("https://aforden.aformix.com/dashboard");
            const res = proxy(req);
            expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
        });

        it("proxy attaches blanket X-Robots-Tag to downstream response on preview domain", () => {
            const req = new NextRequest("https://aforden-git-feat-test.vercel.app/");
            const res = proxy(req);
            expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
        });

        it("proxy leaves X-Robots-Tag unset on public homepage in production", () => {
            const req = new NextRequest("https://aforden.aformix.com/");
            const res = proxy(req);
            expect(res.headers.get("X-Robots-Tag")).toBeNull();
        });
    });
});
