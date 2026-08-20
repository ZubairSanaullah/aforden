# Phase 1.7.6 — Asset Customer & Location Relationship Management Walkthrough

## 1. Executive Summary

Phase 1.7.6 implements the physical location movement and cross-customer ownership transfer domain services for equipment:
1. [`lib/services/asset/transferAssetLocation.ts`](../../lib/services/asset/transferAssetLocation.ts): Moves equipment between `ServiceLocation` entities under the same `Customer`, enforcing parity, moveable-state invariants, and auditing with `LOCATION_TRANSFERRED`.
2. [`lib/services/asset/transferAssetOwnership.ts`](../../lib/services/asset/transferAssetOwnership.ts): Reassigns equipment to a target `Customer` and optionally sets a new `ServiceLocation` under that customer (or nulls it), while preserving historical `WorkOrder` integrity under the Snapshot Rule and auditing with `OWNERSHIP_TRANSFERRED`.

---

## 2. Service Architecture & Execution Pipelines

### 2.1 `transferAssetLocation()` Execution Pipeline
```
1. AUTHENTICATION & PERMISSIONS
   ├─ requireWorkspaceAuthorization(workspaceId)
   ├─ assertPermission(role, PERMISSIONS.ASSETS_TRANSFER)
   └─ Hard rejection of TECHNICIAN callers (ForbiddenError 403, no scoping exception)

2. VALIDATION
   └─ transferAssetLocationSchema.parse(input) (requires destination locationId and non-empty transferReason)

3. RESOLUTION & INVARIANTS
   ├─ Fetch Asset by (id, workspaceId) (404 if missing or cross-tenant)
   ├─ Moveable State Checks:
   │    ├─ If status === RETIRED -> AssetImmutableError (409)
   │    └─ If status === DECOMMISSIONED -> AssetDecommissionedTransferError (409)
   ├─ Depot Rule: If customerId === null -> AssetLocationRequiresCustomerError (422)
   └─ Fetch destination ServiceLocation:
        ├─ 404 AssetLocationNotFoundError if missing
        └─ 422 AssetLocationCustomerMismatchError if destination.customerId !== asset.customerId

4. NO-OP GUARD
   └─ If destination.id === asset.locationId and subLocationNotes unchanged -> return current view model (zero DB writes)

5. ATOMIC PERSISTENCE
   ├─ tx.asset.update({ locationId, subLocationNotes })
   └─ tx.assetHistory.create({ eventType: "LOCATION_TRANSFERRED", metadata: { fromLocationId, toLocationId, ... }, reason })

6. CANONICAL READ MODEL
   └─ Return AssetDetailViewModel
```

### 2.2 `transferAssetOwnership()` Execution Pipeline
```
1. AUTHENTICATION & PERMISSIONS
   ├─ requireWorkspaceAuthorization(workspaceId)
   ├─ assertPermission(role, PERMISSIONS.ASSETS_TRANSFER)
   └─ Hard rejection of TECHNICIAN callers (ForbiddenError 403)

2. VALIDATION
   └─ transferAssetOwnershipSchema.parse(input) (requires target customerId, optional locationId, non-empty transferReason)

3. RESOLUTION & INVARIANTS
   ├─ Fetch Asset by (id, workspaceId) (404 if missing)
   ├─ Moveable State Checks:
   │    ├─ If status === RETIRED -> AssetImmutableError (409)
   │    └─ If status === DECOMMISSIONED -> AssetDecommissionedTransferError (409)
   ├─ Resolve target Customer:
   │    ├─ 404 AssetCustomerNotFoundError if missing
   │    └─ 400 AssetCustomerInactiveError if status !== ACTIVE
   └─ Resolve destination Location (if provided):
        ├─ 404 AssetLocationNotFoundError if missing
        ├─ 422 AssetLocationCustomerMismatchError if location.customerId !== targetCustomer.id
        └─ If omitted: destinationLocationId = null

4. SNAPSHOT RULE INTEGRITY (Section 4.2)
   └─ Zero updates to WorkOrder rows (historical work orders remain bound to historical customerId/locationId)

5. ATOMIC PERSISTENCE
   ├─ tx.asset.update({ customerId, locationId: destinationLocationId, subLocationNotes })
   └─ tx.assetHistory.create({ eventType: "OWNERSHIP_TRANSFERRED", metadata: { fromCustomerId, toCustomerId, fromLocationId, toLocationId }, reason })

6. CANONICAL READ MODEL
   └─ Return AssetDetailViewModel
```

---

## 3. Explicit Architectural Resolutions

### 3.1 Depot-Asset Location Transfer Interpretation
- Per Section 4.1, `transferAssetLocation` operates exclusively on equipment that already has an assigned customer (`customerId !== null`).
- Depot assets (`customerId === null`, `locationId === null`, `status: IN_STORAGE`) cannot receive a service location directly through `transferAssetLocation()` because Invariant 2 (Depot Rule, §3.2) dictates that an asset without a customer cannot have a location.
- Attempting to call `transferAssetLocation()` on a depot asset explicitly throws `AssetLocationRequiresCustomerError` (`ASSET_LOCATION_REQUIRES_CUSTOMER`, 422). Depot assets must be assigned to a customer via `transferAssetOwnership()` before or alongside location placement.

### 3.2 DECOMMISSIONED State Transfer Error Resolution
- Per Section 4.1 validation rule 2 & Section 4.2 validation rule 3, assets in `DECOMMISSIONED` status cannot be moved or transferred to a new owner without first being reactivated.
- To prevent error taxonomy collapse and overloading `AssetImmutableError` (which is reserved exclusively for the terminal `RETIRED` state), we created `AssetDecommissionedTransferError` (`ASSET_DECOMMISSIONED_TRANSFER`, 409).

### 3.3 No-op Same-Location Transfer Decision
- When `destination.id === asset.locationId` and `subLocationNotes` are unchanged:
- The service returns the current canonical `AssetDetailViewModel` immediately without executing redundant database writes or creating meaningless audit records.

### 3.4 WorkOrder Snapshot Rule Verification
- `transferAssetOwnership` does NOT touch historical `WorkOrder` records.
- Verified via unit test: preexisting `WorkOrder` records referencing the asset retain their historical `customerId` and `locationId` after ownership transfer completes.

---

## 4. Verification & Validation Summary

| Test Suite / Check | Results | Notes |
| :--- | :---: | :--- |
| **`npx tsc --noEmit`** | ✅ PASS | 0 TypeScript compilation errors |
| **`tests/asset/asset-errors.test.ts`** | ✅ PASS | 19 tests passed (validates `AssetDecommissionedTransferError`, `AssetNumberLockedError`, `AssetLocationRequiresCustomerError`) |
| **`tests/asset/asset-transfer-service.test.ts`** | ✅ PASS | 18 tests passed (validates both transfer services, RBAC, no-ops, IDOR, Snapshot Rule) |
| **All Asset Domain Tests (`tests/asset/*`)** | ✅ PASS | **11 test files passed (154 tests, 0 failures)** |
| **Full Repository Test Suite** | ✅ PASS | **117 test files passed (2,088 tests, 0 failures)** |
