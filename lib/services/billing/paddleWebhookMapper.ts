/**
 * Phase 1.23.2 — Paddle Webhook Event Taxonomy & Domain Mapping
 *
 * Implements an explicit, exhaustive mapping of Paddle Billing event types
 * onto Aforden's internal billing domain lifecycle actions.
 *
 * Pattern:
 * - Exhaustive handling of every event in Paddle's EventName taxonomy.
 * - Explicit error throwing on any unrecognized or unsupported event type
 *   with zero silent fallthrough (matching translatePaddleSubscriptionStatus).
 * - Flags non-mutating events (catalog, customer, adjustments) as IGNORED.
 */

import { SubscriptionStatus } from "@/generated/prisma/enums";
import { translatePaddleSubscriptionStatus } from "./providers/billingProviderAdapter";
import type { BillingWebhookPayload } from "./providers/providerTypes";

export type PaddleDomainAction =
  | {
      type: "SUBSCRIPTION_SYNC";
      status: SubscriptionStatus;
      providerSubscriptionId: string;
      providerCustomerId: string | null;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      cancelAtPeriodEnd: boolean;
      seatsCount: number;
    }
  | {
      type: "SUBSCRIPTION_CANCELED";
      providerSubscriptionId: string;
      providerCustomerId: string | null;
      canceledAt: Date;
    }
  | {
      type: "PAYMENT_SUCCEEDED";
      providerSubscriptionId: string | null;
      providerCustomerId: string | null;
      providerInvoiceId: string;
      providerPaymentId: string;
      amountDueCents: number;
      amountPaidCents: number;
      subtotalCents: number;
      taxCents: number;
      currency: string;
      periodStart: Date | null;
      periodEnd: Date | null;
      hostedInvoiceUrl: string | null;
      invoicePdfUrl: string | null;
      paidAt: Date;
    }
  | {
      type: "PAYMENT_FAILED";
      providerSubscriptionId: string | null;
      providerCustomerId: string | null;
      providerInvoiceId: string;
      providerPaymentId: string;
      amountDueCents: number;
      subtotalCents: number;
      taxCents: number;
      currency: string;
      periodStart: Date | null;
      periodEnd: Date | null;
      failureReason: string;
    }
  | {
      type: "IGNORED";
      reason: string;
    };

/**
 * All official Paddle Billing Event Types per SDK EventName enum.
 */
export const PADDLE_EVENT_NAMES = [
  // Subscription Events
  "subscription.created",
  "subscription.activated",
  "subscription.updated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.trialing",
  "subscription.imported",

  // Transaction Events
  "transaction.billed",
  "transaction.canceled",
  "transaction.completed",
  "transaction.paid",
  "transaction.created",
  "transaction.past_due",
  "transaction.payment_failed",
  "transaction.ready",
  "transaction.updated",
  "transaction.revised",

  // Customer Events
  "customer.created",
  "customer.updated",
  "customer.imported",

  // Address & Business Events
  "address.created",
  "address.updated",
  "address.imported",
  "business.created",
  "business.updated",
  "business.imported",

  // Catalog & Adjustment Events
  "adjustment.created",
  "adjustment.updated",
  "price.created",
  "price.updated",
  "price.imported",
  "product.created",
  "product.updated",
  "product.imported",
  "discount.created",
  "discount.updated",
  "discount.imported",
  "discount_group.created",
  "discount_group.updated",

  // Payment Method & Payout Events
  "payment_method.saved",
  "payment_method.deleted",
  "payout.created",
  "payout.paid",

  // Security & Auth Token Events
  "api_key.created",
  "api_key.updated",
  "api_key.expiring",
  "api_key.expired",
  "api_key.revoked",
  "api_key_exposure.created",
  "client_token.created",
  "client_token.updated",
  "client_token.revoked",

  // Reporting Events
  "report.created",
  "report.updated",
] as const;

export type PaddleEventName = (typeof PADDLE_EVENT_NAMES)[number];

const KNOWN_PADDLE_EVENTS_SET = new Set<string>(PADDLE_EVENT_NAMES);

/**
 * Explicitly and exhaustively maps a Paddle webhook event to an internal domain action.
 * Throws without silent fallthrough on any unrecognized event string.
 */
