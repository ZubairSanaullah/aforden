# Phase 1.12.6 — Invoice Line Item Mutation Services Walkthrough

## Overview & Executive Summary

This walkthrough document validates the implementation of **Phase 1.12.6: Invoice Line Item Mutation Services** for the Invoicing & Payments domain.

- **Add Line Item Service**: [`lib/services/invoice/addInvoiceLineItem.ts`](file:///d:/Download/aforden/lib/services/invoice/addInvoiceLineItem.ts)
- **Update Line Item Service**: [`lib/services/invoice/updateInvoiceLineItem.ts`](file:///d:/Download/aforden/lib/services/invoice/updateInvoiceLineItem.ts)
- **Remove Line Item Service**: [`lib/services/invoice/removeInvoiceLineItem.ts`](file:///d:/Download/aforden/lib/services/invoice/removeInvoiceLineItem.ts)
- **Reorder Line Items Service**: [`lib/services/invoice/reorderInvoiceLineItems.ts`](file:///d:/Download/aforden/lib/services/invoice/reorderInvoiceLineItems.ts)
- **Module Exports**: [`lib/services/invoice/index.ts`](file:///d:/Download/aforden/lib/services/invoice/index.ts)
- **Unit & Integration Test Suite**: [`tests/invoice/invoice-line-item-services.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts)

---

## Service Implementations & Execution Pipelines

Every mutating service strictly enforces the locked execution order:
$$\text{AUTHENTICATION} \rightarrow \text{PERMISSION} \rightarrow \text{VALIDATION} \rightarrow \text{RESOLUTION} \rightarrow \text{BUSINESS LOGIC} \rightarrow \text{PERSISTENCE}$$

### 1. `addInvoiceLineItem(workspaceId, invoiceId, input, actor)`
- **RBAC**: Asserts `invoices.update` permission.
- **Tenant & Lifecycle Guard**: Verifies invoice exists in workspace; restricts modifications strictly to `DRAFT` status (`InvoiceStatusConflictError`).
- **Validation**: Enforces Step 1 negative-subtotal guard ($(quantity \times unitPrice) - discountAmount \ge 0$) throwing `InvalidInvoiceCalculationError`.
- **Snapshot Resolution**: Resolves and freezes catalog snapshot fields for `workTypeId` (Labor) and `partId` (Part), throwing `WorkTypeNotFoundError` / `PartNotFoundError` on invalid IDs.
- **Dynamic Recalculation**: Recalculates full invoice totals across all lines via `calculateInvoiceTotals`, redistributing header discounts and recalculating line taxes.
- **Audit Logging**: Atomically records `InvoiceHistory` (`eventType: LINE_ITEM_ADDED`).

### 2. `updateInvoiceLineItem(workspaceId, invoiceId, lineItemId, input, actor)`
- **RBAC**: Asserts `invoices.update` permission.
- **Tenant & Scope Guard**: Verifies invoice exists and line item belongs to this specific invoice (`InvoiceLineItemNotFoundError` on cross-invoice attempts).
- **Lifecycle Guard**: Restricts modifications strictly to `DRAFT` status.
- **Validation**: Enforces Step 1 negative-subtotal guard on merged values.
- **Snapshot Re-resolution**: Re-resolves and freezes catalog snapshot fields if `workTypeId` or `partId` changes.
- **Dynamic Recalculation**: Recalculates entire invoice line set and header totals.
- **Audit Logging**: Atomically records `InvoiceHistory` (`eventType: LINE_ITEM_UPDATED`).

### 3. `removeInvoiceLineItem(workspaceId, invoiceId, lineItemId, actor)`
- **RBAC**: Asserts `invoices.update` permission.
- **Tenant & Scope Guard**: Verifies invoice exists and line item belongs to this invoice.
- **Lifecycle Guard**: Restricts deletion strictly to `DRAFT` status.
- **Dynamic Recalculation**: Deletes line item and recalculates full invoice totals across remaining line items (handles 0 items gracefully by resetting subtotal/total/amountDue to 0.00).
- **Audit Logging**: Atomically records `InvoiceHistory` (`eventType: LINE_ITEM_REMOVED`).

### 4. `reorderInvoiceLineItems(workspaceId, invoiceId, orderedLineItemIds, actor)`
- **RBAC**: Asserts `invoices.update` permission.
- **Tenant & Lifecycle Guard**: Verifies invoice exists in `DRAFT` status.
- **Validation**: Verifies `orderedLineItemIds` matches the exact set of current line item IDs without duplicates, omissions, or foreign IDs.
- **Atomic Sort Order Update**: Updates `sortOrder: i` for each line item.
- **Audit Logging**: Atomically records `InvoiceHistory` (`eventType: LINE_ITEM_UPDATED` with reorder metadata).

---

## Test Evidence & Invariants Verification

### 1. Full-Invoice Recalculation on Add/Update/Remove
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts:L178-L290`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts#L178-L290)
- Verified that adding a second line redistributes a fixed header discount ($10.00) equally ($5.00 each) across all lines and updates line-level tax and total fields.

### 2. Cross-Invoice Line Item ID Rejection
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts:L490-L515`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts#L490-L515)
- Verified that attempting to update or delete a line item ID from a foreign invoice throws `InvoiceLineItemNotFoundError`.

### 3. `DRAFT`-Only Lifecycle Guard Enforcement
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts)
- Verified that `add`, `update`, `remove`, and `reorder` all reject non-`DRAFT` invoices (`ISSUED`, `PAID`, `VOID`) with `InvoiceStatusConflictError`.

### 4. Step 1 Negative-Subtotal Rejection
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts:L420-L450`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts#L420-L450)
- Input discount exceeding base line subtotal throws `InvalidInvoiceCalculationError`.

### 5. Removing Last Remaining Line Item
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts:L620-L660`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts#L620-L660)
- Removing the only remaining line item resets `subtotal`, `taxAmount`, `total`, and `amountDue` to `0.00` without errors.

### 6. Transaction Atomicity Rollback
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts:L810-L830`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts#L810-L830)
- Verified that failure during history write rolls back line item creation.

### 7. Deterministic Tie-Break Verification
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts:L831-L895`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts#L831-L895)
- Verified that fixed discount penny proration remainder deterministically assigns to lowest sortOrder line.

### 8. RBAC Permission Rejections
- **Test File**: [`tests/invoice/invoice-line-item-services.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-line-item-services.test.ts)
- Verified that `TECHNICIAN` role is rejected across all four operations with `ForbiddenError`.

---

## Verification Summary

1. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   # Result: 0 errors
   ```

2. **Line Item Test Suite (`tests/invoice/invoice-line-item-services.test.ts`)**:
   ```bash
   npx vitest run tests/invoice/invoice-line-item-services.test.ts
   # Result: 24 passed (24)
   ```

3. **Invoicing Domain Test Suites (`tests/invoice/`)**:
   ```bash
   npx vitest run tests/invoice/
   # Result: 4 passed (121 tests passed)
   ```

4. **Full Regression Suite**:
   ```bash
   npm run test
   # Result:
   # Test Files  174 passed (174)
   # Tests       3197 passed (3197)
   ```

---

## Self-Audit Checklist

| # | Requirement | Status |
| :-: | :--- | :-: |
| **1** | Locked execution pipeline followed for all mutating services | ✅ Passed |
| **2** | Full-invoice recalculation triggered on add/update/remove across all lines | ✅ Passed |
| **3** | Cross-invoice line item ID rejection throws `InvoiceLineItemNotFoundError` | ✅ Passed |
| **4** | `DRAFT`-only lifecycle guard enforced on add, update, remove, and reorder | ✅ Passed |
| **5** | Catalog snapshots frozen on add and workType/part update | ✅ Passed |
| **6** | Step 1 negative-subtotal rejection throws `InvalidInvoiceCalculationError` | ✅ Passed |
| **7** | Removing only remaining line item succeeds with zeroed totals | ✅ Passed |
| **8** | Reorder rejects malformed, duplicate, or foreign ID sets | ✅ Passed |
| **9** | Transaction atomicity rollback verified on history write failure | ✅ Passed |
| **10** | Deterministic tie-break discount proration verified on multi-line mutations | ✅ Passed |
| **11** | RBAC permission rejection verified (`TECHNICIAN` rejected everywhere) | ✅ Passed |
| **12** | TypeScript compilation `npx tsc --noEmit` returns 0 errors | ✅ Passed |
| **13** | Full regression suite passes (174 test files, 3,197 tests passing) | ✅ Passed |
