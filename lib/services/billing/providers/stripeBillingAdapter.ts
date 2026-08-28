/**
 * Phase 1.15.3 — Stripe Gateway Provider Adapter
 * Implements BillingProviderAdapter backed by the official Stripe Node SDK.
 */

import Stripe from "stripe";
import { BillingProviderType } from "@/generated/prisma/enums";
import { WebhookVerificationError } from "../billingErrors";
import {
  BillingProviderAdapter,
  translateStripeSubscriptionStatus,
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

export class StripeBillingAdapter implements BillingProviderAdapter {
  readonly providerName = "STRIPE" as const;
  private readonly stripe: Stripe;
  private readonly webhookSecret?: string;

  constructor(options?: { apiKey?: string; webhookSecret?: string }) {
    const apiKey = options?.apiKey || process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error(
        "Stripe API key is not configured. Please provide 'apiKey' or set 'STRIPE_SECRET_KEY' in the environment."
      );
    }
    this.stripe = new Stripe(apiKey, {
      apiVersion: "2026-08-26.dahlia",
    });
    this.webhookSecret = options?.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
  }

  // ==========================================================================
  // Customer Management
  // ==========================================================================

  async createCustomer(params: CreateProviderCustomerParams): Promise<ProviderCustomerResult> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name || undefined,
      metadata: {
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
    const customer = await this.stripe.customers.update(params.providerCustomerId, {
      email: params.email || undefined,
      name: params.name !== undefined ? params.name || "" : undefined,
      metadata: params.metadata,
    });

    if (customer.deleted) {
      throw new Error(`Stripe customer '${params.providerCustomerId}' has been deleted`);
    }

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
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      line_items: [
        {
          price: params.providerPriceId,
          quantity: params.quantity ?? 1,
        },
      ],
      metadata: {
        workspaceId: params.workspaceId,
        ...params.metadata,
      },
      subscription_data: {
        metadata: {
          workspaceId: params.workspaceId,
          ...params.metadata,
        },
      },
    };

    if (params.providerCustomerId) {
      sessionParams.customer = params.providerCustomerId;
    } else if (params.customerEmail) {
      sessionParams.customer_email = params.customerEmail;
    }

    if (params.trialPeriodDays && params.trialPeriodDays > 0) {
      sessionParams.subscription_data = {
        ...sessionParams.subscription_data,
        trial_period_days: params.trialPeriodDays,
      };
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      throw new Error(`Stripe checkout session '${session.id}' did not return a valid checkout URL`);
    }

    return {
      sessionId: session.id,
      sessionUrl: session.url,
    };
  }

  async createPortalSession(params: CreatePortalSessionParams): Promise<PortalSessionResult> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.providerCustomerId,
      return_url: params.returnUrl,
    });

    return {
      portalUrl: session.url,
    };
  }

  // ==========================================================================
  // Subscription Lifecycle
  // ==========================================================================

  async createSubscription(params: CreateProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const createParams: Stripe.SubscriptionCreateParams = {
      customer: params.providerCustomerId,
      items: [
        {
          price: params.providerPriceId,
          quantity: params.seatsCount ?? 1,
        },
      ],
      metadata: params.metadata,
    };

    if (params.trialPeriodDays && params.trialPeriodDays > 0) {
      createParams.trial_period_days = params.trialPeriodDays;
    }

    const sub = await this.stripe.subscriptions.create(createParams);
    return this.mapStripeSubscription(sub);
  }

  async updateSubscription(params: UpdateProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const existing = await this.stripe.subscriptions.retrieve(params.providerSubscriptionId);
    const updateParams: Stripe.SubscriptionUpdateParams = {};

    if (params.providerPriceId || params.seatsCount !== undefined) {
      const primaryItemId = existing.items.data[0]?.id;
      if (primaryItemId) {
        updateParams.items = [
          {
            id: primaryItemId,
            price: params.providerPriceId || undefined,
            quantity: params.seatsCount !== undefined ? params.seatsCount : undefined,
          },
        ];
      }
    }

    if (params.cancelAtPeriodEnd !== undefined) {
      updateParams.cancel_at_period_end = params.cancelAtPeriodEnd;
    }

    if (params.metadata) {
      updateParams.metadata = params.metadata;
    }

    const updated = await this.stripe.subscriptions.update(params.providerSubscriptionId, updateParams);
    return this.mapStripeSubscription(updated);
  }

  async cancelSubscription(params: CancelProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    if (params.immediately) {
      const canceled = await this.stripe.subscriptions.cancel(params.providerSubscriptionId);
      return this.mapStripeSubscription(canceled);
    }

    const updated = await this.stripe.subscriptions.update(params.providerSubscriptionId, {
      cancel_at_period_end: true,
    });
    return this.mapStripeSubscription(updated);
  }

  async resumeSubscription(params: ResumeProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const resumed = await this.stripe.subscriptions.resume(params.providerSubscriptionId, {
      billing_cycle_anchor: "unchanged",
    });
    return this.mapStripeSubscription(resumed);
  }

  // ==========================================================================
  // Direct State Retrieval & Reconciliation
  // ==========================================================================

  async fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState> {
    const sub = await this.stripe.subscriptions.retrieve(providerSubscriptionId, {
      expand: ["default_payment_method"],
    });

    const mapped = this.mapStripeSubscription(sub);

    let paymentMethodBrand: string | null = null;
    let paymentMethodLast4: string | null = null;

    if (sub.default_payment_method && typeof sub.default_payment_method === "object") {
      const pm = sub.default_payment_method as Stripe.PaymentMethod;
      if (pm.card) {
        paymentMethodBrand = pm.card.brand;
        paymentMethodLast4 = pm.card.last4;
      }
    }

    const primaryItem = sub.items.data[0];
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
      const preview = await this.stripe.invoices.createPreview({
        subscription: providerSubscriptionId,
      });

      const lineItem = preview.lines?.data?.[0];
      const periodStart = lineItem?.period?.start
        ? new Date(lineItem.period.start * 1000)
        : new Date();
      const periodEnd = lineItem?.period?.end
        ? new Date(lineItem.period.end * 1000)
        : new Date(Date.now() + 30 * 86400000);

      const subtotalCents = preview.subtotal ?? 0;
      const totalCents = preview.total ?? preview.amount_due ?? 0;
      const taxCents = Math.max(0, totalCents - subtotalCents);

      return {
        amountDueCents: preview.amount_due ?? 0,
        subtotalCents,
        taxCents,
        currency: (preview.currency || "usd").toUpperCase(),
        periodStart,
        periodEnd,
        nextPaymentAttempt: preview.due_date ? new Date(preview.due_date * 1000) : null,
      };
    } catch (err: any) {
      if (err?.code === "invoice_upcoming_none" || err?.statusCode === 404) {
        return null;
      }
      console.error("[StripeBillingAdapter] Error retrieving upcoming invoice preview:", err);
      throw new Error("Failed to retrieve upcoming invoice from billing provider");
    }
  }

  // ==========================================================================
  // Webhook Signature Verification & Construction
  // ==========================================================================

  async verifyAndConstructWebhookEvent(params: WebhookVerificationParams): Promise<BillingWebhookPayload> {
    const secret = params.secret || this.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new WebhookVerificationError("Stripe webhook secret is not configured in environment");
    }

    try {
      const event = this.stripe.webhooks.constructEvent(params.rawBody, params.signature, secret);

      return {
        id: event.id,
        eventType: event.type,
        provider: BillingProviderType.STRIPE,
        data: event.data.object as unknown as Record<string, unknown>,
        rawEvent: event,
      };
    } catch (err: any) {
      console.error("[StripeBillingAdapter] Webhook signature verification failure:", err?.message || err);
      throw new WebhookVerificationError("Webhook signature verification failed");
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private mapStripeSubscription(sub: Stripe.Subscription): ProviderSubscriptionResult {
    const primaryItem = sub.items?.data?.[0];
    const seatsCount = primaryItem?.quantity ?? 1;

    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id || "";

    const trialStart = sub.trial_start ? new Date(sub.trial_start * 1000) : null;
    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
    const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000) : null;
    const endedAt = sub.ended_at ? new Date(sub.ended_at * 1000) : null;

    let currentPeriodStart: Date;
    let currentPeriodEnd: Date;

    if (primaryItem?.current_period_start && primaryItem?.current_period_end) {
      currentPeriodStart = new Date(primaryItem.current_period_start * 1000);
      currentPeriodEnd = new Date(primaryItem.current_period_end * 1000);
    } else {
      const fallbackStart = sub.start_date
        ? new Date(sub.start_date * 1000)
        : sub.created
        ? new Date(sub.created * 1000)
        : new Date();
      currentPeriodStart = fallbackStart;
      currentPeriodEnd = new Date(fallbackStart.getTime() + 30 * 86400000);
    }

    return {
      providerSubscriptionId: sub.id,
      providerCustomerId: customerId,
      status: translateStripeSubscriptionStatus(sub.status),
      currentPeriodStart,
      currentPeriodEnd,
      trialStart,
      trialEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      canceledAt,
      endedAt,
      seatsCount,
    };
  }
}
