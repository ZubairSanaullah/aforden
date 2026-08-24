# Phase 1.11.3 — Quotes & Estimates Domain Types, Errors & Schemas Walkthrough

## Overview & Executive Summary

This walkthrough document validates the completed implementation of **Phase 1.11.3: Domain Types, Errors & Zod Schemas**.

- **Deliverables**:
  - Pure Domain Error Classes: [`lib/services/quote/quoteErrors.ts`](file:///d:/Download/aforden/lib/services/quote/quoteErrors.ts)
  - Canonical Read Models & Types: [`lib/services/quote/quote.types.ts`](file:///d:/Download/aforden/lib/services/quote/quote.types.ts)
  - Zod Validation Schemas: [`lib/services/quote/quote.schemas.ts`](file:///d:/Download/aforden/lib/services/quote/quote.schemas.ts)
  - Validation Re-export: [`lib/validations/quote.ts`](file:///d:/Download/aforden/lib/validations/quote.ts)
  - Central Error Mapper: [`lib/utils/quoteApiError.ts`](file:///d:/Download/aforden/lib/utils/quoteApiError.ts)
  - Unit Test Suite: [`tests/quote/quote-types-schemas-errors.test.ts`](file:///d:/Download/aforden/tests/quote/quote-types-schemas-errors.test.ts)
- **Status**: 100% Verified; 0 TypeScript errors; 162/162 test suites (2,878/2,878 tests) green.

---

## Detailed Implementation Breakdown

### 1. Pure Domain Error Classes (Convention B)
All 8 domain errors extend `Error` and carry immutable `readonly code`, `statusCode`, and `httpStatus` properties:

| Error Class | Code | HTTP Status | Description / Guard |
| :--- | :--- | :---: | :--- |
| `QuoteNotFoundError` | `QUOTE_NOT_FOUND` | 404 | Quote record does not exist in workspace. |
| `QuoteLineItemNotFoundError` | `QUOTE_LINE_ITEM_NOT_FOUND` | 404 | Line item does not exist or belong to quote. |
| `QuoteStatusConflictError` | `QUOTE_STATUS_CONFLICT` | 409 | Illegal lifecycle mutation (e.g. editing converted quote). |
| `QuoteAlreadyConvertedError` | `QUOTE_ALREADY_CONVERTED` | 409 | Attempting to convert an already converted quote. |
| `QuoteExpiredError` | `QUOTE_EXPIRED` | 422 | Attempting to approve an expired quote without revision. |
| `QuoteEmptyLineItemsError` | `QUOTE_EMPTY_LINE_ITEMS` | 422 | Attempting to send or convert quote with 0 line items. |
| `InvalidQuoteCalculationError` | `INVALID_QUOTE_CALCULATION` | 422 | Raised when line item subtotal $(quantity \times unitPrice) - discountAmount < 0$. |
| `MissingRejectionReasonError` | `MISSING_REJECTION_REASON` | 422 | Rejecting a quote without a non-empty explanation. |

### 2. Zod Validation Schemas & Step 1 Calculation Guard

- **`createQuoteSchema` / `updateQuoteSchema`**: Validates customer reference, title (1–200 chars), optional description, internal notes, terms, uppercase 3-letter `currencyCode`, `validUntil` date, `discountType` (`PERCENTAGE`/`FIXED`), `discountValue` ($\ge 0$), and `taxRate` ($0 \le rate \le 1.0$).
- **`createQuoteLineItemSchema` / `updateQuoteLineItemSchema`**:
  - Validates `lineItemType` (`LABOR`, `PART`, `EXPENSE`, `CUSTOM`), catalog references (`workTypeId`, `partId`), `name`, `quantity` ($\ge 0.01$), `unitPrice` ($\ge 0$), `unitCost` ($\ge 0$), `discountAmount` ($\ge 0$), and `taxRate` ($0 \le rate \le 1.0$).
  - **Step 1 Calculation Guard (Locked Rule §4.2)**: Enforces refinement check:
    $$(\text{quantity} \times \text{unitPrice}) - \text{discountAmount} \ge 0$$
    If subtotal would be negative, rejects validation with:
    `"Invalid quote calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative."`
- **Lifecycle Transition Schemas**:
  - `sendQuoteSchema`: Optional transmission notes.
  - `approveQuoteSchema`: Optional customer approver name and notes.
  - `rejectQuoteSchema`: Strictly enforces `rejectionReason` non-empty (1–2000 chars trimmed).
  - `convertQuoteSchema`: Optional operational overrides (workTypeId, assignedTechnicianId, title, description).
- **`listQuotesQuerySchema`**: Validates filters (`status`, `customerId`, `locationId`, search string, date bounds, amount bounds), pagination defaults (`page=1`, `limit=20`), and sort allowlist (`createdAt`, `updatedAt`, `quoteNumber`, `total`, `validUntil`, `status`).

### 3. Canonical Read Models & Types
API contracts cleanly decouple domain outputs from Prisma models:
- `QuoteReadModel`: Exposes string-formatted Decimal calculations (`subtotal`, `discountValue`, `discountAmount`, `taxRate`, `taxAmount`, `total`), embedded customer/location snippets, currency code, status, and conversion timestamps.
- `QuoteLineItemReadModel`: Exposes frozen pricing snapshots (`workTypeName`, `workTypeCode`, `partName`, `partSku`, `partUom`, `unitCost`), formatted decimal figures, and sort order.
- `QuoteHistoryReadModel`: Structured audit log entity with JSON metadata and actor details.

### 4. API Error Mapper (`lib/utils/quoteApiError.ts`)
- Maps authorization failures via `authorizationErrorResponse`.
- Maps Zod validation errors to `422 VALIDATION_ERROR` with structured field errors.
- Maps all 8 domain error classes to their explicit status codes.
- Maps JSON syntax errors to `400 INVALID_REQUEST`.
- Provides tenant workspace resolution utilities (`extractWorkspaceId`, `resolveWorkspaceId`, `extractQueryParams`).

---

## Test Suite Execution Results

Executed Vitest test suite covering error instantiation, schema boundaries, calculation guards, and error translation:

```bash
npx vitest run tests/quote/quote-types-schemas-errors.test.ts
```

Output:
```
 ✓ tests/quote/quote-types-schemas-errors.test.ts (36 tests) 45ms

 Test Files  162 passed (162)
      Tests  2878 passed (2878)
```

---

## Self-Audit Checklist

| # | Requirement | Verification | Status |
| :-: | :--- | :--- | :-: |
| **1** | **8 Domain Errors** | All 8 error classes implemented with Convention B metadata (`code`, `statusCode`, `httpStatus`). | ✅ Passed |
| **2** | **Step 1 Calculation Guard** | Line item schema rejects $(qty \times unitPrice) - discount < 0$ with `InvalidQuoteCalculationError` semantics. | ✅ Passed |
| **3** | **Rejection Guard** | `rejectQuoteSchema` enforces required, non-empty, trimmed `rejectionReason`. | ✅ Passed |
| **4** | **Query Schema** | `listQuotesQuerySchema` handles pagination defaults, sort allowlist, and status parsing. | ✅ Passed |
| **5** | **Canonical Read Models** | `QuoteReadModel`, `QuoteLineItemReadModel`, `QuoteHistoryReadModel` defined without Prisma leakage. | ✅ Passed |
| **6** | **Central Error Mapper** | `handleQuoteApiError` handles all 8 error classes, Zod, syntax, and auth errors. | ✅ Passed |
| **7** | **Zero TS Errors** | `tsc --noEmit` verified with 0 errors across entire workspace. | ✅ Passed |
| **8** | **Regression Safety** | Full test suite passed (162 test files, 2,878 tests, 100% green). | ✅ Passed |
| **9** | **Scope Discipline** | Zero services, database queries, or API routes created in this milestone. | ✅ Passed |

---

## Completion Statement & Readiness for Phase 1.11.4

Phase 1.11.3 is complete and verified.

**Next Milestone**: **Phase 1.11.4 (Calculation Engine & Pricing Snapshots)** — implementing the server-authoritative Decimal calculation utility, discount proration engine, and catalog freeze snapshot helpers.
