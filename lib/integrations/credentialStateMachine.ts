/**
 * Phase 1.17.2 — Integration Credential Lifecycle State Machine
 * Ports the declarative credential transition matrix from Phase 1.17.1 §3.5.
 */

import { IntegrationCredentialStatus } from "@/generated/prisma/client";
import { InvalidCredentialTransitionError } from "./integrationErrors";

export { IntegrationCredentialStatus };

/**
 * Phase 1.17.1 §3.5 — Default grace window during which a SUPERSEDED credential
 * is permitted to verify incoming webhook signatures (24 hours).
 */
export const CREDENTIAL_SUPERSEDED_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export interface CredentialTransitionRule {
  readonly from: IntegrationCredentialStatus;
  readonly to: IntegrationCredentialStatus;
  readonly permittedTriggers: readonly string[];
  readonly description: string;
}

export const CREDENTIAL_TRANSITIONS: readonly CredentialTransitionRule[] = [
  {
    from: "ACTIVE",
    to: "ROTATING",
    permittedTriggers: [
      "ROTATION_INIT:scheduled_expiry_window",
      "ROTATION_INIT:user_manual_trigger",
      "ROTATION_INIT:provider_webhook_event",
      "ROTATION_INIT:reactive_401_refresh",
    ],
    description: "Initiate token rotation handshake; creates new credential version in ROTATING state.",
  },
  {
    from: "ROTATING",
    to: "ACTIVE",
    permittedTriggers: [
      "ROTATION_VERIFY:handshake_success",
      "ROTATION_VERIFY:new_tokens_persisted",
    ],
    description: "New credential verified against upstream provider and promoted to authoritative ACTIVE version.",
  },
  {
    from: "ROTATING",
    to: "REVOKED",
    permittedTriggers: [
      "ROTATION_VERIFY:handshake_failed",
      "ROTATION:aborted_by_timeout",
      "ROTATION:invalid_grant_error",
    ],
    description: "Rotation attempt failed; discard candidate credential version without disrupting existing credentials.",
  },
  {
    from: "ACTIVE",
    to: "SUPERSEDED",
    permittedTriggers: [
      "ROTATION_PROMOTE:new_version_activated",
    ],
    description: "Existing ACTIVE credential demoted to SUPERSEDED upon successful activation of new version.",
  },
  {
    from: "ACTIVE",
    to: "REVOKED",
    permittedTriggers: [
      "USER_ACTION:delete_credential",
      "CONNECTION:disconnected",
      "ADMIN:force_revoke",
      "SECURITY:breach_revocation",
    ],
    description: "Credential explicitly revoked or connection severed; immediate cryptographic invalidation.",
  },
  {
    from: "SUPERSEDED",
    to: "REVOKED",
    permittedTriggers: [
      "ROTATION:grace_period_expired",
      "USER_ACTION:purge_old_versions",
      "CONNECTION:disconnected",
    ],
    description: "Overlap grace period expired (24h default); old key material permanently destroyed.",
  },
] as const;

/**
 * Validates whether a credential transition from `from` to `to` with the given `trigger` is permitted.
 */
export function isValidCredentialTransition(
  from: IntegrationCredentialStatus,
  to: IntegrationCredentialStatus,
  trigger: string
): boolean {
  return CREDENTIAL_TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.permittedTriggers.includes(trigger)
  );
}

/**
 * Asserts that a credential transition is valid according to the declarative state machine matrix.
 * Throws InvalidCredentialTransitionError on any non-permitted transition or trigger.
 */
export function assertValidCredentialTransition(
  from: IntegrationCredentialStatus,
  to: IntegrationCredentialStatus,
  trigger: string
): void {
  if (!isValidCredentialTransition(from, to, trigger)) {
    throw new InvalidCredentialTransitionError(from, to, trigger);
  }
}

/**
 * Returns all permitted triggers for a specific `from` -> `to` credential transition.
 */
export function getPermittedCredentialTriggers(
  from: IntegrationCredentialStatus,
  to: IntegrationCredentialStatus
): readonly string[] {
  const rule = CREDENTIAL_TRANSITIONS.find((r) => r.from === from && r.to === to);
  return rule ? rule.permittedTriggers : [];
}

/**
 * Returns all potential next states reachable from a given credential status.
 */
export function getPermittedNextCredentialStatuses(
  from: IntegrationCredentialStatus
): readonly IntegrationCredentialStatus[] {
  return CREDENTIAL_TRANSITIONS.filter((r) => r.from === from).map((r) => r.to);
}
