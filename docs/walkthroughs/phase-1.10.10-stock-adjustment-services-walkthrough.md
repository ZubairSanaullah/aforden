# Phase 1.10.10 — Inventory & Parts: Stock Adjustment (ADJUSTMENT Movement) Walkthrough

## Overview

In **Phase 1.10.10**, the service layer, validation schema, DTO types, and unit/integration tests for the **Stock Adjustment (ADJUSTMENT Movement)** workflow were implemented per Section 6.2 and Section 5.5 of the Phase 1.10.1 specification.

---

## 1. Files Created and Modified

### Domain Movement Files (`lib/services/inventory/movement/`)
- [`lib/services/inventory/movement/stockMovement.types.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.types.ts) — Added `StockAdjustmentResult` and `AdjustStockInput`.
- [`lib/services/inventory/movement/stockMovement.schemas.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/stockMovement.schemas.ts) — Added `adjustStockSchema` (enforces nonzero signed quantity and mandatory reason).
- [`lib/services/inventory/movement/adjustStock.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/adjustStock.ts) — Core adjustment mutation service with on-hand floor check and signed quantity ledger recording.
- [`lib/services/inventory/movement/index.ts`](file:///d:/Download/aforden/lib/services/inventory/movement/index.ts) — Re-exported `adjustStock`.

### Validations & Barrel Re-Exports
- [`lib/validations/stockMovement.ts`](file:///d:/Download/aforden/lib/validations/stockMovement.ts) — Re-exports `adjustStockSchema`.

### Test Suite Files
- [`tests/inventory/stock-adjustment-service.test.ts`](file:///d:/Download/aforden/tests/inventory/stock-adjustment-service.test.ts) — 18 unit & integration tests covering positive/negative adjustments, on-hand floor validation, mandatory reason rejection, signed quantity preservation in the ledger, inactive location cycle counting / decommissioning, tenant isolation, and RBAC enforcement.

---

## 2. Key Architectural Decisions & Invariants

### Signed Quantity Storage for ADJUSTMENT Ledger Entries
- In contrast to `RECEIPT` and `TRANSFER` (where direction is dictated by distinct movement types `RECEIPT`, `TRANSFER_IN`, `TRANSFER_OUT` with unsigned positive quantities), a single `ADJUSTMENT` movement type covers both inventory gains (found items, physical count reconciliation) and losses (damage write-offs, shrinkage).
- `StockMovement.quantity` stores the **signed** value (e.g., `+8.5` or `-6.0`), allowing straightforward ledger summation: $\Delta \text{onHand} = \text{movement.quantity}$.

### On-Hand Floor Check vs. Availability
- For adjustments, the floor invariant is $\text{quantityOnHand} \ge 0$.
- Adjustments do not interact with work order reservations ($\text{quantityReserved}$ is untouched). Therefore, an adjustment is only rejected if it would drive total physical $\text{quantityOnHand}$ below zero.

### Inactive Location Adjustability
- Inactive locations are permitted as adjustment targets. This allows warehouse managers to true-up, write off, or zero out physical inventory counts during facility / vehicle decommissioning.

### Mandatory Reason Rule
- Unlike receipts or transfers where `reason` is optional, adjustments require a non-empty string `reason` (min 1 char after trim, max 2000) to satisfy the "No silent quantity corrections" governance principle.

### RBAC Access Matrix Confirmation
- `PERMISSIONS.INVENTORY_ADJUST` is restricted to `OWNER`, `ADMIN`, and `MANAGER`. `DISPATCHER` and `TECHNICIAN` roles are forbidden.

---

## 3. Verification & Regression Results

- **`npm test`**:
  - Total test files: **156 passed / 156 total** (100%)
  - Total tests: **2,724 passed / 2,724 total** (100%)
  - New tests added: **+18 tests** in `stock-adjustment-service.test.ts`.
  - Regressions / Failures: **0**
- **`npx tsc --noEmit`**:
  - **0 TypeScript errors**
