# Phase 1.10.17 — Inventory & Parts: Reusable Query Services Walkthrough

## Overview

In **Phase 1.10.17**, the 5 cross-cutting read-layer query services were established with tenant isolation, deterministic compound sorting, pagination, and RBAC enforcement.

---

## 1. Services Summary

| Query Service | Purpose & Filters | Auth / Permission | Read Model / Features |
|---|---|---|---|
| **`listParts`** (`getParts`) | Paginated part catalog; filters by `status`, `unitOfMeasure`, `search` (name, SKU, description); sorting options. | `PERMISSIONS.PARTS_VIEW` / `INVENTORY_VIEW` | `PartListResult` |
| **`listInventoryBalances`** (`getInventoryBalances`) | Paginated inventory balances; filters by `partId`, `locationId`. | `PERMISSIONS.INVENTORY_VIEW` | `InventoryBalanceListResult` with computed `quantityAvailable` ($quantityOnHand - quantityReserved$). |
| **`listStockMovements`** | Complete ledger query; filterable by `partId`, `locationId` (OR condition on `locationId`, `fromLocationId`, `toLocationId`), `movementType`, `workOrderId`, `originalWorkOrderPartId`, `actorMemberId`, date range (`startDate`, `endDate`). Sorted `createdAt: "desc"` by default. | `PERMISSIONS.INVENTORY_VIEW` | `StockMovementListResult` |
| **`listReservations`** | Active stock reservations query (`quantityReserved > 0`); filters by `partId`, `locationId`. | `PERMISSIONS.INVENTORY_VIEW` | `InventoryBalanceListResult` |
| **`listTechnicianStock`** | Van/technician stock balances scoped to `InventoryLocation`s matching `technicianProfileId`. | `PERMISSIONS.INVENTORY_VIEW` | `InventoryBalanceListResult` |

---

## 2. Key Architectural Decisions

### `listReservations` Approach Justification
- **Approach Chosen**: Balances with `quantityReserved > 0`.
- **Justification**: In this transactional inventory system, `InventoryBalance.quantityReserved` is the materialized, authoritative state of currently reserved parts. Querying balances with `quantityReserved > 0` provides instant, indexed $O(1)$ reads of committed reservations per `(partId, locationId)` without requiring expensive aggregate scans over the entire `StockMovement` ledger table.

### `listTechnicianStock` Location Link
- Scopes query directly through `InventoryLocation.technicianProfileId` (the locked schema foreign key from Phase 1.10.2), finding all assigned locations and fetching their active balances.

---

## 3. Verification & Regression Results

- **`npm test`**:
  - Total test files: **160 passed / 160 total** (100%)
  - Total tests: **2,803 passed / 2,803 total** (100%)
  - New tests: **+14 tests** in `tests/inventory/inventory-query-services.test.ts`
  - Failures / Regressions: **0**
- **`npx tsc --noEmit`**:
  - **0 TypeScript errors**
