# Phase 1.11.2 — Quotes & Estimates Schema & Migration Walkthrough

## Overview & Executive Summary

This walkthrough document validates the implementation and database migration for **Phase 1.11.2: Prisma Schema & Database Migration**.

- **Deliverable Schema**: [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma)
- **Migration Directory**: [`prisma/migrations/20260824114458_add_quotes_and_estimates_domain/migration.sql`](file:///d:/Download/aforden/prisma/migrations/20260824114458_add_quotes_and_estimates_domain/migration.sql)
- **Status**: Migration applied successfully; Prisma Client generated; 0 TypeScript errors; 161 test suites (2,842 tests) 100% green.

---

## Schema Changes Implemented

### 1. New Enums
- **`QuoteStatus`**: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONVERTED`
- **`QuoteLineItemType`**: `LABOR`, `PART`, `EXPENSE`, `CUSTOM`
- **`QuoteDiscountType`**: `PERCENTAGE`, `FIXED`
- **`QuoteHistoryEventType`**: `CREATED`, `UPDATED`, `LINE_ITEM_ADDED`, `LINE_ITEM_UPDATED`, `LINE_ITEM_REMOVED`, `SENT`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONVERTED`, `DELETED`

### 2. Workspace Extension (Currency Baseline)
- Added `defaultCurrencyCode String @default("USD") @db.VarChar(3)` to `Workspace`.
- Added reverse relation arrays on `Workspace`: `quotes Quote[]`, `quoteLineItems QuoteLineItem[]`, `quoteHistories QuoteHistory[]`.

### 3. Core Models Added
- **`Quote`**:
  - Multi-tenant foreign key to `Workspace` (`onDelete: Cascade`).
  - Strict natural uniqueness constraint: `@@unique([workspaceId, quoteNumber])`.
  - Foreign keys to `Customer` and optional `ServiceLocation` (`onDelete: Restrict`).
  - Currency snapshot: `currencyCode String @default("USD") @db.VarChar(3)`.
  - Authoritative financial decimals: `subtotal` (12,2), `discountValue` (12,2), `discountAmount` (12,2), `taxRate` (5,4), `taxAmount` (12,2), `total` (12,2).
  - Lifecycle audit columns: `sentAt`, `approvedAt`, `approvedByCustomerName`, `rejectedAt`, `rejectionReason`, `convertedAt`, `convertedWorkOrderId`, `convertedByMemberId`.
- **`QuoteLineItem`**:
  - References parent `Quote` (`onDelete: Cascade`), `Workspace` (`onDelete: Cascade`), optional `WorkType` (`onDelete: SetNull`), and optional `Part` (`onDelete: SetNull`).
  - Frozen snapshot fields: `workTypeName`, `workTypeCode`, `partName`, `partSku`, `partUnitOfMeasure`, `unitCost`.
  - Precise decimal calculations: `quantity` (10,2), `unitPrice` (12,2), `unitCost` (12,2), `discountAmount` (12,2), `subtotal` (12,2), `taxRate` (5,4), `taxAmount` (12,2), `total` (12,2).
  - Indexed by `quoteId`, `workspaceId`, `workTypeId`, `partId`, `sortOrder`.
- **`QuoteHistory`**:
  - Captures full timeline of mutations and lifecycle transitions.
  - Links to `Quote` and `Workspace` (`onDelete: Cascade`), storing actor, field changes, and JSON metadata.

### 4. WorkOrder Provenance Extension
- Extended `WorkOrder` with `sourceQuoteId String?`.
- Added relation `sourceQuote Quote? @relation(fields: [sourceQuoteId], references: [id], onDelete: SetNull)`.
- Added index `@@index([sourceQuoteId])`.

### 5. Reverse Relations on Existing Models
- `Customer`: `quotes Quote[]`
- `ServiceLocation`: `quotes Quote[]`
- `WorkType`: `quoteLineItems QuoteLineItem[]`
- `Part`: `quoteLineItems QuoteLineItem[]`

---

## Migration & Generation Verification

1. **Schema Validation**:
   ```bash
   npx prisma validate
   # Output: The schema at prisma\schema.prisma is valid 🚀
   ```
2. **Database Migration**:
   ```bash
   npx prisma migrate dev --name add_quotes_and_estimates_domain
   # Output: Applying migration `20260824114458_add_quotes_and_estimates_domain`
   # Your database is now in sync with your schema.
   ```
3. **Prisma Client Generation**:
   ```bash
   npx prisma generate
   # Output: ✔ Generated Prisma Client (7.9.1) to .\generated\prisma in 769ms
   ```

---

## TypeScript & Test Suite Verification

1. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   # Output: 0 errors
   ```
2. **Full Test Suite Execution**:
   ```bash
   npx vitest run
   # Output:
   # Test Files  161 passed (161)
   # Tests       2842 passed (2842)
   ```

---

## Self-Audit Checklist

| # | Requirement | Verification | Status |
| :-: | :--- | :--- | :-: |
| **1** | **Enum Definitions** | `QuoteStatus`, `QuoteLineItemType`, `QuoteDiscountType`, `QuoteHistoryEventType` added. | ✅ Passed |
| **2** | **Workspace Currency Baseline** | `Workspace.defaultCurrencyCode` added with default `"USD"` for true snapshotting. | ✅ Passed |
| **3** | **Quote Model** | Matches 1.11.1 locked specification with exact decimals, indexes, and unique constraints. | ✅ Passed |
| **4** | **QuoteLineItem Model** | Includes pricing snapshots, catalog SetNull FKs, and line decimal financial fields. | ✅ Passed |
| **5** | **QuoteHistory Model** | Audit ledger with JSON metadata, actor logging, and event enum indexing. | ✅ Passed |
| **6** | **WorkOrder Extension** | `sourceQuoteId` added with `onDelete: SetNull` and index. | ✅ Passed |
| **7** | **Migration Execution** | Migration generated and applied against dev PostgreSQL database. | ✅ Passed |
| **8** | **Zero TS Errors** | `tsc --noEmit` verified with 0 errors across entire workspace. | ✅ Passed |
| **9** | **Regression Safety** | All 161 test suites (2,842 tests) from Phase 1.1–1.10 remain 100% green. | ✅ Passed |
| **10** | **Scope Discipline** | No services, Zod schemas, or API routes created in this milestone. | ✅ Passed |

---

## Completion Statement & Readiness for Phase 1.11.3

Phase 1.11.2 is complete and verified.

**Next Milestone**: **Phase 1.11.3 (Domain Types, Errors & Zod Schemas)** — defining domain read models, input DTOs, pure domain error classes, and Zod validation schemas for Quotes and Line Items.
