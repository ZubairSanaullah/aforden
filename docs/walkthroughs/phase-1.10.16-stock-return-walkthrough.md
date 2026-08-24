# Phase 1.10.16 — Inventory & Parts: Stock Return (RETURN Movement) Walkthrough

## Overview

In **Phase 1.10.16**, the `returnStock` mutation service, `returnStockSchema` validation schema, `ExcessiveReturnError` domain error, DTO types, and unit/integration tests were implemented per Section 7.3 and Section 6.2 of the Phase 1.10.1 specification.

---

## 1. Files Created and Modified

### Domain Movement Files
- [`lib/services/inventory/movement/stockMovementErrors.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovementErrors.ts) — Added `ExcessiveReturnError` (409) and re-exported `WorkOrderPartNotFoundError`.
- [`lib/services/inventory/movement/stockMovement.types.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.types.ts) — Added `StockReturnResult` and `ReturnStockInput`.
- [`lib/services/inventory/movement/stockMovement.schemas.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.schemas.ts) — Added `returnStockSchema` (enforcing positive quantity, required `workOrderId`, and required `originalWorkOrderPartId`).
- [`lib/services/inventory/movement/returnStock.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/returnStock.ts) — Mutation service for returning previously consumed parts to stock, enforcing net-consumed ceiling guards and writing immutable `RETURN` ledger entries.
- [`lib/services/inventory/movement/index.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/index.ts) — Re-exported `returnStock`.

### Validations & Barrel Re-Exports
- [`lib/validations/stockMovement.ts`](file:///d:/Download/aforden/lib/validations/stockMovement.ts) — Re-exports `returnStockSchema`.

### Test Suite Files
- [`tests/inventory/stock-return-service.test.ts`](file:///d:/Download/aforden/tests/inventory/stock-return-service.test.ts) — 17 unit & integration tests covering partial and exact returns, `ExcessiveReturnError` rejection on over-returns, allowing inactive catalog parts, active destination location enforcement, tenant isolation across part/location/workOrder/workOrderPart, and RBAC (allowing `TECHNICIAN`, denying `ACCOUNTANT`).

---

## 2. Key Architectural Decisions & Invariants

### Permission Assignment (`PERMISSIONS.INVENTORY_RETURN`)
- `returnStock` enforces `PERMISSIONS.INVENTORY_RETURN`.
- In `rolePermissions.ts`, `INVENTORY_RETURN` includes `TECHNICIAN`, `DISPATCHER`, `MANAGER`, `ADMIN`, and `OWNER`. Field technicians can return unused parts from their work orders. `ACCOUNTANT` is denied.

### Over-Return Protection & Net-Consumed Calculation
- Returns are checked against cumulative unreturned stock:
  $$\text{netRemainingQty} = \text{WorkOrderPart.quantity} - \sum_{\text{prior RETURN movements}} \text{movement.quantity}$$
- If $\text{requestedQuantity} > \text{netRemainingQty}$, the service rejects with `ExcessiveReturnError` (409).
- The original `WorkOrderPart` remains strictly write-once and immutable (never updated on return).

### Inactive Catalog Part Permitted
- Returning parts that have since become `INACTIVE` in the catalog is permitted because the return is a physical reversal/correction of past operational usage, not creating new demand.

### Active Location Invariant
- Receiving returned inventory requires an `ACTIVE` location. Inactive locations are rejected with `InventoryLocationInactiveError` (409).

### Balance Invariant
- Returned parts increment `quantityOnHand`. `quantityReserved` is untouched (returned stock is available for future demands).

---

## 3. Verification & Regression Results

- **`npm test`**:
  - Total test files: **159 passed / 159 total** (100%)
  - Total tests: **2,789 passed / 2,789 total** (100%)
  - New tests added: **+17 tests** in `stock-return-service.test.ts`.
  - Regressions / Failures: **0**
- **`npx tsc --noEmit`**:
  - **0 TypeScript errors**
