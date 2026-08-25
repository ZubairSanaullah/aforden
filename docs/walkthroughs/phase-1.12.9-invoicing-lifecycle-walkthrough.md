# Phase 1.12.9 — Invoice Lifecycle & Overdue Services Walkthrough

## Overview

This walkthrough documents **Phase 1.12.9: Invoice Lifecycle & Overdue Services**, implementing exactly the three lifecycle services defined in the locked Phase 1.12.1 domain architecture:
- `issueInvoice`
- `voidInvoice`
- `evaluateInvoiceOverdue`

---

## 1. Verbatim Architecture Reference (Phase 1.12.1 §6.2)

### §6.2.A `issueInvoice(workspaceId, invoiceId, actor)`
```markdown
1. **RBAC Guard**: Assert `invoices.issue` permission.
2. **Existence Guard**: Fetch `Invoice`. If not found $\rightarrow$ throw `InvoiceNotFoundError` (404).
3. **Status Guard**: Assert `invoice.status === DRAFT`. If `status === ISSUED` $\rightarrow$ return idempotent success. If `status !== DRAFT` $\rightarrow$ throw `InvoiceStatusConflictError` (409).
4. **Line Item Count Guard**: Query line items count. If $0$ $\rightarrow$ throw `InvoiceEmptyLineItemsError` (`INVOICE_EMPTY_LINE_ITEMS`, HTTP 422).
5. **Due Date Guard**: Assert `invoice.dueDate >= invoice.issueDate`. If not $\rightarrow$ throw `InvoiceDueDateInvalidError` (`INVOICE_DUE_DATE_INVALID`, HTTP 422).
6. **Execution**: Atomically update `status = ISSUED`, `issuedAt = now()`, `amountDue = total`, `amountPaid = 0.00`, log `InvoiceHistory` event `ISSUED`.
```

### §6.2.B `voidInvoice(workspaceId, invoiceId, payload: { voidReason }, actor)`
```markdown
1. **RBAC Guard**: Assert `invoices.void` permission.
2. **Existence Guard**: Fetch `Invoice`. If not found $\rightarrow$ throw `InvoiceNotFoundError` (404).
3. **Void Reason Guard**: Assert `payload.voidReason` is non-empty string. If empty $\rightarrow$ throw `MissingVoidReasonError` (`MISSING_VOID_REASON`, HTTP 422).
4. **Already Voided Guard**: If `invoice.status === VOID` $\rightarrow$ throw `InvoiceAlreadyVoidedError` (`INVOICE_ALREADY_VOIDED`, HTTP 409).
5. **Active Payments Guard**: Query active `Payment` records where `status === RECORDED`. If count $> 0$ $\rightarrow$ throw `InvoiceHasActivePaymentsError` (`INVOICE_HAS_ACTIVE_PAYMENTS`, HTTP 409, message: `"Cannot void an invoice with active recorded payments. Void all associated payments first."`).
6. **Execution**: Update `status = VOID`, `voidedAt = now()`, `voidReason = payload.voidReason`, `amountDue = 0.00`, log `InvoiceHistory` event `VOIDED`.
```

---

## 2. Implemented Services

### A. [`issueInvoice.ts`](file:///d:/Download/aforden/lib/services/invoice/issueInvoice.ts)
- **AUTH & PERMISSION**: Asserts `PERMISSIONS.INVOICES_ISSUE` (`invoices.issue`).
- **RESOLVE & EXISTENCE**: Tenant-scoped fetch; throws `InvoiceNotFoundError` (404).
- **STATUS GUARD**:
  - `status === "ISSUED"`: Idempotently returns current read model without side effects.
  - `status !== "DRAFT"`: Throws `InvoiceStatusConflictError` (409).
- **LINE ITEM GUARD**: 0 line items $\rightarrow$ throws `InvoiceEmptyLineItemsError` (422).
- **DUE DATE GUARD**: `dueDate < issueDate` $\rightarrow$ throws `InvoiceDueDateInvalidError` (422) (part of original 1.12.1 error taxonomy).
- **CUSTOMER ACTIVE GUARD**: Verifies referenced Customer has `status === "ACTIVE"`; throws `CustomerNotFoundError` (404) if missing or inactive.
- **PERSISTENCE**: Atomic `$transaction` updating `status = "ISSUED"`, `issuedAt = now()`, `amountDue = invoice.total`, `amountPaid = "0.00"`, and recording `InvoiceHistory` with `eventType: "ISSUED"`.

### B. [`voidInvoice.ts`](file:///d:/Download/aforden/lib/services/invoice/voidInvoice.ts)
- **AUTH & PERMISSION**: Asserts `PERMISSIONS.INVOICES_VOID` (`invoices.void`).
- **VOID REASON GUARD**: Pre-DB validation; non-empty trimmed reason required or throws `MissingVoidReasonError` (422).
- **RESOLVE & EXISTENCE**: Tenant-scoped fetch; throws `InvoiceNotFoundError` (404).
- **ALREADY VOIDED GUARD**: `status === "VOID"` $\rightarrow$ throws `InvoiceAlreadyVoidedError` (409).
- **STATUS ELIGIBILITY GUARD**: Permitted only from `ISSUED`, `OVERDUE`, and `PARTIALLY_PAID`; throws `InvoiceStatusConflictError` (409) otherwise.
- **ACTIVE PAYMENTS GUARD**: Any payment with `status !== "VOIDED"` blocks voiding $\rightarrow$ throws `InvoiceHasActivePaymentsError` (409).
- **SNAPSHOT IMMUTABILITY**: Stored financial totals (`subtotal`, `taxAmount`, `discountAmount`, `total`) and line items remain byte-for-byte untouched.
- **PERSISTENCE**: Atomic `$transaction` updating `status = "VOID"`, `voidedAt = now()`, `voidReason`, `amountDue = 0.00`, and writing `InvoiceHistory` with `eventType: "VOIDED"` tracking the actual prior status in `oldValue`.

### C. [`evaluateInvoiceOverdue.ts`](file:///d:/Download/aforden/lib/services/invoice/evaluateInvoiceOverdue.ts)
- **SYSTEM SERVICE**: No human auth/actor requirements.
- **TRANSITION CONDITIONS (§6.1 lines 625 & 628)**:
  - `status IN ["ISSUED", "PARTIALLY_PAID"]`
  - `dueDate < now`
  - `amountDue > 0.00`
- **TENANT ISOLATION**:
  - `workspaceId !== "ALL"`: Strict single-workspace queries.
  - `workspaceId === "ALL"`: Discovers distinct `workspaceId` values from eligible invoices, then iterates per workspace.
- **IDEMPOTENCY & CONCURRENCY**: Per-invoice `$transaction` with re-fetch verifying `status IN ["ISSUED", "PARTIALLY_PAID"]` and `amountDue > 0`. If state changed concurrently, skips transition silently without incrementing `transitionedCount`.
- **AUDIT LOGGING**: Records `InvoiceHistory` with `eventType: "OVERDUE_MARKED"`, `actorName: "System"`, and prior status recorded in `oldValue`.

---

## 3. Verification Results

### Lifecycle Test Suite (`tests/invoice/invoice-lifecycle-services.test.ts`)
36/36 tests passing across all three services.

### Full Regression Suite
- **177 test files passed (177)**
- **3,261 tests passed (3,261)**
