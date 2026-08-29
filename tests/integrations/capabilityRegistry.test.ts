import { describe, it, expect } from "vitest";
import {
  IntegrationCapability,
  CAPABILITY_REGISTRY,
  getCapabilityDefinition,
  isExclusiveCapability,
  getAllCapabilities,
  getExclusiveCapabilities,
  getMultiProviderCapabilities,
} from "@/lib/integrations";

describe("Phase 1.17.2 — Capability Registry", () => {
  it("should have all 11 capabilities registered in CAPABILITY_REGISTRY", () => {
    const capabilities = getAllCapabilities();
    expect(capabilities).toHaveLength(11);

    for (const cap of capabilities) {
      const def = getCapabilityDefinition(cap);
      expect(def).toBeDefined();
      expect(def.capability).toBe(cap);
      expect(def.displayName).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.defaultTimeoutMs).toBeGreaterThan(0);
      expect(typeof def.allowsMultipleActiveProviders).toBe("boolean");
    }
  });

  it("should correctly categorize exclusive vs multi-provider capabilities", () => {
    const exclusive = getExclusiveCapabilities();
    const multi = getMultiProviderCapabilities();

    // Exclusive singleton capabilities per spec:
    expect(exclusive).toContain(IntegrationCapability.CALENDAR_WRITE);
    expect(exclusive).toContain(IntegrationCapability.CALENDAR_READ);
    expect(exclusive).toContain(IntegrationCapability.ACCOUNTING_INVOICE_SYNC);
    expect(exclusive).toContain(IntegrationCapability.ACCOUNTING_PAYMENT_SYNC);
    expect(exclusive).toContain(IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC);
    expect(exclusive).toContain(IntegrationCapability.FILE_UPLOAD);
    expect(exclusive).toContain(IntegrationCapability.FILE_DOWNLOAD);
    expect(exclusive).toContain(IntegrationCapability.CRM_CONTACT_SYNC);
    expect(exclusive).toHaveLength(8);

    // Multi-provider transport capabilities per spec:
    expect(multi).toContain(IntegrationCapability.EMAIL_SEND);
    expect(multi).toContain(IntegrationCapability.SMS_SEND);
    expect(multi).toContain(IntegrationCapability.WEBHOOK_RECEIVE);
    expect(multi).toHaveLength(3);

    expect(isExclusiveCapability(IntegrationCapability.ACCOUNTING_INVOICE_SYNC)).toBe(true);
    expect(isExclusiveCapability(IntegrationCapability.EMAIL_SEND)).toBe(false);
  });

  it("should throw when querying an unknown capability", () => {
    expect(() => getCapabilityDefinition("UNKNOWN_CAP" as unknown as IntegrationCapability)).toThrow(
      /Unrecognized integration capability/
    );
  });

  it("should verify default timeouts meet SLA requirements", () => {
    expect(getCapabilityDefinition(IntegrationCapability.EMAIL_SEND).defaultTimeoutMs).toBe(5000);
    expect(getCapabilityDefinition(IntegrationCapability.SMS_SEND).defaultTimeoutMs).toBe(5000);
    expect(getCapabilityDefinition(IntegrationCapability.ACCOUNTING_INVOICE_SYNC).defaultTimeoutMs).toBe(15000);
    expect(getCapabilityDefinition(IntegrationCapability.FILE_UPLOAD).defaultTimeoutMs).toBe(30000);
  });
});
