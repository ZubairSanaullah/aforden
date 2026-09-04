/**
 * Phase 1.23.1 — Paddle Billing Gateway Provider Adapter
 * Implements BillingProviderAdapter backed by the official @paddle/paddle-node-sdk.
 */

import {
  Paddle,
  Environment,
  type Subscription,
} from "@paddle/paddle-node-sdk";
import { BillingProviderType, SubscriptionStatus } from "@/generated/prisma/enums";
import { WebhookVerificationError } from "../billingErrors";
import {
  BillingProviderAdapter,
  translatePaddleSubscriptionStatus,
} from "./billingProviderAdapter";
import type {
  CreateProviderCustomerParams,
  UpdateProviderCustomerParams,
  ProviderCustomerResult,
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  CreatePortalSessionParams,
  PortalSessionResult,
  CreateProviderSubscriptionParams,
  UpdateProviderSubscriptionParams,
  CancelProviderSubscriptionParams,
  ResumeProviderSubscriptionParams,
  ProviderSubscriptionResult,
  ProviderSubscriptionState,
  UpcomingInvoiceResult,
  WebhookVerificationParams,
  BillingWebhookPayload,
} from "./providerTypes";

export interface PaddleBillingAdapterOptions {
  apiKey?: string;
  webhookSecret?: string;
  environment?: "sandbox" | "production" | Environment;
}

export class PaddleBillingAdapter implements BillingProviderAdapter {
  readonly providerName = "PADDLE" as const;
  private readonly paddle: Paddle;
  private readonly webhookSecret?: string;
  private readonly environment: Environment;

