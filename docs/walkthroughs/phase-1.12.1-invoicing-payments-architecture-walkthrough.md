# Phase 1.12.1 — Invoicing & Payments Domain Architecture Audit Walkthrough

## Overview & Executive Summary

This walkthrough document presents the revised and audited deliverable for **Phase 1.12.1: Invoice Architecture & Financial Domain Model**.

- **Deliverable File**: [`phase-1.12.1-invoicing-payments-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.12.1-invoicing-payments-domain-architecture.md)
- **Status**: LOCKED FOR IMPLEMENTATION
- **Source Code Impact**: Exactly **0 implementation code (`.ts`) files** were created or modified during this architecture specification milestone.

Phase 1.12 establishes the Accounts Receivable (AR) billing and payment realization layer for Aforden. It enables field service companies to demand payment for work performed or goods delivered, track customer financial liabilities, record and reconcile partial or full payments, and maintain legally binding financial records.

---

## Audit Findings & Definite Resolutions

### 1. 🔴 Resolved: Ambiguous `workOrderId` Population Rule on Quote-Sourced Invoices (§2.1)
- **Audit Finding**: The previous draft presented two alternative behaviors with an "or" clause regarding whether `workOrderId` is populated when an invoice is spawned from a converted Quote.
- **Definitive Resolution**: Locked a single canonical, deterministic rule in §2.1:
  1. **Quote-Sourced Invoice (`createInvoiceFromQuote`)**: Sets `Invoice.quoteId = quote.id`. If the Quote was previously converted to an operational WorkOrder (`quote.convertedWorkOrderId` is not null), the service **automatically populates `Invoice.workOrderId = quote.convertedWorkOrderId`**. If the Quote was never converted, `Invoice.workOrderId` is set to `null`.
  2. **WorkOrder-Sourced Invoice (`createInvoiceFromWorkOrder`)**: Sets `Invoice.workOrderId = workOrder.id`. If the WorkOrder originated from a Quote (`workOrder.sourceQuoteId` is not null), the service **automatically populates `Invoice.quoteId = workOrder.sourceQuoteId`**. If the WorkOrder was created standalone, `Invoice.quoteId` is set to `null`.
  3. **Standalone Direct Invoice (`createInvoice`)**: Sets `Invoice.quoteId = null` and `Invoice.workOrderId = null`.

### 2. 🔴 Resolved: Guard-Precedence Ambiguity in `recordPayment` and Lifecycle Services (§5.5 & §6.2)
- **Audit Finding**: For a `PAID` invoice, `amountDue = 0.00`, which could ambiguously trip either the status-based `InvoiceAlreadyPaidError` (409) or the balance-based `OverpaymentNotAllowedError` (422). The evaluation order was unspecified.
- **Definitive Resolution**: Established the **strict hierarchical guard sequence** in §5.5:
  1. **RBAC Guard**: Assert `payments.create` permission $\rightarrow$ throw `AuthorizationError` (403).
  2. **Tenant Isolation & Existence Guard**: Fetch `Invoice` by `(workspaceId, invoiceId)` $\rightarrow$ throw `InvoiceNotFoundError` (404).
  3. **Payload Validation Guard**: Assert `amount > 0.00` and $\le 2$ decimal places $\rightarrow$ throw `InvalidPaymentAmountError` (422).
  4. **Status Guards (Checked in strict order BEFORE balance evaluation)**:
     - If `status === VOID` $\rightarrow$ throw `InvoiceAlreadyVoidedError` (409).
     - If `status === DRAFT` $\rightarrow$ throw `InvoiceStatusConflictError` (409).
     - If `status === PAID` $\rightarrow$ throw `InvoiceAlreadyPaidError` (409) unconditionally.
  5. **Payable State Affirmation**: Status must be `ISSUED`, `PARTIALLY_PAID`, or `OVERDUE`.
  6. **Balance & Overpayment Guard**: Assert `payload.amount <= invoice.amountDue` $\rightarrow$ if exceeded, throw `OverpaymentNotAllowedError` (422).
  7. **Atomic Execution**: Apply payment, update `amountPaid`/`amountDue`, transition status to `PARTIALLY_PAID` or `PAID`, record `InvoiceHistory` event.
  - Complete guard sequences were likewise established in §6.2 for `issueInvoice`, `voidInvoice`, `voidPayment`, and `deleteInvoice`.

### 3. 🟡 Resolved: Implementation Roadmap Restored to Full 13-Stage Breakdown (§11 & §12)
- **Audit Finding**: The previous table compressed the roadmap into 11 stages without disclosing the omission of standalone Query/Directory (1.12.7), Referential Integrity (1.12.11), Operational History (1.12.12), and Final Closure (1.12.13) stages.
- **Definitive Resolution**: Restored the complete 13-stage implementation plan (Phase 1.12.1 through Phase 1.12.13) in Section 11 and added an explicit disclosure in Section 12.

---

## Architectural Decisions Summary

1. **Independent Financial Snapshot Layer (§2.2)**: All line items are deep-copied into independent `InvoiceLineItem` records with frozen catalog names, codes, SKUs, units of measure, quantities, unit prices, unit costs, discounts, and tax rates. Historical invoices survive any subsequent edits or deletions to source Quotes, WorkOrders, Service Catalogs, or Parts.
2. **Provenance Relational Modeling (§2.1)**: Direct nullable foreign keys `quoteId String?` and `workOrderId String?` on `Invoice` (`onDelete: SetNull`) with database indexes.
3. **Canonical Server-Authoritative Calculation Engine (§4)**: Line-level tax model with proportional header discount proration, penny-rounding reconciliation to the largest line, and server-side aggregation.
4. **Stored-and-Reconciled Payment Aggregates (§5.2)**: `amountPaid` and `amountDue` stored on `Invoice` and reconciled in atomic database transactions for instant $O(1)$ query indexing.
5. **Overpayment Guard (§5.3)**: Server-enforced invariant $\text{Payment.amount} \le \text{Invoice.amountDue}$.
6. **Payment Lifecycle & Scope of Refunds (§7.2)**: `RECORDED` $\rightarrow$ `VOIDED`. Outward customer refund disbursements and credit notes are deferred to Phase 1.15; operational error correction is handled via `VOIDED` payments.
7. **Technician Financial Visibility Isolation (§8.3)**: `TECHNICIAN` role is 100% excluded from `invoices.*` and `payments.*` permissions.
8. **Currency Representation Snapshot (§3.2)**: `currencyCode` snapshotted on `Invoice` and `Payment` from `Workspace.defaultCurrencyCode`.

---

## Deviations from Preliminary Roadmap

| Area | Roadmap Terminology | Architecture Specification | Technical Rationale |
| :--- | :--- | :--- | :--- |
| **Invoice Status** | `SENT` / `UNPAID` | `ISSUED` | Standardizes accounting terminology. Distinguishes commercial invoice finalization from email transport delivery (`SENT`). |
| **Invoice Status** | `PAID_IN_FULL` | `PAID` | Concise, industry-standard enum naming pairing cleanly with `PARTIALLY_PAID`. |
| **Payment Lifecycle** | `COMPLETED` / `REFUNDED` | `RECORDED` / `VOIDED` | Accurately models field service operational error corrections. Formal refund disbursements are deferred to Phase 1.15, avoiding negative balance complications. |
| **Line Item Types** | `SERVICE` | `LABOR` | Directly links to the `WorkType` catalog entity (Phase 1.5) representing technician labor and billable time. |
| **Line Item Types** | `MATERIAL` | `PART` (consolidated) | Aligns with the canonical `Part` catalog schema (Phase 1.10) to maintain uniform naming across Quotes, WorkOrders, and Invoices. |
| **Line Item Types** | *(none)* | `EXPENSE` | Added for pass-through commercial fees (permits, equipment rentals, disposal fees) that are neither labor nor inventoried parts. |
| **Implementation Stages** | Compressed / Implicit Stages | Explicit 13-Stage Roadmap | Restores explicit standalone milestones for Query/Directory Architecture (1.12.7), Referential Integrity (1.12.11), Operational History (1.12.12), and Final Closure (1.12.13) to match the rigorous 13-stage execution plan. |

---

## Self-Audit Checklist

| # | Requirement | Verification | Status |
| :-: | :--- | :--- | :-: |
| **1** | **Domain Boundary & Ownership** | Invoicing (AR billing) strictly separated from Quotes (1.11), WorkOrders (1.6), and Inventory (1.10). GL/AP/Payroll/Subscription exclusions documented. | ✅ Passed |
| **2** | **Provenance & Deterministic Population** | Direct `Invoice.quoteId` and `Invoice.workOrderId` nullable FKs with unambiguous population rules across Quote/WorkOrder/Standalone paths. | ✅ Passed |
| **3** | **Independent Snapshot Invariant** | Independent line-item re-snapshotting layer specified; historical invoices survive source modifications/deletions. | ✅ Passed |
| **4** | **Data Models Contract** | Full Prisma schemas for `Invoice`, `InvoiceLineItem`, `Payment`, and `InvoiceHistory` with exact types, decimal precision, relations, and `onDelete` rules. | ✅ Passed |
| **5** | **Currency Representation** | `currencyCode` snapshotted on `Invoice` and `Payment` from `Workspace.defaultCurrencyCode`. | ✅ Passed |
| **6** | **Calculation Engine** | Single canonical line-level tax model with proportional discount proration, penny-rounding reconciliation, and server-side aggregation. | ✅ Passed |
| **7** | **Payment Aggregate & Balances** | 1:N payment relationship, stored-and-reconciled `amountPaid`/`amountDue` in interactive transactions, strict overpayment guard ($\text{amount} \le \text{amountDue}$). | ✅ Passed |
| **8** | **Guard Precedence & Sequencing** | Exact hierarchical check sequences specified for `recordPayment` and all lifecycle services (status-conflict 409 vs overpayment 422 disambiguated). | ✅ Passed |
| **9** | **Invoice Lifecycle State Machine** | `DRAFT` $\rightarrow$ `ISSUED` $\rightarrow$ `PARTIALLY_PAID` $\rightarrow$ `PAID` / `OVERDUE` / `VOID` with complete transition matrix and guards. | ✅ Passed |
| **10** | **Payment Lifecycle & Refund Scoping** | `RECORDED` $\rightarrow$ `VOIDED`; outward refund disbursements explicitly deferred to Phase 1.15 with clear rationale. | ✅ Passed |
| **11** | **RBAC & Technician Isolation** | Complete role matrix; `TECHNICIAN` role 100% excluded from `invoices.*` and `payments.*`. | ✅ Passed |
| **12** | **Roadmap & Error Taxonomy** | 15 pure domain error classes following Convention B; 13-stage roadmap restored and fully disclosed. | ✅ Passed |

---

## Completion Statement & Readiness for Phase 1.12.2

The specification in [`phase-1.12.1-invoicing-payments-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.12.1-invoicing-payments-domain-architecture.md) has been audited, fully resolved against all three feedback items, and is locked for execution.

**Zero implementation code files (`.ts`) were touched.**

**Next Milestone**: **Phase 1.12.2 (Prisma Schema & Database Migration)** — introducing `Invoice`, `InvoiceLineItem`, `Payment`, `InvoiceHistory`, and updating `Workspace`, `Customer`, `Quote`, `WorkOrder`, and `WorkspaceMember` relations.
