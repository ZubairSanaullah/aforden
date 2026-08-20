# Phase 1.7.7 — WorkOrder <-> Asset Integration Walkthrough

## 1. Executive Summary

Phase 1.7.7 safely connects the WorkOrder domain with the Asset domain through the existing `WorkOrder.assetId` relation without modifying the locked Phase 1.6 WorkOrder lifecycle or state machine:
1. **Schema Extension**: Extended `createWorkOrderSchema` and `updateWorkOrderSchema` in [`lib/validations/workOrder.ts`](../../lib/validations/workOrder.ts) with `assetId: z.string().trim().min(1).nullable().optional()`.
2. **Additive Resolution & Consistency Invariants**: Inserted asset lookup, customer/location consistency checks, and retired asset guards into [`createWorkOrder.ts`](../../lib/services/workOrder/createWorkOrder.ts) and [`updateWorkOrder.ts`](../../lib/services/workOrder/updateWorkOrder.ts).
3. **Distinct Error Classes**: Introduced `WorkOrderAssetCustomerMismatchError` and `WorkOrderAssetLocationMismatchError` in [`lib/services/workOrder/workOrderErrors.ts`](../../lib/services/workOrder/workOrderErrors.ts).
4. **Asset-Side Query Helper**: Implemented [`lib/services/asset/getAssetWorkOrders.ts`](../../lib/services/asset/getAssetWorkOrders.ts) to query all WorkOrders referencing a specific Asset with pagination, filtering, search, and role scoping.

---

## 2. Exact Insertion Points in WorkOrder Services

### 2.1 `createWorkOrder.ts`
- **Location**: Step 6.5 (immediately following WorkType operational availability validation and prior to transaction / number generation).
- **Exact Code Block**:
```typescript
// --- 6.5. Optional Asset Resolution & Consistency Checks (§9.2 & §17.3) ---
if (data.assetId) {
    const asset = await prisma.asset.findFirst({
        where: {
            id: data.assetId,
            workspaceId,
        },
    });

    if (!asset) {
        throw new AssetNotFoundError();
    }

    // Section 17.3: Retired assets are permanently blocked from new WorkOrders
    if (asset.status === "RETIRED") {
        throw new AssetImmutableError(
            "Cannot associate a work order with a retired asset.",
        );
    }

    // Section 9.2: Customer / Location Consistency Invariants
    // If the Asset is a depot asset (customerId === null), skip customer/location checks (depot deployment)
    if (asset.customerId !== null) {
        if (asset.customerId !== data.customerId) {
            throw new WorkOrderAssetCustomerMismatchError();
        }

        if (asset.locationId !== null && asset.locationId !== data.locationId) {
            throw new WorkOrderAssetLocationMismatchError();
        }
    }
}
```

### 2.2 `updateWorkOrder.ts`
- **Location**: Step 6.5 (immediately following technician scoping and prior to `updateData` assembly).
- **Exact Code Block**:
```typescript
// --- 6.5. Asset Resolution & Consistency Checks (§9.2 & §17.3) ---
if (data.assetId !== undefined && data.assetId !== null && data.assetId !== workOrder.assetId) {
    const asset = await prisma.asset.findFirst({
        where: {
            id: data.assetId,
            workspaceId,
        },
    });

    if (!asset) {
        throw new AssetNotFoundError();
    }

    if (asset.status === "RETIRED") {
        throw new AssetImmutableError(
            "Cannot associate a work order with a retired asset.",
        );
    }

    if (asset.customerId !== null) {
        if (asset.customerId !== workOrder.customerId) {
            throw new WorkOrderAssetCustomerMismatchError();
        }

        if (asset.locationId !== null && asset.locationId !== workOrder.locationId) {
            throw new WorkOrderAssetLocationMismatchError();
        }
    }
}
```

---

## 3. Explicit Architectural Confirmations & Resolutions

### 3.1 Customer-Mismatch vs Location-Mismatch Error Classes
- **Decision**: Created two separate domain error classes:
  1. `WorkOrderAssetCustomerMismatchError` (`WORK_ORDER_ASSET_CUSTOMER_MISMATCH`, 422)
  2. `WorkOrderAssetLocationMismatchError` (`WORK_ORDER_ASSET_LOCATION_MISMATCH`, 422)
- **Rationale**: In accordance with the taxonomy distinctness principle (1.7.4–1.7.6), separating customer and location mismatches prevents overloading error codes, allowing API callers to clearly discern whether a conflict is an ownership mismatch or a facility location mismatch.

### 3.2 Depot-Asset Consistency Check Exemption
- **Confirmation**: Confirmed. If `asset.customerId === null` (depot standby equipment in storage), customer and location consistency checks are skipped. This allows a technician/dispatcher to deploy depot equipment directly to any job regardless of customer or site.

### 3.3 RETIRED Asset Guard
- **Confirmation**: Confirmed per Section 17.3. Associating a new or existing WorkOrder with an asset in `RETIRED` status throws `AssetImmutableError` (409) (`"Cannot associate a work order with a retired asset."`).

### 3.4 `assetId` Mutability on Update
- **Decision**: `assetId` is mutable during update (`updateWorkOrder`).
- **Justification**: Unlike `customerId` and `locationId` (which represent immutable work-order contract boundaries established at intake), `assetId` represents equipment identification that may be initially unknown and linked later during diagnostic dispatch, or cleared (`assetId: null`). When mutated, `assetId` is rigorously validated against the work order's existing `customerId` and `locationId`.

### 3.5 WorkOrder REST Route Pass-Through
- **Confirmation**: Confirmed. Existing routes (`POST /api/work-orders` and `PATCH /api/work-orders/[workOrderId]`) pass request payloads directly to `createWorkOrder` / `updateWorkOrder`. Extending the Zod schemas automatically enables `assetId` payload handling across all endpoints without altering route controller code.

---

## 4. Verification & Validation Summary

| Test Suite / Area | Tests Passed | Status | Notes |
| :--- | :---: | :---: | :--- |
| **`npx tsc --noEmit`** | — | ✅ PASS | 0 TypeScript compilation errors |
| **WorkOrder <-> Asset Integration Tests** | 17 | ✅ PASS | Validates creation/update consistency, depot bypass, retired guard, IDOR, `getAssetWorkOrders` |
| **Asset Domain Tests (`tests/asset/*`)** | 171 | ✅ PASS | 12 test files passed with 0 failures |
| **WorkOrder Regression Suite (`tests/work-order/*`)** | 254 | ✅ PASS | 10 test files passed 100% unchanged |
