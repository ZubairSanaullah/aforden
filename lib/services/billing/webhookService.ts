/**
 * Phase 1.15.8 — Billing Webhook Ingestion & Idempotent Processing Service
 *
 * Implements:
 * 1. Transactional deduplication via the BillingWebhookEvent inbox table.
 * 2. Dispatching normalized webhook events to the subscription lifecycle engine.
 * 3. Synchronization of SubscriptionInvoice and SubscriptionPayment records.
 * 4. Safe out-of-order sequence timestamp handling.
 */

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  BillingProviderType,
  WebhookProcessingStatus,
  SubscriptionStatus,
  SubscriptionInvoiceStatus,
  SubscriptionPaymentStatus,
} from "@/generated/prisma/enums";
import type { BillingWebhookPayload } from "./providers/providerTypes";
import { translateStripeSubscriptionStatus } from "./providers";
import { transitionSubscriptionStatus } from "./subscriptionService";
import { mapPaddleEventToDomainAction } from "./paddleWebhookMapper";

import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "./subscriptionStateMachine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface WebhookProcessingResult {
  received: boolean;
  deduplicated: boolean;
  processed: boolean;
  eventId: string;
  eventType: string;
  outcome?: string;
}

// ---------------------------------------------------------------------------
// processBillingWebhookEvent
// ---------------------------------------------------------------------------

/**
 * Idempotently processes an incoming billing webhook payload.
 *
 * Pipeline:
 * 1. Deduplication: Check BillingWebhookEvent by providerEventId.
 *    If already PROCESSED or IGNORED, returns immediately without re-executing mutations.
 * 2. Record inbox entry with status PROCESSING.
 * 3. Dispatch to event-specific lifecycle and invoice/payment handlers.
 * 4. Mark BillingWebhookEvent as PROCESSED (or IGNORED for unhandled events).
 */
