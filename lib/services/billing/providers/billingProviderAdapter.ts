/**
 * Phase 1.15.3 — Billing Provider Gateway Abstraction Interface
 * Strict provider adapter interface per §2.2 of Phase 1.15 Domain Architecture.
 */

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

  // Customer Management
  createCustomer(params: CreateProviderCustomerParams): Promise<ProviderCustomerResult>;
  updateCustomer(params: UpdateProviderCustomerParams): Promise<ProviderCustomerResult>;

  // Checkout & Customer Portal
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult>;
  createPortalSession(params: CreatePortalSessionParams): Promise<PortalSessionResult>;

  // Subscription Lifecycle
  createSubscription(params: CreateProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;
  updateSubscription(params: UpdateProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;
  cancelSubscription(params: CancelProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;
  resumeSubscription(params: ResumeProviderSubscriptionParams): Promise<ProviderSubscriptionResult>;

  // Direct State Retrieval & Reconciliation
  fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState>;
  fetchUpcomingInvoice(providerSubscriptionId: string): Promise<UpcomingInvoiceResult | null>;

  // Webhook Signature Verification & Construction
  verifyAndConstructWebhookEvent(params: WebhookVerificationParams): Promise<BillingWebhookPayload>;
}

/**
 * Explicitly and exhaustively translates Stripe subscription status strings to Aforden SubscriptionStatus enum.
 * Throws on any unrecognized status without silent fallthrough.
 */
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
