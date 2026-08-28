# Phase 1.15.2 — SaaS Billing Data Models, Enums, Migrations & Entitlement Registry Walkthrough

> **Milestone Status**: COMPLETE & VERIFIED  
> **Target Specification**: [`phase-1.15.1-saas-billing-subscriptions-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.15.1-saas-billing-subscriptions-domain-architecture.md)  
> **Sub-Phase Deliverable**: Prisma Models, DDL Migration with Partial Unique Index, Closed Entitlement Registry, Domain Error Classes, Idempotent Plan Seed Data, and Full Test Suite  

---

## 1. Milestone Overview

Phase 1.15.2 implements the foundational data models, PostgreSQL database migration, compile-time entitlement registry, domain error taxonomy, and seed data for the **SaaS Billing & Subscriptions** domain in Aforden FSM, strictly adhering to the locked Phase 1.15.1 architectural specification.

All 8 Prisma enums, 9 domain models, direct `@relation` foreign keys to `Workspace`, single-active-subscription PostgreSQL partial unique index, closed 10-key `ENTITLEMENT_REGISTRY`, 7 pure domain error classes, and 3 standard subscription plans (`starter`, `growth`, `enterprise`) have been implemented, migrated, seeded, and verified with zero schema drift and zero regressions.

---

## 2. Changes Implemented

### 2.1 Prisma Schema (`prisma/schema.prisma`)

* **8 Enums Added**:
  `SubscriptionStatus`, `BillingInterval`, `BillingProviderType`, `SubscriptionInvoiceStatus`, `SubscriptionPaymentStatus`, `WebhookProcessingStatus`, `PlanTier`, `FeatureValueType`.

* **9 Models Added**:
  1. `SubscriptionPlan`: Catalog plans with `tier`, `baseSeats`, `sortOrder`, and `code` uniqueness.
  2. `SubscriptionPlanPrice`: Multi-interval pricing (`MONTHLY`, `ANNUAL`) with `perAdditionalSeatCents` and `providerPriceId`.
  3. `SubscriptionPlanFeature`: Feature flags and quotas with generic `scalesWithSeats: Boolean @default(false)` support.
  4. `PlatformBillingAccount`: 1:1 Workspace billing account linking to external Stripe Customer IDs with payment method metadata.
  5. `Subscription`: Core subscription entity with status, period dates, trial timestamps, seat counts, dunning counters, and direct `@relation` to `Workspace`.
  6. `WorkspaceEntitlementOverride`: Granular per-workspace feature and quota overrides with optional expiration (`expiresAt`).
  7. `SubscriptionInvoice`: Platform SaaS invoices charged to tenant workspaces with `payments` relation and direct `@relation` to `Workspace`.
  8. `SubscriptionPayment`: Individual charge/refund payment attempts against `SubscriptionInvoice` with direct `@relation` to `Workspace`.
  9. `BillingWebhookEvent`: Transactional webhook inbox for signature verification, deduplication, and replay protection.
  10. `SubscriptionHistory`: Immutable audit ledger recording state transitions and trigger sources.

* **Workspace Relations Added**:
  `subscriptions`, `subscriptionInvoices`, `subscriptionPayments`, `platformBillingAccount`, `workspaceEntitlementOverrides`.

---

### 2.2 DDL Migration & Single Active Subscription Partial Unique Index

* **Migration File**: [`prisma/migrations/20260828094000_add_saas_billing_and_subscriptions_domain/migration.sql`](file:///d:/Download/aforden/prisma/migrations/20260828094000_add_saas_billing_and_subscriptions_domain/migration.sql)
* **Partial Unique Index**:
  ```sql
  -- Enforce Single Active Subscription Invariant (§3.2 of Phase 1.15.1 Architecture Spec)
  CREATE UNIQUE INDEX "unique_active_subscription_per_account"
  ON "Subscription"("accountId")
  WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'INCOMPLETE', 'PAUSED');
  ```
* **Drift Verification**: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` returned **`No difference detected`** (0 drift).

---

### 2.3 Closed Compile-Time Entitlement Registry (`lib/services/billing/entitlementRegistry.ts`)

Contains exactly 10 canonical entries, frozen at runtime via `Object.freeze()`:

