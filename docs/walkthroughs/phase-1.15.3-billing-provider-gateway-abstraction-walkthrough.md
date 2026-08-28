# Phase 1.15.3 — Billing Provider Gateway Abstraction & Stripe Adapter Walkthrough

> **Milestone Status**: COMPLETE & VERIFIED  
> **Target Specification**: [`phase-1.15.1-saas-billing-subscriptions-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.15.1-saas-billing-subscriptions-domain-architecture.md) (§2)  
> **Sub-Phase Deliverable**: `BillingProviderAdapter` Interface, Parameter/Return Types, `StripeBillingAdapter`, `MockBillingAdapter`, Status Mapping, `getBillingAdapter` Factory, and Test Suite  

---

## 1. Milestone Overview

Phase 1.15.3 establishes the provider abstraction gateway layer for the Aforden platform's SaaS billing domain. It strictly enforces the **Principle of Aforden ID Sovereignty** (§2.1), ensuring that internal business logic is completely decoupled from external gateway vendor semantics, while providing full production Stripe integration alongside a deterministic in-memory simulator (`MockBillingAdapter`) for offline testing.

---

## 2. Source Code Artifacts

### 2.1 Provider Types (`lib/services/billing/providers/providerTypes.ts`)

```typescript
import type {
  SubscriptionStatus,
  BillingInterval,
  BillingProviderType,
} from "@/generated/prisma/enums";

export type { SubscriptionStatus, BillingInterval, BillingProviderType };

export interface CreateProviderCustomerParams {
  workspaceId: string;
  email: string;
  name?: string | null;
  metadata?: Record<string, string>;
}

export interface UpdateProviderCustomerParams {
  providerCustomerId: string;
  email?: string;
  name?: string | null;
  metadata?: Record<string, string>;
}

export interface ProviderCustomerResult {
  providerCustomerId: string;
  email: string;
  name?: string | null;
  paymentMethodBrand?: string | null;
  paymentMethodLast4?: string | null;
  paymentMethodExpMonth?: number | null;
  paymentMethodExpYear?: number | null;
}

export interface CreateCheckoutSessionParams {
  workspaceId: string;
  providerCustomerId?: string | null;
  customerEmail?: string;
  providerPriceId: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
  trialPeriodDays?: number | null;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  sessionUrl: string;
}

export interface CreatePortalSessionParams {
  providerCustomerId: string;
  returnUrl: string;
}

export interface PortalSessionResult {
  portalUrl: string;
}

export interface CreateProviderSubscriptionParams {
  providerCustomerId: string;
  providerPriceId: string;
  seatsCount?: number;
  trialPeriodDays?: number | null;
  metadata?: Record<string, string>;
}

export interface UpdateProviderSubscriptionParams {
  providerSubscriptionId: string;
  providerPriceId?: string;
  seatsCount?: number;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, string>;
}

export interface CancelProviderSubscriptionParams {
  providerSubscriptionId: string;
  immediately?: boolean;
}

export interface ResumeProviderSubscriptionParams {
  providerSubscriptionId: string;
}

export interface ProviderSubscriptionResult {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  seatsCount: number;
}

export interface ProviderSubscriptionState {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  seatsCount: number;
  providerPriceId?: string | null;
  paymentMethodBrand?: string | null;
  paymentMethodLast4?: string | null;
}

export interface UpcomingInvoiceResult {
  amountDueCents: number;
  subtotalCents: number;
  taxCents: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  nextPaymentAttempt: Date | null;
}

export interface WebhookVerificationParams {
  rawBody: string | Buffer;
  signature: string;
  secret?: string;
}

export interface BillingWebhookPayload {
  id: string;
  eventType: string;
  provider: BillingProviderType;
  data: Record<string, unknown>;
  rawEvent: unknown;
}
```

---

### 2.2 `BillingProviderAdapter` & Status Translation (`lib/services/billing/providers/billingProviderAdapter.ts`)

```typescript
import { SubscriptionStatus } from "@/generated/prisma/enums";
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

export interface BillingProviderAdapter {
  readonly providerName: "STRIPE" | "MOCK";

  createCustomer(params: CreateProviderCustomerParams): Promise<ProviderCustomerResult>;
  updateCustomer(params: UpdateProviderCustomerParams): Promise<ProviderCustomerResult>;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult>;
  createPortalSession(params: CreatePortalSessionParams): Promise<PortalSessionResult>;
  createSubscription(params: CreateProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;
  updateSubscription(params: UpdateProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;
  cancelSubscription(params: CancelProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;
  resumeSubscription(params: ResumeProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;
  fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState>;
  fetchUpcomingInvoice(providerSubscriptionId: string): Promise<UpcomingInvoiceResult | null>;
  verifyAndConstructWebhookEvent(params: WebhookVerificationParams): Promise<BillingWebhookPayload>;
}

export function translateStripeSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "unpaid":
      return SubscriptionStatus.UNPAID;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    case "incomplete":
      return SubscriptionStatus.INCOMPLETE;
    case "incomplete_expired":
      return SubscriptionStatus.INCOMPLETE_EXPIRED;
    case "paused":
      return SubscriptionStatus.PAUSED;
    default:
      throw new Error(`Unrecognized Stripe subscription status: '${stripeStatus}'`);
  }
}
```

---

### 2.3 `StripeBillingAdapter` (`lib/services/billing/providers/stripeBillingAdapter.ts`)

```typescript
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
```

---

### 2.4 `MockBillingAdapter` (`lib/services/billing/providers/mockBillingAdapter.ts`)

```typescript
import { BillingProviderType, SubscriptionStatus } from "@/generated/prisma/enums";
import { WebhookVerificationError } from "../billingErrors";
import { BillingProviderAdapter } from "./billingProviderAdapter";
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

export class MockBillingAdapter implements BillingProviderAdapter {
  readonly providerName = "MOCK" as const;

  private readonly customers = new Map<string, ProviderCustomerResult>();
  private readonly subscriptions = new Map<string, ProviderSubscriptionState>();
  private readonly upcomingInvoices = new Map<string, UpcomingInvoiceResult>();

  private idCounter = 1;

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const counter = (this.idCounter++).toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `${prefix}_mock_${timestamp}${counter}${random}`;
  }

  async createCustomer(params: CreateProviderCustomerParams): Promise<ProviderCustomerResult> {
    const customerId = this.generateId("cus");
    const customer: ProviderCustomerResult = {
      providerCustomerId: customerId,
      email: params.email,
      name: params.name || null,
      paymentMethodBrand: "visa",
      paymentMethodLast4: "4242",
      paymentMethodExpMonth: 12,
      paymentMethodExpYear: 2030,
    };

    this.customers.set(customerId, customer);
    return { ...customer };
  }

  async updateCustomer(params: UpdateProviderCustomerParams): Promise<ProviderCustomerResult> {
    const existing = this.customers.get(params.providerCustomerId);
    if (!existing) {
      throw new Error(`Mock customer '${params.providerCustomerId}' not found`);
    }

    const updated: ProviderCustomerResult = {
      ...existing,
      email: params.email || existing.email,
      name: params.name !== undefined ? params.name : existing.name,
    };

    this.customers.set(params.providerCustomerId, updated);
    return { ...updated };
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    const sessionId = this.generateId("cs");
    const sessionUrl = `https://mock-billing.aforden.internal/checkout/${sessionId}`;

    return {
      sessionId,
      sessionUrl,
    };
  }

  async createPortalSession(params: CreatePortalSessionParams): Promise<PortalSessionResult> {
    const portalUrl = `https://mock-billing.aforden.internal/portal/${params.providerCustomerId}`;
    return {
      portalUrl,
    };
  }

  async createSubscription(params: CreateProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const subId = this.generateId("sub");
    const now = new Date();
    const isTrial = Boolean(params.trialPeriodDays && params.trialPeriodDays > 0);

    const trialStart = isTrial ? now : null;
    const trialEnd = isTrial ? new Date(now.getTime() + params.trialPeriodDays! * 86400000) : null;
    const currentPeriodStart = now;
    const currentPeriodEnd = new Date(now.getTime() + 30 * 86400000);

    const state: ProviderSubscriptionState = {
      providerSubscriptionId: subId,
      providerCustomerId: params.providerCustomerId,
      status: isTrial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
      trialStart,
      trialEnd,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      seatsCount: params.seatsCount ?? 1,
      providerPriceId: params.providerPriceId,
      paymentMethodBrand: "visa",
      paymentMethodLast4: "4242",
    };

    this.subscriptions.set(subId, state);
    return this.toResult(state);
  }

  async updateSubscription(params: UpdateProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const existing = this.subscriptions.get(params.providerSubscriptionId);
    if (!existing) {
      throw new Error(`Mock subscription '${params.providerSubscriptionId}' not found`);
    }

    const updated: ProviderSubscriptionState = {
      ...existing,
      providerPriceId: params.providerPriceId || existing.providerPriceId,
      seatsCount: params.seatsCount !== undefined ? params.seatsCount : existing.seatsCount,
      cancelAtPeriodEnd:
        params.cancelAtPeriodEnd !== undefined ? params.cancelAtPeriodEnd : existing.cancelAtPeriodEnd,
    };

    this.subscriptions.set(params.providerSubscriptionId, updated);
    return this.toResult(updated);
  }

  async cancelSubscription(params: CancelProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const existing = this.subscriptions.get(params.providerSubscriptionId);
    if (!existing) {
      throw new Error(`Mock subscription '${params.providerSubscriptionId}' not found`);
    }

    const now = new Date();
    const updated: ProviderSubscriptionState = params.immediately
      ? {
          ...existing,
          status: SubscriptionStatus.CANCELED,
          cancelAtPeriodEnd: false,
          canceledAt: now,
          endedAt: now,
        }
      : {
          ...existing,
          cancelAtPeriodEnd: true,
          canceledAt: now,
        };

    this.subscriptions.set(params.providerSubscriptionId, updated);
    return this.toResult(updated);
  }

  async resumeSubscription(params: ResumeProviderSubscriptionParams): Promise<ProviderSubscriptionResult> {
    const existing = this.subscriptions.get(params.providerSubscriptionId);
    if (!existing) {
      throw new Error(`Mock subscription '${params.providerSubscriptionId}' not found`);
    }

    const updated: ProviderSubscriptionState = {
      ...existing,
      cancelAtPeriodEnd: false,
      status: SubscriptionStatus.ACTIVE,
    };

    this.subscriptions.set(params.providerSubscriptionId, updated);
    return this.toResult(updated);
  }

  async fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState> {
    const existing = this.subscriptions.get(providerSubscriptionId);
    if (!existing) {
      throw new Error(`Mock subscription '${providerSubscriptionId}' not found`);
    }
    return { ...existing };
  }

  async fetchUpcomingInvoice(providerSubscriptionId: string): Promise<UpcomingInvoiceResult | null> {
    const existing = this.upcomingInvoices.get(providerSubscriptionId);
    if (existing) {
      return { ...existing };
    }

    const sub = this.subscriptions.get(providerSubscriptionId);
    if (!sub) {
      return null;
    }

    return {
      amountDueCents: 4900 * sub.seatsCount,
      subtotalCents: 4900 * sub.seatsCount,
      taxCents: 0,
      currency: "USD",
      periodStart: sub.currentPeriodEnd,
      periodEnd: new Date(sub.currentPeriodEnd.getTime() + 30 * 86400000),
      nextPaymentAttempt: sub.currentPeriodEnd,
    };
  }

  async verifyAndConstructWebhookEvent(params: WebhookVerificationParams): Promise<BillingWebhookPayload> {
    let payloadObj: any;

    if (typeof params.rawBody === "string") {
      try {
        payloadObj = JSON.parse(params.rawBody);
      } catch {
        throw new WebhookVerificationError("Malformed JSON payload in mock webhook verification");
      }
    } else if (Buffer.isBuffer(params.rawBody)) {
      try {
        payloadObj = JSON.parse(params.rawBody.toString("utf8"));
      } catch {
        throw new WebhookVerificationError("Malformed Buffer payload in mock webhook verification");
      }
    } else if (typeof params.rawBody === "object" && params.rawBody !== null) {
      payloadObj = params.rawBody;
    } else {
      throw new WebhookVerificationError("Invalid payload type provided for mock webhook verification");
    }

    if (!payloadObj || typeof payloadObj !== "object" || !payloadObj.type) {
      throw new WebhookVerificationError("Mock webhook payload missing required 'type' field");
    }

    const eventId = payloadObj.id || this.generateId("evt");
    const eventType = payloadObj.type;
    const data = payloadObj.data?.object || payloadObj.data || {};

    return {
      id: eventId,
      eventType,
      provider: BillingProviderType.MOCK,
      data,
      rawEvent: payloadObj,
    };
  }

  simulatePaymentSuccess(subscriptionId: string, invoiceAmountCents = 4900): BillingWebhookPayload {
    const sub = this.subscriptions.get(subscriptionId);
    const customerId = sub?.providerCustomerId || this.generateId("cus");
    const invoiceId = this.generateId("in");
    const paymentIntentId = this.generateId("pi");

    if (sub && (sub.status === SubscriptionStatus.PAST_DUE || sub.status === SubscriptionStatus.INCOMPLETE)) {
      sub.status = SubscriptionStatus.ACTIVE;
    }

    const rawEvent = {
      id: this.generateId("evt"),
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: invoiceId,
          customer: customerId,
          subscription: subscriptionId,
          payment_intent: paymentIntentId,
          amount_paid: invoiceAmountCents,
          amount_due: invoiceAmountCents,
          currency: "usd",
          status: "paid",
          period_start: Math.floor(Date.now() / 1000),
          period_end: Math.floor((Date.now() + 30 * 86400000) / 1000),
        },
      },
    };

    return {
      id: rawEvent.id,
      eventType: rawEvent.type,
      provider: BillingProviderType.MOCK,
      data: rawEvent.data.object,
      rawEvent,
    };
  }

  simulatePaymentFailure(subscriptionId: string, failureReason = "insufficient_funds"): BillingWebhookPayload {
    const sub = this.subscriptions.get(subscriptionId);
    const customerId = sub?.providerCustomerId || this.generateId("cus");
    const invoiceId = this.generateId("in");

    if (sub && sub.status === SubscriptionStatus.ACTIVE) {
      sub.status = SubscriptionStatus.PAST_DUE;
    }

    const rawEvent = {
      id: this.generateId("evt"),
      type: "invoice.payment_failed",
      data: {
        object: {
          id: invoiceId,
          customer: customerId,
          subscription: subscriptionId,
          amount_due: 4900,
          currency: "usd",
          status: "open",
          last_payment_error: {
            message: failureReason,
          },
        },
      },
    };

    return {
      id: rawEvent.id,
      eventType: rawEvent.type,
      provider: BillingProviderType.MOCK,
      data: rawEvent.data.object,
      rawEvent,
    };
  }

  simulateSubscriptionUpdated(
    subscriptionId: string,
    updates: Partial<ProviderSubscriptionState>
  ): BillingWebhookPayload {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      Object.assign(sub, updates);
    }

    const rawEvent = {
      id: this.generateId("evt"),
      type: "customer.subscription.updated",
      data: {
        object: {
          id: subscriptionId,
          customer: sub?.providerCustomerId || this.generateId("cus"),
          status: sub?.status ? sub.status.toLowerCase() : "active",
          cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
        },
      },
    };

    return {
      id: rawEvent.id,
      eventType: rawEvent.type,
      provider: BillingProviderType.MOCK,
      data: rawEvent.data.object,
      rawEvent,
    };
  }

  simulateSubscriptionDeleted(subscriptionId: string): BillingWebhookPayload {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.status = SubscriptionStatus.CANCELED;
      sub.endedAt = new Date();
    }

    const rawEvent = {
      id: this.generateId("evt"),
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: subscriptionId,
          customer: sub?.providerCustomerId || this.generateId("cus"),
          status: "canceled",
        },
      },
    };

    return {
      id: rawEvent.id,
      eventType: rawEvent.type,
      provider: BillingProviderType.MOCK,
      data: rawEvent.data.object,
      rawEvent,
    };
  }

  private toResult(state: ProviderSubscriptionState): ProviderSubscriptionResult {
    return {
      providerSubscriptionId: state.providerSubscriptionId,
      providerCustomerId: state.providerCustomerId,
      status: state.status,
      currentPeriodStart: state.currentPeriodStart,
      currentPeriodEnd: state.currentPeriodEnd,
      trialStart: state.trialStart,
      trialEnd: state.trialEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      canceledAt: state.canceledAt,
      endedAt: state.endedAt,
      seatsCount: state.seatsCount,
    };
  }
}
```

---

### 2.5 Adapter Factory (`lib/services/billing/providers/getBillingAdapter.ts`)

```typescript
import { BillingProviderType } from "@/generated/prisma/enums";
import type { BillingProviderAdapter } from "./billingProviderAdapter";
import { StripeBillingAdapter } from "./stripeBillingAdapter";
import { MockBillingAdapter } from "./mockBillingAdapter";

