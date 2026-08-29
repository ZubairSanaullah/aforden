/**
 * Phase 1.17.3 — AdapterRegistry Unit Tests
 * Tests adapter registration, retrieval, duplicate guards, fail-fast capability subset checks,
 * unregister/clear lifecycle, and catalog consistency cross-checks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AdapterRegistry,
  registerAdapter,
  getAdapter,
  getAdapterOrThrow,
  hasAdapter,
  getAllAdapters,
  unregisterAdapter,
  clearAdapters,
  validateAdapterCatalogConsistency,
} from "@/lib/integrations/adapters/adapterRegistry";
import { MockEmailAdapter } from "@/lib/integrations/adapters/mockEmailAdapter";
import {
  AdapterNotRegisteredError,
  AdapterAlreadyRegisteredError,
  AdapterCapabilityMismatchError,
} from "@/lib/integrations/integrationErrors";
import { IntegrationCapability, type IntegrationAdapter } from "@/lib/integrations/adapters/types";

describe("Phase 1.17.3 — AdapterRegistry", () => {
  beforeEach(() => {
    clearAdapters();
  });

  describe("1. Registration & Retrieval", () => {
    it("should register and retrieve an adapter by integrationId", () => {
      const adapter = new MockEmailAdapter("mock_email");
      registerAdapter(adapter, { skipCatalogValidation: true });

      expect(hasAdapter("mock_email")).toBe(true);
      expect(getAdapter("mock_email")).toBe(adapter);
      expect(getAdapterOrThrow("mock_email")).toBe(adapter);
    });

    it("should throw AdapterNotRegisteredError when lookup fails via getAdapterOrThrow", () => {
      expect(getAdapter("unregistered_provider")).toBeUndefined();
      expect(() => getAdapterOrThrow("unregistered_provider")).toThrow(AdapterNotRegisteredError);
      expect(() => getAdapterOrThrow("unregistered_provider")).toThrow(
        "No provider adapter registered for integration 'unregistered_provider'."
      );
    });

    it("should reject registering an adapter without an integrationId", () => {
      const invalidAdapter = {
        integrationId: "",
        displayName: "Invalid",
        version: "1.0.0",
        getCapabilities: () => [],
      } as unknown as IntegrationAdapter;

      expect(() => registerAdapter(invalidAdapter)).toThrow(
        "[AdapterRegistry] Cannot register adapter without a valid integrationId."
      );
    });

    it("should list all registered adapters via getAllAdapters", () => {
      const adapter1 = new MockEmailAdapter("email_1");
      const adapter2 = new MockEmailAdapter("email_2");

      registerAdapter(adapter1, { skipCatalogValidation: true });
      registerAdapter(adapter2, { skipCatalogValidation: true });

      const all = getAllAdapters();
      expect(all).toHaveLength(2);
      expect(all.map((a) => a.integrationId)).toContain("email_1");
      expect(all.map((a) => a.integrationId)).toContain("email_2");
    });
  });

  describe("2. Duplicate Registration Guards & Overrides", () => {
    it("should throw AdapterAlreadyRegisteredError when registering the same integrationId twice without allowOverride", () => {
      const adapter1 = new MockEmailAdapter("mock_email", "Original Adapter");
      const adapter2 = new MockEmailAdapter("mock_email", "Replacement Adapter");

      registerAdapter(adapter1, { skipCatalogValidation: true });

      expect(() => registerAdapter(adapter2, { skipCatalogValidation: true })).toThrow(
        AdapterAlreadyRegisteredError
      );
      expect(() => registerAdapter(adapter2, { skipCatalogValidation: true })).toThrow(
        "An adapter is already registered for integration 'mock_email'. Use allowOverride to replace it."
      );

      // Verify original remains in place
      expect(getAdapterOrThrow("mock_email").displayName).toBe("Original Adapter");
    });

    it("should successfully replace an adapter when allowOverride is true", () => {
      const adapter1 = new MockEmailAdapter("mock_email", "Original Adapter");
      const adapter2 = new MockEmailAdapter("mock_email", "Replacement Adapter");

      registerAdapter(adapter1, { skipCatalogValidation: true });
      registerAdapter(adapter2, { allowOverride: true, skipCatalogValidation: true });

      expect(getAdapterOrThrow("mock_email").displayName).toBe("Replacement Adapter");
    });
  });

  describe("3. Unregister & Clear Lifecycle", () => {
    it("should unregister an existing adapter", () => {
      const adapter = new MockEmailAdapter("mock_email");
      registerAdapter(adapter, { skipCatalogValidation: true });

      expect(hasAdapter("mock_email")).toBe(true);
      const removed = unregisterAdapter("mock_email");
      expect(removed).toBe(true);
      expect(hasAdapter("mock_email")).toBe(false);
      expect(getAdapter("mock_email")).toBeUndefined();
    });

    it("should return false when unregistering a non-existent adapter", () => {
      expect(unregisterAdapter("non_existent")).toBe(false);
    });

    it("should clear all adapters", () => {
      registerAdapter(new MockEmailAdapter("a"), { skipCatalogValidation: true });
      registerAdapter(new MockEmailAdapter("b"), { skipCatalogValidation: true });
      expect(getAllAdapters()).toHaveLength(2);

      clearAdapters();
      expect(getAllAdapters()).toHaveLength(0);
    });
  });

  describe("4. Fail-Fast Capability Subset Validation at Registration", () => {
    it("should pass registration when adapter capabilities form a valid subset of the seeded catalog row", () => {
      // 'resend' in catalog supports [EMAIL_SEND, WEBHOOK_RECEIVE]
      // MockEmailAdapter provides [EMAIL_SEND] (valid subset)
      const validResendAdapter = new MockEmailAdapter("resend", "Resend Test Adapter");
      expect(() => registerAdapter(validResendAdapter)).not.toThrow();
      expect(hasAdapter("resend")).toBe(true);
    });

    it("should throw AdapterCapabilityMismatchError when adapter advertises capabilities not in the catalog row", () => {
      // 'resend' does NOT support ACCOUNTING_INVOICE_SYNC or SMS_SEND
      const rogueAdapter: IntegrationAdapter = {
        integrationId: "resend",
        displayName: "Rogue Resend Adapter",
        version: "1.0.0",
        connect: async () => ({} as any),
        disconnect: async () => {},
        testConnection: async () => ({} as any),
        execute: async () => ({} as any),
        handleWebhook: async () => null,
        getCapabilities: () => [
          IntegrationCapability.EMAIL_SEND,
          IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        ],
      };

      expect(() => registerAdapter(rogueAdapter)).toThrow(AdapterCapabilityMismatchError);
      expect(() => registerAdapter(rogueAdapter)).toThrow(
        "Adapter for integration 'resend' advertises capabilities [ACCOUNTING_INVOICE_SYNC] not supported by catalog [EMAIL_SEND, WEBHOOK_RECEIVE]."
      );
      expect(hasAdapter("resend")).toBe(false);
    });

    it("should allow skipping catalog validation with skipCatalogValidation option", () => {
      const dynamicAdapter: IntegrationAdapter = {
        integrationId: "resend",
        displayName: "Test Custom Resend",
        version: "1.0.0",
        connect: async () => ({} as any),
        disconnect: async () => {},
        testConnection: async () => ({} as any),
        execute: async () => ({} as any),
        handleWebhook: async () => null,
        getCapabilities: () => [IntegrationCapability.SMS_SEND],
      };

      expect(() =>
        registerAdapter(dynamicAdapter, { skipCatalogValidation: true })
      ).not.toThrow();
      expect(hasAdapter("resend")).toBe(true);
    });
  });

  describe("5. Consistency Cross-Check (validateAdapterCatalogConsistency)", () => {
    it("should validate all registered adapters against a given catalog array", () => {
      const adapter1 = new MockEmailAdapter("resend");
      registerAdapter(adapter1, { skipCatalogValidation: true });

      const catalog = [
        {
          id: "resend",
          capabilities: [IntegrationCapability.EMAIL_SEND, IntegrationCapability.WEBHOOK_RECEIVE],
        },
      ];

      expect(() => validateAdapterCatalogConsistency(catalog)).not.toThrow();
    });

    it("should throw AdapterCapabilityMismatchError if an adapter has capabilities outside the catalog", () => {
      const adapter1 = new MockEmailAdapter("custom_provider");
      registerAdapter(adapter1, { skipCatalogValidation: true });

      const catalog = [
        {
          id: "custom_provider",
          capabilities: [IntegrationCapability.SMS_SEND], // Does not include EMAIL_SEND
        },
      ];

      expect(() => validateAdapterCatalogConsistency(catalog)).toThrow(
        AdapterCapabilityMismatchError
      );
      expect(() => validateAdapterCatalogConsistency(catalog)).toThrow(
        "Adapter for integration 'custom_provider' advertises capabilities [EMAIL_SEND] not supported by catalog [SMS_SEND]."
      );
    });
  });
});
