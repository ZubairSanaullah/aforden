/**
 * Phase 1.15.3 — Billing Provider Gateway Types & Signatures
 */

import type {
  SubscriptionStatus,
  BillingInterval,
  BillingProviderType,
} from "@/generated/prisma/enums";

export type { SubscriptionStatus, BillingInterval, BillingProviderType };

// ============================================================================
// Customer Management Types
// ============================================================================

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

// ============================================================================
// Checkout & Customer Portal Types
// ============================================================================

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

// ============================================================================
// Subscription Lifecycle Types
// ============================================================================

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

// ============================================================================
// Invoicing & Webhook Types
// ============================================================================

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
  id: string; // providerEventId e.g. "evt_..."
  eventType: string; // e.g. "invoice.payment_succeeded"
  provider: BillingProviderType;
  data: Record<string, unknown>;
  rawEvent: unknown;
}