  constructor(options?: PaddleBillingAdapterOptions) {
    const apiKey = options?.apiKey || process.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Paddle API key is not configured. Please provide 'apiKey' or set 'PADDLE_API_KEY' in the environment."
      );
    }

    const envOption = options?.environment || process.env.PADDLE_ENVIRONMENT;
    if (envOption === "production" || envOption === Environment.production) {
      this.environment = Environment.production;
    } else {
      this.environment = Environment.sandbox;
    }

    this.paddle = new Paddle(apiKey, {
      environment: this.environment,
    });
    this.webhookSecret = options?.webhookSecret || process.env.PADDLE_WEBHOOK_SECRET;
  }

  // ==========================================================================
  // Customer Management
  // ==========================================================================

  async createCustomer(params: CreateProviderCustomerParams): Promise<ProviderCustomerResult> {
    const customer = await this.paddle.customers.create({
      email: params.email,
      name: params.name || undefined,
      customData: {
        workspaceId: params.workspaceId,
        ...params.metadata,
      },
    });

    return {
      providerCustomerId: customer.id,
      email: customer.email || params.email,
      name: customer.name || params.name || null,
      paymentMethodBrand: null,
      paymentMethodLast4: null,
      paymentMethodExpMonth: null,
      paymentMethodExpYear: null,
    };
  }

  async updateCustomer(params: UpdateProviderCustomerParams): Promise<ProviderCustomerResult> {
    const customer = await this.paddle.customers.update(params.providerCustomerId, {
      email: params.email || undefined,
      name: params.name !== undefined ? params.name || "" : undefined,
      customData: params.metadata,
    });

    return {
      providerCustomerId: customer.id,
      email: customer.email || params.email || "",
      name: customer.name || null,
      paymentMethodBrand: null,
      paymentMethodLast4: null,
      paymentMethodExpMonth: null,
      paymentMethodExpYear: null,
    };
  }

  // ==========================================================================
  // Checkout & Customer Portal
  // ==========================================================================

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    // Note on cancelUrl vs successUrl:
    // Paddle Billing's Transaction Checkout API (`checkout: { url }`) accepts only a single
    // success/return destination URL. There is no dedicated server-side `cancel_url` parameter
    // in Paddle Billing; on cancellation or dismissal, Paddle.js overlay returns to the host page
    // or hosted checkout preserves user context. We store `cancelUrl` in `customData.cancelUrl`
    // for audit, redirect telemetry, and webhook correlation.
    const transactionParams: any = {
      items: [
        {
          priceId: params.providerPriceId,
          quantity: params.quantity ?? 1,
        },
      ],
      // Note on Trial Handling:
      // In Paddle Billing, formal trial duration is governed primarily by the catalog Price entity
      // (via `trial_period: { interval: 'day', frequency: N }`). Dynamic runtime `trialPeriodDays`
      // passed here cannot override catalog Price rules directly on automatic collection transactions
      // without an attached trial discount. We record it in customData for telemetry and audit.
      customData: {
        workspaceId: params.workspaceId,
        ...(params.cancelUrl ? { cancelUrl: params.cancelUrl } : {}),
        ...(params.trialPeriodDays ? { trialPeriodDays: String(params.trialPeriodDays) } : {}),
        ...params.metadata,
      },
      collectionMode: "automatic",
    };

    if (params.providerCustomerId) {
      transactionParams.customerId = params.providerCustomerId;
    }

    if (params.successUrl) {
      transactionParams.checkout = {
        url: params.successUrl,
      };
    }

    const transaction = await this.paddle.transactions.create(transactionParams);

    const sessionUrl =
      transaction.checkout?.url ||
      (this.environment === Environment.production
        ? `https://checkout.paddle.com/checkout/${transaction.id}`
        : `https://sandbox-checkout.paddle.com/checkout/${transaction.id}`);

    return {
      sessionId: transaction.id,
      sessionUrl,
    };
  }

  async createPortalSession(params: CreatePortalSessionParams): Promise<PortalSessionResult> {
    // Consistent with StripeBillingAdapter: let SDK exceptions propagate naturally to caller/service layer
    const session = await this.paddle.customerPortalSessions.create(params.providerCustomerId, []);
    const portalUrl = session.urls?.general?.overview;
    if (!portalUrl) {
      throw new Error(`Paddle customer portal session '${session.id}' did not return a valid overview URL`);
    }
    return { portalUrl };
  }

  // ==========================================================================
  // Subscription Lifecycle
  // ==========================================================================

  async createSubscription(params: CreateProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const transaction = await this.paddle.transactions.create({
      items: [
        {
          priceId: params.providerPriceId,
          quantity: params.seatsCount ?? 1,
        },
      ],
      customerId: params.providerCustomerId,
      // Note on Trial Handling:
      // Catalog Price definition governs the trial duration in Paddle Billing;
      // trialPeriodDays is preserved in customData for telemetry and audit.
      customData: {
        ...(params.trialPeriodDays ? { trialPeriodDays: String(params.trialPeriodDays) } : {}),
        ...params.metadata,
      },
      collectionMode: "automatic",
    });

    if (transaction.subscriptionId) {
      const sub = await this.paddle.subscriptions.get(transaction.subscriptionId);
      return this.mapPaddleSubscription(sub);
    }

    // In Paddle Billing, a transaction created for a subscription may not synchronously return a subscriptionId
    // if payment collection is asynchronous or awaiting customer authorization.
    // Rather than fabricating an active subscription state, we return an explicit INCOMPLETE status
    // representing the pending transaction until activated by subsequent webhooks.
    const periodStart = transaction.billingPeriod?.startsAt
      ? new Date(transaction.billingPeriod.startsAt)
      : transaction.createdAt
      ? new Date(transaction.createdAt)
      : new Date();

    const periodEnd = transaction.billingPeriod?.endsAt
      ? new Date(transaction.billingPeriod.endsAt)
      : new Date(periodStart.getTime() + 30 * 86400000);

    return {
      providerSubscriptionId: transaction.id,
      providerCustomerId: params.providerCustomerId,
      status: SubscriptionStatus.INCOMPLETE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStart: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      seatsCount: params.seatsCount ?? 1,
    };
  }

  async updateSubscription(params: UpdateProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const updateBody: any = {};

    let existingSub: Subscription | null = null;
    const getExisting = async () => {
      if (!existingSub) {
        existingSub = await this.paddle.subscriptions.get(params.providerSubscriptionId);
      }
      return existingSub;
    };

    if (params.providerPriceId || params.seatsCount !== undefined) {
      let targetPriceId = params.providerPriceId;
      // If seatsCount changes without a new priceId, resolve existing item's priceId
      if (!targetPriceId) {
        const existing = await getExisting();
        targetPriceId = existing.items?.[0]?.price?.id;
        if (!targetPriceId) {
          throw new Error(
            `Cannot update seats on subscription '${params.providerSubscriptionId}': no primary item/price found on existing subscription.`
          );
        }
      }

      updateBody.items = [
        {
          priceId: targetPriceId,
          quantity: params.seatsCount !== undefined ? params.seatsCount : 1,
        },
      ];
      updateBody.prorationBillingMode = "prorated_immediately";
    }

    if (params.cancelAtPeriodEnd !== undefined) {
      if (params.cancelAtPeriodEnd) {
        const existing = await getExisting();
        const periodEnd = existing.currentBillingPeriod?.endsAt;
        if (periodEnd) {
          updateBody.scheduledChange = {
            action: "cancel",
            effectiveAt: periodEnd,
          };
        }
      } else {
        updateBody.scheduledChange = null;
      }
    }

    if (params.metadata) {
      updateBody.customData = params.metadata;
    }

    const updated = await this.paddle.subscriptions.update(params.providerSubscriptionId, updateBody);
    return this.mapPaddleSubscription(updated);
  }

  async cancelSubscription(params: CancelProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const effectiveFrom = params.immediately ? "immediately" : "next_billing_period";
    const canceled = await this.paddle.subscriptions.cancel(params.providerSubscriptionId, {
      effectiveFrom,
    });
    return this.mapPaddleSubscription(canceled);
  }

  async resumeSubscription(params: ResumeProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const resumed = await this.paddle.subscriptions.resume(params.providerSubscriptionId, {
      effectiveFrom: "immediately",
    });
    return this.mapPaddleSubscription(resumed);
  }

  // ==========================================================================
  // Direct State Retrieval & Reconciliation
  // ==========================================================================

  async fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState> {
    const sub = await this.paddle.subscriptions.get(providerSubscriptionId);
    const mapped = this.mapPaddleSubscription(sub);

    let paymentMethodBrand: string | null = null;
    let paymentMethodLast4: string | null = null;

    if (sub.customerId) {
      try {
        const paymentMethods = await this.paddle.paymentMethods.list(sub.customerId).next();
        const primaryPm = paymentMethods[0];
        if (primaryPm?.card) {
          paymentMethodBrand = primaryPm.card.type || null;
          paymentMethodLast4 = primaryPm.card.last4 || null;
        }
      } catch {
        // Non-fatal if payment method details cannot be queried
      }
    }

    const primaryItem = sub.items?.[0];
    const providerPriceId = primaryItem?.price?.id || null;

    return {
      ...mapped,
      providerPriceId,
      paymentMethodBrand,
      paymentMethodLast4,
    };
  }

  async fetchUpcomingInvoice(providerSubscriptionId: string): Promise<UpcomingInvoiceResult | null> {
    try {
      const sub = await this.paddle.subscriptions.get(providerSubscriptionId);

      const details = sub.recurringTransactionDetails;
      if (!details) {
        return null;
      }

      const periodStart = sub.currentBillingPeriod?.startsAt
        ? new Date(sub.currentBillingPeriod.startsAt)
        : new Date();
      const periodEnd = sub.currentBillingPeriod?.endsAt
        ? new Date(sub.currentBillingPeriod.endsAt)
        : new Date(Date.now() + 30 * 86400000);

      const totalCents = details.totals?.total ? parseInt(details.totals.total, 10) : 0;
      const subtotalCents = details.totals?.subtotal ? parseInt(details.totals.subtotal, 10) : totalCents;
      const taxCents = details.totals?.tax ? parseInt(details.totals.tax, 10) : 0;
      const currency = (sub.currencyCode || "USD").toUpperCase();
      const nextPaymentAttempt = sub.nextBilledAt ? new Date(sub.nextBilledAt) : null;

      return {
        amountDueCents: totalCents,
        subtotalCents,
        taxCents,
        currency,
        periodStart,
        periodEnd,
        nextPaymentAttempt,
      };
    } catch (err: any) {
      if (err?.code === "not_found" || err?.statusCode === 404) {
        return null;
      }
      console.error("[PaddleBillingAdapter] Error retrieving upcoming invoice preview:", err);
      throw new Error("Failed to retrieve upcoming invoice from billing provider");
    }
  }

  // ==========================================================================
  // Webhook Signature Verification & Construction
  // ==========================================================================

  async verifyAndConstructWebhookEvent(params: WebhookVerificationParams): Promise<BillingWebhookPayload> {
    const secret = params.secret || this.webhookSecret || process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      throw new WebhookVerificationError("Paddle webhook secret is not configured in environment");
    }

    try {
      const rawBodyString =
        typeof params.rawBody === "string"
          ? params.rawBody
          : params.rawBody.toString("utf8");

      const event = await this.paddle.webhooks.unmarshal(
        rawBodyString,
        secret,
        params.signature
      );

      return {
        id: (event as any).eventId || (event as any).id || "",
        eventType: (event as any).eventType || (event as any).type || (event as any).name || "",
        provider: BillingProviderType.PADDLE,
        data: ((event as any).data || event) as unknown as Record<string, unknown>,
        rawEvent: event,
      };
    } catch (err: any) {
      console.error("[PaddleBillingAdapter] Webhook signature verification failure:", err?.message || err);
      throw new WebhookVerificationError("Webhook signature verification failed");
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private mapPaddleSubscription(sub: Subscription): ProviderSubscriptionResult {
    const primaryItem = sub.items?.[0];
    const seatsCount = primaryItem?.quantity ?? 1;

    const trialStart = primaryItem?.trialDates?.startsAt
      ? new Date(primaryItem.trialDates.startsAt)
      : null;
    const trialEnd = primaryItem?.trialDates?.endsAt
      ? new Date(primaryItem.trialDates.endsAt)
      : null;

    const canceledAt = sub.canceledAt ? new Date(sub.canceledAt) : null;
    const endedAt =
      sub.status === "canceled" && sub.canceledAt
        ? new Date(sub.canceledAt)
        : null;

    const currentPeriodStart = sub.currentBillingPeriod?.startsAt
      ? new Date(sub.currentBillingPeriod.startsAt)
      : sub.startedAt
      ? new Date(sub.startedAt)
      : new Date();

    const currentPeriodEnd = sub.currentBillingPeriod?.endsAt
      ? new Date(sub.currentBillingPeriod.endsAt)
      : new Date(currentPeriodStart.getTime() + 30 * 86400000);

    const cancelAtPeriodEnd = sub.scheduledChange?.action === "cancel";

    return {
      providerSubscriptionId: sub.id,
      providerCustomerId: sub.customerId,
      status: translatePaddleSubscriptionStatus(sub.status),
      currentPeriodStart,
      currentPeriodEnd,
      trialStart,
      trialEnd,
      cancelAtPeriodEnd,
      canceledAt,
      endedAt,
      seatsCount,
    };
  }
}
