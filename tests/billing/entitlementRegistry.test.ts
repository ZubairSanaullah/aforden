import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_REGISTRY,
  ENTITLEMENT_KEYS,
  isEntitlementKey,
  getEntitlementDefinition,
  type EntitlementKey,
} from "@/lib/services/billing/entitlementRegistry";
import {
  PlanFeatureNotEnabledError,
  QuotaExceededError,
  DuplicateActiveSubscriptionError,
  SubscriptionPastDueError,
  InvalidSubscriptionStateTransitionError,
  WebhookVerificationError,
  InvalidEntitlementMultiplierError,
} from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.2 — Entitlement Registry & Error Classes Tests", () => {
  describe("1. ENTITLEMENT_REGISTRY Integrity", () => {
    it("should have exactly 11 registered entitlement keys", () => {
      expect(ENTITLEMENT_KEYS).toHaveLength(11);
      expect(Object.keys(ENTITLEMENT_REGISTRY)).toHaveLength(11);
    });

    it("should contain all mandatory numeric quotas with correct scaling declarations", () => {
      expect(ENTITLEMENT_REGISTRY.MAX_MEMBERS).toEqual({
        key: "MAX_MEMBERS",
        type: "NUMERIC_LIMIT",
        defaultValue: 2,
        scalesWithSeats: true,
        description: "Maximum active user accounts in the workspace",
      });

      expect(ENTITLEMENT_REGISTRY.MAX_TECHNICIANS).toEqual({
        key: "MAX_TECHNICIANS",
        type: "NUMERIC_LIMIT",
        defaultValue: 1,
        scalesWithSeats: false,
        description: "Maximum active technician profiles with dispatch scheduling",
      });

      expect(ENTITLEMENT_REGISTRY.MAX_WORK_ORDERS_PER_MONTH).toEqual({
        key: "MAX_WORK_ORDERS_PER_MONTH",
        type: "NUMERIC_LIMIT",
        defaultValue: 25,
        scalesWithSeats: false,
        description: "Maximum work orders created within a single calendar month",
      });

      expect(ENTITLEMENT_REGISTRY.MAX_SERVICE_LOCATIONS).toEqual({
        key: "MAX_SERVICE_LOCATIONS",
        type: "NUMERIC_LIMIT",
        defaultValue: 50,
        scalesWithSeats: false,
        description: "Maximum active customer service location records",
      });

      expect(ENTITLEMENT_REGISTRY.MAX_ATTACHMENT_STORAGE_MB).toEqual({
        key: "MAX_ATTACHMENT_STORAGE_MB",
        type: "NUMERIC_LIMIT",
        defaultValue: 500,
        scalesWithSeats: false,
        description: "Total file attachment and photo evidence storage capacity in MB",
      });
    });

    it("should contain all mandatory boolean feature flags", () => {
      expect(ENTITLEMENT_REGISTRY.FEATURE_ADVANCED_REPORTING).toEqual({
        key: "FEATURE_ADVANCED_REPORTING",
        type: "BOOLEAN",
        defaultValue: false,
        scalesWithSeats: false,
        description: "Access to profitability, technician efficiency, and AR aging reports",
      });

      expect(ENTITLEMENT_REGISTRY.FEATURE_CUSTOM_BRANDING).toEqual({
        key: "FEATURE_CUSTOM_BRANDING",
        type: "BOOLEAN",
        defaultValue: false,
        scalesWithSeats: false,
        description: "Custom logos, PDF color schemes, and email sender signatures",
      });

      expect(ENTITLEMENT_REGISTRY.FEATURE_SMS_NOTIFICATIONS).toEqual({
        key: "FEATURE_SMS_NOTIFICATIONS",
        type: "BOOLEAN",
        defaultValue: false,
        scalesWithSeats: false,
        description: "Direct SMS notification dispatches to customers and field techs",
      });

      expect(ENTITLEMENT_REGISTRY.FEATURE_INVENTORY_MULTI_WAREHOUSE).toEqual({
        key: "FEATURE_INVENTORY_MULTI_WAREHOUSE",
        type: "BOOLEAN",
        defaultValue: false,
        scalesWithSeats: false,
        description: "Tracking inventory across multiple physical warehouses and trucks",
      });

      expect(ENTITLEMENT_REGISTRY.FEATURE_API_ACCESS).toEqual({
        key: "FEATURE_API_ACCESS",
        type: "BOOLEAN",
        defaultValue: false,
        scalesWithSeats: false,
        description: "Access to public developer REST APIs and webhooks",
      });
    });

    it("should be runtime frozen preventing mutations", () => {
      expect(Object.isFrozen(ENTITLEMENT_REGISTRY)).toBe(true);
      for (const key of ENTITLEMENT_KEYS) {
        expect(Object.isFrozen(ENTITLEMENT_REGISTRY[key])).toBe(true);
      }

      // Assert attempting to add or modify properties fails in strict mode
      expect(() => {
        // @ts-expect-error - Testing runtime mutation rejection
        ENTITLEMENT_REGISTRY["UNKNOWN_KEY"] = { key: "UNKNOWN_KEY" };
      }).toThrow();
    });

    it("should correctly validate keys using isEntitlementKey", () => {
      expect(isEntitlementKey("MAX_MEMBERS")).toBe(true);
      expect(isEntitlementKey("FEATURE_ADVANCED_REPORTING")).toBe(true);
      expect(isEntitlementKey("UNKNOWN_FEATURE")).toBe(false);
      expect(isEntitlementKey("")).toBe(false);
    });

    it("should retrieve definitions via getEntitlementDefinition", () => {
      const def = getEntitlementDefinition("MAX_MEMBERS");
      expect(def.key).toBe("MAX_MEMBERS");
      expect(def.scalesWithSeats).toBe(true);
    });
  });

  describe("2. Pure Domain Error Classes", () => {
    it("PlanFeatureNotEnabledError should have 403 status and context", () => {
      const err = new PlanFeatureNotEnabledError("FEATURE_ADVANCED_REPORTING", "ws_123");
      expect(err.code).toBe("PLAN_FEATURE_NOT_ENABLED");
      expect(err.statusCode).toBe(403);
      expect(err.httpStatus).toBe(403);
      expect(err.context).toEqual({
        featureKey: "FEATURE_ADVANCED_REPORTING",
        workspaceId: "ws_123",
      });
      expect(err.message).toContain("FEATURE_ADVANCED_REPORTING");
    });

    it("QuotaExceededError should have 402 status and context", () => {
      const err = new QuotaExceededError("MAX_MEMBERS", 5, 5, "ws_123");
      expect(err.code).toBe("QUOTA_EXCEEDED");
      expect(err.statusCode).toBe(402);
      expect(err.httpStatus).toBe(402);
      expect(err.context).toEqual({
        featureKey: "MAX_MEMBERS",
        current: 5,
        limit: 5,
        workspaceId: "ws_123",
      });
    });

    it("DuplicateActiveSubscriptionError should have 409 status and context", () => {
      const err = new DuplicateActiveSubscriptionError("acc_123", "sub_abc");
      expect(err.code).toBe("DUPLICATE_ACTIVE_SUBSCRIPTION");
      expect(err.statusCode).toBe(409);
      expect(err.httpStatus).toBe(409);
      expect(err.context).toEqual({
        accountId: "acc_123",
        existingSubscriptionId: "sub_abc",
      });
    });

    it("SubscriptionPastDueError should have 402 status and context", () => {
      const graceEnd = new Date("2026-09-01T00:00:00.000Z");
      const err = new SubscriptionPastDueError("ws_123", graceEnd);
      expect(err.code).toBe("SUBSCRIPTION_PAST_DUE");
      expect(err.statusCode).toBe(402);
      expect(err.httpStatus).toBe(402);
      expect(err.context).toEqual({
        workspaceId: "ws_123",
        gracePeriodEndsAt: graceEnd,
      });
    });

    it("InvalidSubscriptionStateTransitionError should have 409 status and context", () => {
      const err = new InvalidSubscriptionStateTransitionError("CANCELED", "PAST_DUE", "Terminal state");
      expect(err.code).toBe("INVALID_SUBSCRIPTION_STATE_TRANSITION");
      expect(err.statusCode).toBe(409);
      expect(err.httpStatus).toBe(409);
      expect(err.context).toEqual({
        from: "CANCELED",
        to: "PAST_DUE",
        reason: "Terminal state",
      });
    });

    it("WebhookVerificationError should have 400 status and context", () => {
      const err = new WebhookVerificationError("Invalid HMAC signature");
      expect(err.code).toBe("WEBHOOK_VERIFICATION_FAILED");
      expect(err.statusCode).toBe(400);
      expect(err.httpStatus).toBe(400);
      expect(err.context).toEqual({
        message: "Invalid HMAC signature",
      });
    });

    it("InvalidEntitlementMultiplierError should have 500 status and context", () => {
      const err = new InvalidEntitlementMultiplierError("MAX_MEMBERS", 0, "plan_starter");
      expect(err.code).toBe("INVALID_ENTITLEMENT_MULTIPLIER");
      expect(err.statusCode).toBe(500);
      expect(err.httpStatus).toBe(500);
      expect(err.context).toEqual({
        featureKey: "MAX_MEMBERS",
        value: 0,
        planId: "plan_starter",
      });
    });
  });
});