```typescript
export const ENTITLEMENT_REGISTRY = {
  MAX_MEMBERS: { key: "MAX_MEMBERS", type: "NUMERIC_LIMIT", defaultValue: 2, scalesWithSeats: true, description: "Maximum active user accounts in the workspace" },
  MAX_TECHNICIANS: { key: "MAX_TECHNICIANS", type: "NUMERIC_LIMIT", defaultValue: 1, scalesWithSeats: false, description: "Maximum active technician profiles with dispatch scheduling" },
  MAX_WORK_ORDERS_PER_MONTH: { key: "MAX_WORK_ORDERS_PER_MONTH", type: "NUMERIC_LIMIT", defaultValue: 25, scalesWithSeats: false, description: "Maximum work orders created within a single calendar month" },
  MAX_SERVICE_LOCATIONS: { key: "MAX_SERVICE_LOCATIONS", type: "NUMERIC_LIMIT", defaultValue: 50, scalesWithSeats: false, description: "Maximum active customer service location records" },
  MAX_ATTACHMENT_STORAGE_MB: { key: "MAX_ATTACHMENT_STORAGE_MB", type: "NUMERIC_LIMIT", defaultValue: 500, scalesWithSeats: false, description: "Total file attachment and photo evidence storage capacity in MB" },
  FEATURE_ADVANCED_REPORTING: { key: "FEATURE_ADVANCED_REPORTING", type: "BOOLEAN", defaultValue: false, scalesWithSeats: false, description: "Access to profitability, technician efficiency, and AR aging reports" },
  FEATURE_CUSTOM_BRANDING: { key: "FEATURE_CUSTOM_BRANDING", type: "BOOLEAN", defaultValue: false, scalesWithSeats: false, description: "Custom logos, PDF color schemes, and email sender signatures" },
  FEATURE_SMS_NOTIFICATIONS: { key: "FEATURE_SMS_NOTIFICATIONS", type: "BOOLEAN", defaultValue: false, scalesWithSeats: false, description: "Direct SMS notification dispatches to customers and field techs" },
  FEATURE_INVENTORY_MULTI_WAREHOUSE: { key: "FEATURE_INVENTORY_MULTI_WAREHOUSE", type: "BOOLEAN", defaultValue: false, scalesWithSeats: false, description: "Tracking inventory across multiple physical warehouses and trucks" },
  FEATURE_API_ACCESS: { key: "FEATURE_API_ACCESS", type: "BOOLEAN", defaultValue: false, scalesWithSeats: false, description: "Access to public developer REST APIs and webhooks" },
} as const;
```

---

### 2.4 Domain Error Classes (`lib/services/billing/billingErrors.ts`)

* `PlanFeatureNotEnabledError` (HTTP 403)
* `QuotaExceededError` (HTTP 402)
* `DuplicateActiveSubscriptionError` (HTTP 409)
* `SubscriptionPastDueError` (HTTP 402)
* `InvalidSubscriptionStateTransitionError` (HTTP 409)
* `WebhookVerificationError` (HTTP 400)
* `InvalidEntitlementMultiplierError` (HTTP 500)

---

### 2.5 Seed Data (`lib/services/billing/seedSubscriptionPlans.ts`)

Seeds 3 canonical plans idempotently:
1. **Starter**: $49/mo ($468/yr), 1 base seat, +$29/additional seat, 3 techs, 100 WOs/mo, 100 locations, 1GB storage.
2. **Growth**: $149/mo ($1,428/yr), 5 base seats, +$25/additional seat, 15 techs, 500 WOs/mo, 1,000 locations, 10GB storage, Advanced Reporting, Custom Branding, SMS.
3. **Enterprise**: $499/mo ($4,788/yr), 20 base seats, +$20/additional seat, Unlimited techs, WOs, locations, storage, Multi-warehouse inventory, and Developer APIs.

All `scalesWithSeats: true` features (`MAX_MEMBERS`) are seeded with positive integer multiplier `1`.

---

## 3. Verification & Test Results

### 3.1 Domain Unit & Integration Tests
* `tests/billing/entitlementRegistry.test.ts` (13 tests) — **PASS**
* `tests/billing/billingSchemaAndMigration.test.ts` (6 tests) — **PASS**
* `tests/billing/billingSeed.test.ts` (6 tests) — **PASS**

### 3.2 Key Tested Invariants
- [x] Partial unique index rejects a second non-terminal subscription for the same account at DB level.
- [x] Terminal status (`CANCELED`) allows creating a new active subscription.
- [x] Deleting `Workspace` cascades to all billing models.
- [x] Deleting `SubscriptionPlan` is restricted when active subscriptions exist.
- [x] Deleting `Subscription` sets `SubscriptionInvoice.subscriptionId` to `null`.
- [x] Deleting `SubscriptionInvoice` cascades to `SubscriptionPayment`.
- [x] Re-running `seedSubscriptionPlans()` is 100% idempotent.

### 3.3 Platform-Wide Regression Test Summary
* **TypeScript Compilation**: `npx tsc --noEmit` $\rightarrow$ **0 errors**
* **Test Suite**: `npm test` $\rightarrow$ **203 Test Files Passed (3,708 Tests Passed, 0 Failed)**
* **Schema Drift**: `npx prisma migrate diff` $\rightarrow$ **No difference detected**

---

## 4. Next Step

Ready for **Phase 1.15.3 — Billing Provider Gateway Abstraction & Stripe Adapter**:
- Implementing `BillingProviderAdapter` interface.
- Creating `StripeBillingAdapter` (with Stripe Node SDK v17+ integration).
- Creating `MockBillingAdapter` (in-memory simulator for offline integration testing).
