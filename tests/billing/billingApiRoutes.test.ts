import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as checkoutRoute } from "@/app/api/workspaces/[workspaceId]/billing/checkout/route";
import { POST as changePlanRoute } from "@/app/api/workspaces/[workspaceId]/billing/change-plan/route";
import { POST as portalRoute } from "@/app/api/workspaces/[workspaceId]/billing/portal/route";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
  DuplicateActiveSubscriptionError,
  PlanPriceNotFoundError,
  MissingProviderCustomerError,
} from "@/lib/services/billing/billingErrors";

// Mock services & auth
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

import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { createCheckoutSession } from "@/lib/services/billing/checkoutService";
import { changeSubscriptionPlan } from "@/lib/services/billing/planChangeService";
import { createCustomerPortalSession } from "@/lib/services/billing/portalService";

describe("Phase 1.15.6 / 1.15.7 — SaaS Billing REST API Routes Tests", () => {
  const wsId = "ws_test_billing_routes";
  const paramsPromise = Promise.resolve({ workspaceId: wsId });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/workspaces/[workspaceId]/billing/checkout", () => {
    it("should return 401 UNAUTHORIZED when caller is unauthenticated", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockRejectedValueOnce(
        new UnauthorizedError("Authentication required.")
      );

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
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 403 FORBIDDEN when user role lacks BILLING_MANAGE (e.g. TECHNICIAN)", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "TECHNICIAN" as any } as any,
        user: { id: "u_tech", email: "tech@example.com", name: "Tech User" } as any,
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

    it("should return 422 VALIDATION_ERROR when required parameters are missing", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing priceId and URLs
        }),
      });

      const res = await checkoutRoute(req, { params: paramsPromise });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 409 DUPLICATE_ACTIVE_SUBSCRIPTION when active subscription already exists", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      vi.mocked(createCheckoutSession).mockRejectedValueOnce(
        new DuplicateActiveSubscriptionError("acc_123", "sub_active_123")
      );

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
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("DUPLICATE_ACTIVE_SUBSCRIPTION");
    });

    it("should return 200 with checkout session details for authorized OWNER", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      vi.mocked(createCheckoutSession).mockResolvedValueOnce({
        sessionId: "cs_mock_12345",
        sessionUrl: "https://checkout.stripe.com/c/pay/cs_mock_12345",
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "price_123",
          quantity: 3,
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
        }),
      });

      const res = await checkoutRoute(req, { params: paramsPromise });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.sessionId).toBe("cs_mock_12345");
      expect(json.data.sessionUrl).toContain("cs_mock_12345");
    });
  });

  describe("POST /api/workspaces/[workspaceId]/billing/change-plan", () => {
    it("should return 403 FORBIDDEN when user lacks BILLING_MANAGE permission", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "DISPATCHER" as any } as any,
        user: { id: "u_disp", email: "disp@example.com", name: "Dispatcher" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/change-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "price_growth",
        }),
      });

      const res = await changePlanRoute(req, { params: paramsPromise });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("should return 404 PLAN_PRICE_NOT_FOUND when price is not found", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      vi.mocked(changeSubscriptionPlan).mockRejectedValueOnce(
        new PlanPriceNotFoundError("price_unknown")
      );

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/change-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "price_unknown",
        }),
      });

      const res = await changePlanRoute(req, { params: paramsPromise });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("PLAN_PRICE_NOT_FOUND");
    });

    it("should return 200 with updated subscription for authorized OWNER", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      vi.mocked(changeSubscriptionPlan).mockResolvedValueOnce({
        id: "sub_123",
        workspaceId: wsId,
        accountId: "acc_123",
        planId: "plan_growth",
        status: "ACTIVE",
        seatsCount: 5,
      } as any);

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/change-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: "price_growth",
          seatsCount: 5,
        }),
      });

      const res = await changePlanRoute(req, { params: paramsPromise });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe("sub_123");
      expect(json.data.planId).toBe("plan_growth");
      expect(json.data.seatsCount).toBe(5);
    });
  });

  describe("POST /api/workspaces/[workspaceId]/billing/portal", () => {
    it("should return 401 UNAUTHORIZED when caller is unauthenticated", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockRejectedValueOnce(
        new UnauthorizedError("Authentication required.")
      );

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: "https://aforden.com/settings/billing",
        }),
      });

      const res = await portalRoute(req, { params: paramsPromise });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 403 FORBIDDEN when user lacks BILLING_MANAGE permission", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "TECHNICIAN" as any } as any,
        user: { id: "u_tech", email: "tech@example.com", name: "Tech User" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: "https://aforden.com/settings/billing",
        }),
      });

      const res = await portalRoute(req, { params: paramsPromise });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("should return 422 VALIDATION_ERROR when returnUrl is invalid", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: "not-a-valid-url",
        }),
      });

      const res = await portalRoute(req, { params: paramsPromise });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 MISSING_PROVIDER_CUSTOMER when workspace has no providerCustomerId", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      vi.mocked(createCustomerPortalSession).mockRejectedValueOnce(
        new MissingProviderCustomerError(wsId)
      );

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: "https://aforden.com/settings/billing",
        }),
      });

      const res = await portalRoute(req, { params: paramsPromise });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("MISSING_PROVIDER_CUSTOMER");
    });

    it("should return 200 with portalUrl for authorized OWNER", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "OWNER" as any } as any,
        user: { id: "u_owner", email: "owner@example.com", name: "Owner" } as any,
        workspace: { id: wsId, name: "Test WS" } as any,
      });

      vi.mocked(createCustomerPortalSession).mockResolvedValueOnce({
        portalUrl: "https://billing.stripe.com/p/session/test_portal_123",
      });

      const req = new Request(`http://localhost/api/workspaces/${wsId}/billing/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: "https://aforden.com/settings/billing",
        }),
      });

      const res = await portalRoute(req, { params: paramsPromise });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.portalUrl).toBe("https://billing.stripe.com/p/session/test_portal_123");
    });
  });
});
