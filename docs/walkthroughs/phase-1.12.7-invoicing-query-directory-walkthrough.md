# Phase 1.12.7 — Invoice Query & Directory Architecture Walkthrough

## Overview & Executive Summary

This walkthrough document validates the implementation of **Phase 1.12.7: Invoice Query & Directory Architecture** for the Invoicing & Payments domain.

- **Invoice Listing & Directory Service**: [`lib/services/invoice/listInvoices.ts`](file:///d:/Download/aforden/lib/services/invoice/listInvoices.ts)
- **Payments Listing Service**: [`lib/services/invoice/listPayments.ts`](file:///d:/Download/aforden/lib/services/invoice/listPayments.ts)
- **Invoice Payments Retrieval Service**: [`lib/services/invoice/getInvoicePayments.ts`](file:///d:/Download/aforden/lib/services/invoice/getInvoicePayments.ts)
- **Customer AR Summary Helper**: [`lib/services/invoice/getCustomerOutstandingBalance.ts`](file:///d:/Download/aforden/lib/services/invoice/getCustomerOutstandingBalance.ts)
- **Unit & Integration Test Suite**: [`tests/invoice/invoice-query-directory-services.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-query-directory-services.test.ts)

---

## Architectural Decisions & Disclosures

### 1. Dynamic Overdue Evaluation Filter (`isOverdue` / `overdueOnly`)
- **Decision Taken**: Dynamically evaluated in the database query via Prisma `where` clause rather than relying solely on stored status enums.
- **Implementation**:
  ```typescript
  if (query.overdueOnly || query.isOverdue) {
      where.status = { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] };
      where.dueDate = { lt: new Date() };
      where.amountDue = { gt: new Prisma.Decimal("0.00") };
  }
  ```
- **Rationale**: Immediate support is provided for overdue views even before the Phase 1.12.9 batch evaluation cron/worker (`evaluateInvoiceOverdue`) is triggered. Any invoice in `ISSUED` or `PARTIALLY_PAID` whose `dueDate` has passed with an outstanding balance will be returned immediately, ensuring complete data consistency across directory queries.

### 2. Single-Invoice Payment List Scope (`getInvoicePayments`)
- **Decision Taken**: Unpaginated list ordered by `paymentDate desc` with deterministic `{ id: "asc" }` secondary tie-breaker.
- **Rationale**: Payments per individual invoice represent a bounded collection (typically 1–5 installments). Full workspace-wide payment querying and reporting is handled via `listPayments` with pagination.

---

## Service Deliverables & Capabilities

### 1. `listInvoices(workspaceId, query, actor)`
- **RBAC**: Asserts `invoices.view` permission (`OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `ACCOUNTANT`).
- **Filters**:
  - `status`: Single enum or array of enums (`DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`).
  - `customerId`, `locationId`, `quoteId`, `workOrderId`.
  - Date ranges: `issueDate` bounds (`issueDateFrom`, `issueDateTo`), `dueDate` bounds (`dueDateFrom`, `dueDateTo`), `createdAt` bounds (`createdFrom`, `createdTo`).
  - Monetary bounds: `minTotal`, `maxTotal`, `minAmountDue`, `maxAmountDue`.
  - Overdue filter: `isOverdue` / `overdueOnly`.
- **Search**: Case-insensitive text search across `invoiceNumber`, `title`, `notes`, customer `name`, and customer `customerNumber`.
- **Sort Allowlist**: `createdAt`, `updatedAt`, `invoiceNumber`, `issueDate`, `dueDate`, `total`, `amountPaid`, `amountDue`, `status` with secondary `{ id: "asc" }` deterministic tie-breaker.
- **Pagination Envelope**: `{ items: InvoiceReadModel[], total, page, limit, totalPages }`.

### 2. `listPayments(workspaceId, query, actor)`
- **RBAC**: Asserts `payments.view` permission (`OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `ACCOUNTANT`).
- **Workspace-Level Scope**: Aggregates all payments across the entire workspace.
- **Filters**:
  - `status`: `RECORDED` or `VOIDED`.
  - `customerId`, `invoiceId`, `paymentMethod` (`CREDIT_CARD`, `DEBIT_CARD`, `ACH`, `CHECK`, `CASH`, `BANK_TRANSFER`, `FINANCING`, `OTHER`).
  - Date ranges: `paymentDate` bounds (`paymentDateFrom`, `paymentDateTo`, `startDate`, `endDate`).
  - Amount ranges: `minAmount`, `maxAmount`.
- **Search**: Case-insensitive search on `paymentNumber`, `referenceNumber`, `notes`, and customer name.
- **Sort Allowlist**: `createdAt`, `paymentDate`, `paymentNumber`, `amount`, `status` with secondary `{ id: "asc" }` deterministic tie-breaker.
- **Pagination Envelope**: `{ items: PaymentReadModel[], total, page, limit, totalPages }`.

### 3. `getInvoicePayments(workspaceId, invoiceId, actor)`
- **RBAC**: Asserts `payments.view` permission.
- **Tenant Scoping**: Verifies invoice exists in workspace; throws `InvoiceNotFoundError` if missing.
- **Result**: Returns all payments for the specific invoice ordered by `paymentDate: "desc"`, with `{ id: "asc" }` tie-breaker.

### 4. `getCustomerOutstandingBalance(workspaceId, customerId, actor)`
- **RBAC**: Asserts `invoices.view` permission.
- **Resolution**: Verifies customer exists in workspace; throws `CustomerNotFoundError` if missing.
- **Server Aggregation**: Computes sum of `amountDue` across all non-`DRAFT`, non-`VOID` invoices for the customer.
- **Result**: `{ customerId, totalOutstandingBalance, currencyCode, invoiceCount }`.

---

## Verification Results

1. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   # Result: 0 errors
   ```

2. **Query & Directory Test Suite (`tests/invoice/invoice-query-directory-services.test.ts`)**:
   ```bash
   npx vitest run tests/invoice/invoice-query-directory-services.test.ts
   # Result: 16 passed (16)
   ```

3. **Invoicing Domain Test Suites (`tests/invoice/`)**:
   ```bash
   npx vitest run tests/invoice/
   # Result: 5 passed (137 tests passed)
   ```

4. **Full Regression Suite**:
   ```bash
   npm run test
   # Result:
   # Test Files  175 passed (175)
   # Tests       3213 passed (3213)
   ```

---

## Self-Audit Checklist

| # | Requirement | Status |
| :-: | :--- | :-: |
| **1** | `listInvoices` covers full filter/search/sort matrix per 1.12.1 §10 | ✅ Passed |
| **2** | Dynamic overdue filter evaluates status in `{ISSUED, PARTIALLY_PAID, OVERDUE}`, past due date, and amountDue > 0 | ✅ Passed |
| **3** | AmountDue range bounds filter works for outstanding balance views | ✅ Passed |
| **4** | Case-insensitive multi-field search covers invoiceNumber, title, notes, customer name/number | ✅ Passed |
| **5** | Deterministic `{ id: "asc" }` secondary tie-breaker enforced on all sort operations | ✅ Passed |
| **6** | `listPayments` covers cross-invoice filtering (status, customer, invoice, paymentMethod, date, amount) | ✅ Passed |
| **7** | `getInvoicePayments` enforces tenant isolation and returns ordered payment list | ✅ Passed |
| **8** | `getCustomerOutstandingBalance` aggregates amountDue excluding DRAFT and VOID invoices | ✅ Passed |
| **9** | Foreign customer ID in AR summary helper throws `CustomerNotFoundError` | ✅ Passed |
| **10** | RBAC permission matrix verified (`TECHNICIAN` rejected across all 4 query endpoints) | ✅ Passed |
| **11** | TypeScript compilation `npx tsc --noEmit` returns 0 errors | ✅ Passed |
| **12** | Full regression suite passes (175 test files, 3,213 tests passing) | ✅ Passed |
