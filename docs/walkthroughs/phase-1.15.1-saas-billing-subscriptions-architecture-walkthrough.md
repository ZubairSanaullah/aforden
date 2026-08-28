# Phase 1.15.1 — SaaS Billing & Subscriptions Architecture Walkthrough

> **Milestone Status**: COMPLETE & LOCKED (Audited and Revised)  
> **Target Specification**: [`phase-1.15.1-saas-billing-subscriptions-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.15.1-saas-billing-subscriptions-domain-architecture.md)  
> **Sub-Phase Deliverable**: Phase 1.15 Architecture Contract, Decision Rationale & Self-Audit Walkthrough  

---

## 1. Milestone Overview

Phase 1.15.1 establishes the formal domain architecture and system contract for the **SaaS Billing & Subscriptions** domain in the Aforden Field Service Management (FSM) multi-tenant platform.

This phase is a pure architecture specification milestone. It formalizes all domain boundaries, provider abstractions (Stripe & Mock adapters), subscription lifecycle state machines, entitlement resolution mechanics, webhook idempotency protocols, dunning/grace period escalation rules, RBAC permissions, and the 10-stage implementation roadmap (1.15.1 through 1.15.10) before database schemas and services are implemented in Phase 1.15.2 onward.

---

## 2. Key Architectural Decisions & Re-Audit Corrections

### 2.1 Generic Dynamic Seat Scaling & Multiplier Semantics (§5.1, §5.2)
* **Correction Applied**:
  * Formally defined that when `scalesWithSeats: true`, `SubscriptionPlanFeature.valueJson` represents the **positive integer per-seat multiplier coefficient** ($m \ge 1$, e.g. `1` for 1 member per seat).
  * In `resolveEntitlement()`, the `UNLIMITED` sentinel check is evaluated early, returning `{ isUnlimited: true }` immediately and bypassing numeric multiplier checks (preventing `NaN` errors on enterprise plans).
  * Added runtime assertion in `resolveEntitlement()` that throws `InvalidEntitlementMultiplierError` if a feature has `scalesWithSeats: true` but contains a non-integer or invalid multiplier ($m < 1$).
  * Clarified that `ENTITLEMENT_REGISTRY[featureKey].defaultValue` is an absolute limit for free/unsubscribed workspaces.

### 2.2 Reintroduction & Consistency of `SubscriptionPayment` (§1.1, §1.2, §3.1)
* **Correction Applied**: Added the `SubscriptionPayment` model and enum `SubscriptionPaymentStatus` to §3.1, linked to `SubscriptionInvoice` and `Workspace`, and aligned the Domain Ownership Table and Executive Summary.

### 2.3 Tenant-Scoped Foreign Key Integrity (§3.1)
* **Correction Applied**: Added explicit `@relation(fields: [workspaceId], references: [id], onDelete: Cascade)` to `Workspace` on `PlatformBillingAccount`, `Subscription`, `SubscriptionInvoice`, `SubscriptionPayment`, and `WorkspaceEntitlementOverride`.

### 2.4 Single Active Subscription Invariant (§3.2)
* **Invariant Formalized**: At most one non-terminal subscription per `accountId` / `workspaceId`, enforced via PostgreSQL partial unique index and transactional service check.

### 2.5 Accurate `INCOMPLETE_EXPIRED` Webhook Trigger (§4.2)
* **Correction Applied**: Mapped trigger to `WEBHOOK:customer.subscription.updated` (`status: incomplete_expired`) + 24-hour timeout sweep in reconciliation worker.

### 2.6 Platform Admin Override Boundary (§1.2, §9.1, §10)
* **Correction Applied**: Deferred operator REST routes to Phase 1.19; internal services retained in 1.15.4/1.15.5 for system scripts.

### 2.7 Roadmap Supersession (§12)
* **Correction Applied**: Formally documented in §12 that the 10-subphase roadmap (1.15.1 through 1.15.10) consolidates and supersedes the preliminary 13-subphase breakdown.

---

## 3. Walkthrough of the 12 Architectural Pillars

| Pillar | Core Architectural Rule | Reference |
| :--- | :--- | :--- |
| **1. Invoicing Separation** | Complete decoupling between Phase 1.12 (invoicing customers for field jobs) and Phase 1.15 (billing tenants for platform usage). Zero shared tables or routes. | §1.1 |
| **2. ID Sovereignty** | Aforden owns all internal UUIDs. Stripe customer/subscription/payment IDs are stored purely as secondary references. | §2.1 |
| **3. Provider Abstraction** | `BillingProviderAdapter` interface standardizes `StripeBillingAdapter` (production) and `MockBillingAdapter` (fast, deterministic integration testing). | §2.2 |
| **4. Database Schema** | 9 targeted models in Prisma with direct `Workspace` FKs, `SubscriptionPayment` tracking, and single-active-subscription partial unique index. | §3.1, §3.2 |
| **5. State Machine** | Strict transition matrix across `TRIALING`, `ACTIVE`, `PAST_DUE`, `UNPAID`, `CANCELED`, `INCOMPLETE`, `PAUSED` with provider-driven recovery. | §4.1, §4.2 |
| **6. Entitlement Engine** | Closed `ENTITLEMENT_REGISTRY` with validated `scalesWithSeats` per-seat multiplier semantics and 3-tier fallback resolution. | §5.1, §5.2 |
| **7. Webhook Idempotency** | Raw-body HMAC verification, `BillingWebhookEvent` transactional inbox, and out-of-order sequence timestamp guards. | §6.1 |
| **8. Proration & Cycles** | Immediate upgrades with prorated credits/charges; scheduled downgrades at `currentPeriodEnd`. | §7.1 |
| **9. Dunning Engine** | 7-day operational grace period on failed payments $\rightarrow$ soft suspension (read-only) $\rightarrow$ hard termination. | §8.1 |
| **10. RBAC Matrix** | 5 granular permissions (`billing.view_plan`, `billing.manage_subscription`, `billing.view_invoices`, `billing.manage_payment_methods`, `billing.admin_override`). | §9.1 |
| **11. Notification Dispatch** | Billing events emitted to Phase 1.13 `NotificationOutbox` inside database transactions for reliable email/in-app alerting. | §1.2 |
| **12. 10-Stage Roadmap** | Locked progression from 1.15.1 through 1.15.10 superseding earlier 13-stage draft. | §12.0 |

---

## 4. Subphase 1.15.1 Self-Audit Checklist

- [x] **Per-Seat Multiplier Semantics**: Explicitly defined `valueJson` as a positive integer per-seat multiplier ($m \ge 1$) when `scalesWithSeats: true`; runtime assertion throws `InvalidEntitlementMultiplierError` on invalid values.
- [x] **SubscriptionPayment Internal Consistency**: Model added to §3.1 with full relation links to `SubscriptionInvoice` and `Workspace`, and restored in Executive Summary and Domain Ownership tables.
- [x] **Tenant Foreign Key Integrity**: `Subscription`, `SubscriptionInvoice`, and `SubscriptionPayment` all declare explicit `@relation(fields: [workspaceId], references: [id], onDelete: Cascade)`.
- [x] **Single Active Subscription Constraint**: Documented dual-layer enforcement via PostgreSQL partial unique index and transactional service check.
- [x] **Stripe Trigger Accuracy**: `INCOMPLETE → INCOMPLETE_EXPIRED` correctly mapped to `customer.subscription.updated (status: incomplete_expired)` + 24h sweep.
- [x] **Operator REST Route Scope**: Deferred to Phase 1.19; underlying internal functions retained in 1.15.4/1.15.5.
- [x] **Roadmap Supersession**: Explicitly declared in §12 that 10-stage roadmap supersedes the preliminary 13-stage breakdown.

---

## 5. Next Steps

With Phase 1.15.1 corrected, verified, and locked:
* **Next Subphase**: **Phase 1.15.2 — SaaS Billing Data Models, Enums, Migrations & Entitlement Registry**
* **Deliverables**: Prisma schema migration DDL (including partial unique index and `SubscriptionPayment`), seed data for standard subscription plans (Starter, Growth, Enterprise), and compile-time `ENTITLEMENT_REGISTRY`.
