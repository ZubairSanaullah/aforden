import { describe, it, expect } from "vitest";
import {
  IntegrationDomainError,
  ConnectionNotReadyError,
  AmbiguousCapabilityProviderError,
  CapabilityProviderNotConfiguredError,
  ExclusiveCapabilityConflictError,
  EntitlementBlockedError,
  InvalidConnectionTransitionError,
  InvalidCredentialTransitionError,
} from "@/lib/integrations";

describe("Phase 1.17.2 — Integration Domain Errors", () => {
  it("ConnectionNotReadyError should instantiate with expected properties and context", () => {
    const err = new ConnectionNotReadyError("conn_123", "ERROR", "ws_456");
    expect(err).toBeInstanceOf(IntegrationDomainError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConnectionNotReadyError");
    expect(err.code).toBe("CONNECTION_NOT_READY");
    expect(err.statusCode).toBe(409);
    expect(err.httpStatus).toBe(409);
    expect(err.message).toContain("conn_123");
    expect(err.message).toContain("ws_456");
    expect(err.context).toEqual({
      connectionId: "conn_123",
      status: "ERROR",
      workspaceId: "ws_456",
    });
  });

  it("AmbiguousCapabilityProviderError should instantiate with matching connections", () => {
    const err = new AmbiguousCapabilityProviderError("EMAIL_SEND", "ws_123", ["conn_1", "conn_2"]);
    expect(err).toBeInstanceOf(IntegrationDomainError);
    expect(err.name).toBe("AmbiguousCapabilityProviderError");
    expect(err.code).toBe("AMBIGUOUS_CAPABILITY_PROVIDER");
    expect(err.statusCode).toBe(409);
    expect(err.context).toEqual({
      capability: "EMAIL_SEND",
      workspaceId: "ws_123",
      matchingConnectionIds: ["conn_1", "conn_2"],
    });
  });

  it("CapabilityProviderNotConfiguredError should instantiate with 404 status", () => {
    const err = new CapabilityProviderNotConfiguredError("SMS_SEND", "ws_123");
    expect(err).toBeInstanceOf(IntegrationDomainError);
    expect(err.name).toBe("CapabilityProviderNotConfiguredError");
    expect(err.code).toBe("CAPABILITY_PROVIDER_NOT_CONFIGURED");
    expect(err.statusCode).toBe(404);
    expect(err.context).toEqual({
      capability: "SMS_SEND",
      workspaceId: "ws_123",
    });
  });

  it("ExclusiveCapabilityConflictError should instantiate with 409 conflict and details", () => {
    const err = new ExclusiveCapabilityConflictError(
      "ACCOUNTING_INVOICE_SYNC",
      "ws_123",
      "conn_quickbooks",
      "conn_xero"
    );
    expect(err).toBeInstanceOf(IntegrationDomainError);
    expect(err.name).toBe("ExclusiveCapabilityConflictError");
    expect(err.code).toBe("EXCLUSIVE_CAPABILITY_CONFLICT");
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("ACCOUNTING_INVOICE_SYNC");
    expect(err.context).toEqual({
      capability: "ACCOUNTING_INVOICE_SYNC",
      workspaceId: "ws_123",
      existingConnectionId: "conn_quickbooks",
      attemptedConnectionId: "conn_xero",
    });
  });

  it("EntitlementBlockedError should instantiate with 402 Payment Required status", () => {
    const err = new EntitlementBlockedError("ws_123", "FEATURE_INTEGRATIONS");
    expect(err).toBeInstanceOf(IntegrationDomainError);
    expect(err.name).toBe("EntitlementBlockedError");
    expect(err.code).toBe("ENTITLEMENT_BLOCKED");
    expect(err.statusCode).toBe(402);
    expect(err.context).toEqual({
      workspaceId: "ws_123",
      featureKey: "FEATURE_INTEGRATIONS",
    });
  });

  it("InvalidConnectionTransitionError should instantiate with 400 Bad Request status", () => {
    const err = new InvalidConnectionTransitionError("DISCONNECTED", "CONNECTED", "FORCE");
    expect(err).toBeInstanceOf(IntegrationDomainError);
    expect(err.code).toBe("INVALID_CONNECTION_TRANSITION");
    expect(err.statusCode).toBe(400);
    expect(err.context).toEqual({
      from: "DISCONNECTED",
      to: "CONNECTED",
      trigger: "FORCE",
    });
  });

  it("InvalidCredentialTransitionError should instantiate with 400 Bad Request status", () => {
    const err = new InvalidCredentialTransitionError("REVOKED", "ACTIVE", "FORCE");
    expect(err).toBeInstanceOf(IntegrationDomainError);
    expect(err.code).toBe("INVALID_CREDENTIAL_TRANSITION");
    expect(err.statusCode).toBe(400);
    expect(err.context).toEqual({
      from: "REVOKED",
      to: "ACTIVE",
      trigger: "FORCE",
    });
  });
});
