/**
 * Phase 1.17.2 — Integration Connection Lifecycle State Machine
 * Ports the declarative connection transition matrix from Phase 1.17.1 §3.2.
 */

import { IntegrationConnectionStatus } from "@/generated/prisma/client";
import { InvalidConnectionTransitionError } from "./integrationErrors";

export { IntegrationConnectionStatus };

export interface IntegrationTransitionRule {
  readonly from: IntegrationConnectionStatus;
  readonly to: IntegrationConnectionStatus;
  readonly permittedTriggers: readonly string[];
  readonly description: string;
}

export const INTEGRATION_TRANSITIONS: readonly IntegrationTransitionRule[] = [
  {
    from: "DISCONNECTED",
    to: "CONNECTING",
    permittedTriggers: ["USER_ACTION:connect_init", "SYSTEM:reconnect_init"],
    description: "User initiates connection setup or OAuth handshake.",
  },
  {
    from: "CONNECTING",
    to: "CONNECTED",
    permittedTriggers: [
      "OAUTH:callback_success",
      "API_KEY:verify_success",
      "TEST_CONNECTION:success",
    ],
    description: "Initial authentication and handshake successfully validated.",
  },
  {
    from: "CONNECTING",
    to: "ERROR",
    permittedTriggers: [
      "OAUTH:callback_failed",
      "API_KEY:verify_failed",
      "TEST_CONNECTION:failed",
      "TIMEOUT:handshake_expired",
    ],
    description: "Initial authentication attempt failed or timed out.",
  },
  {
    from: "CONNECTING",
    to: "DISCONNECTED",
    permittedTriggers: ["USER_ACTION:cancel_connect"],
    description: "User cancels the in-flight connection configuration.",
  },
  {
    from: "CONNECTED",
    to: "ERROR",
    permittedTriggers: [
      "AUTH:token_refresh_failed",
      "EXECUTION:auth_failed_401",
      "EXECUTION:auth_failed_403",
      "HEALTH_CHECK:failed",
    ],
    description: "Provider rejected credentials, refresh token failed, or health check broke.",
  },
  {
    from: "CONNECTED",
    to: "DISCONNECTED",
    permittedTriggers: [
      "USER_ACTION:disconnect",
      "SYSTEM:provider_deprecated",
      "ADMIN:force_disconnect",
    ],
    description: "User or platform administrator voluntarily disconnects the integration.",
  },
  {
    from: "CONNECTED",
    to: "SUSPENDED_ENTITLEMENT",
    permittedTriggers: [
      "ENTITLEMENT:feature_revoked",
      "BILLING:subscription_downgraded",
      "BILLING:subscription_past_due_cutoff",
    ],
    description: "Workspace subscription tier downgraded; integration blocked by quota engine.",
  },
  {
    from: "ERROR",
    to: "CONNECTED",
    permittedTriggers: [
      "AUTH:token_refresh_success",
      "HEALTH_CHECK:recovered",
      "API_KEY:update_success",
      "TEST_CONNECTION:success",
    ],
    description: "Recovered from error state via token refresh, key update, or successful test.",
  },
  {
    from: "ERROR",
    to: "CONNECTING",
    permittedTriggers: ["USER_ACTION:reconnect_init"],
    description: "User initiates a fresh OAuth flow or re-authentication handshake.",
  },
  {
    from: "ERROR",
    to: "DISCONNECTED",
    permittedTriggers: ["USER_ACTION:disconnect", "ADMIN:force_disconnect"],
    description: "User abandons or disconnects an errored integration.",
  },
  {
    from: "SUSPENDED_ENTITLEMENT",
    to: "CONNECTED",
    permittedTriggers: [
      "ENTITLEMENT:feature_restored",
      "BILLING:subscription_reactivated",
      "BILLING:plan_upgraded",
    ],
    description: "Workspace subscription reactivated or upgraded to tier supporting integrations.",
  },
  {
    from: "SUSPENDED_ENTITLEMENT",
    to: "DISCONNECTED",
    permittedTriggers: ["USER_ACTION:disconnect"],
    description: "User voluntarily removes connection while under entitlement suspension.",
  },
] as const;

/**
 * Validates whether a connection transition from `from` to `to` with the given `trigger` is permitted.
 */
export function isValidConnectionTransition(
  from: IntegrationConnectionStatus,
  to: IntegrationConnectionStatus,
  trigger: string
): boolean {
  return INTEGRATION_TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.permittedTriggers.includes(trigger)
  );
}

/**
 * Asserts that a connection transition is valid according to the declarative state machine matrix.
 * Throws InvalidConnectionTransitionError on any non-permitted transition or trigger.
 */
export function assertValidConnectionTransition(
  from: IntegrationConnectionStatus,
  to: IntegrationConnectionStatus,
  trigger: string
): void {
  if (!isValidConnectionTransition(from, to, trigger)) {
    throw new InvalidConnectionTransitionError(from, to, trigger);
  }
}

/**
 * Returns all permitted triggers for a specific `from` -> `to` connection transition.
 */
export function getPermittedConnectionTriggers(
  from: IntegrationConnectionStatus,
  to: IntegrationConnectionStatus
): readonly string[] {
  const rule = INTEGRATION_TRANSITIONS.find((r) => r.from === from && r.to === to);
  return rule ? rule.permittedTriggers : [];
}

/**
 * Returns all potential next states reachable from a given connection status.
 */
export function getPermittedNextConnectionStatuses(
  from: IntegrationConnectionStatus
): readonly IntegrationConnectionStatus[] {
  return INTEGRATION_TRANSITIONS.filter((r) => r.from === from).map((r) => r.to);
}
