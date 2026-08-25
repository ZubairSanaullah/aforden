# Phase 1.12.13 — REST API Route Handlers, Hardening & Final Closure Walkthrough

## Overview

Phase 1.12.13 delivers the complete REST API route layer for the Invoicing & Payments domain, exposing all locked service capabilities from Phases 1.12.5 through 1.12.12 as strictly thin HTTP adapters.

---

## 1. REST Architecture & Endpoint Contract

### Architecture Precedent Citation
In the locked Phase 1.12.1 roadmap (§11, line 807):
`| **Phase 1.12.13** | REST API Route Handlers, Hardening & Final Closure | REST endpoints for invoices, payments, lines, conversions, error mapping, lifecycle closure. |`

The REST route layer strictly follows the architectural conventions established in **Phase 1.11.13 (Quotes REST API)**:
- **Tenant Path & Resolution**: Standardized `resolveWorkspaceId(request, pathWorkspaceId)` supporting path parameter (`/api/workspaces/[workspaceId]/...`), headers (`x-workspace-id`, `workspace-id`), and query parameters (`?workspaceId=`).
- **Thin Adapters**: Zero direct Prisma calls inside route files (`ripgrep "prisma\." app/api/workspaces/\[workspaceId\]/invoices` $\rightarrow$ 0 matches).
- **Canonical Envelope**:
  - Success: `{ success: true, data: T }`
  - Error: `{ success: false, error: { code: string, message: string, fields?: Record<string, string[]> } }`

---

## 2. Implemented Route Surface

| HTTP Method | Route Path | Service Function Invoked | Success Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/workspaces/[workspaceId]/invoices` | `listInvoices(workspaceId, query)` | `200 OK` |
| `POST` | `/api/workspaces/[workspaceId]/invoices` | `createInvoice(workspaceId, body)` | `201 Created` |
| `GET` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]` | `getInvoice(workspaceId, invoiceId)` | `200 OK` |
| `PATCH` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]` | `updateInvoice(workspaceId, invoiceId, body)` | `200 OK` |
| `DELETE` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]` | `deleteInvoice(workspaceId, invoiceId)` | `200 OK` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items` | `addInvoiceLineItem(workspaceId, invoiceId, body)` | `201 Created` |
| `PATCH` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/[lineItemId]` | `updateInvoiceLineItem(workspaceId, invoiceId, lineItemId, body)` | `200 OK` |
| `DELETE` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/[lineItemId]` | `removeInvoiceLineItem(workspaceId, invoiceId, lineItemId)` | `200 OK` |
| `PUT` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/reorder` | `reorderInvoiceLineItems(workspaceId, invoiceId, body)` | `200 OK` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/issue` | `issueInvoice(workspaceId, invoiceId)` | `200 OK` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/void` | `voidInvoice(workspaceId, invoiceId, reason)` | `200 OK` |
| `GET` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/payments` | `getInvoicePayments(workspaceId, invoiceId)` | `200 OK` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/payments` | `recordPayment(workspaceId, invoiceId, body)` | `201 Created` |
| `GET` | `/api/workspaces/[workspaceId]/payments` | `listPayments(workspaceId, query)` | `200 OK` |
| `POST` | `/api/workspaces/[workspaceId]/payments/[paymentId]/void` | `voidPayment(workspaceId, paymentId, reason)` | `200 OK` |
| `GET` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/history` | `getInvoiceHistory(workspaceId, invoiceId, undefined, query)` | `200 OK` |
| `GET` | `/api/workspaces/[workspaceId]/invoices/history` | `listInvoiceHistoryEvents(workspaceId, query)` | `200 OK` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/from-quote/[quoteId]` | `createInvoiceFromQuote(workspaceId, quoteId, body)` | `201 Created` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/from-work-order/[workOrderId]` | `createInvoiceFromWorkOrder(workspaceId, workOrderId, body)` | `201 Created` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/overdue` | `evaluateInvoiceOverdue(workspaceId)` | `200 OK` |
| `GET` | `/api/workspaces/[workspaceId]/customers/[customerId]/balance` | `getCustomerOutstandingBalance(workspaceId, customerId)` | `200 OK` |

---

## 3. Centralized HTTP Error Mapper (`handleInvoiceApiError`)

Defined in [`lib/utils/invoiceApiError.ts`](file:///d:/Download/aforden/lib/utils/invoiceApiError.ts):
- **400 Bad Request**: Missing workspace context (`MISSING_WORKSPACE`), malformed JSON syntax in body (`MALFORMED_JSON`).
- **401 Unauthorized**: Missing or invalid session credentials (`UNAUTHORIZED`).
- **403 Forbidden**: Insufficient RBAC permissions (`FORBIDDEN`).
- **404 Not Found**: `InvoiceNotFoundError`, `InvoiceLineItemNotFoundError`, `PaymentNotFoundError`, `CustomerNotFoundError`, `ServiceLocationNotFoundError`, `QuoteNotFoundError`, `WorkOrderNotFoundError`.
- **409 Conflict**: `InvoiceStatusConflictError`, `InvoiceAlreadyPaidError`, `InvoiceAlreadyVoidedError`, `PaymentAlreadyVoidedError`, `InvoiceHasActivePaymentsError`, `InvoiceTotalsMismatchError`.
- **422 Unprocessable Entity**: Zod schema validation errors (`VALIDATION_ERROR`), `OverpaymentNotAllowedError`, `InvalidPaymentAmountError`, `InvoiceEmptyLineItemsError`, `InvalidInvoiceCalculationError`, `SourceEntityNotEligibleError`, `MissingVoidReasonError`, `InvoiceDueDateInvalidError`.
- **500 Internal Server Error**: Sanitizes all unexpected runtime errors, stripping internal SQL, database URLs, and stack traces.

---

## 4. Verification Results

- **Route Integration Test Suite** (`tests/invoice/invoice-api-routes.test.ts`): **39/39 passed** (including 2 tenant isolation tests for read & write routes).
- **Invoicing Domain Test Suites** (`tests/invoice/`): **11 test files, 270 passed**.
- **Full Project Regression Suite** (`npm run test`): **181 test files, 3,346 passed**.
- **TypeScript Compilation Check** (`npx tsc --noEmit`): **0 errors**.
