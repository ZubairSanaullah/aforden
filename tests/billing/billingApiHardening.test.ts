/**
 * Phase 1.15.10 — SaaS Billing REST API Hardening & Route Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as checkoutRoute } from "@/app/api/workspaces/[workspaceId]/billing/checkout/route";
import { POST as changePlanRoute } from "@/app/api/workspaces/[workspaceId]/billing/change-plan/route";
import { POST as portalRoute } from "@/app/api/workspaces/[workspaceId]/billing/portal/route";
import { GET as getSubscriptionRoute } from "@/app/api/billing/subscriptions/[workspaceId]/route";
import { POST as webhookRoute } from "@/app/api/billing/webhooks/[provider]/route";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { prisma } from "@/lib/prisma";

// Mock authorization and billing services
vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
  requireWorkspaceAuthorization: vi.fn(),
}));

vi.mock("@/lib/services/billing/checkoutService", () => ({
  createCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/services/billing/planChangeService", () => ({
  changeSubscriptionPlan: vi.fn(),
}));

vi.mock("@/lib/services/billing/portalService", () => ({
  createCustomerPortalSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: {
      findFirst: vi.fn(),
    },
  },
}));

import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { createCheckoutSession } from "@/lib/services/billing/checkoutService";
import { changeSubscriptionPlan } from "@/lib/services/billing/planChangeService";
import { createCustomerPortalSession } from "@/lib/services/billing/portalService";

describe("Phase 1.15.10 — SaaS Billing REST API Hardening Tests", () => {
  const wsId = "ws_harden_test";
  const paramsPromise = Promise.resolve({ workspaceId: wsId });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Authentication & Role-Based Access Control (401 / 403)", () => {
    it("should return 401 UNAUTHORIZED when caller has no valid session (GET subscription)", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockRejectedValueOnce(
        new UnauthorizedError("Authentication required.")
      );

      const req = new Request(`http://localhost/api/billing/subscriptions/${wsId}`);
      const res = await getSubscriptionRoute(req, { params: paramsPromise });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 403 FORBIDDEN when user role lacks BILLING_VIEW (e.g. TECHNICIAN on GET)", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "TECHNICIAN" as any } as any,
        user: { id: "u_tech", email: "tech@example.com", name: "Technician" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/billing/subscriptions/${wsId}`);
      const res = await getSubscriptionRoute(req, { params: paramsPromise });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("should allow ADMIN to read GET /api/billing/subscriptions/[workspaceId] (BILLING_VIEW)", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "ADMIN" as any } as any,
        user: { id: "u_admin", email: "admin@example.com", name: "Admin" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
        id: "sub_admin_read",
        workspaceId: wsId,
        status: "ACTIVE",
        seatsCount: 4,
        plan: { code: "growth", name: "Growth Plan", features: [], prices: [] },
        account: { id: "acc_123", billingEmail: "admin@example.com", provider: "MOCK" },
      } as any);

      const req = new Request(`http://localhost/api/billing/subscriptions/${wsId}`);
      const res = await getSubscriptionRoute(req, { params: paramsPromise });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.hasActiveSubscription).toBe(true);
      expect(json.data.subscription.id).toBe("sub_admin_read");
    });

    it("should reject DISPATCHER from POST /checkout (requires BILLING_MANAGE)", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "DISPATCHER" as any } as any,
        user: { id: "u_disp", email: "disp@example.com", name: "Dispatcher" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "price_123",
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
        }),
      });

      const res = await checkoutRoute(req, { params: paramsPromise });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });

  describe("2. Request Validation & Malformed Payload Handling", () => {
    it("should return 400 MALFORMED_JSON when JSON syntax is corrupt", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "INVALID_JSON_CONTENT{{{",
      });

      const res = await checkoutRoute(req, { params: paramsPromise });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("MALFORMED_JSON");
    });

    it("should return 422 VALIDATION_ERROR with field details on schema validation failure", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "", // Empty priceId
          successUrl: "not-a-url",
          cancelUrl: "not-a-url",
          quantity: -5, // Invalid negative quantity
        }),
      });

      const res = await checkoutRoute(req, { params: paramsPromise });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.fields).toBeDefined();
    });
  });

  describe("3. Error Sanitization & Non-Leakage of Internal Details", () => {
    it("should sanitize unexpected internal exceptions to generic 500 without leaking stack traces", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      // Simulate an internal runtime exception with sensitive details
      vi.mocked(createCheckoutSession).mockRejectedValueOnce(
        new Error("Sensitive internal PostgreSQL connection failure: postgres://admin:secret@10.0.0.1:5432/aforden")
      );

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "price_growth",
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
        }),
      });

      const res = await checkoutRoute(req, { params: paramsPromise });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(json.error.message).toBe("An unexpected error occurred. Please try again later.");
      // Ensure no internal DB URL leaked in response
      expect(JSON.stringify(json)).not.toContain("postgres://");
      expect(JSON.stringify(json)).not.toContain("secret");
    });
  });

  describe("4. Webhook Route Hardening", () => {
    it("should reject unsupported provider with 400 Bad Request", async () => {
      const req = new Request("http://localhost/api/billing/webhooks/unsupported_gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      const res = await webhookRoute(req, {
        params: Promise.resolve({ provider: "unsupported_gateway" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Unsupported billing provider");
    });
  });
});
