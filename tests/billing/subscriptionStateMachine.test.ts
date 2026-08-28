import { describe, expect, it } from "vitest";
import { SubscriptionStatus } from "@/generated/prisma/enums";
import {
  assertValidTransition,
  isValidTransition,
  NON_TERMINAL_SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
} from "@/lib/services/billing/subscriptionStateMachine";
import { InvalidSubscriptionStateTransitionError } from "@/lib/services/billing/billingErrors";

describe("Phase 1.15.4 — Subscription State Machine Guard Table Tests (Strict Locked Matrix)", () => {
  describe("1. Permitted Transitions Matrix Coverage", () => {
    it("should allow INCOMPLETE -> ACTIVE via exact WEBHOOK:invoice.payment_succeeded only", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.INCOMPLETE,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK:invoice.payment_succeeded"
        )
      ).not.toThrow();
      expect(
        isValidTransition(
          SubscriptionStatus.INCOMPLETE,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK:invoice.payment_succeeded"
        )
      ).toBe(true);
    });

    it("should allow INCOMPLETE -> INCOMPLETE_EXPIRED via update webhook or reconciliation worker", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.INCOMPLETE,
          SubscriptionStatus.INCOMPLETE_EXPIRED,
          "WEBHOOK:customer.subscription.updated[incomplete_expired]"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.INCOMPLETE,
          SubscriptionStatus.INCOMPLETE_EXPIRED,
          "RECONCILIATION_WORKER"
        )
      ).not.toThrow();
    });

    it("should allow TRIALING -> ACTIVE via checkout or literal WEBHOOK", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.ACTIVE,
          "CHECKOUT:session_completed"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK"
        )
      ).not.toThrow();
    });

    it("should allow TRIALING -> PAST_DUE via dunning trial expiration", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.PAST_DUE,
          "DUNNING_ENGINE:trial_expired"
        )
      ).not.toThrow();
    });

    it("should allow TRIALING -> CANCELED via USER_ACTION:cancel", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.CANCELED,
          "USER_ACTION:cancel"
        )
      ).not.toThrow();
      expect(
        isValidTransition(
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.CANCELED,
          "USER_ACTION:cancel"
        )
      ).toBe(true);
    });

    it("should allow ACTIVE -> PAST_DUE via invoice payment failed webhook", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
          "WEBHOOK:invoice.payment_failed"
        )
      ).not.toThrow();
    });

    it("should allow ACTIVE -> CANCELED via user cancel or literal WEBHOOK", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.CANCELED,
          "USER_ACTION:cancel"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.CANCELED,
          "WEBHOOK"
        )
      ).not.toThrow();
    });

    it("should allow ACTIVE -> PAUSED via admin override only", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAUSED,
          "ADMIN_OVERRIDE"
        )
      ).not.toThrow();
    });

    it("should allow PAST_DUE -> ACTIVE via webhook, sync, or admin override", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK:invoice.payment_succeeded"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.ACTIVE,
          "SYNC_RECONCILIATION"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.ACTIVE,
          "ADMIN_OVERRIDE"
        )
      ).not.toThrow();
    });

    it("should allow PAST_DUE -> UNPAID via dunning grace expired", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.UNPAID,
          "DUNNING_ENGINE:grace_expired"
        )
      ).not.toThrow();
    });

    it("should allow PAST_DUE -> CANCELED via webhook:customer.subscription.deleted", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.CANCELED,
          "WEBHOOK:customer.subscription.deleted"
        )
      ).not.toThrow();
    });

    it("should allow UNPAID -> ACTIVE via webhook or sync reconciliation", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.UNPAID,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK:invoice.payment_succeeded"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.UNPAID,
          SubscriptionStatus.ACTIVE,
          "SYNC_RECONCILIATION"
        )
      ).not.toThrow();
    });

    it("should allow UNPAID -> CANCELED via webhook or automatic termination", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.UNPAID,
          SubscriptionStatus.CANCELED,
          "WEBHOOK:customer.subscription.deleted"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.UNPAID,
          SubscriptionStatus.CANCELED,
          "DUNNING_ENGINE:automatic_termination"
        )
      ).not.toThrow();
    });

    it("should allow PAUSED -> ACTIVE via user resume or admin override", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAUSED,
          SubscriptionStatus.ACTIVE,
          "USER_ACTION:resume"
        )
      ).not.toThrow();
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAUSED,
          SubscriptionStatus.ACTIVE,
          "ADMIN_OVERRIDE"
        )
      ).not.toThrow();
    });

    it("should allow CANCELED -> ACTIVE via new checkout session", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.CANCELED,
          SubscriptionStatus.ACTIVE,
          "CHECKOUT:session_completed"
        )
      ).not.toThrow();
    });
  });

  describe("2. Prohibited Transitions (Illegal Paths & Removed Non-Spec Additions)", () => {
    it("should reject TRIALING -> CANCELED when trigger is WEBHOOK or DUNNING_ENGINE:trial_expired", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.CANCELED,
          "WEBHOOK"
        )
      ).toThrow("Trigger source 'WEBHOOK' is not authorized");

      expect(() =>
        assertValidTransition(
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.CANCELED,
          "DUNNING_ENGINE:trial_expired"
        )
      ).toThrow("Trigger source 'DUNNING_ENGINE:trial_expired' is not authorized");
    });

    it("should throw InvalidSubscriptionStateTransitionError for CANCELED -> PAST_DUE", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.CANCELED,
          SubscriptionStatus.PAST_DUE,
          "WEBHOOK:invoice.payment_failed"
        )
      ).toThrow(InvalidSubscriptionStateTransitionError);
    });

    it("should throw for CANCELED -> TRIALING", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.CANCELED,
          SubscriptionStatus.TRIALING,
          "SYSTEM"
        )
      ).toThrow(InvalidSubscriptionStateTransitionError);
    });

    it("should throw for UNPAID -> TRIALING", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.UNPAID,
          SubscriptionStatus.TRIALING,
          "ADMIN_OVERRIDE"
        )
      ).toThrow(InvalidSubscriptionStateTransitionError);
    });

    it("should throw for PAST_DUE -> TRIALING", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.TRIALING,
          "ADMIN_OVERRIDE"
        )
      ).toThrow(InvalidSubscriptionStateTransitionError);
    });

    it("should throw for INCOMPLETE_EXPIRED -> ACTIVE", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.INCOMPLETE_EXPIRED,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK:invoice.payment_succeeded"
        )
      ).toThrow(InvalidSubscriptionStateTransitionError);
    });

    it("should throw for INCOMPLETE -> PAST_DUE", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.INCOMPLETE,
          SubscriptionStatus.PAST_DUE,
          "DUNNING_ENGINE:trial_expired"
        )
      ).toThrow(InvalidSubscriptionStateTransitionError);
    });

    it("should throw for ACTIVE -> INCOMPLETE", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.INCOMPLETE,
          "WEBHOOK"
        )
      ).toThrow(InvalidSubscriptionStateTransitionError);
    });
  });

  describe("3. Unauthorized Trigger Sources & Wildcard Rejections", () => {
    it("should reject INCOMPLETE -> ACTIVE with bare 'WEBHOOK' wildcard or arbitrary webhook", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.INCOMPLETE,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK"
        )
      ).toThrow("Trigger source 'WEBHOOK' is not authorized");

      expect(() =>
        assertValidTransition(
          SubscriptionStatus.INCOMPLETE,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK:customer.subscription.updated"
        )
      ).toThrow("Trigger source 'WEBHOOK:customer.subscription.updated' is not authorized");
    });

    it("should reject UNPAID -> ACTIVE with ADMIN_OVERRIDE (not in locked prompt matrix)", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.UNPAID,
          SubscriptionStatus.ACTIVE,
          "ADMIN_OVERRIDE"
        )
      ).toThrow("Trigger source 'ADMIN_OVERRIDE' is not authorized");
    });

    it("should reject PAST_DUE -> CANCELED with DUNNING_ENGINE:automatic_termination (not in locked prompt matrix)", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.CANCELED,
          "DUNNING_ENGINE:automatic_termination"
        )
      ).toThrow("Trigger source 'DUNNING_ENGINE:automatic_termination' is not authorized");
    });

    it("should reject ACTIVE -> PAST_DUE when trigger is USER_ACTION:cancel", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
          "USER_ACTION:cancel"
        )
      ).toThrow("Trigger source 'USER_ACTION:cancel' is not authorized");
    });

    it("should reject ACTIVE -> PAUSED when trigger is WEBHOOK:invoice.payment_succeeded", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAUSED,
          "WEBHOOK:invoice.payment_succeeded"
        )
      ).toThrow("Trigger source 'WEBHOOK:invoice.payment_succeeded' is not authorized");
    });

    it("should reject PAST_DUE -> ACTIVE when trigger is DUNNING_ENGINE:trial_expired", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.ACTIVE,
          "DUNNING_ENGINE:trial_expired"
        )
      ).toThrow("Trigger source 'DUNNING_ENGINE:trial_expired' is not authorized");
    });
  });

  describe("4. Same-State Transitions and Idempotency Rules", () => {
    it("should permit same-state when trigger is a webhook", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.ACTIVE,
          "WEBHOOK:invoice.payment_succeeded"
        )
      ).not.toThrow();
    });

    it("should permit same-state when trigger is SYNC_RECONCILIATION", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.ACTIVE,
          "SYNC_RECONCILIATION"
        )
      ).not.toThrow();
    });

    it("should throw on same-state when trigger is a user or admin action", () => {
      expect(() =>
        assertValidTransition(
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.ACTIVE,
          "USER_ACTION:cancel"
        )
      ).toThrow("Same-state transition is only permitted for idempotent webhook/sync triggers");
    });
  });

  describe("5. Status Categorization Lists", () => {
    it("should define exactly 6 non-terminal statuses", () => {
      expect(NON_TERMINAL_SUBSCRIPTION_STATUSES).toEqual([
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAST_DUE,
        SubscriptionStatus.UNPAID,
        SubscriptionStatus.INCOMPLETE,
        SubscriptionStatus.PAUSED,
      ]);
    });

    it("should define exactly 2 terminal statuses", () => {
      expect(TERMINAL_SUBSCRIPTION_STATUSES).toEqual([
        SubscriptionStatus.CANCELED,
        SubscriptionStatus.INCOMPLETE_EXPIRED,
      ]);
    });
  });
});
