# Phase 1.12.12 — Invoice & Payment Operational History Walkthrough

## Overview

Phase 1.12.12 implements the read-side operational history and audit log services for the Invoicing & Payments domain, providing:
1. `getInvoiceHistory(workspaceId, invoiceId, actor, queryInput?)`: Returns the complete chronologically sorted lifecycle audit timeline for a single invoice.
2. `listInvoiceHistoryEvents(workspaceId, filters, actor)`: Returns a workspace-wide paginated log of operational history events across all invoices with bounded cursor/page pagination and filtering by date range, `eventType`, `actorMemberId`, and `invoiceId`.

---

## 1. Locked Architecture Reference

In the locked Phase 1.12.1 roadmap (§11, line 806):
`| **Phase 1.12.12** | Invoice & Payment Operational History | `InvoiceHistory` event logging pipeline, audit timeline queries, historical field diff tracking. |`

> **Note on Service Signatures**: The 1.12.1 architecture contract defined the `InvoiceHistory` model, event types, and transactional logging pipeline (§3.5), but did not specify explicit function signatures for the query layer. The implementation follows the established query-service conventions from Phase 1.12.7 (`listInvoices`, `listPayments`) and Phase 1.11.9 (`getQuoteHistory`).

---

## 2. Implemented Services & Architectural Conventions

### 1. `getInvoiceHistory(workspaceId, invoiceId, actor, queryInput?)`
- **Location**: [`lib/services/invoice/getInvoiceHistory.ts`](file:///d:/Download/aforden/lib/services/invoice/getInvoiceHistory.ts)
- **Guard Sequence**:
  1. **AUTH**: Resolves valid tenant context.
  2. **PERMISSION**: Enforces `invoices.view` via `assertPermission`.
  3. **VALIDATION**: Validates query params (`page`, `limit`, `eventType`, `sortOrder`) against `getInvoiceHistoryQuerySchema`.
  4. **RESOLUTION**: Tenant-scoped invoice check (`InvoiceNotFoundError` if missing in authorized workspace).
  5. **SORT ORDER CONVENTION**: Defaults to chronological `"asc"` (from `CREATED` to terminal `PAID`/`VOIDED`) to render a natural top-to-bottom timeline replay for a single entity. Can be overridden to `"desc"`.
  6. **PAGINATION CONVENTION**: Matches 1.12.7 `listInvoices` offset-based pagination (`page` $\ge 1$, default 1; `limit` $1 \le \text{limit} \le 100$, default 50) returning `{ items, total, page, limit, totalPages }`.
  7. **ATTRIBUTION & MAPPING**: Uses `mapInvoiceHistoryToReadModel` to format old/new values, attribution (`"System"` for automated operations when `metadata.system === true`, `"Deleted User"` for soft-deleted members), and metadata.

### 2. `listInvoiceHistoryEvents(workspaceId, filters, actor)`
- **Location**: [`lib/services/invoice/listInvoiceHistoryEvents.ts`](file:///d:/Download/aforden/lib/services/invoice/listInvoiceHistoryEvents.ts)
- **Guard Sequence**:
  1. **AUTH**: Resolves valid tenant context.
  2. **PERMISSION**: Enforces `invoices.view` via `assertPermission`.
  3. **VALIDATION**: Parses `listInvoiceHistoryEventsQuerySchema` (rejects invalid/unknown `eventType` enums, enforces bounded pagination `limit <= 100`).
  4. **SORT ORDER CONVENTION**: Defaults to `"desc"` (matching 1.12.7 `listInvoices` and `listPayments`) to surface the latest workspace-wide operational events first.
  5. **PAGINATION CONVENTION**: Matches 1.12.7 offset-based pagination (`page`, `limit`, `total`, `totalPages`).
  6. **QUERY**: Executes bounded workspace-scoped query with filters (`invoiceId`, `eventType`, `actorMemberId`, `fromDate`/`toDate`).
  7. **MAPPING**: Maps to canonical `PaginatedInvoiceHistoryReadModel`.

---

## 3. Immutability & Mutation Verification
- **Write Path Audit**: Exact search for `.create`, `.update`, `.delete` in `getInvoiceHistory.ts` and `listInvoiceHistoryEvents.ts` confirmed **0 mutation calls**.
- **Pure Query Services**: Read-only operations that do not leak write capabilities.

---

## 4. Verification Results

### Test Suites
- **History Services Suite** (`tests/invoice/invoice-history-services.test.ts`): 11/11 passed.
- **Invoicing Domain Suite** (`tests/invoice/`): 10 test files, 231 passed.
- **Full Regression Suite** (`npm run test`): 180 test files, 3,307 passed.
