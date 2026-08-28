/**
 * Phase 1.15.4 — Subscription State Machine Guard Table & Transition Assertions
 * Strictly encodes the transition matrix and allowed trigger sources per §4.2 of Phase 1.15 Domain Architecture
 * and Phase 1.15.4 locked specification.
 */

import { SubscriptionStatus } from "@/generated/prisma/enums";
import { InvalidSubscriptionStateTransitionError } from "./billingErrors";

export const NON_TERMINAL_SUBSCRIPTION_STATUSES = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.UNPAID,
  SubscriptionStatus.INCOMPLETE,
  SubscriptionStatus.PAUSED,
] as const;

export const TERMINAL_SUBSCRIPTION_STATUSES = [
  SubscriptionStatus.CANCELED,
  SubscriptionStatus.INCOMPLETE_EXPIRED,
] as const;

export interface TransitionRule {
  readonly from: SubscriptionStatus;
  readonly to: SubscriptionStatus;
  readonly permittedTriggers: readonly string[];
  readonly description: string;
}

/**
 * Immutable Single Source of Truth for Subscription Transitions.
 * Strictly matches the locked Phase 1.15.4 state transition matrix.
 */
export const SUBSCRIPTION_TRANSITIONS: readonly TransitionRule[] = [
  {
    from: SubscriptionStatus.INCOMPLETE,
    to: SubscriptionStatus.ACTIVE,
    permittedTriggers: ["WEBHOOK:invoice.payment_succeeded"],
    description: "Provider confirms initial checkout charge settled.",
  },
  {
    from: SubscriptionStatus.INCOMPLETE,
    to: SubscriptionStatus.INCOMPLETE_EXPIRED,
    permittedTriggers: [
      "WEBHOOK:customer.subscription.updated[incomplete_expired]",
      "RECONCILIATION_WORKER",
    ],
    description: "Initial payment setup abandoned (> 23h).",
  },
  {
    from: SubscriptionStatus.TRIALING,
    to: SubscriptionStatus.ACTIVE,
    permittedTriggers: [
      "CHECKOUT:session_completed",
      "WEBHOOK",
    ],
    description: "Customer adds valid payment method and completes plan checkout.",
  },
  {
    from: SubscriptionStatus.TRIALING,
    to: SubscriptionStatus.PAST_DUE,
    permittedTriggers: ["DUNNING_ENGINE:trial_expired"],
    description: "Trial period ended with no payment method.",
  },
  {
    from: SubscriptionStatus.TRIALING,
    to: SubscriptionStatus.CANCELED,
    permittedTriggers: ["USER_ACTION:cancel"],
    description: "User voluntarily cancels during trial period.",
  },
  {
    from: SubscriptionStatus.ACTIVE,
    to: SubscriptionStatus.PAST_DUE,
    permittedTriggers: ["WEBHOOK:invoice.payment_failed"],
    description: "Recurring charge rejected by provider gateway.",
  },
  {
    from: SubscriptionStatus.ACTIVE,
    to: SubscriptionStatus.CANCELED,
    permittedTriggers: [
      "USER_ACTION:cancel",
      "WEBHOOK",
    ],
    description: "Immediate user cancellation or period-end expiration finalized.",
  },
  {
    from: SubscriptionStatus.ACTIVE,
    to: SubscriptionStatus.PAUSED,
    permittedTriggers: ["ADMIN_OVERRIDE"],
    description: "Administrative courtesy or billing dispute pause.",
  },
  {
    from: SubscriptionStatus.PAST_DUE,
    to: SubscriptionStatus.ACTIVE,
    permittedTriggers: [
      "WEBHOOK:invoice.payment_succeeded",
      "SYNC_RECONCILIATION",
      "ADMIN_OVERRIDE",
    ],
    description: "Payment cleared via card retry, portal update, or operator override.",
  },
  {
    from: SubscriptionStatus.PAST_DUE,
    to: SubscriptionStatus.UNPAID,
    permittedTriggers: ["DUNNING_ENGINE:grace_expired"],
    description: "Grace period elapsed without payment.",
  },
  {
    from: SubscriptionStatus.PAST_DUE,
    to: SubscriptionStatus.CANCELED,
    permittedTriggers: [
      "WEBHOOK:customer.subscription.deleted",
    ],
    description: "Gateway cancellation following exhausted dunning.",
  },
  {
    from: SubscriptionStatus.UNPAID,
    to: SubscriptionStatus.ACTIVE,
    permittedTriggers: [
      "WEBHOOK:invoice.payment_succeeded",
      "SYNC_RECONCILIATION",
    ],
    description: "Full past-due balance settled via provider.",
  },
  {
    from: SubscriptionStatus.UNPAID,
    to: SubscriptionStatus.CANCELED,
    permittedTriggers: [
      "WEBHOOK:customer.subscription.deleted",
      "DUNNING_ENGINE:automatic_termination",
    ],
    description: "Automatic termination following unpaid cycle expiration.",
  },
  {
    from: SubscriptionStatus.PAUSED,
    to: SubscriptionStatus.ACTIVE,
    permittedTriggers: ["USER_ACTION:resume", "ADMIN_OVERRIDE"],
    description: "User or administrator resumes paused subscription.",
  },
  {
    from: SubscriptionStatus.CANCELED,
    to: SubscriptionStatus.ACTIVE,
    permittedTriggers: ["CHECKOUT:session_completed"],
    description: "New subscription checkout or reactivation for canceled account.",
  },
];

