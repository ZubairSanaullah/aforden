# Phase 1.12.5 — Invoice Header CRUD & Numbering Services Walkthrough

## Overview & Executive Summary

This walkthrough document validates the implementation of **Phase 1.12.5: Invoice Header CRUD & Numbering Services** for the Invoicing & Payments domain, including explicit citations of test evidence for audit compliance and defensive guards.

- **Creation Service**: [`lib/services/invoice/createInvoice.ts`](file:///d:/Download/aforden/lib/services/invoice/createInvoice.ts)
- **Retrieval Service**: [`lib/services/invoice/getInvoice.ts`](file:///d:/Download/aforden/lib/services/invoice/getInvoice.ts)
- **Update Service**: [`lib/services/invoice/updateInvoice.ts`](file:///d:/Download/aforden/lib/services/invoice/updateInvoice.ts)
- **Deletion Service**: [`lib/services/invoice/deleteInvoice.ts`](file:///d:/Download/aforden/lib/services/invoice/deleteInvoice.ts)
- **Listing & Query Service**: [`lib/services/invoice/listInvoices.ts`](file:///d:/Download/aforden/lib/services/invoice/listInvoices.ts)
- **Unit & Integration Test Suite**: [`tests/invoice/invoice-header-crud-services.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-header-crud-services.test.ts)

---

## Test Evidence Citations

### 1. `deleteInvoice` Writes `eventType: DELETED` Directly (Quotes Precedent)

In Quotes (Phase 1.11.5), `deleteQuote` originally used `UPDATED` before a mid-phase correction aligned it with `eventType: DELETED`. For Invoicing, `deleteInvoice` implemented `eventType: "DELETED"` directly from the first attempt.

- **Test Suite**: [`tests/invoice/invoice-header-crud-services.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-header-crud-services.test.ts#L648-L676)
- **Test Name**: `"successfully deletes DRAFT invoice and writes DELETED history event"`
- **Lines [648–676]**:
  ```typescript
  it("successfully deletes DRAFT invoice and writes DELETED history event", async () => {
      mocks.invoiceFindFirst.mockResolvedValue({
          ...baseInvoiceRecord,
          status: "DRAFT",
          payments: [],
      });

      const result = await deleteInvoice(WS_ID, INVOICE_ID, adminActor);

      expect(result.success).toBe(true);
      expect(result.id).toBe(INVOICE_ID);

      // Verify DELETED history is written before row deletion
      expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
          expect.objectContaining({
              data: expect.objectContaining({
                  invoiceId: INVOICE_ID,
                  eventType: "DELETED",
                  actorMemberId: "mem_admin_01",
                  oldValue: "DRAFT",
                  newValue: "DELETED",
              }),
          }),
      );

      expect(mocks.invoiceDelete).toHaveBeenCalledWith({
          where: { id: INVOICE_ID },
      });
  });
  ```

---

### 2. Defensive Zero-Payments Check on `deleteInvoice`

Per the 1.12.1 state machine, payments can only be recorded against `ISSUED`, `PARTIALLY_PAID`, or `OVERDUE` invoices, meaning a `DRAFT` invoice should not have payments in normal workflows. However, `deleteInvoice` implements a defensive guard:
```typescript
if (existing.payments && existing.payments.length > 0) {
    throw new InvoiceStatusConflictError(
        "Cannot delete invoice with associated payment records.",
    );
}
```

To prove that this service-level defensive check (and not merely the `status === "DRAFT"` check) is actively guarding against data anomalies, the test suite constructs an anomalous state directly: an invoice with `status === "DRAFT"` that has associated payment records. In this state, the `status === "DRAFT"` guard passes, and the deletion is blocked *solely* by the defensive zero-payments check.

- **Test Suite**: [`tests/invoice/invoice-header-crud-services.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-header-crud-services.test.ts#L691-L703)
- **Test Name**: `"defensively blocks deletion of DRAFT invoice if payments exist"`
- **Lines [691–703]**:
  ```typescript
  it("defensively blocks deletion of DRAFT invoice if payments exist", async () => {
      // Constructing state where status is DRAFT but a payment row is present
      mocks.invoiceFindFirst.mockResolvedValue({
          ...baseInvoiceRecord,
          status: "DRAFT",
          payments: [{ id: "pay_anomaly_01" }],
      });

      await expect(deleteInvoice(WS_ID, INVOICE_ID, adminActor)).rejects.toThrow(
          InvoiceStatusConflictError,
      );
      expect(mocks.invoiceDelete).not.toHaveBeenCalled();
  });
  ```

---

## Deliverables & Service Architectures

### 1. Execution Pipeline Adherence
Every mutating service strictly adheres to the locked order:
$$\text{AUTHENTICATION} \rightarrow \text{PERMISSION} \rightarrow \text{VALIDATION} \rightarrow \text{RESOLUTION} \rightarrow \text{BUSINESS LOGIC} \rightarrow \text{PERSISTENCE}$$

### 2. Service Implementations

1. **`createInvoice(workspaceId, input, actor)`**:
   - **RBAC**: Asserts `invoices.create` permission (`OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `ACCOUNTANT`).
   - **Resolution & Tenant Scoping**: Validates `customerId` within tenant workspace; validates `locationId` belongs to customer.
   - **Currency Snapshot**: Snapshots `currencyCode` from `Workspace.defaultCurrencyCode` or input override.
   - **Deterministic Numbering**: Computes sequential reference number `INV-YYYY-XXXXXX` (e.g. `INV-2026-000001`) inside the transaction.
   - **Initial State**: Created in `DRAFT` status with `subtotal = 0.00`, `total = 0.00`, `amountDue = 0.00`, `quoteId = null`, `workOrderId = null`.
   - **Audit Trail**: Atomically writes `InvoiceHistory` with `eventType: CREATED` inside `prisma.$transaction`.

2. **`getInvoice(workspaceId, invoiceId, actor)`**:
   - **RBAC**: Asserts `invoices.view` permission.
   - **Tenant Scoping**: Lookup scoped to `workspaceId`; throws `InvoiceNotFoundError` if missing.
   - **Eager Loading**: Returns full `InvoiceReadModel` with ordered `lineItems` (`sortOrder: "asc"`), `payments` (`createdAt: "desc"`), and `history` (`createdAt: "desc"`).

3. **`updateInvoice(workspaceId, invoiceId, input, actor)`**:
   - **RBAC**: Asserts `invoices.update` permission (`OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`).
   - **Lifecycle Mutability Guard**: Restricts header modifications strictly to `DRAFT` status. Non-`DRAFT` status throws `InvoiceStatusConflictError`.
   - **Validation**: Enforces `dueDate >= issueDate` refinement.
   - **Calculation Engine Re-execution**: If `discountType`, `discountValue`, or `taxRate` changes and line items exist, recalculates line items, taxes, totals, and payment balances.
   - **Audit Trail**: Atomically writes `InvoiceHistory` with `eventType: UPDATED`.

4. **`deleteInvoice(workspaceId, invoiceId, actor)`**:
   - **RBAC**: Asserts `invoices.delete` permission (strictly restricted to `OWNER` and `ADMIN`).
   - **Lifecycle Guard**: Restricts deletion strictly to `DRAFT` status.
   - **Defensive Invariant Guard**: Explicitly checks `existing.payments.length === 0`, throwing `InvoiceStatusConflictError` if any payment records are present.
   - **Audit Trail & Deletion**: Writes `InvoiceHistory` with dedicated `eventType: DELETED` *before* hard deleting the row.

5. **`listInvoices(workspaceId, query, actor)`**:
   - **RBAC**: Asserts `invoices.view` permission.
   - **Tenant Scoping**: Scoped strictly to `where: { workspaceId }`.
   - **Filters**: `status` (single or array), `customerId`, `locationId`, `quoteId`, `workOrderId`, `overdueOnly`, date bounds (`issueDate`, `dueDate`, `createdAt`), and amount bounds (`minTotal`, `maxTotal`, `minAmountDue`, `maxAmountDue`).
   - **Search**: Case-insensitive text search on `invoiceNumber`, `title`, `notes`, customer name, customer number.
   - **Sorting**: Allowlist (`createdAt`, `updatedAt`, `invoiceNumber`, `issueDate`, `dueDate`, `total`, `amountPaid`, `amountDue`, `status`) with secondary `{ id: "asc" }` deterministic tie-breaker.
   - **Pagination Envelope**: Returns standard `{ items, total, page, limit, totalPages }`.

---

## Verification Results

1. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   # Result: 0 errors
   ```

2. **Unit & Integration Test Suite (`tests/invoice/invoice-header-crud-services.test.ts`)**:
   ```bash
   npx vitest run tests/invoice/invoice-header-crud-services.test.ts
   # Result: 23 passed (23)
   ```

3. **Invoicing Domain Tests (`tests/invoice/`)**:
   ```bash
   npx vitest run tests/invoice/
   # Result: 3 passed (97 tests passed)
   ```

4. **Full Regression Suite**:
   ```bash
   npm run test
   # Result:
   # Test Files  173 passed (173)
   # Tests       3173 passed (3173)
   ```

---

## Self-Audit Checklist

| # | Requirement | Status |
| :-: | :--- | :-: |
| **1** | Locked execution pipeline followed for all mutating services | ✅ Passed |
| **2** | Sequential `INV-YYYY-XXXXXX` numbering generated deterministically | ✅ Passed |
| **3** | `currencyCode` snapshotted from `Workspace.defaultCurrencyCode` | ✅ Passed |
| **4** | Foreign customer and location IDs rejected with domain errors | ✅ Passed |
| **5** | `DRAFT`-only mutability guard enforced on update and delete | ✅ Passed |
| **6** | Defensive zero-payments check verified on `deleteInvoice` with cited test isolation | ✅ Passed |
| **7** | `deleteInvoice` writes dedicated `eventType: DELETED` history entry before deletion (Quotes precedent cited) | ✅ Passed |
| **8** | Dynamic recalculation on update when discount or tax parameters change | ✅ Passed |
| **9** | Deterministic sorting with `{ id: "asc" }` secondary tie-breaker | ✅ Passed |
| **10** | RBAC permission matrix verified across all roles (`TECHNICIAN` rejected everywhere) | ✅ Passed |
| **11** | TypeScript compilation `npx tsc --noEmit` returns 0 errors | ✅ Passed |
| **12** | Full regression suite passes (173 test files, 3,173 tests passing) | ✅ Passed |
