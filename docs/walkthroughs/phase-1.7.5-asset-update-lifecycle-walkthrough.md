# Phase 1.7.5 — Asset Update & Lifecycle Service Walkthrough

## 1. Executive Summary

Phase 1.7.5 implements the update and operational lifecycle services for physical equipment:
1. [`lib/services/asset/updateAsset.ts`](../../lib/services/asset/updateAsset.ts): Updates mutable metadata, technical specifications, custom tags, and calculates a granular field-level diff for the audit log.
2. [`lib/services/asset/transitionAssetStatus.ts`](../../lib/services/asset/transitionAssetStatus.ts): Orchestrates state transitions through the 22-rule state machine, applies side-effects (e.g. location nulling on depot uninstallation, timestamps), enforces per-pair reason requirements, and records domain-specific audit events.
3. [`lib/services/asset/retireAsset.ts`](../../lib/services/asset/retireAsset.ts): Dedicated ergonomic domain wrapper for retiring equipment.

---

## 2. Service Architecture & Pipelines

### 2.1 `updateAsset()` Execution Pipeline
```
1. AUTHENTICATION & PERMISSIONS
   └─ requireWorkspaceAuthorization(workspaceId)
   └─ assertPermission(role, PERMISSIONS.ASSETS_UPDATE) (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN)

2. VALIDATION
   └─ updateAssetSchema.parse(input)
   └─ Rejects immutable fields (id, workspaceId, createdAt, status, customerId, locationId, etc.)

3. RESOLUTION & INVARIANTS
   ├─ Fetch Asset by (id, workspaceId) (404 if missing or cross-tenant)
   ├─ If status === RETIRED: reject with AssetImmutableError (409)
   └─ If categoryId changed: validate existence and ACTIVE status in workspace (404/400)

4. TECHNICIAN SCOPING RULE (§11.2)
   └─ If caller is TECHNICIAN: assert assignment to active WorkOrder (OPEN/ASSIGNED/IN_PROGRESS/ON_HOLD) targeting this asset or location.

5. ASSET NUMBER GUARD (§16)
   ├─ Only OWNER / ADMIN can modify assetNumber (403 ForbiddenError for other roles)
   └─ If WorkOrders reference assetId: reject with AssetNumberLockedError (409 ASSET_NUMBER_LOCKED)

6. ATOMIC PERSISTENCE & AUDIT DIFF
   ├─ Compute field-level diff { [field]: { oldValue, newValue } }
   ├─ tx.asset.update()
   └─ tx.assetHistory.create({ eventType: "UPDATED", metadata: { diff } })

7. CANONICAL READ MODEL
   └─ Return AssetDetailViewModel
```

### 2.2 `transitionAssetStatus()` Execution Pipeline
```
1. AUTHENTICATION & RESOLUTION
   └─ requireWorkspaceAuthorization(workspaceId)
   └─ Fetch Asset by (id, workspaceId) (404 if missing)

2. TERMINAL STATE CHECK
   └─ If status === RETIRED: reject with AssetImmutableError (409)

3. VALIDATION & STATE MACHINE LOOKUP
   ├─ transitionAssetStatusSchema.parse(input)
   ├─ Lookup rule in assetStatusTransitions (409 AssetInvalidStatusTransitionError if invalid pair)
   ├─ Verify caller role in rule.allowedRoles (403 ForbiddenError if role unauthorized)
   └─ If TECHNICIAN: enforce active WorkOrder scoping

4. STATUS REASON ENFORCEMENT
   └─ If rule.requiresReason is true and statusReason is missing/empty: throw AssetMissingStatusReasonError (422)

5. SIDE EFFECTS & EVENT TYPE RESOLUTION
   ├─ -> IN_STORAGE: set locationId = null (uninstalled from site back to depot)
   ├─ -> DECOMMISSIONED: set decommissionedAt = now(), eventType = "DECOMMISSIONED"
   ├─ DECOMMISSIONED ->: clear decommissionedAt = null, eventType = "REACTIVATED"
   ├─ -> RETIRED: set retiredAt = now(), eventType = "RETIRED"
   └─ Other operational changes: eventType = "STATUS_CHANGED"

6. ATOMIC PERSISTENCE
   ├─ tx.asset.update(status + side effects)
   └─ tx.assetHistory.create(eventType, reason, metadata)

7. CANONICAL READ MODEL
   └─ Return AssetDetailViewModel
```

---

## 3. Explicit Confirmations & Architectural Resolutions

### 3.1 `AssetNumberLockedError` Taxonomy Resolution
- **`AssetImmutableError` (`ASSET_IMMUTABLE`, 409)**: Dedicated strictly to terminal state rejections (when target equipment has status `RETIRED`).
- **`AssetNumberLockedError` (`ASSET_NUMBER_LOCKED`, 409)**: Added as a distinct error class in `lib/services/asset/assetErrors.ts`. Thrown when an `OWNER`/`ADMIN` attempts to modify an `assetNumber` after historical `WorkOrder` records have been associated with the equipment.
- **Taxonomy Delta**: `assetErrors.ts` now defines **13 Asset error classes** + **4 Category error class re-exports** (**17 total distinct domain error classes**).

### 3.2 Full 21-Transition Matrix Test Coverage
- In [`tests/asset/asset-status-transition-service.test.ts`](../../tests/asset/asset-status-transition-service.test.ts), the test `comprehensively exercises all 21 valid transitions in ASSET_STATUS_TRANSITION_RULES with correct side effects and audit event types` programmatically exercises every row of `ASSET_STATUS_TRANSITION_RULES`.
- Each transition asserts:
  1. Resulting status equals `rule.to`.
  2. `locationId` is nulled when moving `-> IN_STORAGE` from an installed status (`OPERATIONAL`, `DEGRADED`, `OUT_OF_SERVICE`), and preserved otherwise.
  3. `decommissionedAt` is set when moving `-> DECOMMISSIONED` and cleared to `null` when reactivated from `DECOMMISSIONED`.
  4. `retiredAt` is set when moving `-> RETIRED` and `null` otherwise.
  5. Exact `AssetHistoryEventType` matches (`DECOMMISSIONED`, `REACTIVATED`, `RETIRED`, or `STATUS_CHANGED`).

### 3.3 `retireAsset()` Redundancy Resolution
- `lib/services/asset/retireAsset.ts` is implemented as a thin, dedicated ergonomic domain wrapper around `transitionAssetStatus()`.
- It accepts `{ statusReason: string }` and delegates directly to `transitionAssetStatus(workspaceId, assetId, { toStatus: "RETIRED", statusReason: input.statusReason })`.

---

## 4. Verification & Validation Summary

### 4.1 Automated Test Execution Results
```
Test Files  116 passed (116)
     Tests  2069 passed (2069)
  Duration  33.75s
```

1. **TypeScript Typecheck (`npx tsc --noEmit`)**:
   - Passed with **0 errors**.
2. **Error Taxonomy Suite (`tests/asset/asset-errors.test.ts`)**:
   - 18 passed (verifies `AssetNumberLockedError`, `AssetLocationRequiresCustomerError`, etc.).
3. **Asset Update Unit Suite (`tests/asset/asset-update-service.test.ts`)**:
   - 10 tests passed (verifies `AssetNumberLockedError` on historical work orders).
4. **Asset Status Transition & Retire Unit Suite (`tests/asset/asset-status-transition-service.test.ts`)**:
   - 14 tests passed (verifies all 21 state machine transitions, side effects, role enforcement, Technician scoping, and `retireAsset()`).
