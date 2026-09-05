/**
 * Phase 1.22.9 — Technical SEO Structured Data (JSON-LD) Foundation
 *
 * Implements Schema.org data models for WebSite and Organization types.
 *
 * Conservative Content Principle:
 * Strictly avoids fabricating addresses, founding dates, or registration IDs.
 * Only verified, confirmed platform attributes are included; physical postal
 * address and legal entity details are documented as deferred to Phase 1.25.
 */

export interface OrganizationSchema {
  "@context": "https://schema.org";
  "@type": "Organization";
  name: string;
  url: string;
  logo: string;
  description: string;
  sameAs?: string[];
}

export interface WebSiteSchema {
  "@context": "https://schema.org";
  "@type": "WebSite";
  name: string;
  url: string;
  description: string;
  potentialAction?: {
    "@type": "SearchAction";
    target: string;
    "query-input": string;
  };
}

export type StructuredDataPayload =
  | OrganizationSchema
  | WebSiteSchema
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

/**
 * Generates canonical Organization JSON-LD metadata.
 * Uses only verified real values; physical street address and corporate numbers are deferred to Phase 1.25.
 */
export function createOrganizationSchema(baseUrl: string): OrganizationSchema {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Aforden",
    url: cleanBaseUrl,
    logo: `${cleanBaseUrl}/logo.png`,
    description:
      "Aforden is a modern field service operations platform for dispatch, scheduling, work orders, invoicing, and technician management.",
    // Deferred to Phase 1.25 (Public Marketing Site):
    // - address (PostalAddress: pending corporate headquarters registration)
    // - telephone / contactPoint (Customer Support 10DLC hotline)
    // - foundingDate (Corporate incorporation milestone)
  };
}

/**
 * Generates canonical WebSite JSON-LD metadata.
 */
export function createWebSiteSchema(baseUrl: string): WebSiteSchema {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Aforden",
    url: cleanBaseUrl,
    description:
      "Field service management and operations software for dispatch, scheduling, work orders, and invoicing.",
  };
}
