# Phase 1.10.11–1.10.13 — Inventory & Parts: Stock Reservation & Release (RESERVATION / RELEASE) Walkthrough

## Overview

In **Phase 1.10.11–1.10.13**, the service functions, schemas, DTOs, and unit/integration tests for the **Stock Reservation (`reserveStock`)** and **Stock Release (`releaseStock`)** workflows were implemented per Sections 5.5 and 6.2 of the Phase 1.10.1 specification.

---

## 1. Files Created and Modified

### Domain Movement Files (`lib/services/inventory/movement/`)
- [`lib/services/inventory/movement/stockMovement.types.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.types.ts) — Added `StockReservationResult`, `StockReleaseResult`, `ReserveStockInput`, and `ReleaseStockInput`.
- [`lib/services/inventory/movement/stockMovement.schemas.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.schemas.ts) — Added `reserveStockSchema` and `releaseStockSchema`.
- [`lib/services/inventory/movement/reserveStock.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/reserveStock.ts) — Mutation service for reserving stock with on-hand floor check ($quantityReserved \le quantityOnHand$) and active location guard.
- [`lib/services/inventory/movement/releaseStock.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/releaseStock.ts) — Mutation service for releasing stock with non-negative reservation floor check ($quantityReserved \ge 0$) and decommissioning exception for inactive locations.
- [`lib/services/inventory/movement/index.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/index.ts) — Re-exported `reserveStock` and `releaseStock`.

### Validations & Barrel Re-Exports
- [`lib/validations/stockMovement.ts`](file:///d:/Download/aforden/lib/validations/stockMovement.ts) — Re-exports `reserveStockSchema` and `releaseStockSchema`.

### Test Suite Files
- [`tests/inventory/stock-reservation-service.test.ts`](file:///d:/Download/aforden/tests/inventory/stock-reservation-service.test.ts) — 26 unit & integration tests covering positive/negative validations, on-hand cap enforcement ($reserved \le onHand$), reservation floor checks ($release \le reserved$), opposite inactive location defaults, tenant isolation, and RBAC enforcement.

---

## 2. Key Architectural Decisions & Invariants

### Permissions Architecture
- Both `reserveStock` and `releaseStock` enforce the dedicated permission `PERMISSIONS.INVENTORY_RESERVE`.
- In `lib/services/authorization/rolePermissions.ts`, `INVENTORY_RESERVE` is granted to `OWNER`, `ADMIN`, `MANAGER`, and `DISPATCHER` roles, and denied to `TECHNICIAN` and `ACCOUNTANT`.

### Inactive Location Behavior (Opposite Defaults)
- **`reserveStock`**: Strictly requires an `ACTIVE` location. Inactive locations throw `InventoryLocationInactiveError` (409) because new commitments cannot be made against decommissioned locations.
- **`releaseStock`**: Permits inactive locations without throwing `InventoryLocationInactiveError`. This allows warehouse managers and dispatchers to clear and release remaining commitments during location decommissioning.

### Floor Guards
- **`reserveStock`**: $newReserved = currentReserved + quantity$. Throws `InsufficientStockError` (409) if $newReserved > currentOnHand$.
- **`releaseStock`**: $newReserved = currentReserved - quantity$. Throws `InsufficientStockError` (409) if $newReserved < 0$ (cannot release more than currently reserved).

### Ledger Stored Quantity Convention
- `StockMovement.quantity` stores the positive magnitude ($> 0$), with `movementType = RESERVATION` and `movementType = RELEASE` unambiguously dictating the positive vs. negative reservation delta. This matches the platform convention used by `RECEIPT`, `TRANSFER_IN`, `TRANSFER_OUT`, `CONSUMPTION`, and `RETURN`.

---

## 3. Verification & Regression Results

- **`npm test`**:
  - Total test files: **157 passed / 157 total** (100%)
  - Total tests: **2,750 passed / 2,750 total** (100%)
  - New tests added: **+26 tests** in `stock-reservation-service.test.ts`.
  - Regressions / Failures: **0**
- **`npx tsc --noEmit`**:
  - **0 TypeScript errors**