/**
 * Pre-computed lookup map for fast validation: `${from}->${to}` -> Set of permitted triggers.
 */
const TRANSITION_LOOKUP_MAP = new Map<string, Set<string>>();

for (const rule of SUBSCRIPTION_TRANSITIONS) {
  const key = `${rule.from}->${rule.to}`;
  let triggers = TRANSITION_LOOKUP_MAP.get(key);
  if (!triggers) {
    triggers = new Set<string>();
    TRANSITION_LOOKUP_MAP.set(key, triggers);
  }
  for (const trigger of rule.permittedTriggers) {
    triggers.add(trigger);
  }
}

/**
 * Asserts whether a transition from `from` to `to` caused by `triggerSource` is valid.
 * Throws InvalidSubscriptionStateTransitionError if the transition is prohibited.
 * Enforces exact-string trigger matching without wildcard or prefix-matching bypasses.
 */
export function assertValidTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
  triggerSource: string
): void {
  // Same-state transitions are generally not transitions unless handled as an idempotent webhook replay
  if (from === to) {
    if (triggerSource.startsWith("WEBHOOK") || triggerSource === "SYNC_RECONCILIATION") {
      return;
    }
    throw new InvalidSubscriptionStateTransitionError(
      from,
      to,
      `Same-state transition is only permitted for idempotent webhook/sync triggers (received: '${triggerSource}')`
    );
  }

  const key = `${from}->${to}`;
  const permittedTriggers = TRANSITION_LOOKUP_MAP.get(key);

  if (!permittedTriggers) {
    throw new InvalidSubscriptionStateTransitionError(
      from,
      to,
      `Transition path from '${from}' to '${to}' is not permitted by the subscription state machine`
    );
  }

  // Exact string match only against permitted triggers
  const isPermitted = permittedTriggers.has(triggerSource);

  if (!isPermitted) {
    const allowed = Array.from(permittedTriggers).join(", ");
    throw new InvalidSubscriptionStateTransitionError(
      from,
      to,
      `Trigger source '${triggerSource}' is not authorized for transition '${from} -> ${to}'. Allowed triggers: [${allowed}]`
    );
  }
}

/**
 * Non-throwing query helper to check if a transition is valid.
 */
export function isValidTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
  triggerSource: string
): boolean {
  try {
    assertValidTransition(from, to, triggerSource);
    return true;
  } catch {
    return false;
  }
}
