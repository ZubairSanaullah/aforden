# Phase 1.10.7 — Inventory & Parts: InventoryBalance Read Services & Lock Helper Walkthrough

## Overview

In **Phase 1.10.7**, the read-side services, query schemas, DTOs, and the internal row-level pessimistic locking helper (`lockInventoryBalance`) for the **InventoryBalance** domain were implemented per the locked specification (Sections 5.3 & 8.2 of Phase 1.10.1).

---

## 1. Files Created and Modified

### Domain Balance Files (`lib/services/inventory/balance/`)
- [`lib/services/inventory/balance/inventoryBalance.types.ts`](file:///d:/Download/aforden/lib/services/inventory/balance/inventoryBalance.types.ts) — Canonical Read Model DTOs (`InventoryBalanceDetailViewModel`, `InventoryBalanceListResult`, `GetInventoryBalancesQueryInput`).
- [`lib/services/inventory/balance/inventoryBalance.schemas.ts`](file:///d:/Download/aforden/lib/services/inventory/balance/inventoryBalance.schemas.ts) — Zod validation schemas (`getInventoryBalanceParamsSchema`, `getInventoryBalancesQuerySchema`).
- [`lib/services/inventory/balance/getInventoryBalance.ts`](file:///d:/Download/aforden/lib/services/inventory/balance/getInventoryBalance.ts) — Tenant-scoped point lookup returning actual or synthetic zero-balance view models.
- [`lib/services/inventory/balance/getInventoryBalances.ts`](file:///d:/Download/aforden/lib/services/inventory/balance/getInventoryBalances.ts) — Paginated, filterable (`partId`, `locationId`) list service with compound deterministic sort.
- [`lib/services/inventory/balance/lockInventoryBalance.ts`](file:///d:/Download/aforden/lib/services/inventory/balance/lockInventoryBalance.ts) — Internal transaction-scoped helper executing `SELECT ... FOR UPDATE` with lazy creation, concurrent race collision handling (`P2002`), and re-locking.
- [`lib/services/inventory/balance/index.ts`](file:///d:/Download/aforden/lib/services/inventory/balance/index.ts) — Barrel exports.

### Validations & Barrel Re-Exports
- [`lib/validations/inventoryBalance.ts`](file:///d:/Download/aforden/lib/validations/inventoryBalance.ts) — Re-exports from `inventoryBalance.schemas.ts`.
- [`lib/services/inventory/index.ts`](file:///d:/Download/aforden/lib/services/inventory/index.ts) — Re-exports `balance` domain from top-level inventory barrel.

### Test Suite Files
- [`tests/inventory/inventory-balance-service.test.ts`](file:///d:/Download/aforden/tests/inventory/inventory-balance-service.test.ts) — 15 unit & integration tests covering single lookup, zero balance synthesis, list filtering, tenant isolation, and lock helper concurrent race handling.

---

## 2. Key Architectural Decisions

### Synthetic Zero-Balance Model
When `getInventoryBalance` is queried for an unstocked (part, location) pair:
- It confirms that both `part` and `location` belong to the authorized workspace (throwing `PartNotFoundError` or `InventoryLocationNotFoundError` if either is missing or belongs to another tenant).
- It returns a synthetic zero-balance model:
  - `id: null`, `createdAt: null`, `updatedAt: null`
  - `quantityOnHand: 0`, `quantityReserved: 0`, `quantityAvailable: 0`
- **Reasoning**: `null` for `id` and timestamps accurately reflects that no database record exists, preventing clients from referencing phantom IDs while allowing UI/service layers to read 0 quantities without catching 404 errors.

### Transaction-Scoped Pessimistic Row Lock (`lockInventoryBalance`) & Concurrent First-Creation Safety
- Operates inside an active `Prisma.TransactionClient` (`tx`).
- Executes PostgreSQL native `SELECT * FROM "InventoryBalance" WHERE "workspaceId" = $1 AND "partId" = $2 AND "locationId" = $3 FOR UPDATE`.
- If the row does not exist, attempts to create a zero balance row (`quantityOnHand=0`, `quantityReserved=0`).
- If another concurrent transaction wins the creation race and causes a `P2002` (unique constraint collision on `[workspaceId, partId, locationId]`), `lockInventoryBalance` catches the collision and falls through to the re-lock `SELECT ... FOR UPDATE`, which waits for the winner's transaction to commit and locks the winner's row.
- If re-selection returns 0 rows (isolation issue), throws a descriptive internal error.
- Returns raw `Decimal` instances intact for downstream mutation services.

---

## 3. Verification & Regression Results

- **`npm test`**:
  - Total test files: **153 passed / 153 total** (100%)
  - Total tests: **2,666 passed / 2,666 total** (100%)
  - New tests added: **+15 tests** in `inventory-balance-service.test.ts`.
  - Regressions / Failures: **0**
- **`npx tsc --noEmit`**:
  - **0 TypeScript errors**
