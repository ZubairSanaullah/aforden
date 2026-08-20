# Phase 1.7.4 — Asset Creation Service Walkthrough

## 1. Executive Summary

Phase 1.7.4 implements the asset registration service `createAsset()` in [`lib/services/asset/createAsset.ts`](../../lib/services/asset/createAsset.ts).

The service strictly adheres to the locked execution pipeline from Phase 1.7.1:
$$\text{AUTHENTICATION} \longrightarrow \text{PERMISSION} \longrightarrow \text{VALIDATION} \longrightarrow \text{RESOLUTION} \longrightarrow \text{BUSINESS RULES} \longrightarrow \text{PERSISTENCE} \longrightarrow \text{CANONICAL READ MODEL}$$

All functionality is verified with unit tests and a live PostgreSQL concurrency & transaction atomicity test suite.

---

## 2. Implementation Pipeline

```
1. AUTHENTICATION
   └─ requireWorkspaceAuthorization(workspaceId)
      └─ Asserts active session, active user status, and active workspace membership.

2. PERMISSION
   └─ assertPermission(membership.role, PERMISSIONS.ASSETS_CREATE)
      └─ Allowed roles: OWNER, ADMIN, MANAGER, DISPATCHER. (TECHNICIAN / ACCOUNTANT rejected with 403 Forbidden).

3. VALIDATION
   └─ createAssetSchema.parse(input)
      └─ Rejects unknown fields (.strict()), validates name (1-200 chars), tags (max 20), metadata (depth <= 2, size <= 32KB).

4. RESOLUTION & INVARIANTS
   ├─ Customer: If customerId provided, assert existence and ACTIVE status (404/400).
   ├─ Location: If locationId provided, assert existence in workspace (404).
   ├─ Parity Rule (Invariant 1): If customerId & locationId present, assert location.customerId === customerId (422 AssetLocationCustomerMismatchError).
   ├─ Depot Rule (Invariant 2): If customerId is null and locationId provided, reject with AssetLocationRequiresCustomerError (422 ASSET_LOCATION_REQUIRES_CUSTOMER).
   └─ Category: If categoryId provided, assert existence and ACTIVE status (404/400).

5. BUSINESS RULES
   ├─ Status Defaulting:
   │  ├─ If caller specified status: use explicit status.
   │  ├─ If customerId & locationId present (installed): defaults to OPERATIONAL.
   │  └─ If customerId & locationId null (depot inventory): defaults to IN_STORAGE.
   └─ Asset Number:
      ├─ If explicit: assert workspace uniqueness (409 on collision).
      └─ If omitted: auto-generate AST-XXXXXX sequence with concurrency-safe retry on P2002.

6. PERSISTENCE (Single Atomic Prisma Transaction)
   ├─ Asset.create({ ... })
   └─ AssetHistory.create({ eventType: "CREATED", actorUserId: session.userId, actorRole: session.role, ... })
   └─ Atomic Rollback Guarantee: If either write fails, the entire transaction is rolled back.

7. CANONICAL READ MODEL
   └─ Returns AssetDetailViewModel with nested summaries for customer, location, and category.
```

---

## 3. Explicit Confirmations & Architectural Resolutions

### 3.1 Depot Rule: Dedicated Error Code Resolution (`AssetLocationRequiresCustomerError`)
- **Invariant 1 (`ASSET_LOCATION_CUSTOMER_MISMATCH`)**: Thrown when `location.customerId !== customerId` (a customer is provided, but the location belongs to a different customer).
- **Invariant 2 (`ASSET_LOCATION_REQUIRES_CUSTOMER`)**: To prevent error ambiguity, a dedicated error class `AssetLocationRequiresCustomerError` (HTTP 422, code `"ASSET_LOCATION_REQUIRES_CUSTOMER"`) was added to `lib/services/asset/assetErrors.ts`. It is thrown whenever `locationId` is provided without a `customerId` (unassigned depot equipment).
- **Taxonomy Delta Note**: `assetErrors.ts` now defines 12 Asset error classes + 4 Category error class re-exports (16 total distinct domain error classes across the combined Asset & Category taxonomy).

### 3.2 Default Operational Status for Depot Assets
- In Phase 1.7.1 Section 2.1, `OPERATIONAL` denotes equipment physically installed on customer site, while `IN_STORAGE` denotes uninstalled depot inventory.
- `createAsset()` detects whether the caller explicitly supplied a `status` in the request body:
  - If `status` was omitted and the asset is unassigned depot equipment (`customerId` and `locationId` both null), `status` defaults to `IN_STORAGE`.
  - If `status` was omitted and the asset is assigned to customer and location, `status` defaults to `OPERATIONAL`.
  - If the client explicitly provided a `status` in the payload (e.g. `{ status: "IN_STORAGE" }`), the client's explicit value is preserved.

### 3.3 Concurrency-Safe `assetNumber` Generation & Transaction Atomicity
- Generation logic runs inside `prisma.$transaction(async (tx) => { ... })` and computes the next sequential `AST-XXXXXX` string based on `orderBy: { assetNumber: "desc" }`.
- Under concurrent simultaneous creation, PostgreSQL's `@@unique([workspaceId, assetNumber])` constraint ensures only one transaction commits the candidate number.
- Any concurrent transaction encountering `P2002` catches the collision and retries inside an optimistic loop (up to 5 attempts), fetching the newly committed sequence and succeeding without collision.
- If the collision occurred on an explicitly client-provided `assetNumber`, `createAsset()` immediately throws `DuplicateAssetNumberError` without retrying.
- **Rollback Guarantee**: Verified via both unit mock and real database tests that if the `AssetHistory` CREATED write fails, the entire transaction rolls back and no `Asset` row is persisted.

---

## 4. Verification & Validation Summary

### 4.1 Automated Test Execution Results
```
Test Files  114 passed (114)
     Tests  2043 passed (2043)
  Duration  33.5s
```

1. **TypeScript Compilation (`npx tsc --noEmit`)**:
   - Passed with 0 errors.
2. **Error Taxonomy Suite (`tests/asset/asset-errors.test.ts`)**:
   - 17 passed: verifies `AssetLocationRequiresCustomerError` (`ASSET_LOCATION_REQUIRES_CUSTOMER`, 422) and all other domain error mappings.
3. **Unit Test Suite (`tests/asset/asset-creation-service.test.ts`)**:
   - 17 tests passed:
     - Authentication (`UnauthorizedError`)
     - Permission enforcement (`ForbiddenError` on TECHNICIAN)
     - Customer not found / inactive / cross-tenant IDOR protection (404/400)
     - Location not found / mismatch / depot rule violation (`AssetLocationRequiresCustomerError`, 422)
     - Category not found / inactive / cross-tenant (404/400)
     - Explicit duplicate asset number rejection (409)
     - Sequential number incrementing (`AST-000001` $\rightarrow$ `AST-000002`)
     - Context-aware status defaulting (`IN_STORAGE` vs `OPERATIONAL`)
     - Atomic `AssetHistory` CREATED event capturing session actor ID and role
     - Transaction rollback on audit write failure
     - Canonical `AssetDetailViewModel` projection
4. **Live PostgreSQL Integration Suite (`tests/asset/asset-creation.integration.test.ts`)**:
   - 4 tests passed against Supabase PostgreSQL:
     - Real DB installed asset creation with relations & history audit row
     - Real DB concurrent creation: 5 simultaneous calls without asset numbers generated 5 unique sequential `AST-XXXXXX` numbers with zero collisions
     - Real DB depot asset creation defaulting to `IN_STORAGE`
     - Real DB atomicity test proving transaction rolls back `Asset` if `AssetHistory` write fails
