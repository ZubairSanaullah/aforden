/**
 * Phase 1.15.3 — In-Memory Mock Billing Provider Adapter
 * Deterministic, offline provider simulator for integration tests and local development.
 */

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

  // In-memory shared data stores
  private static readonly sharedCustomers = new Map<string, ProviderCustomerResult>();
  private static readonly sharedSubscriptions = new Map<string, ProviderSubscriptionState>();
  private static readonly sharedUpcomingInvoices = new Map<string, UpcomingInvoiceResult>();

  private readonly customers: Map<string, ProviderCustomerResult>;
  private readonly subscriptions: Map<string, ProviderSubscriptionState>;
  private readonly upcomingInvoices: Map<string, UpcomingInvoiceResult>;

  constructor(options?: { isolated?: boolean }) {
    if (options?.isolated) {
      this.customers = new Map();
      this.subscriptions = new Map();
      this.upcomingInvoices = new Map();
    } else {
      this.customers = MockBillingAdapter.sharedCustomers;
      this.subscriptions = MockBillingAdapter.sharedSubscriptions;
      this.upcomingInvoices = MockBillingAdapter.sharedUpcomingInvoices;
    }
  }

  private idCounter = 1;

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const counter = (this.idCounter++).toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `${prefix}_mock_${timestamp}${counter}${random}`;
  }

  static clearSharedStores(): void {
    MockBillingAdapter.sharedCustomers.clear();
    MockBillingAdapter.sharedSubscriptions.clear();
    MockBillingAdapter.sharedUpcomingInvoices.clear();
  }

  // ==========================================================================
  // Customer Management
  // ==========================================================================

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

  // ==========================================================================
  // Checkout & Customer Portal
  // ==========================================================================

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

  // ==========================================================================
  // Subscription Lifecycle
  // ==========================================================================

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
    let existing = this.subscriptions.get(params.providerSubscriptionId);
    if (!existing) {
      existing = {
        providerSubscriptionId: params.providerSubscriptionId,
        providerCustomerId: "cus_mock_default",
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        trialStart: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        endedAt: null,
        seatsCount: params.seatsCount ?? 1,
        providerPriceId: params.providerPriceId,
      };
      this.subscriptions.set(params.providerSubscriptionId, existing);
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

  // ==========================================================================
  // Direct State Retrieval & Reconciliation
  // ==========================================================================

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

  // ==========================================================================
  // Webhook Signature Verification & Construction
  // ==========================================================================

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

  // ==========================================================================
  // Test Event Simulation Helpers (For downstream lifecycle integration tests)
  // ==========================================================================

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

  // ==========================================================================
  // Test & Simulation Helpers
  // ==========================================================================

  setMockSubscription(state: ProviderSubscriptionState): void {
    this.subscriptions.set(state.providerSubscriptionId, { ...state });
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

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
