# Phase 1.10.9 — Inventory & Parts: Stock Transfer (TRANSFER_OUT / TRANSFER_IN) Walkthrough

## Overview

In **Phase 1.10.9**, the service layer, validation schema, domain error classes, DTO types, and integration tests for the **Stock Transfer (TRANSFER_OUT / TRANSFER_IN)** workflow were implemented per Section 6.2 and Section 8.2.3 of the Phase 1.10.1 specification.

---

## 1. Files Created and Modified

### Domain Movement Files (`lib/services/inventory/movement/`)
- [`lib/services/inventory/movement/stockMovementErrors.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovementErrors.ts) — Added `TransferSameLocationError` (422) and `InsufficientStockError` (409).
- [`lib/services/inventory/movement/stockMovement.types.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.types.ts) — Added `StockTransferResult` and `TransferStockInput`.
- [`lib/services/inventory/movement/stockMovement.schemas.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.schemas.ts) — Added `transferStockSchema`.
- [`lib/services/inventory/movement/transferStock.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/transferStock.ts) — Core transfer mutation service with deterministic lock ordering and atomic paired ledger generation.
- [`lib/services/inventory/movement/index.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/index.ts) — Re-exported `transferStock`.

### Validations & Barrel Re-Exports
- [`lib/validations/stockMovement.ts`](file:///d:/Download/aforden/lib/validations/stockMovement.ts) — Re-exports `transferStockSchema`.

### Test Suite Files
- [`tests/inventory/stock-transfer-service.test.ts`](file:///d:/Download/aforden/tests/inventory/stock-transfer-service.test.ts) — 23 unit & integration tests covering positive/negative validations, inactive entity guards, stock availability checks (considering reservations), paired movement creation, RBAC (including Dispatcher role), and deterministic lock ordering verification.

---

## 2. Key Architectural Invariants & Deadlock Prevention

### Deterministic Lock Ordering (Section 8.2.3)
To prevent circular deadlocks between concurrent transfers in opposite directions (e.g., Transaction 1 moving A $\rightarrow$ B while Transaction 2 moves B $\rightarrow$ A):
```typescript
// Sort location IDs lexicographically before acquiring locks
const sortedLocationIds = [data.fromLocationId, data.toLocationId].sort((a, b) =>
    a.localeCompare(b),
);
const firstLocId = sortedLocationIds[0];
const secondLocId = sortedLocationIds[1];

// Always acquire row locks in sorted order
const lock1 = await lockInventoryBalance(tx, workspaceId, data.partId, firstLocId);
const lock2 = await lockInventoryBalance(tx, workspaceId, data.partId, secondLocId);
```
- The test suite explicitly verified that whether transferring A $\rightarrow$ Z or Z $\rightarrow$ A, `lockInventoryBalance` is always called with `loc_aaa_warehouse` first, then `loc_zzz_vehicle`.

### Asymmetric Inactive Status Check
- **Source Location (`fromLocationId`)**: Only existence in workspace is verified; `INACTIVE` status is NOT rejected. This allows decommissioning a facility/van by transferring its remaining inventory out.
- **Destination Location (`toLocationId`)**: Must be `ACTIVE`. Inactive destinations reject the transfer with `InventoryLocationInactiveError` (409).

### Stock Availability Validation (Considering Reservations)
- Verified available stock: $\text{quantityOnHand} - \text{quantityReserved} \ge \text{requestedQuantity}$.
- If reservations reduce available stock below the requested transfer quantity, `InsufficientStockError` (409) is thrown.

### Paired Ledger Entries
- Inside the atomic transaction, creates both:
  1. `TRANSFER_OUT`: `locationId = fromLocationId`, `fromLocationId`, `toLocationId`
  2. `TRANSFER_IN`: `locationId = toLocationId`, `fromLocationId`, `toLocationId`
- Both records carry the full `fromLocationId` and `toLocationId` context and snapshot unit cost.

### RBAC Access Matrix Confirmation
- `PERMISSIONS.INVENTORY_TRANSFER` includes `OWNER`, `ADMIN`, `MANAGER`, and `DISPATCHER`. `TECHNICIAN` is denied.

---

## 3. Verification & Regression Results

- **`npm test`**:
  - Total test files: **155 passed / 155 total** (100%)
  - Total tests: **2,706 passed / 2,706 total** (100%)
  - New tests added: **+23 tests** in `stock-transfer-service.test.ts`.
  - Regressions / Failures: **0**
- **`npx tsc --noEmit`**:
  - **0 TypeScript errors**