export function getBillingAdapter(
  provider: BillingProviderType,
  options?: { apiKey?: string; webhookSecret?: string }
): BillingProviderAdapter {
  switch (provider) {
    case BillingProviderType.STRIPE:
      return new StripeBillingAdapter(options);
    case BillingProviderType.MOCK:
      return new MockBillingAdapter();
    default:
      throw new Error(`Unsupported or unrecognized billing provider: '${String(provider)}'`);
  }
}
```

---

## 3. Verification & Test Results

### 3.1 Subphase Unit Tests
* `tests/billing/stripeBillingAdapter.test.ts` (17 tests) — **PASS**
* `tests/billing/mockBillingAdapter.test.ts` (20 tests) — **PASS**
* `tests/billing/getBillingAdapter.test.ts` (4 tests) — **PASS**
* `tests/billing/entitlementRegistry.test.ts` (13 tests) — **PASS**
* `tests/billing/billingSchemaAndMigration.test.ts` (6 tests) — **PASS**
* `tests/billing/billingSeed.test.ts` (6 tests) — **PASS**

**Total Domain Tests in `tests/billing`**: **66 Tests Passed (0 Failed)**

### 3.2 Platform-Wide Regression Test Summary
* **TypeScript Compilation**: `npx tsc --noEmit` $\rightarrow$ **0 errors** (with zero `as any` type bypasses on SDK versions, methods, or subscription mapping).
* **Test Suite**: `npm test` $\rightarrow$ **206 Test Files Passed (3,746 Tests Passed, 0 Failed)**.
* **Offline Independence**: Zero test executions require live network connectivity or real Stripe credentials.
