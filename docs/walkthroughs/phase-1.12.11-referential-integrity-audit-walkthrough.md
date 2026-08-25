# Phase 1.12.11 — Referential Integrity & Historical Safety Audit Walkthrough

## Overview

This walkthrough documents the comprehensive findings of the **Phase 1.12.11 Referential Integrity & Historical Safety Audit** across the Invoicing & Payments domain (`Invoice`, `InvoiceLineItem`, `Payment`, `InvoiceHistory`) and their relations to `Workspace`, `Customer`, `ServiceLocation`, `Quote`, `WorkOrder`, `WorkType`, and `Part`.

---

## 1. Locked Architecture Reference

In the locked Phase 1.12.1 roadmap (§11, line 805):
`| **Phase 1.12.11** | Referential Integrity & Historical Safety | Cascade/SetNull/Restrict verification, catalog/source deletion isolation, snapshot immutability verification. |`

There is no separate service specification section in 1.12.1 for 1.12.11; it is an architectural verification milestone.

---

## 2. Audit Findings

### Item 1: Cascade & Restrict Behaviors
- **Customer Deletion**: `Customer.invoices` and `Customer.payments` both specify `onDelete: Restrict` in Prisma schema. Deleting a customer with existing invoices or payments is strictly blocked at the database engine level.
- **ServiceLocation Deletion**: `ServiceLocation.invoices` specifies `onDelete: Restrict`.
- **Quote & WorkOrder Lineage**: `Quote` and `WorkOrder` relations on `Invoice` use `onDelete: SetNull`. If a source Quote or WorkOrder is removed, `invoice.quoteId` or `invoice.workOrderId` is set to `null` without deleting or corrupting the invoice.
- **Catalog Isolation**: `InvoiceLineItem.workType` and `InvoiceLineItem.part` use `onDelete: SetNull`.
- **Hard Delete Code Paths**:
  - `deleteInvoice.ts`: Only allowed when `status === "DRAFT"` and zero payments exist (`InvoiceStatusConflictError` otherwise).
  - `removeInvoiceLineItem.ts`: Only allowed when `status === "DRAFT"` (`InvoiceStatusConflictError` otherwise).
  - `Payment`: **Zero hard-delete calls exist in the entire codebase.**

### Item 2: Historical Immutability
- `invoiceHistory.update()` calls: **0**
- `invoiceHistory.delete()` calls: **0**
- All 14 mutation services in `lib/services/invoice/` strictly perform append-only writes via `tx.invoiceHistory.create()`.

### Item 3: Snapshot Fidelity
- `InvoiceLineItem` persists denormalized, frozen commercial fields (`workTypeName`, `workTypeCode`, `partName`, `partSku`, `partUnitOfMeasure`, `unitPrice`, `unitCost`, `quantity`, `discountAmount`, `taxRate`, `taxAmount`, `subtotal`, `total`).
- `invoiceMappers.ts` maps directly from these frozen line item columns without joining live catalog tables. Repricing or deleting a catalog item has zero retroactive impact on existing invoices.

### Item 4: Cross-Tenant Isolation
- All 27 query sites in `lib/services/invoice/` are explicitly scoped by `workspaceId` in the root `where` filter.
- `evaluateInvoiceOverdue` in `"ALL"` mode first discovers distinct `workspaceId`s from eligible invoices, then iterates strictly per workspace.

### Item 5: Sequential Numbering & Concurrency Collision Retries
- **Code implementation**:
  - `Invoice`: [`createInvoice.ts`](file:///d:/Download/aforden/lib/services/invoice/createInvoice.ts), [`createInvoiceFromQuote.ts`](file:///d:/Download/aforden/lib/services/invoice/createInvoiceFromQuote.ts), [`createInvoiceFromWorkOrder.ts`](file:///d:/Download/aforden/lib/services/invoice/createInvoiceFromWorkOrder.ts)
  - `Payment`: [`recordPayment.ts`](file:///d:/Download/aforden/lib/services/invoice/recordPayment.ts)
- **Bounded Retry Mechanism**:
  - All number generation services execute within a `MAX_NUMBER_RETRIES = 5` loop.
  - When concurrent transactions generate identical sequence numbers simultaneously, the Prisma `P2002` unique constraint violation on `[workspaceId, invoiceNumber]` or `[workspaceId, paymentNumber]` is intercepted.
  - The service re-queries the latest sequential number from the database within a fresh transaction attempt and retries, ensuring concurrent writers both succeed without crashing or surfacing an unhandled error.
- **Database Unique Constraint Guarantee**:
  - `Invoice`: `@@unique([workspaceId, invoiceNumber])`
  - `Payment`: `@@unique([workspaceId, paymentNumber])`

---

## 3. Verification Results

### Test Suites
- **Referential Integrity & Concurrency Suite** (`tests/invoice/invoice-referential-integrity.test.ts`): 9/9 passed.
- **Invoicing Domain Suite** (`tests/invoice/`): 9 test files, 220 passed.
- **Full Regression Suite** (`npm run test`): 179 test files, 3,296 passed.
