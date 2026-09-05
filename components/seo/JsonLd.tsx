import React from "react";
import type { StructuredDataPayload } from "@/lib/seo/structuredData";

interface JsonLdProps {
  data: StructuredDataPayload;
}

/**
 * Reusable React Component for injecting Schema.org JSON-LD structured data.
 *
 * Implements safe JSON serialization with XSS mitigation (\u003c escaping)
 * to satisfy both App Router SSR and Schema.org ingestion.
 */
export function JsonLd({ data }: JsonLdProps) {
  // Prevent XSS injection via </script> tag closure in schema data
  const jsonString = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonString }}
    />
  );
}