export async function processBillingWebhookEvent(
  prisma: DbClient,
  event: BillingWebhookPayload
): Promise<WebhookProcessingResult> {
  const db = prisma as PrismaClient;
  const eventId = event.id;
  const eventType = event.eventType;

  // 1. Check existing inbox entry for deduplication
  const existing = await db.billingWebhookEvent.findUnique({
    where: { providerEventId: eventId },
  });

  if (existing) {
    if (
      existing.status === WebhookProcessingStatus.PROCESSED ||
      existing.status === WebhookProcessingStatus.IGNORED
    ) {
      return {
        received: true,
        deduplicated: true,
        processed: false,
        eventId,
        eventType,
        outcome: `Deduplicated: already in status ${existing.status}`,
      };
    }

    // If currently processing or failed retry, increment attempts
    await db.billingWebhookEvent.update({
      where: { id: existing.id },
      data: {
        attemptsCount: { increment: 1 },
        status: WebhookProcessingStatus.PROCESSING,
      },
    });
  } else {
    // Record new inbox entry
    try {
      await db.billingWebhookEvent.create({
        data: {
          provider: event.provider,
          providerEventId: eventId,
          eventType,
          status: WebhookProcessingStatus.PROCESSING,
          payloadJson: (event.data || {}) as Prisma.InputJsonValue,
          attemptsCount: 1,
        },
      });
    } catch (err: any) {
      // Handle race condition on duplicate concurrent creation
      if (err?.code === "P2002") {
        return {
          received: true,
          deduplicated: true,
          processed: false,
          eventId,
          eventType,
          outcome: "Deduplicated: concurrent insert detected",
        };
      }
      throw err;
    }
  }

  // 2. Process the event payload
  try {
    const outcome = await handleEventDispatch(db, event);

    // 3. Mark inbox record as PROCESSED or IGNORED
    const finalStatus =
      outcome.status === "IGNORED"
        ? WebhookProcessingStatus.IGNORED
        : WebhookProcessingStatus.PROCESSED;

    await db.billingWebhookEvent.update({
      where: { providerEventId: eventId },
      data: {
        status: finalStatus,
        processedAt: new Date(),
        processingError: null,
      },
    });

    return {
      received: true,
      deduplicated: false,
      processed: outcome.status === "PROCESSED",
      eventId,
      eventType,
      outcome: outcome.message,
    };
  } catch (error: any) {
    // Record error in inbox
    await db.billingWebhookEvent.update({
      where: { providerEventId: eventId },
      data: {
        status: WebhookProcessingStatus.FAILED,
        processingError: error?.message || String(error),
      },
    });

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Internal Event Dispatcher
// ---------------------------------------------------------------------------

interface DispatchOutcome {
  status: "PROCESSED" | "IGNORED";
  message: string;
}

async function handleEventDispatch(
  prisma: DbClient,
  event: BillingWebhookPayload
): Promise<DispatchOutcome> {
  const db = prisma as PrismaClient;
  const eventTimestamp = extractEventTimestamp(event);

  // Dedicated handler for Paddle Billing events
  if (event.provider === BillingProviderType.PADDLE) {
    return await handlePaddleEventDispatch(db, event, eventTimestamp);
  }

  switch (event.eventType) {
    // -----------------------------------------------------------------------
    // 1. Invoice Payment Succeeded (Active Renewal / Past-Due Recovery)
    // -----------------------------------------------------------------------
    case "invoice.payment_succeeded": {
      return await handleInvoicePaymentSucceeded(db, event.data, eventTimestamp);
    }

    // -----------------------------------------------------------------------
    // 2. Invoice Payment Failed (Enters Dunning / Past Due)
    // -----------------------------------------------------------------------
    case "invoice.payment_failed": {
      return await handleInvoicePaymentFailed(db, event.data, eventTimestamp);
    }

    // -----------------------------------------------------------------------
    // 3. Subscription Updated (Plan, Period, Quantity, or Status Changes)
    // -----------------------------------------------------------------------
    case "customer.subscription.updated": {
      return await handleSubscriptionUpdated(db, event.data, eventTimestamp);
    }

    // -----------------------------------------------------------------------
    // 4. Subscription Deleted (Canceled after Dunning / Immediate Drop)
    // -----------------------------------------------------------------------
    case "customer.subscription.deleted": {
      return await handleSubscriptionDeleted(db, event.data, eventTimestamp);
    }

    // -----------------------------------------------------------------------
    // 5. Checkout Session Completed
    // -----------------------------------------------------------------------
    case "checkout.session.completed": {
      return await handleCheckoutSessionCompleted(db, event.data, eventTimestamp);
    }

    // -----------------------------------------------------------------------
    // Default: Unhandled but valid event type (e.g. payment_intent.created)
    // -----------------------------------------------------------------------
    default: {
      return {
        status: "IGNORED",
        message: `Unhandled webhook event type '${event.eventType}' acknowledged without mutation`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

async function handleInvoicePaymentSucceeded(
  prisma: DbClient,
  data: Record<string, unknown>,
  eventTimestamp: Date
): Promise<DispatchOutcome> {
  const db = prisma as PrismaClient;
  const providerSubscriptionId = extractSubscriptionId(data);
  const providerCustomerId = extractCustomerId(data);
  const providerInvoiceId = typeof data.id === "string" ? data.id : null;

  const subscription = await resolveSubscription(db, providerSubscriptionId, providerCustomerId);

  if (!subscription) {
    return {
      status: "IGNORED",
      message: `No active or matching subscription found for invoice '${providerInvoiceId}'`,
    };
  }

  // 1. Transition subscription to ACTIVE if PAST_DUE or INCOMPLETE
  if (
    subscription.status === SubscriptionStatus.PAST_DUE ||
    subscription.status === SubscriptionStatus.INCOMPLETE ||
    subscription.status === SubscriptionStatus.UNPAID
  ) {
    await db.$transaction(async (tx) => {
      await transitionSubscriptionStatus(tx, {
        subscriptionId: subscription.id,
        toStatus: SubscriptionStatus.ACTIVE,
        triggerSource: "WEBHOOK:invoice.payment_succeeded",
        providerEventTimestamp: eventTimestamp,
      });
    });
  } else {
    // Advance timestamp if subscription is already ACTIVE
    if (
      !subscription.lastSyncedProviderEventAt ||
      eventTimestamp.getTime() > subscription.lastSyncedProviderEventAt.getTime()
    ) {
      await db.subscription.update({
        where: { id: subscription.id },
        data: { lastSyncedProviderEventAt: eventTimestamp },
      });
    }
  }

  // 2. Upsert SubscriptionInvoice and SubscriptionPayment records
  if (providerInvoiceId) {
    const amountDueCents = typeof data.amount_due === "number" ? data.amount_due : 0;
    const amountPaidCents = typeof data.amount_paid === "number" ? data.amount_paid : amountDueCents;
    const subtotalCents = typeof data.subtotal === "number" ? data.subtotal : amountDueCents;
    const taxCents = typeof data.tax === "number" ? data.tax : 0;
    const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : "USD";
    const hostedInvoiceUrl = typeof data.hosted_invoice_url === "string" ? data.hosted_invoice_url : null;
    const invoicePdfUrl = typeof data.invoice_pdf === "string" ? data.invoice_pdf : null;

    const periodStart = typeof data.period_start === "number"
      ? new Date(data.period_start * 1000)
      : subscription.currentPeriodStart;
    const periodEnd = typeof data.period_end === "number"
      ? new Date(data.period_end * 1000)
      : subscription.currentPeriodEnd;

    const invoice = await db.subscriptionInvoice.upsert({
      where: { providerInvoiceId },
      create: {
        workspaceId: subscription.workspaceId,
        accountId: subscription.accountId,
        subscriptionId: subscription.id,
        providerInvoiceId,
        status: SubscriptionInvoiceStatus.PAID,
        currency,
        amountDueCents,
        amountPaidCents,
        subtotalCents,
        taxCents,
        hostedInvoiceUrl,
        invoicePdfUrl,
        periodStart,
        periodEnd,
        paidAt: eventTimestamp,
      },
      update: {
        status: SubscriptionInvoiceStatus.PAID,
        amountPaidCents,
        hostedInvoiceUrl,
        invoicePdfUrl,
        paidAt: eventTimestamp,
      },
    });

    // Record payment if payment intent/charge exists
    const providerPaymentId = typeof data.payment_intent === "string"
      ? data.payment_intent
      : typeof data.charge === "string"
      ? data.charge
      : `pmt_${providerInvoiceId}`;

    await db.subscriptionPayment.upsert({
      where: { providerPaymentId },
      create: {
        workspaceId: subscription.workspaceId,
        invoiceId: invoice.id,
        providerPaymentId,
        amountCents: amountPaidCents,
        currency,
        status: SubscriptionPaymentStatus.SUCCEEDED,
        paidAt: eventTimestamp,
      },
      update: {
        status: SubscriptionPaymentStatus.SUCCEEDED,
        paidAt: eventTimestamp,
      },
    });
  }

  return {
    status: "PROCESSED",
    message: `Payment succeeded processed for subscription '${subscription.id}'`,
  };
}

async function handleInvoicePaymentFailed(
  prisma: DbClient,
  data: Record<string, unknown>,
  eventTimestamp: Date
): Promise<DispatchOutcome> {
  const db = prisma as PrismaClient;
  const providerSubscriptionId = extractSubscriptionId(data);
  const providerCustomerId = extractCustomerId(data);
  const providerInvoiceId = typeof data.id === "string" ? data.id : null;

  const subscription = await resolveSubscription(db, providerSubscriptionId, providerCustomerId);

  if (!subscription) {
    return {
      status: "IGNORED",
      message: `No active or matching subscription found for failed invoice '${providerInvoiceId}'`,
    };
  }

  // 1. Transition subscription to PAST_DUE if currently ACTIVE
  if (subscription.status === SubscriptionStatus.ACTIVE) {
    await db.$transaction(async (tx) => {
      await transitionSubscriptionStatus(tx, {
        subscriptionId: subscription.id,
        toStatus: SubscriptionStatus.PAST_DUE,
        triggerSource: "WEBHOOK:invoice.payment_failed",
        providerEventTimestamp: eventTimestamp,
      });
    });
  }

  // 2. Upsert SubscriptionInvoice and SubscriptionPayment records
  if (providerInvoiceId) {
    const amountDueCents = typeof data.amount_due === "number" ? data.amount_due : 0;
    const subtotalCents = typeof data.subtotal === "number" ? data.subtotal : amountDueCents;
    const taxCents = typeof data.tax === "number" ? data.tax : 0;
    const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : "USD";
    const hostedInvoiceUrl = typeof data.hosted_invoice_url === "string" ? data.hosted_invoice_url : null;
    const invoicePdfUrl = typeof data.invoice_pdf === "string" ? data.invoice_pdf : null;

    const periodStart = typeof data.period_start === "number"
      ? new Date(data.period_start * 1000)
      : subscription.currentPeriodStart;
    const periodEnd = typeof data.period_end === "number"
      ? new Date(data.period_end * 1000)
      : subscription.currentPeriodEnd;

    const invoice = await db.subscriptionInvoice.upsert({
      where: { providerInvoiceId },
      create: {
        workspaceId: subscription.workspaceId,
        accountId: subscription.accountId,
        subscriptionId: subscription.id,
        providerInvoiceId,
        status: SubscriptionInvoiceStatus.OPEN,
        currency,
        amountDueCents,
        amountPaidCents: 0,
        subtotalCents,
        taxCents,
        hostedInvoiceUrl,
        invoicePdfUrl,
        periodStart,
        periodEnd,
      },
      update: {
        status: SubscriptionInvoiceStatus.OPEN,
        hostedInvoiceUrl,
        invoicePdfUrl,
      },
    });

    const providerPaymentId = typeof data.payment_intent === "string"
      ? data.payment_intent
      : typeof data.charge === "string"
      ? data.charge
      : `pmt_failed_${providerInvoiceId}`;

    const failureReason = typeof (data.last_payment_error as any)?.message === "string"
      ? (data.last_payment_error as any).message
      : "Invoice payment attempt failed";

    await db.subscriptionPayment.upsert({
      where: { providerPaymentId },
      create: {
        workspaceId: subscription.workspaceId,
        invoiceId: invoice.id,
        providerPaymentId,
        amountCents: amountDueCents,
        currency,
        status: SubscriptionPaymentStatus.FAILED,
        failureReason,
      },
      update: {
        status: SubscriptionPaymentStatus.FAILED,
        failureReason,
      },
    });
  }

  return {
    status: "PROCESSED",
    message: `Payment failure processed for subscription '${subscription.id}'`,
  };
}

async function handleSubscriptionUpdated(
  prisma: DbClient,
  data: Record<string, unknown>,
  eventTimestamp: Date
): Promise<DispatchOutcome> {
  const db = prisma as PrismaClient;
  const providerSubscriptionId = typeof data.id === "string" ? data.id : null;
  const providerCustomerId = extractCustomerId(data);

  if (!providerSubscriptionId && !providerCustomerId) {
    return {
      status: "IGNORED",
      message: "Subscription updated event missing identifier",
    };
  }

  const subscription = await resolveSubscription(db, providerSubscriptionId, providerCustomerId);

  if (!subscription) {
    return {
      status: "IGNORED",
      message: `No matching subscription found for provider sub '${providerSubscriptionId}'`,
    };
  }

  // Translate provider status
  const rawStatus = typeof data.status === "string" ? data.status : "active";
  const targetStatus = translateStripeSubscriptionStatus(rawStatus);

  const cancelAtPeriodEnd = typeof data.cancel_at_period_end === "boolean"
    ? data.cancel_at_period_end
    : subscription.cancelAtPeriodEnd;

  const currentPeriodStart = typeof data.current_period_start === "number"
    ? new Date(data.current_period_start * 1000)
    : subscription.currentPeriodStart;
  const currentPeriodEnd = typeof data.current_period_end === "number"
    ? new Date(data.current_period_end * 1000)
    : subscription.currentPeriodEnd;

  const items = Array.isArray((data.items as any)?.data) ? (data.items as any).data : [];
  const seatsCount = typeof items[0]?.quantity === "number"
    ? items[0].quantity
    : subscription.seatsCount;

  // Execute transition or updates
  await db.$transaction(async (tx) => {
    if (subscription.status !== targetStatus) {
      await transitionSubscriptionStatus(tx, {
        subscriptionId: subscription.id,
        toStatus: targetStatus,
        triggerSource: "WEBHOOK:customer.subscription.updated",
        providerEventTimestamp: eventTimestamp,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        seatsCount,
      });
    } else {
      // Same status: update period and flags if event is newer
      if (
        !subscription.lastSyncedProviderEventAt ||
        eventTimestamp.getTime() >= subscription.lastSyncedProviderEventAt.getTime()
      ) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd,
            seatsCount,
            lastSyncedProviderEventAt: eventTimestamp,
          },
        });
      }
    }
  });

  return {
    status: "PROCESSED",
    message: `Subscription '${subscription.id}' updated to status '${targetStatus}'`,
  };
}

async function handleSubscriptionDeleted(
  prisma: DbClient,
  data: Record<string, unknown>,
  eventTimestamp: Date
): Promise<DispatchOutcome> {
  const db = prisma as PrismaClient;
  const providerSubscriptionId = typeof data.id === "string" ? data.id : null;
  const providerCustomerId = extractCustomerId(data);

  const subscription = await resolveSubscription(db, providerSubscriptionId, providerCustomerId);

  if (!subscription) {
    return {
      status: "IGNORED",
      message: `No matching subscription found for deleted event`,
    };
  }

  if (subscription.status !== SubscriptionStatus.CANCELED) {
    await db.$transaction(async (tx) => {
      await transitionSubscriptionStatus(tx, {
        subscriptionId: subscription.id,
        toStatus: SubscriptionStatus.CANCELED,
        triggerSource: "WEBHOOK:customer.subscription.deleted",
        providerEventTimestamp: eventTimestamp,
      });
    });
  }

  return {
    status: "PROCESSED",
    message: `Subscription '${subscription.id}' transitioned to CANCELED`,
  };
}

async function handleCheckoutSessionCompleted(
  prisma: DbClient,
  data: Record<string, unknown>,
  eventTimestamp: Date
): Promise<DispatchOutcome> {
  const db = prisma as PrismaClient;
  const providerSubscriptionId = typeof data.subscription === "string"
    ? data.subscription
    : (data.subscription as any)?.id || null;
  const providerCustomerId = extractCustomerId(data);
  const workspaceId = typeof (data.metadata as any)?.workspaceId === "string"
    ? (data.metadata as any).workspaceId
    : typeof data.client_reference_id === "string"
    ? data.client_reference_id
    : null;

  if (providerSubscriptionId) {
    const subscription = await resolveSubscription(db, providerSubscriptionId, providerCustomerId);
    if (subscription && subscription.status !== SubscriptionStatus.ACTIVE) {
      await db.$transaction(async (tx) => {
        await transitionSubscriptionStatus(tx, {
          subscriptionId: subscription.id,
          toStatus: SubscriptionStatus.ACTIVE,
          triggerSource: "CHECKOUT:session_completed",
          providerEventTimestamp: eventTimestamp,
        });
      });
      return {
        status: "PROCESSED",
        message: `Subscription '${subscription.id}' activated via checkout session completion`,
      };
    }
  }

  return {
    status: "PROCESSED",
    message: `Checkout session completed acknowledged for workspace '${workspaceId || "unknown"}'`,
  };
}

// ---------------------------------------------------------------------------
// Paddle Event Dispatcher & Handlers
// ---------------------------------------------------------------------------

async function handlePaddleEventDispatch(
  db: PrismaClient,
  event: BillingWebhookPayload,
  eventTimestamp: Date
): Promise<DispatchOutcome> {
  const action = mapPaddleEventToDomainAction(event);

  switch (action.type) {
    case "IGNORED": {
      return {
        status: "IGNORED",
        message: action.reason,
      };
    }

    case "SUBSCRIPTION_SYNC": {
      const subscription = await resolveSubscription(
        db,
        action.providerSubscriptionId,
        action.providerCustomerId
      );

      if (!subscription) {
        return {
          status: "IGNORED",
          message: `No matching subscription found for Paddle sub '${action.providerSubscriptionId}'`,
        };
      }

      await db.$transaction(async (tx) => {
        if (subscription.status !== action.status) {
          // Resolve authorized domain trigger source based on target transition
          let triggerSource = "WEBHOOK:customer.subscription.updated";
          if (action.status === SubscriptionStatus.ACTIVE) {
            triggerSource =
              subscription.status === SubscriptionStatus.TRIALING
                ? "WEBHOOK"
                : "WEBHOOK:invoice.payment_succeeded";
          } else if (action.status === SubscriptionStatus.PAST_DUE) {
            triggerSource = "WEBHOOK:invoice.payment_failed";
          } else if (action.status === SubscriptionStatus.CANCELED) {
            triggerSource =
              subscription.status === SubscriptionStatus.PAST_DUE ||
              subscription.status === SubscriptionStatus.UNPAID
                ? "WEBHOOK:customer.subscription.deleted"
                : "WEBHOOK";
          }

          await transitionSubscriptionStatus(tx, {
            subscriptionId: subscription.id,
            toStatus: action.status,
            triggerSource,
            providerEventTimestamp: eventTimestamp,
            currentPeriodStart: action.currentPeriodStart,
            currentPeriodEnd: action.currentPeriodEnd,
            cancelAtPeriodEnd: action.cancelAtPeriodEnd,
            seatsCount: action.seatsCount,
          });
        } else {
          // Same status: update period and flags if event is newer
          if (
            !subscription.lastSyncedProviderEventAt ||
            eventTimestamp.getTime() >= subscription.lastSyncedProviderEventAt.getTime()
          ) {
            await tx.subscription.update({
              where: { id: subscription.id },
              data: {
                currentPeriodStart: action.currentPeriodStart,
                currentPeriodEnd: action.currentPeriodEnd,
                cancelAtPeriodEnd: action.cancelAtPeriodEnd,
                seatsCount: action.seatsCount,
                lastSyncedProviderEventAt: eventTimestamp,
              },
            });
          }
        }
      });

      return {
        status: "PROCESSED",
        message: `Subscription '${subscription.id}' synced to status '${action.status}' via ${event.eventType}`,
      };
    }

    case "SUBSCRIPTION_CANCELED": {
      const subscription = await resolveSubscription(
        db,
        action.providerSubscriptionId,
        action.providerCustomerId
      );

      if (!subscription) {
        return {
          status: "IGNORED",
          message: `No matching subscription found for Paddle canceled event '${action.providerSubscriptionId}'`,
        };
      }

      if (subscription.status !== SubscriptionStatus.CANCELED) {
        const triggerSource =
          subscription.status === SubscriptionStatus.PAST_DUE ||
          subscription.status === SubscriptionStatus.UNPAID
            ? "WEBHOOK:customer.subscription.deleted"
            : "WEBHOOK";

        await db.$transaction(async (tx) => {
          await transitionSubscriptionStatus(tx, {
            subscriptionId: subscription.id,
            toStatus: SubscriptionStatus.CANCELED,
            triggerSource,
            providerEventTimestamp: eventTimestamp,
          });
        });
      }

      return {
        status: "PROCESSED",
        message: `Subscription '${subscription.id}' transitioned to CANCELED via Paddle webhook`,
      };
    }

    case "PAYMENT_SUCCEEDED": {
      const subscription = await resolveSubscription(
        db,
        action.providerSubscriptionId,
        action.providerCustomerId
      );

      if (!subscription) {
        return {
          status: "IGNORED",
          message: `No matching subscription found for Paddle transaction '${action.providerInvoiceId}'`,
        };
      }

      // 1. Transition subscription to ACTIVE if PAST_DUE or INCOMPLETE
      if (
        subscription.status === SubscriptionStatus.PAST_DUE ||
        subscription.status === SubscriptionStatus.INCOMPLETE ||
        subscription.status === SubscriptionStatus.UNPAID
      ) {
        await db.$transaction(async (tx) => {
          await transitionSubscriptionStatus(tx, {
            subscriptionId: subscription.id,
            toStatus: SubscriptionStatus.ACTIVE,
            triggerSource: "WEBHOOK:invoice.payment_succeeded",
            providerEventTimestamp: eventTimestamp,
          });
        });
      } else {
        if (
          !subscription.lastSyncedProviderEventAt ||
          eventTimestamp.getTime() > subscription.lastSyncedProviderEventAt.getTime()
        ) {
          await db.subscription.update({
            where: { id: subscription.id },
            data: { lastSyncedProviderEventAt: eventTimestamp },
          });
        }
      }

      // 2. Upsert SubscriptionInvoice and SubscriptionPayment
      const invoice = await db.subscriptionInvoice.upsert({
        where: { providerInvoiceId: action.providerInvoiceId },
        create: {
          workspaceId: subscription.workspaceId,
          accountId: subscription.accountId,
          subscriptionId: subscription.id,
          providerInvoiceId: action.providerInvoiceId,
          status: SubscriptionInvoiceStatus.PAID,
          currency: action.currency,
          amountDueCents: action.amountDueCents,
          amountPaidCents: action.amountPaidCents,
          subtotalCents: action.subtotalCents,
          taxCents: action.taxCents,
          hostedInvoiceUrl: action.hostedInvoiceUrl,
          invoicePdfUrl: action.invoicePdfUrl,
          periodStart: action.periodStart || subscription.currentPeriodStart,
          periodEnd: action.periodEnd || subscription.currentPeriodEnd,
          paidAt: action.paidAt,
        },
        update: {
          status: SubscriptionInvoiceStatus.PAID,
          amountPaidCents: action.amountPaidCents,
          hostedInvoiceUrl: action.hostedInvoiceUrl,
          paidAt: action.paidAt,
        },
      });

      await db.subscriptionPayment.upsert({
        where: { providerPaymentId: action.providerPaymentId },
        create: {
          workspaceId: subscription.workspaceId,
          invoiceId: invoice.id,
          providerPaymentId: action.providerPaymentId,
          amountCents: action.amountPaidCents,
          currency: action.currency,
          status: SubscriptionPaymentStatus.SUCCEEDED,
          paidAt: action.paidAt,
        },
        update: {
          status: SubscriptionPaymentStatus.SUCCEEDED,
          paidAt: action.paidAt,
        },
      });

      return {
        status: "PROCESSED",
        message: `Payment succeeded processed for Paddle subscription '${subscription.id}'`,
      };
    }

    case "PAYMENT_FAILED": {
      const subscription = await resolveSubscription(
        db,
        action.providerSubscriptionId,
        action.providerCustomerId
      );

      if (!subscription) {
        return {
          status: "IGNORED",
          message: `No matching subscription found for failed Paddle transaction '${action.providerInvoiceId}'`,
        };
      }

      // 1. Transition subscription to PAST_DUE if currently ACTIVE
      if (subscription.status === SubscriptionStatus.ACTIVE) {
        await db.$transaction(async (tx) => {
          await transitionSubscriptionStatus(tx, {
            subscriptionId: subscription.id,
            toStatus: SubscriptionStatus.PAST_DUE,
            triggerSource: "WEBHOOK:invoice.payment_failed",
            providerEventTimestamp: eventTimestamp,
          });
        });
      }

      // 2. Upsert SubscriptionInvoice and SubscriptionPayment records
      const invoice = await db.subscriptionInvoice.upsert({
        where: { providerInvoiceId: action.providerInvoiceId },
        create: {
          workspaceId: subscription.workspaceId,
          accountId: subscription.accountId,
          subscriptionId: subscription.id,
          providerInvoiceId: action.providerInvoiceId,
          status: SubscriptionInvoiceStatus.OPEN,
          currency: action.currency,
          amountDueCents: action.amountDueCents,
          amountPaidCents: 0,
          subtotalCents: action.subtotalCents,
          taxCents: action.taxCents,
          periodStart: action.periodStart || subscription.currentPeriodStart,
          periodEnd: action.periodEnd || subscription.currentPeriodEnd,
        },
        update: {
          status: SubscriptionInvoiceStatus.OPEN,
        },
      });

      await db.subscriptionPayment.upsert({
        where: { providerPaymentId: action.providerPaymentId },
        create: {
          workspaceId: subscription.workspaceId,
          invoiceId: invoice.id,
          providerPaymentId: action.providerPaymentId,
          amountCents: action.amountDueCents,
          currency: action.currency,
          status: SubscriptionPaymentStatus.FAILED,
          failureReason: action.failureReason,
        },
        update: {
          status: SubscriptionPaymentStatus.FAILED,
          failureReason: action.failureReason,
        },
      });

      return {
        status: "PROCESSED",
        message: `Payment failure processed for Paddle subscription '${subscription.id}'`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSubscriptionId(data: Record<string, unknown>): string | null {
  if (typeof data.subscription === "string") return data.subscription;
  if (data.subscription && typeof (data.subscription as any).id === "string") {
    return (data.subscription as any).id;
  }
  if (typeof data.subscriptionId === "string") return data.subscriptionId;
  if (typeof data.subscription_id === "string") return data.subscription_id;
  return null;
}

function extractCustomerId(data: Record<string, unknown>): string | null {
  if (typeof data.customer === "string") return data.customer;
  if (data.customer && typeof (data.customer as any).id === "string") {
    return (data.customer as any).id;
  }
  if (typeof data.customerId === "string") return data.customerId;
  if (typeof data.customer_id === "string") return data.customer_id;
  return null;
}

function extractEventTimestamp(event: BillingWebhookPayload): Date {
  // Stripe UNIX timestamp (seconds)
  if (event.rawEvent && typeof (event.rawEvent as any).created === "number") {
    return new Date((event.rawEvent as any).created * 1000);
  }
  if (typeof (event.data as any)?.created === "number") {
    return new Date((event.data as any).created * 1000);
  }
  // Paddle ISO 8601 string or Date (occurredAt / occurred_at / createdAt)
  const rawOccurred = (event.rawEvent as any)?.occurredAt || (event.rawEvent as any)?.occurred_at;
  if (rawOccurred) {
    const d = new Date(rawOccurred);
    if (!isNaN(d.getTime())) return d;
  }
  const dataOccurred =
    (event.data as any)?.occurred_at ||
    (event.data as any)?.occurredAt ||
    (event.data as any)?.updated_at ||
    (event.data as any)?.created_at;
  if (dataOccurred) {
    const d = new Date(dataOccurred);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

async function resolveSubscription(
  prisma: PrismaClient,
  providerSubscriptionId?: string | null,
  providerCustomerId?: string | null
) {
  if (providerSubscriptionId) {
    const sub = await prisma.subscription.findUnique({
      where: { providerSubscriptionId },
    });
    if (sub) return sub;
  }

  if (providerCustomerId) {
    const account = await prisma.platformBillingAccount.findFirst({
      where: { providerCustomerId },
    });

    if (account) {
      const sub = await prisma.subscription.findFirst({
        where: {
          accountId: account.id,
          status: { in: [...NON_TERMINAL_SUBSCRIPTION_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (sub) return sub;
    }
  }

  return null;
}

