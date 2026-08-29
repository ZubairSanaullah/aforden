import { describe, it, expect } from "vitest";
import {
  IntegrationConnectionStatus,
  INTEGRATION_TRANSITIONS,
  isValidConnectionTransition,
  assertValidConnectionTransition,
  getPermittedConnectionTriggers,
  getPermittedNextConnectionStatuses,
  InvalidConnectionTransitionError,
} from "@/lib/integrations";

describe("Phase 1.17.2 — Connection Lifecycle State Machine", () => {
  it("should validate all declarative transition rules in matrix", () => {
    for (const rule of INTEGRATION_TRANSITIONS) {
      for (const trigger of rule.permittedTriggers) {
        expect(isValidConnectionTransition(rule.from, rule.to, trigger)).toBe(true);
        expect(() => assertValidConnectionTransition(rule.from, rule.to, trigger)).not.toThrow();
      }
    }
  });

  it("should allow DISCONNECTED -> CONNECTING via valid triggers", () => {
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.DISCONNECTED,
        IntegrationConnectionStatus.CONNECTING,
        "USER_ACTION:connect_init"
      )
    ).toBe(true);

    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.DISCONNECTED,
        IntegrationConnectionStatus.CONNECTING,
        "SYSTEM:reconnect_init"
      )
    ).toBe(true);
  });

  it("should allow CONNECTING -> CONNECTED via valid authentication triggers", () => {
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.CONNECTING,
        IntegrationConnectionStatus.CONNECTED,
        "OAUTH:callback_success"
      )
    ).toBe(true);

    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.CONNECTING,
        IntegrationConnectionStatus.CONNECTED,
        "API_KEY:verify_success"
      )
    ).toBe(true);

    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.CONNECTING,
        IntegrationConnectionStatus.CONNECTED,
        "TEST_CONNECTION:success"
      )
    ).toBe(true);
  });

  it("should allow in-place error recovery ERROR -> CONNECTED", () => {
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.ERROR,
        IntegrationConnectionStatus.CONNECTED,
        "AUTH:token_refresh_success"
      )
    ).toBe(true);

    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.ERROR,
        IntegrationConnectionStatus.CONNECTED,
        "HEALTH_CHECK:recovered"
      )
    ).toBe(true);
  });

  it("should allow entitlement suspension and restoration transitions", () => {
    // CONNECTED -> SUSPENDED_ENTITLEMENT
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.CONNECTED,
        IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
        "ENTITLEMENT:feature_revoked"
      )
    ).toBe(true);

    // SUSPENDED_ENTITLEMENT -> CONNECTED
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
        IntegrationConnectionStatus.CONNECTED,
        "ENTITLEMENT:feature_restored"
      )
    ).toBe(true);

    // SUSPENDED_ENTITLEMENT -> DISCONNECTED
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
        IntegrationConnectionStatus.DISCONNECTED,
        "USER_ACTION:disconnect"
      )
    ).toBe(true);
  });

  it("should reject illegal transitions and throw InvalidConnectionTransitionError", () => {
    // DISCONNECTED directly to CONNECTED without handshake
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.DISCONNECTED,
        IntegrationConnectionStatus.CONNECTED,
        "FORCE_CONNECT"
      )
    ).toBe(false);

    expect(() =>
      assertValidConnectionTransition(
        IntegrationConnectionStatus.DISCONNECTED,
        IntegrationConnectionStatus.CONNECTED,
        "FORCE_CONNECT"
      )
    ).toThrow(InvalidConnectionTransitionError);

    try {
      assertValidConnectionTransition(
        IntegrationConnectionStatus.DISCONNECTED,
        IntegrationConnectionStatus.CONNECTED,
        "FORCE_CONNECT"
      );
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConnectionTransitionError);
      const domainErr = err as InvalidConnectionTransitionError;
      expect(domainErr.code).toBe("INVALID_CONNECTION_TRANSITION");
      expect(domainErr.statusCode).toBe(400);
      expect(domainErr.context.from).toBe(IntegrationConnectionStatus.DISCONNECTED);
      expect(domainErr.context.to).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(domainErr.context.trigger).toBe("FORCE_CONNECT");
    }
  });

  it("should reject valid from/to transition with an unauthorized trigger", () => {
    expect(
      isValidConnectionTransition(
        IntegrationConnectionStatus.CONNECTING,
        IntegrationConnectionStatus.CONNECTED,
        "INVALID_TRIGGER"
      )
    ).toBe(false);

    expect(() =>
      assertValidConnectionTransition(
        IntegrationConnectionStatus.CONNECTING,
        IntegrationConnectionStatus.CONNECTED,
        "INVALID_TRIGGER"
      )
    ).toThrow(InvalidConnectionTransitionError);
  });

  it("should query permitted triggers and reachable next statuses", () => {
    const triggers = getPermittedConnectionTriggers(
      IntegrationConnectionStatus.DISCONNECTED,
      IntegrationConnectionStatus.CONNECTING
    );
    expect(triggers).toEqual(["USER_ACTION:connect_init", "SYSTEM:reconnect_init"]);

    const nextStatuses = getPermittedNextConnectionStatuses(IntegrationConnectionStatus.CONNECTED);
    expect(nextStatuses).toContain(IntegrationConnectionStatus.ERROR);
    expect(nextStatuses).toContain(IntegrationConnectionStatus.DISCONNECTED);
    expect(nextStatuses).toContain(IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT);
  });
});
