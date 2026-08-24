# Phase 1.10.14–1.10.15 — Inventory & Parts: Stock Consumption & WorkOrderPart Read Models Walkthrough

## Overview

In **Phase 1.10.14–1.10.15**, the service function `consumeStock`, schema `consumeStockSchema`, DTO types, the `WorkOrderPart` query services (`getWorkOrderPart`, `getWorkOrderParts`), and unit/integration tests were implemented per Section 7 and Section 6.2 of the Phase 1.10.1 specification.

---

## 1. Files Created and Modified

### Domain Movement & WorkOrderPart Files
- [`lib/services/inventory/movement/stockMovementErrors.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovementErrors.ts) — Re-exported `WorkOrderNotFoundError`.
- [`lib/services/inventory/movement/stockMovement.types.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.types.ts) — Added `StockConsumptionResult` and `ConsumeStockInput`.
- [`lib/services/inventory/movement/stockMovement.schemas.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.schemas.ts) — Added `consumeStockSchema` (enforcing required `workOrderId`).
- [`lib/services/inventory/movement/consumeStock.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/consumeStock.ts) — Mutation service fulfilling reservations, decrementing both `quantityOnHand` and `quantityReserved`, and creating both `WorkOrderPart` snapshot and `StockMovement` ledger entries.
- [`lib/services/inventory/workOrderPart/workOrderPart.types.ts`](file:///d:/Download/aforden/lib/services/inventory/workOrderPart/workOrderPart.types.ts) — Presentation view models with ledger-derived `netQuantityConsumed`.
- [`lib/services/inventory/workOrderPart/workOrderPartErrors.ts`](file:///d:/Download/aforden/lib/services/inventory/workOrderPart/workOrderPartErrors.ts) — Added `WorkOrderPartNotFoundError` (404).
- [`lib/services/inventory/workOrderPart/getWorkOrderPart.ts`](file:///d:/Download/aforden/lib/services/inventory/workOrderPart/getWorkOrderPart.ts) — Single `WorkOrderPart` query computing net consumption factoring in returns.
- [`lib/services/inventory/workOrderPart/getWorkOrderParts.ts`](file:///d:/Download/aforden/lib/services/inventory/workOrderPart/getWorkOrderParts.ts) — Paginated list query for `WorkOrderPart` records.
- [`lib/services/inventory/workOrderPart/index.ts`](file:///d:/Download/aforden/lib/services/inventory/workOrderPart/index.ts) — WorkOrderPart barrel exports.
- [`lib/services/inventory/movement/index.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/index.ts) — Re-exported `consumeStock`.
- [`lib/services/inventory/index.ts`](file:///d:/Download/aforden/lib/services/inventory/index.ts) — Re-exported `workOrderPart`.

### Test Suite Files
- [`tests/inventory/stock-consumption-service.test.ts`](file:///d:/Download/aforden/tests/inventory/stock-consumption-service.test.ts) — 21 unit & integration tests covering positive consumption, strict reservation fulfillment, floor checks, inactive location rejection, required `workOrderId`, write-once catalog/financial snapshots, `WorkOrderPart` read model queries with net quantity computation, tenant isolation, and RBAC (allowing `TECHNICIAN`, denying `ACCOUNTANT`).

---

## 2. Key Architectural Decisions & Invariants

### RBAC Persona & Permission Mapping
- `consumeStock` enforces `PERMISSIONS.INVENTORY_CONSUME`.
- In `rolePermissions.ts`, `INVENTORY_CONSUME` includes `TECHNICIAN`, `DISPATCHER`, `MANAGER`, `ADMIN`, and `OWNER`. This enables field technicians to record parts used on job sites. `ACCOUNTANT` is denied.

### Strict Reservation Fulfillment Model
- Fulfilling a reservation decrements **both** `quantityOnHand` and `quantityReserved` by `quantity`.
- **Floor Guards**:
  - `newOnHand < 0` $\rightarrow$ throws `InsufficientStockError` ("Cannot consume stock exceeding physical quantity on hand").
  - `newReserved < 0` $\rightarrow$ throws `InsufficientStockError` ("Cannot consume stock exceeding reserved quantity").

### Operational Pull & Location Active Check
- Consumption is an operational pull from active stock, not cleanup. Therefore, `consumeStock` strictly requires the `InventoryLocation` to be `ACTIVE`. Inactive locations throw `InventoryLocationInactiveError` (409).

### Write-Once Snapshot on WorkOrderPart
- `WorkOrderPart` captures a permanent immutable snapshot: `unitCostAtTimeOfUse`, `partName`, `partSku`, `unitOfMeasure`, and `consumedByMemberId`.
- The entity has no `updatedAt` field per Section 7.1.

### Ledger-Derived Net Quantity Calculation
- Returns do not mutate `WorkOrderPart.quantity`. The read model dynamically calculates:
  $$\text{netQuantityConsumed} = \text{WorkOrderPart.quantity} - \sum_{\text{RETURN movements}} \text{movement.quantity}$$

---

## 3. Verification & Regression Results

- **`npm test`**:
  - Total test files: **158 passed / 158 total** (100%)
  - Total tests: **2,771 passed / 2,771 total** (100%)
  - New tests added: **+21 tests** in `stock-consumption-service.test.ts`.
  - Regressions / Failures: **0**
- **`npx tsc --noEmit`**:
  - **0 TypeScript errors**
