# Phase 1.11.1 — Quotes & Estimates Domain Architecture Audit Walkthrough

## Overview & Executive Summary

This walkthrough document presents the revised and audited deliverable for **Phase 1.11.1: Quotes & Estimates Domain Architecture & Specification**.

- **Deliverable File**: [`phase-1.11.1-quotes-estimates-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.11.1-quotes-estimates-domain-architecture.md)
- **Status**: Revised & Locked for Implementation; 0 implementation code (`.ts` files) touched during this specification milestone.

Phase 1.11 establishes the Quotes & Estimates domain for the Aforden platform, providing pre-work commercial estimation, line item pricing snapshots, server-authoritative monetary calculations with discount proration, quote lifecycle governance, and single-path conversion into active WorkOrders.

---

## Audit Findings & Resolution Log

The initial architecture specification underwent an in-depth audit review. All five findings (2 blocking, 2 disclosures/gaps, 1 structure item) have been definitively resolved:

### 1. 🔴 Resolved: Tax Calculation Ambiguity in §4.2 Step 7
- **Finding**: The original spec offered two competing tax calculation branches: header-rate on net base vs. sum of line taxes.
- **Resolution**: Selected a **single canonical line-level tax model with proportional discount proration**.
  - `QuoteLineItem.taxRate` and `QuoteLineItem.taxAmount` are authoritative.
  - Header discount is allocated proportionally across line items before line tax computation:
    $$\text{LineAllocatedDiscount}_i = \text{round}\left(\text{QuoteDiscountAmount} \times \frac{\text{LineBaseSubtotal}_i}{\text{QuoteSubtotal}}, 2\right)$$
  - Net taxable base per line: $\text{LineNetBase}_i = \max(0.00, \text{LineBaseSubtotal}_i - \text{LineAllocatedDiscount}_i)$.
  - Line tax amount: $\text{LineTaxAmount}_i = \text{round}(\text{LineNetBase}_i \times \text{LineTaxRate}_i, 2)$.
  - Header totals are strictly aggregated from line totals: $\text{QuoteTaxAmount} = \sum \text{LineTaxAmount}_i$ and $\text{QuoteTotal} = \sum \text{LineTotal}_i$.
  - `Quote.taxRate` is strictly a display template / default rate used when populating new lines, eliminating calculation divergence.

### 2. 🔴 Resolved: Technician RBAC Commercial Visibility Isolation (§7.2 & §7.3)
- **Finding**: The original role matrix granted `TECHNICIAN` unrestricted workspace-wide `quotes.view` access.
- **Resolution**: Revoked `quotes.view` from `TECHNICIAN` (`❌`). Added Section 7.3 ("Technician Commercial Visibility Isolation"). Field technicians have zero direct access to quote pricing, margins, markup rates, or client discount history. When an approved quote converts to a WorkOrder, operational requirements (tasks, parts, location) flow to the technician through the standard WorkOrder interface (Phase 1.6 / Phase 1.9) without exposing sensitive commercial numbers.

### 3. 🟡 Resolved: Explicit Disclosure of Roadmap Deviations (§11)
- **Finding**: Naming changes from the preliminary roadmap (`SENT` → `PENDING_APPROVAL`, `ACCEPTED` → `APPROVED`, `SERVICE`/`MATERIAL` → `LABOR`/`EXPENSE`) were not formally disclosed.
- **Resolution**: Added Section 11 ("Deviations from Phase 1.11 Roadmap") detailing both renames along with technical justification.

### 4. 🟡 Resolved: Currency Representation Snapshot on Quote (§3.2)
- **Finding**: Dual-currency operating context (PKR/USD) was not represented in the data model.
- **Resolution**: Added `currencyCode String @default("USD") @db.VarChar(3)` to the `Quote` model. Denominated at creation time from workspace default settings, freezing the currency code immutably on the quote record.

### 5. 🟢 Resolved: Walkthrough Document Structure
- **Finding**: Walkthrough was missing formal sections for disclosures, deviations, self-audit, and completion statement.
- **Resolution**: Full standard structure restored in this audit walkthrough.

---

## Disclosures & Architectural Decisions

### 1. WorkOrder Provenance: `WorkOrder.sourceQuoteId`
- **Decision**: Added nullable foreign key `sourceQuoteId String?` on `WorkOrder` (`onDelete: SetNull`, indexed `@@index([sourceQuoteId])`).
- **Rationale**: Direct 1-hop traversal (`workOrder.sourceQuote`), consistency with `assetId` / `assignedTechnicianId` patterns on `WorkOrder`, zero join-table query overhead, and clean audit logs on both `QuoteHistory` (`CONVERTED`) and `WorkOrderHistory` (`CREATED`).

### 2. Single-Path WorkOrder Creation Invariant
- **Decision**: Quote conversion must invoke the existing canonical `createWorkOrder` service (Phase 1.6) inside an interactive transaction.
- **Rationale**: Forbids duplicate work order creation pathways, guaranteeing tenant isolation and RBAC checks never drift.

### 3. Inventory Boundary Isolation
- **Decision**: Quoting catalog `Part` records snapshots pricing/cost but **never** mutates live inventory balances or creates stock reservations.
- **Rationale**: Stock reservation and consumption are operational concerns governed by WorkOrders (Phase 1.10).

---

## Deviations from Phase 1.11 Roadmap

| Area | Roadmap Terminology | Architecture Specification | Technical Rationale |
| :--- | :--- | :--- | :--- |
| **Quote Status** | `SENT` | `PENDING_APPROVAL` | Accurately describes the commercial state (waiting for client approval) without conflating domain state with email transport delivery. |
| **Quote Status** | `ACCEPTED` | `APPROVED` | Standardizes approval terminology across the platform (timesheet approvals, expense approvals) and pairs symmetrically with `REJECTED`. |
| **Quote Status** | *(implicit)* | `CONVERTED` | Added explicit terminal state to prevent duplicate conversion or modification of active quotes. |
| **Line Item Types** | `SERVICE` | `LABOR` | Directly links to the `WorkType` catalog entity (Phase 1.5) representing technician labor and hourly rates. |
| **Line Item Types** | `MATERIAL` | `PART` (consolidated) | Consolidated into canonical `Part` catalog (Phase 1.10) to avoid duplicate material concepts. |
| **Line Item Types** | *(none)* | `EXPENSE` | Added for pass-through non-inventory items (permits, travel surcharges, equipment rentals). |

---

## Self-Audit Checklist

| # | Requirement | Verification | Status |
| :-: | :--- | :--- | :-: |
| **1** | **Domain Boundaries** | Pre-work proposal (Quote) vs post-work billing (Invoice) vs stock operations (Inventory) strictly separated. | ✅ Passed |
| **2** | **Provenance Model** | Direct `WorkOrder.sourceQuoteId` nullable FK with `onDelete: SetNull` and index. | ✅ Passed |
| **3** | **Currency Representation** | `currencyCode` field on `Quote` snapshotted from workspace configuration. | ✅ Passed |
| **4** | **Pricing Snapshots** | `workTypeName`, `workTypeCode`, `partName`, `partSku`, `partUom`, `unitCost` frozen at line creation. | ✅ Passed |
| **5** | **Calculation Engine** | Authoritative line-level tax calculation with proportional discount proration; single canonical formula. | ✅ Passed |
| **6** | **State Machine** | `DRAFT` → `PENDING_APPROVAL` → `APPROVED` / `REJECTED` / `EXPIRED` → `CONVERTED` with full guards. | ✅ Passed |
| **7** | **Conversion Invariant** | `convertQuoteToWorkOrder` calls existing `createWorkOrder` in interactive transaction. | ✅ Passed |
| **8** | **Commercial RBAC** | `TECHNICIAN` isolated from `quotes.*` permissions; full matrix for Owner/Admin/Manager/Dispatcher/Accountant. | ✅ Passed |
| **9** | **Audit History** | `QuoteHistory` captures all lifecycle changes and conversion metadata. | ✅ Passed |
| **10** | **Error Taxonomy** | 8 pure domain error classes following Convention B (`code`, `statusCode`, `httpStatus`). | ✅ Passed |
| **11** | **REST Endpoints** | Complete REST specification for quotes, line items, and lifecycle transitions. | ✅ Passed |
| **12** | **Disclosures & Deviations** | All roadmap evolutions explicitly itemized and justified. | ✅ Passed |

---

## Completion Statement & Readiness for Phase 1.11.2

The specification in [`phase-1.11.1-quotes-estimates-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.11.1-quotes-estimates-domain-architecture.md) is fully reconciled, unambiguous, and locked for execution.

**Next Milestone**: **Phase 1.11.2 (Prisma Schema & Database Migration)** — introducing `Quote`, `QuoteLineItem`, `QuoteHistory`, and updating `WorkOrder.sourceQuoteId`.
