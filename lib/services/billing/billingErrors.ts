/**
 * Phase 1.15.2 — SaaS Billing & Subscriptions Pure Domain Error Classes
 * Follows Convention B: pure Error subclasses with immutable readonly code, statusCode, and httpStatus metadata.
 */

export interface DomainErrorContext {
  [key: string]: unknown;
}

export class PlanFeatureNotEnabledError extends Error {
  readonly code = "PLAN_FEATURE_NOT_ENABLED";
  readonly statusCode = 403;
  readonly httpStatus = 403;
  readonly context: DomainErrorContext;

  constructor(featureKey: string, workspaceId: string) {
    super(`Feature '${featureKey}' is not enabled for workspace '${workspaceId}'`);
    this.name = "PlanFeatureNotEnabledError";
    this.context = { featureKey, workspaceId };
  }
}

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  readonly statusCode = 402;
  readonly httpStatus = 402;
  readonly context: DomainErrorContext;

  constructor(featureKey: string, current: number, limit: number, workspaceId: string) {
    super(`Quota exceeded for '${featureKey}'. Current: ${current}, Limit: ${limit}`);
    this.name = "QuotaExceededError";
    this.context = { featureKey, current, limit, workspaceId };
  }
}

export class DuplicateActiveSubscriptionError extends Error {
  readonly code = "DUPLICATE_ACTIVE_SUBSCRIPTION";
  readonly statusCode = 409;
  readonly httpStatus = 409;
  readonly context: DomainErrorContext;

  /**
   * @param accountId - The billing account attempting to create a duplicate subscription.
   * @param existingSubscriptionId - The ID of the conflicting active subscription if known.
   * Optional to support database-level unique constraint race condition catches (P2002) where
   * the conflicting subscription ID might not be immediately available without an extra query.
   */
  constructor(accountId: string, existingSubscriptionId?: string) {
    super(
      existingSubscriptionId
        ? `Account '${accountId}' already has an active subscription '${existingSubscriptionId}'`
        : `Account '${accountId}' already has an active subscription.`
    );
    this.name = "DuplicateActiveSubscriptionError";
    this.context = { accountId, existingSubscriptionId };
  }
}

export class SubscriptionPastDueError extends Error {
  readonly code = "SUBSCRIPTION_PAST_DUE";
  readonly statusCode = 402;
  readonly httpStatus = 402;
  readonly context: DomainErrorContext;

  constructor(workspaceId: string, gracePeriodEndsAt: Date | null) {
    super(
      `Subscription is past due for workspace '${workspaceId}'. Grace period ends: ${gracePeriodEndsAt ? gracePeriodEndsAt.toISOString() : "N/A"}`
    );
    this.name = "SubscriptionPastDueError";
    this.context = { workspaceId, gracePeriodEndsAt };
  }
}

export class InvalidSubscriptionStateTransitionError extends Error {
  readonly code = "INVALID_SUBSCRIPTION_STATE_TRANSITION";
  readonly statusCode = 409;
  readonly httpStatus = 409;
  readonly context: DomainErrorContext;

  constructor(from: string, to: string, reason?: string) {
    super(
      reason
        ? `Cannot transition subscription from '${from}' to '${to}': ${reason}`
        : `Cannot transition subscription from '${from}' to '${to}'`
    );
    this.name = "InvalidSubscriptionStateTransitionError";
    this.context = { from, to, reason };
  }
}

export class WebhookVerificationError extends Error {
  readonly code = "WEBHOOK_VERIFICATION_FAILED";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  readonly context: DomainErrorContext;

  constructor(message = "Webhook verification failed.") {
    super(`Webhook verification failed: ${message}`);
    this.name = "WebhookVerificationError";
    this.context = { message };
  }
}

export class InvalidEntitlementMultiplierError extends Error {
  readonly code = "INVALID_ENTITLEMENT_MULTIPLIER";
  readonly statusCode = 500;
  readonly httpStatus = 500;
  readonly context: DomainErrorContext;

  constructor(featureKey: string, value: unknown, planId?: string) {
    super(
      planId
        ? `Plan '${planId}' feature '${featureKey}' declared 'scalesWithSeats: true' but has invalid multiplier '${String(value)}'`
        : `Feature '${featureKey}' declared 'scalesWithSeats: true' but has invalid multiplier '${String(value)}'`
    );
    this.name = "InvalidEntitlementMultiplierError";
    this.context = { featureKey, value, planId };
  }
}

export class BillingAccountNotFoundError extends Error {
  readonly code = "BILLING_ACCOUNT_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  readonly context: DomainErrorContext;

  constructor(workspaceId: string) {
    super(`Billing account not found for workspace '${workspaceId}'`);
    this.name = "BillingAccountNotFoundError";
    this.context = { workspaceId };
  }
}

export class PlanNotFoundError extends Error {
  readonly code = "PLAN_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  readonly context: DomainErrorContext;

  constructor(planIdentifier: string) {
    super(`Subscription plan '${planIdentifier}' was not found or is inactive`);
    this.name = "PlanNotFoundError";
    this.context = { planIdentifier };
  }
}

export class PlanPriceNotFoundError extends Error {
  readonly code = "PLAN_PRICE_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  readonly context: DomainErrorContext;

  constructor(priceId: string) {
    super(`Subscription plan price '${priceId}' was not found or is inactive`);
    this.name = "PlanPriceNotFoundError";
    this.context = { priceId };
  }
}

export class SubscriptionNotFoundError extends Error {
  readonly code = "SUBSCRIPTION_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  readonly context: DomainErrorContext;

  constructor(workspaceId: string, subscriptionId?: string) {
    super(
      subscriptionId
        ? `Subscription '${subscriptionId}' was not found in workspace '${workspaceId}'`
        : `No active subscription found for workspace '${workspaceId}'`
    );
    this.name = "SubscriptionNotFoundError";
    this.context = { workspaceId, subscriptionId };
  }
}

export class InvalidSubscriptionStatusForPlanChangeError extends Error {
  readonly code = "INVALID_SUBSCRIPTION_STATUS_FOR_PLAN_CHANGE";
  readonly statusCode = 409;
  readonly httpStatus = 409;
  readonly context: DomainErrorContext;

  constructor(status: string, reason?: string) {
    super(
      reason
        ? `Cannot change plan for subscription with status '${status}': ${reason}`
        : `Cannot change plan for subscription with status '${status}'`
    );
    this.name = "InvalidSubscriptionStatusForPlanChangeError";
    this.context = { status, reason };
  }
}

export class DowngradeUsageExceededError extends Error {
  readonly code = "DOWNGRADE_USAGE_EXCEEDED";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  readonly context: DomainErrorContext;

  constructor(featureKey: string, currentUsage: number, targetLimit: number) {
    super(
      `Cannot downgrade plan: current usage of '${featureKey}' (${currentUsage}) exceeds target plan limit (${targetLimit}). Reduce resource count before downgrading.`
    );
    this.name = "DowngradeUsageExceededError";
    this.context = { featureKey, currentUsage, targetLimit };
  }
}

export class MissingProviderCustomerError extends Error {
  readonly code = "MISSING_PROVIDER_CUSTOMER";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  readonly context: DomainErrorContext;

  constructor(workspaceId: string) {
    super(
      `Workspace '${workspaceId}' does not have a registered billing customer on the provider gateway. Please start a subscription first.`
    );
    this.name = "MissingProviderCustomerError";
    this.context = { workspaceId };
  }
}


