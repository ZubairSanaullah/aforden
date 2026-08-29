import { describe, it, expect } from "vitest";
import {
  IntegrationCredentialStatus,
  CREDENTIAL_TRANSITIONS,
  isValidCredentialTransition,
  assertValidCredentialTransition,
  getPermittedCredentialTriggers,
  getPermittedNextCredentialStatuses,
  InvalidCredentialTransitionError,
} from "@/lib/integrations";

describe("Phase 1.17.2 — Credential Lifecycle State Machine", () => {
  it("should validate all declarative credential transition rules in matrix", () => {
    for (const rule of CREDENTIAL_TRANSITIONS) {
      for (const trigger of rule.permittedTriggers) {
        expect(isValidCredentialTransition(rule.from, rule.to, trigger)).toBe(true);
        expect(() => assertValidCredentialTransition(rule.from, rule.to, trigger)).not.toThrow();
      }
    }
  });

  it("should support complete token rotation lifecycle", () => {
    // 1. ACTIVE -> ROTATING (Initiate rotation)
    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.ACTIVE,
        IntegrationCredentialStatus.ROTATING,
        "ROTATION_INIT:scheduled_expiry_window"
      )
    ).toBe(true);

    // 2. ROTATING -> ACTIVE (Verify and promote candidate)
    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.ROTATING,
        IntegrationCredentialStatus.ACTIVE,
        "ROTATION_VERIFY:handshake_success"
      )
    ).toBe(true);

    // 3. ACTIVE -> SUPERSEDED (Demote incumbent active credential)
    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.ACTIVE,
        IntegrationCredentialStatus.SUPERSEDED,
        "ROTATION_PROMOTE:new_version_activated"
      )
    ).toBe(true);

    // 4. SUPERSEDED -> REVOKED (Grace period expired after 24h)
    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.SUPERSEDED,
        IntegrationCredentialStatus.REVOKED,
        "ROTATION:grace_period_expired"
      )
    ).toBe(true);
  });

  it("should allow discarding failed candidate ROTATING -> REVOKED without affecting incumbent", () => {
    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.ROTATING,
        IntegrationCredentialStatus.REVOKED,
        "ROTATION_VERIFY:handshake_failed"
      )
    ).toBe(true);

    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.ROTATING,
        IntegrationCredentialStatus.REVOKED,
        "ROTATION:aborted_by_timeout"
      )
    ).toBe(true);
  });

  it("should enforce REVOKED as a strictly terminal state with zero outgoing transitions", () => {
    const nextFromRevoked = getPermittedNextCredentialStatuses(IntegrationCredentialStatus.REVOKED);
    expect(nextFromRevoked).toHaveLength(0);

    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.REVOKED,
        IntegrationCredentialStatus.ACTIVE,
        "REACTIVATE"
      )
    ).toBe(false);

    expect(() =>
      assertValidCredentialTransition(
        IntegrationCredentialStatus.REVOKED,
        IntegrationCredentialStatus.ACTIVE,
        "REACTIVATE"
      )
    ).toThrow(InvalidCredentialTransitionError);
  });

  it("should reject illegal credential transitions and throw InvalidCredentialTransitionError with context", () => {
    // SUPERSEDED directly to ACTIVE without re-verification
    expect(
      isValidCredentialTransition(
        IntegrationCredentialStatus.SUPERSEDED,
        IntegrationCredentialStatus.ACTIVE,
        "FORCE_REACTIVATE"
      )
    ).toBe(false);

    try {
      assertValidCredentialTransition(
        IntegrationCredentialStatus.SUPERSEDED,
        IntegrationCredentialStatus.ACTIVE,
        "FORCE_REACTIVATE"
      );
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidCredentialTransitionError);
      const domainErr = err as InvalidCredentialTransitionError;
      expect(domainErr.code).toBe("INVALID_CREDENTIAL_TRANSITION");
      expect(domainErr.statusCode).toBe(400);
      expect(domainErr.context.from).toBe(IntegrationCredentialStatus.SUPERSEDED);
      expect(domainErr.context.to).toBe(IntegrationCredentialStatus.ACTIVE);
      expect(domainErr.context.trigger).toBe("FORCE_REACTIVATE");
    }
  });

  it("should query permitted triggers and reachable next statuses", () => {
    const triggers = getPermittedCredentialTriggers(
      IntegrationCredentialStatus.ACTIVE,
      IntegrationCredentialStatus.ROTATING
    );
    expect(triggers).toContain("ROTATION_INIT:scheduled_expiry_window");
    expect(triggers).toContain("ROTATION_INIT:user_manual_trigger");

    const nextStatuses = getPermittedNextCredentialStatuses(IntegrationCredentialStatus.ACTIVE);
    expect(nextStatuses).toContain(IntegrationCredentialStatus.ROTATING);
    expect(nextStatuses).toContain(IntegrationCredentialStatus.SUPERSEDED);
    expect(nextStatuses).toContain(IntegrationCredentialStatus.REVOKED);
  });
});
