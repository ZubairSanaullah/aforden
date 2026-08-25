# Phase 1.12.3 — Invoicing & Payments Domain Types, Errors & Zod Schemas Walkthrough

## Overview & Executive Summary

This walkthrough document validates the implementation of **Phase 1.12.3: Domain Types, Errors & Zod Schemas** for the Invoicing & Payments domain.

- **Errors Implementation**: [`lib/services/invoice/invoiceErrors.ts`](file:///d:/Download/aforden/lib/services/invoice/invoiceErrors.ts)
- **Domain Types & Read Models**: [`lib/services/invoice/invoice.types.ts`](file:///d:/Download/aforden/lib/services/invoice/invoice.types.ts)
- **Zod Validation Schemas**: [`lib/services/invoice/invoice.schemas.ts`](file:///d:/Download/aforden/lib/services/invoice/invoice.schemas.ts)
- **Read Model Mappers**: [`lib/services/invoice/invoiceMappers.ts`](file:///d:/Download/aforden/lib/services/invoice/invoiceMappers.ts)
- **API Error Mapper**: [`lib/utils/invoiceApiError.ts`](file:///d:/Download/aforden/lib/utils/invoiceApiError.ts)
- **Unit Test Suite**: [`tests/invoice/invoice-types-schemas-errors.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-types-schemas-errors.test.ts)

---

## Deliverables & Architecture Specifications

### 1. Pure Domain Error Classes (Convention B)
Implemented all 15 locked domain error classes as pure subclasses of `Error` with immutable `code`, `statusCode`, and `httpStatus` properties:

| Error Class | Code | HTTP Status | Purpose |
| :--- | :--- | :---: | :--- |
| `InvoiceNotFoundError` | `INVOICE_NOT_FOUND` | 404 | Target invoice not found in workspace |
| `InvoiceLineItemNotFoundError` | `INVOICE_LINE_ITEM_NOT_FOUND` | 404 | Target line item not found on invoice |
| `PaymentNotFoundError` | `PAYMENT_NOT_FOUND` | 404 | Target payment not found in workspace |
| `InvoiceStatusConflictError` | `INVOICE_STATUS_CONFLICT` | 409 | State machine transition disallowed |
| `InvoiceAlreadyPaidError` | `INVOICE_ALREADY_PAID` | 409 | Attempting to pay an already PAID invoice |
| `InvoiceAlreadyVoidedError` | `INVOICE_ALREADY_VOIDED` | 409 | Attempting to mutate/pay a VOID invoice |
| `PaymentAlreadyVoidedError` | `PAYMENT_ALREADY_VOIDED` | 409 | Attempting to void an already VOIDED payment |
| `InvoiceHasActivePaymentsError` | `INVOICE_HAS_ACTIVE_PAYMENTS` | 409 | Attempting to void/delete invoice with active payments |
| `OverpaymentNotAllowedError` | `OVERPAYMENT_NOT_ALLOWED` | 422 | Payment amount > invoice `amountDue` |
| `InvalidPaymentAmountError` | `INVALID_PAYMENT_AMOUNT` | 422 | Payment amount $\le 0$ or $> 2$ decimal places |
| `InvoiceEmptyLineItemsError` | `INVOICE_EMPTY_LINE_ITEMS` | 422 | Issuing invoice with 0 line items |
| `InvalidInvoiceCalculationError` | `INVALID_INVOICE_CALCULATION` | 422 | Line item $(quantity \times unitPrice) - discount < 0$ |
| `SourceEntityNotEligibleError` | `SOURCE_ENTITY_NOT_ELIGIBLE` | 422 | Quote not APPROVED/CONVERTED, or WorkOrder not COMPLETED |
| `MissingVoidReasonError` | `MISSING_VOID_REASON` | 422 | Void reason missing or empty on void action |
| `InvoiceDueDateInvalidError` | `INVOICE_DUE_DATE_INVALID` | 422 | Due date earlier than issue date |

### 2. Zod Validation Schemas & Refinement Guards
- **`createInvoiceSchema`**: Validates customer, title, terms, dates, and discounts. Refined with `dueDate >= issueDate` guard.
- **`createInvoiceFromQuoteSchema` & `createInvoiceFromWorkOrderSchema`**: Enforces valid source ID and `dueDate >= issueDate`.
- **`updateInvoiceSchema`**: Partial invoice updates with `dueDate >= issueDate` refinement when both dates are present.
- **`createInvoiceLineItemSchema` & `updateInvoiceLineItemSchema`**: Enforces positive quantity, non-negative prices, and the **Step 1 Calculation Guard**: line item subtotal $(quantity \times unitPrice) - discountAmount \ge 0$.
- **`voidInvoiceSchema` & `voidPaymentSchema`**: Enforces required non-empty `voidReason` string.
- **`recordPaymentSchema`**: Enforces positive payment `amount > 0` with a maximum of 2 decimal places.
- **`listInvoicesQuerySchema` & `listPaymentsQuerySchema`**: Query filtering, pagination, date ranges, and sorting.

### 3. Canonical Read Models & Mappers
- `InvoiceReadModel`, `InvoiceLineItemReadModel`, `PaymentReadModel`, and `InvoiceHistoryReadModel` provide clean API-facing interfaces without leaking Prisma Decimal or internals.
- `invoiceMappers.ts` converts all Decimal fields to formatted strings (`.toFixed(2)` / `.toFixed(4)`), Date objects to ISO 8601 strings, and handles nulls safely.

### 4. Central API Error Mapper (`handleInvoiceApiError`)
- Maps authentication/authorization errors using `authorizationErrorResponse`.
- Maps `ZodError` to `422 VALIDATION_ERROR` with structured field errors.
- Maps `SyntaxError` with body property to `400 MALFORMED_JSON`.
- Maps all 15 Invoicing domain errors to their exact locked HTTP statuses.
- Maps cross-domain not found errors (`CustomerNotFoundError`, `ServiceLocationNotFoundError`, `QuoteNotFoundError`, `WorkOrderNotFoundError`) to `404`.
- Sanitizes unexpected errors to `500 INTERNAL_SERVER_ERROR`.

---

## Verification Results

1. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   # Result: 0 errors
   ```

2. **Unit Test Suite (`tests/invoice/invoice-types-schemas-errors.test.ts`)**:
   ```bash
   npx vitest run tests/invoice/invoice-types-schemas-errors.test.ts
   # Result: 60 passed (60)
   ```

3. **Full Regression Suite**:
   ```bash
   npm run test
   # Result:
   # Test Files  171 passed (171)
   # Tests       3136 passed (3136)
   ```

---

## Self-Audit Checklist

| # | Requirement | Status |
| :-: | :--- | :-: |
| **1** | All 15 pure domain error classes implemented with locked `code`/`statusCode`/`httpStatus` | ✅ Passed |
| **2** | `createInvoiceSchema`, `createInvoiceFromQuoteSchema`, `createInvoiceFromWorkOrderSchema`, `updateInvoiceSchema` | ✅ Passed |
| **3** | Line item schemas with Step 1 $(qty \times price) - disc \ge 0$ calculation guard | ✅ Passed |
| **4** | `dueDate >= issueDate` refinement on header schemas | ✅ Passed |
| **5** | `voidInvoiceSchema` and `voidPaymentSchema` enforce non-empty `voidReason` | ✅ Passed |
| **6** | `recordPaymentSchema` enforces `amount > 0` and max 2 decimal places | ✅ Passed |
| **7** | `listInvoicesQuerySchema` and `listPaymentsQuerySchema` pagination and filtering | ✅ Passed |
| **8** | Canonical Read Models (`InvoiceReadModel`, `InvoiceLineItemReadModel`, `PaymentReadModel`, `InvoiceHistoryReadModel`) | ✅ Passed |
| **9** | Decimal-to-string and Date-to-ISO mappers in `invoiceMappers.ts` | ✅ Passed |
| **10** | Central error mapper `handleInvoiceApiError` handling all 15 domain errors, Zod, and syntax errors | ✅ Passed |
| **11** | TypeScript compilation `npx tsc --noEmit` returns 0 errors | ✅ Passed |
| **12** | Full regression suite passes (171 test files, 3,136 tests green) | ✅ Passed |