export function mapPaddleEventToDomainAction(event: BillingWebhookPayload): PaddleDomainAction {
  const eventType = event.eventType;
  const data = event.data || {};

  if (!KNOWN_PADDLE_EVENTS_SET.has(eventType)) {
    throw new Error(`Unrecognized Paddle event type: '${eventType}'`);
  }

  switch (eventType) {
    // -------------------------------------------------------------------------
    // 1. Subscription Status & Update Events
    // -------------------------------------------------------------------------
    case "subscription.created":
    case "subscription.activated":
    case "subscription.updated":
    case "subscription.trialing":
    case "subscription.past_due":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.imported": {
      const providerSubscriptionId = typeof data.id === "string" ? data.id : "";
      if (!providerSubscriptionId) {
        return {
          type: "IGNORED",
          reason: `Paddle ${eventType} event missing subscription ID`,
        };
      }

      const providerCustomerId =
        typeof data.customerId === "string"
          ? data.customerId
          : typeof data.customer_id === "string"
          ? data.customer_id
          : null;

      // Translate status explicitly
      const rawStatus = typeof data.status === "string" ? data.status : "active";
      const status = translatePaddleSubscriptionStatus(rawStatus);

      // Extract periods (support both camelCase SDK entity and snake_case raw JSON)
      const bp = (data.currentBillingPeriod || data.current_billing_period || {}) as any;
      const periodStart = bp.startsAt || bp.starts_at ? new Date(bp.startsAt || bp.starts_at) : new Date();
      const periodEnd = bp.endsAt || bp.ends_at
        ? new Date(bp.endsAt || bp.ends_at)
        : new Date(periodStart.getTime() + 30 * 86400000);

      // Scheduled cancellation
      const scheduledChange = (data.scheduledChange || data.scheduled_change) as any;
      const cancelAtPeriodEnd = scheduledChange?.action === "cancel";

      // Seats count from first item
      const items = Array.isArray(data.items) ? data.items : [];
      const seatsCount = typeof items[0]?.quantity === "number" ? items[0].quantity : 1;

      return {
        type: "SUBSCRIPTION_SYNC",
        status,
        providerSubscriptionId,
        providerCustomerId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd,
        seatsCount,
      };
    }

    // -------------------------------------------------------------------------
    // 2. Subscription Canceled
    // -------------------------------------------------------------------------
    case "subscription.canceled": {
      const providerSubscriptionId = typeof data.id === "string" ? data.id : "";
      if (!providerSubscriptionId) {
        return {
          type: "IGNORED",
          reason: "Paddle subscription.canceled missing subscription ID",
        };
      }

      const providerCustomerId =
        typeof data.customerId === "string"
          ? data.customerId
          : typeof data.customer_id === "string"
          ? data.customer_id
          : null;

      const canceledAt = data.canceledAt || data.canceled_at
        ? new Date((data.canceledAt || data.canceled_at) as string)
        : new Date();

      return {
        type: "SUBSCRIPTION_CANCELED",
        providerSubscriptionId,
        providerCustomerId,
        canceledAt,
      };
    }

    // -------------------------------------------------------------------------
    // 3. Transaction Completed (Payment Succeeded)
    // -------------------------------------------------------------------------
    case "transaction.completed":
    case "transaction.paid": {
      const providerSubscriptionId =
        typeof data.subscriptionId === "string"
          ? data.subscriptionId
          : typeof data.subscription_id === "string"
          ? data.subscription_id
          : null;

      const providerCustomerId =
        typeof data.customerId === "string"
          ? data.customerId
          : typeof data.customer_id === "string"
          ? data.customer_id
          : null;

      const providerInvoiceId =
        typeof data.invoiceNumber === "string" && data.invoiceNumber
          ? data.invoiceNumber
          : typeof data.invoice_number === "string" && data.invoice_number
          ? data.invoice_number
          : typeof data.invoiceId === "string" && data.invoiceId
          ? data.invoiceId
          : typeof data.invoice_id === "string" && data.invoice_id
          ? data.invoice_id
          : typeof data.id === "string"
          ? `inv_${data.id}`
          : "inv_unknown";

      const payments = Array.isArray(data.payments) ? data.payments : [];
      const firstPayment = payments[0] as any;
      const providerPaymentId =
        firstPayment?.id ||
        (typeof data.id === "string" ? `pmt_${data.id}` : `pmt_${Date.now()}`);

      const details = (data.details || {}) as any;
      const totals = details.totals || {};
      const amountDueCents = parseAmountCents(totals.total, 0);
      const amountPaidCents = parseAmountCents(totals.total, amountDueCents);
      const subtotalCents = parseAmountCents(totals.subtotal, amountDueCents);
      const taxCents = parseAmountCents(totals.tax, 0);

      const currency = (
        typeof data.currencyCode === "string"
          ? data.currencyCode
          : typeof data.currency_code === "string"
          ? data.currency_code
          : "USD"
      ).toUpperCase();

      const bp = (data.billingPeriod || data.billing_period) as any;
      const periodStart = bp?.startsAt || bp?.starts_at ? new Date(bp.startsAt || bp.starts_at) : null;
      const periodEnd = bp?.endsAt || bp?.ends_at ? new Date(bp.endsAt || bp.ends_at) : null;

      const checkout = (data.checkout || {}) as any;
      const hostedInvoiceUrl = typeof checkout.url === "string" ? checkout.url : null;

      const paidAt = data.billedAt || data.billed_at
        ? new Date((data.billedAt || data.billed_at) as string)
        : new Date();

      return {
        type: "PAYMENT_SUCCEEDED",
        providerSubscriptionId,
        providerCustomerId,
        providerInvoiceId,
        providerPaymentId,
        amountDueCents,
        amountPaidCents,
        subtotalCents,
        taxCents,
        currency,
        periodStart,
        periodEnd,
        hostedInvoiceUrl,
        invoicePdfUrl: null,
        paidAt,
      };
    }

    // -------------------------------------------------------------------------
    // 4. Transaction Payment Failed
    // -------------------------------------------------------------------------
    case "transaction.payment_failed": {
      const providerSubscriptionId =
        typeof data.subscriptionId === "string"
          ? data.subscriptionId
          : typeof data.subscription_id === "string"
          ? data.subscription_id
          : null;

      const providerCustomerId =
        typeof data.customerId === "string"
          ? data.customerId
          : typeof data.customer_id === "string"
          ? data.customer_id
          : null;

      const providerInvoiceId =
        typeof data.invoiceNumber === "string" && data.invoiceNumber
          ? data.invoiceNumber
          : typeof data.invoice_number === "string" && data.invoice_number
          ? data.invoice_number
          : typeof data.id === "string"
          ? `inv_${data.id}`
          : "inv_unknown";

      const payments = Array.isArray(data.payments) ? data.payments : [];
      const firstPayment = payments[0] as any;
      const providerPaymentId =
        firstPayment?.id ||
        (typeof data.id === "string" ? `pmt_failed_${data.id}` : `pmt_failed_${Date.now()}`);

      const details = (data.details || {}) as any;
      const totals = details.totals || {};
      const amountDueCents = parseAmountCents(totals.total, 0);
      const subtotalCents = parseAmountCents(totals.subtotal, amountDueCents);
      const taxCents = parseAmountCents(totals.tax, 0);

      const currency = (
        typeof data.currencyCode === "string"
          ? data.currencyCode
          : typeof data.currency_code === "string"
          ? data.currency_code
          : "USD"
      ).toUpperCase();

      const bp = (data.billingPeriod || data.billing_period) as any;
      const periodStart = bp?.startsAt || bp?.starts_at ? new Date(bp.startsAt || bp.starts_at) : null;
      const periodEnd = bp?.endsAt || bp?.ends_at ? new Date(bp.endsAt || bp.ends_at) : null;

      const failureReason =
        firstPayment?.errorResponse?.description ||
        firstPayment?.error_response?.description ||
        firstPayment?.errorMessage ||
        firstPayment?.error_message ||
        "Paddle transaction payment attempt failed";

      return {
        type: "PAYMENT_FAILED",
        providerSubscriptionId,
        providerCustomerId,
        providerInvoiceId,
        providerPaymentId,
        amountDueCents,
        subtotalCents,
        taxCents,
        currency,
        periodStart,
        periodEnd,
        failureReason,
      };
    }

    // -------------------------------------------------------------------------
    // 5. Explicitly Acknowledged Non-Mutating Events
    // -------------------------------------------------------------------------
    case "transaction.billed":
    case "transaction.canceled":
    case "transaction.created":
    case "transaction.past_due":
    case "transaction.ready":
    case "transaction.updated":
    case "transaction.revised":
    case "customer.created":
    case "customer.updated":
    case "customer.imported":
    case "address.created":
    case "address.updated":
    case "address.imported":
    case "business.created":
    case "business.updated":
    case "business.imported":
    case "adjustment.created":
    case "adjustment.updated":
    case "price.created":
    case "price.updated":
    case "price.imported":
    case "product.created":
    case "product.updated":
    case "product.imported":
    case "discount.created":
    case "discount.updated":
    case "discount.imported":
    case "discount_group.created":
    case "discount_group.updated":
    case "payment_method.saved":
    case "payment_method.deleted":
    case "payout.created":
    case "payout.paid":
    case "api_key.created":
    case "api_key.updated":
    case "api_key.expiring":
    case "api_key.expired":
    case "api_key.revoked":
    case "api_key_exposure.created":
    case "client_token.created":
    case "client_token.updated":
    case "client_token.revoked":
    case "report.created":
    case "report.updated": {
      return {
        type: "IGNORED",
        reason: `Paddle event '${eventType}' acknowledged without mutation`,
      };
    }

    default: {
      // TypeScript exhaustiveness check: this is unreachable if all known events are handled
      throw new Error(`Unrecognized Paddle event type: '${eventType}'`);
    }
  }
}

/**
 * Safely parses Paddle total string/number values to integer cents.
 */
function parseAmountCents(val: unknown, fallback: number): number {
  if (typeof val === "number") {
    return Math.round(val);
  }
  if (typeof val === "string") {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}
