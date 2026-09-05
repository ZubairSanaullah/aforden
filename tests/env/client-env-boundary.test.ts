import { describe, it, expect } from "vitest";
import {
  scanFileForClientBoundaryViolations,
  auditClientEnvBoundary,
} from "@/scripts/check-client-env-boundary";

describe("Phase 1.22.3 — Client/Server Environment Boundary Audit", () => {
  it("verifies the entire repository has zero secret leaks into client components", () => {
    const violations = auditClientEnvBoundary();
    expect(violations).toEqual([]);
  });

  describe("scanFileForClientBoundaryViolations", () => {
    it("permits NEXT_PUBLIC_ variables in client components", () => {
      const content = `
        "use client";
        import React from "react";
        export function AppLink() {
          const url = process.env.NEXT_PUBLIC_APP_URL;
          return <a href={url}>App</a>;
        }
      `;
      const violations = scanFileForClientBoundaryViolations("test-client.tsx", content);
      expect(violations).toEqual([]);
    });

    it("detects and flags server secret accesses in client components (dot notation)", () => {
      const content = `
        "use client";
        export function CheckoutButton() {
          const secret = process.env.STRIPE_SECRET_KEY;
          return <button>{secret}</button>;
        }
      `;
      const violations = scanFileForClientBoundaryViolations("components/checkout.tsx", content);
      expect(violations).toHaveLength(1);
      expect(violations[0].variableName).toBe("STRIPE_SECRET_KEY");
      expect(violations[0].filePath).toBe("components/checkout.tsx");
      expect(violations[0].lineNumber).toBe(4);
    });

    it("detects and flags server secret accesses in client components (bracket notation)", () => {
      const content = `
        'use client';
        export function DbViewer() {
          const db = process.env["DATABASE_URL"];
          const paddle = process.env['PADDLE_API_KEY'];
          return <div>{db}</div>;
        }
      `;
      const violations = scanFileForClientBoundaryViolations("components/db.tsx", content);
      expect(violations).toHaveLength(2);
      expect(violations.map((v) => v.variableName)).toEqual(["DATABASE_URL", "PADDLE_API_KEY"]);
    });

    it("ignores server files without 'use client'", () => {
      const content = `
        export async function getServerData() {
          const key = process.env.STRIPE_SECRET_KEY;
          const cron = process.env.CRON_SECRET;
          return { key, cron };
        }
      `;
      const violations = scanFileForClientBoundaryViolations("lib/server.ts", content);
      expect(violations).toEqual([]);
    });

    it("ignores comments referencing server variables in client components", () => {
      const content = `
        "use client";
        // Do not use process.env.STRIPE_SECRET_KEY here
        export function SafeComponent() {
          return <div>Safe</div>;
        }
      `;
      const violations = scanFileForClientBoundaryViolations("components/safe.tsx", content);
      expect(violations).toEqual([]);
    });
  });
});
