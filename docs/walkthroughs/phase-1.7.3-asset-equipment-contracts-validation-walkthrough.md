# Phase 1.7.3 — Asset & Equipment Types, Validation & Domain Errors Walkthrough

## 1. Executive Summary

Phase 1.7.3 establishes the complete domain contracts, TypeScript interfaces, Zod validation schemas, domain error classes, and lifecycle state-machine transition rules for the **Asset & Equipment** domain in Aforden.

This layer serves as the single source of truth for all incoming HTTP payloads, query strings, operational read models, and error responses, strictly conforming to the locked architecture in [`docs/architecture/phase-1.7.1-assets-equipment-domain-architecture.md`](../architecture/phase-1.7.1-assets-equipment-domain-architecture.md) and the persistent data model in [`prisma/schema.prisma`](../../prisma/schema.prisma).

---

## 2. Architecture & Design Confirmations

### 2.1 Reference Conventions from Locked Domains
To maintain cross-domain consistency with Phase 1.6 (WorkOrder) and Phase 1.5 (ServiceCatalog), the following locked files served as canonical conventions:
- **DTOs & Projection Models**: [`lib/services/workOrder/workOrder.types.ts`](../../lib/services/workOrder/workOrder.types.ts) for detailed vs list view projection patterns.
- **Validation Schemas**: [`lib/validations/workOrder.ts`](../../lib/validations/workOrder.ts) for `.strict()` unknown field rejection, `.superRefine()` conditional validation, and query parameter parsing.
- **Error Hierarchy**: [`lib/services/workOrder/workOrderErrors.ts`](../../lib/services/workOrder/workOrderErrors.ts) and [`lib/services/serviceCatalog/serviceCatalogErrors.ts`](../../lib/services/serviceCatalog/serviceCatalogErrors.ts) for class inheritance, custom naming, and HTTP status code mappings.

### 2.2 Transition-Pair `(from, to)` State-Reason Enforcement
The conditional requirement of `statusReason` is implemented strictly **per-transition-pair `(from, to)`** in [`lib/services/asset/assetStatusTransitions.ts`](../../lib/services/asset/assetStatusTransitions.ts), rather than based on the target status alone:
- **Example**:
  - `OPERATIONAL -> DEGRADED` **requires** `statusReason` (degradation must be justified).
  - `OUT_OF_SERVICE -> DEGRADED` **does not require** `statusReason` (partial repair verified, monitoring active).
  - Both transitions target `DEGRADED`, but the state machine evaluates the tuple `(fromStatus, toStatus)` via `isReasonRequiredForTransition(from, to)`.
- **API Payload Resolution**:
  - When `fromStatus` is supplied in `transitionAssetStatusSchema`, the exact `(fromStatus, toStatus)` transition rule is enforced.
  - When `fromStatus` is omitted in the request payload (because the current state lives in the database), the service layer validates the transition against the persistent asset record's `fromStatus` using `isReasonRequiredForTransition(currentStatus, payload.toStatus)`.

### 2.3 Shared Pagination Metadata Reuse
Rather than defining a duplicate pagination interface, `AssetListResult` and `AssetCategoryListResult` explicitly reuse and re-export the established repository pagination interface:
- **Source**: `PaginationMetadata` imported from [`lib/services/serviceCatalog/serviceCatalog.types.ts`](../../lib/services/serviceCatalog/serviceCatalog.types.ts).
- **Structure**:
  ```typescript
  export interface PaginationMetadata {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
  }
  ```

### 2.4 Error Taxonomy Consolidation (Single Canonical Definition)
Across the Asset and AssetCategory domains, there are **15 distinct domain error classes** (11 pure Asset errors + 4 AssetCategory errors):
- `AssetCategoryNotFoundError` is defined **once** canonically in [`lib/services/assetCategory/assetCategoryErrors.ts`](../../lib/services/assetCategory/assetCategoryErrors.ts).
- [`lib/services/asset/assetErrors.ts`](../../lib/services/asset/assetErrors.ts) **re-exports** `AssetCategoryNotFoundError` directly from `assetCategoryErrors.ts`.
- This ensures referential identity (`expect(AssetCategoryNotFoundError).toBe(CatNotFoundError)`), preventing `instanceof` check mismatches or taxonomy drift across service modules.

---

## 3. Deliverables & File Structure

```
lib/
├── services/
│   ├── asset/
│   │   ├── asset.types.ts                 # View models, list models, and input DTOs
│   │   ├── asset.schemas.ts               # Zod validation schemas with strict unknown field rejection
│   │   ├── assetErrors.ts                 # 11 Asset domain errors + re-export of AssetCategoryNotFoundError
│   │   └── assetStatusTransitions.ts      # (from, to) state transition matrix single source of truth
│   ├── assetCategory/
│   │   ├── assetCategory.types.ts         # Category view models and DTOs
│   │   ├── assetCategory.schemas.ts       # Category Zod schemas
│   │   └── assetCategoryErrors.ts         # 4 Category domain error classes
│   └── authorization/
│       ├── permissions.ts                 # Phase 1.7 permission constants
│       └── rolePermissions.ts             # RBAC role-to-permission mapping
└── validations/
    ├── asset.ts                           # Top-level validation re-exports
    └── assetCategory.ts                   # Top-level validation re-exports

tests/
└── asset/
    ├── asset-validation.test.ts           # 34 tests covering all Asset Zod schemas & constraints
    ├── asset-category-validation.test.ts  # 11 tests covering Category schemas & query params
    └── asset-errors.test.ts               # 16 tests verifying error taxonomy codes, status & identity
```

---

## 4. Lifecycle State Transition Matrix (`assetStatusTransitions.ts`)

| From Status | To Status | Allowed Roles | Reason Required | Semantics |
| :--- | :--- | :--- | :---: | :--- |
| `IN_STORAGE` | `OPERATIONAL` | OWNER, ADMIN, MANAGER, DISPATCHER | ❌ | Deployed to active site and assigned |
| `IN_STORAGE` | `DECOMMISSIONED` | OWNER, ADMIN, MANAGER | ✅ | Administrative inactive hold |
| `IN_STORAGE` | `RETIRED` | OWNER, ADMIN, MANAGER | ✅ | Disposed/scrapped directly from depot |
| `OPERATIONAL` | `DEGRADED` | OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN | ✅ | Reduced performance or warning alerts |
| `OPERATIONAL` | `OUT_OF_SERVICE` | OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN | ✅ | Emergency shutdown / total breakdown |
| `OPERATIONAL` | `IN_STORAGE` | OWNER, ADMIN, MANAGER, DISPATCHER | ✅ | Uninstalled from site to depot (`locationId = null`) |
| `OPERATIONAL` | `DECOMMISSIONED` | OWNER, ADMIN, MANAGER | ✅ | Mothballed indefinitely at site |
| `OPERATIONAL` | `RETIRED` | OWNER, ADMIN, MANAGER | ✅ | Scrapped directly from operational service |
| `DEGRADED` | `OPERATIONAL` | OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN | ❌ | Corrective maintenance completed |
| `DEGRADED` | `OUT_OF_SERVICE` | OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN | ✅ | Performance collapsed; asset shut down |
| `DEGRADED` | `IN_STORAGE` | OWNER, ADMIN, MANAGER, DISPATCHER | ✅ | Removed for bench repair |
| `DEGRADED` | `DECOMMISSIONED` | OWNER, ADMIN, MANAGER | ✅ | Mothballed while degraded |
| `DEGRADED` | `RETIRED` | OWNER, ADMIN, MANAGER | ✅ | Uneconomical repair; scrapped |
| `OUT_OF_SERVICE` | `OPERATIONAL` | OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN | ❌ | Full repair verified |
| `OUT_OF_SERVICE` | `DEGRADED` | OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN | ❌ | Partial fix achieved; monitoring active |
| `OUT_OF_SERVICE` | `IN_STORAGE` | OWNER, ADMIN, MANAGER, DISPATCHER | ✅ | Depot return for rebuild |
| `OUT_OF_SERVICE` | `DECOMMISSIONED` | OWNER, ADMIN, MANAGER | ✅ | Mothballed in non-functioning state |
| `OUT_OF_SERVICE` | `RETIRED` | OWNER, ADMIN, MANAGER | ✅ | Catastrophic failure; scrapped |
| `DECOMMISSIONED` | `IN_STORAGE` | OWNER, ADMIN, MANAGER | ✅ | Reactivated to depot inventory |
| `DECOMMISSIONED` | `OPERATIONAL` | OWNER, ADMIN, MANAGER | ❌ | Recommissioned directly into service |
| `DECOMMISSIONED` | `RETIRED` | OWNER, ADMIN, MANAGER | ✅ | End of storage life; retired |
| `RETIRED` | *(Any)* | **NONE** | — | **Irreversible terminal state** |

---

## 5. Zod Validation Rules & Constraints (`asset.schemas.ts`)

1. **Tag Constraints (§7.1)**:
   - Max 20 tags per asset.
   - Each tag: 1–30 characters, strictly lowercase alphanumeric and hyphens (`/^[a-z0-9-]+$/`).
2. **Metadata Constraints (§7.2)**:
   - JSON object with primitive values (`string | number | boolean | null`) or shallow arrays of primitives.
   - Maximum nesting depth of 2 levels.
   - Maximum JSON serialized payload size: 32,768 bytes (32KB).
3. **Strict Mutation Policies (§16)**:
   - `.strict()` prevents unknown field injection across all mutation schemas.
   - `updateAssetSchema` rejects immutable fields (`id`, `workspaceId`, `createdAt`), transfer fields (`customerId`, `locationId`), and lifecycle fields (`status`, `decommissionedAt`, `retiredAt`).
   - `transferAssetLocationSchema` and `transferAssetOwnershipSchema` require non-empty `transferReason`.
   - `getAssetsQuerySchema` validates pagination integers and allowlisted `sortBy` fields (`createdAt`, `updatedAt`, `name`, `assetNumber`, `serialNumber`, `status`, `manufacturer`).

---

## 6. Complete Domain Error Taxonomy (15 Canonical Error Classes)

| Domain Error Class | Defining File | Error Code String | HTTP Status | Trigger Condition |
| :--- | :--- | :--- | :---: | :--- |
| `AssetNotFoundError` | `assetErrors.ts` | `ASSET_NOT_FOUND` | **404** | Asset not found in workspace / IDOR prevention |
| `AssetCustomerNotFoundError` | `assetErrors.ts` | `ASSET_CUSTOMER_NOT_FOUND` | **404** | Customer ID not found in workspace |
| `AssetCustomerInactiveError` | `assetErrors.ts` | `ASSET_CUSTOMER_INACTIVE` | **400** | Target customer is inactive |
| `AssetLocationNotFoundError` | `assetErrors.ts` | `ASSET_LOCATION_NOT_FOUND` | **404** | Service location ID not found |
| `AssetLocationCustomerMismatchError` | `assetErrors.ts` | `ASSET_LOCATION_CUSTOMER_MISMATCH` | **422** | Location does not belong to specified customer |
| `AssetInvalidStatusTransitionError` | `assetErrors.ts` | `ASSET_INVALID_STATUS_TRANSITION` | **409** | Forbidden state machine transition |
| `AssetMissingStatusReasonError` | `assetErrors.ts` | `ASSET_MISSING_STATUS_REASON` | **422** | Omitted reason on required status transition |
| `AssetMissingTransferReasonError` | `assetErrors.ts` | `ASSET_MISSING_TRANSFER_REASON` | **422** | Omitted reason on location/ownership move |
| `AssetImmutableError` | `assetErrors.ts` | `ASSET_IMMUTABLE` | **409** | Attempted modification of `RETIRED` asset |
| `AssetDeletionNotAllowedError` | `assetErrors.ts` | `ASSET_DELETION_NOT_ALLOWED` | **409** | Attempted deletion of asset with work orders |
| `DuplicateAssetNumberError` | `assetErrors.ts` | `DUPLICATE_ASSET_NUMBER` | **409** | Colliding assetNumber in workspace |
| `AssetCategoryNotFoundError` | `assetCategoryErrors.ts` *(re-exported)* | `ASSET_CATEGORY_NOT_FOUND` | **404** | Category ID not found |
| `AssetCategoryAlreadyExistsError` | `assetCategoryErrors.ts` | `ASSET_CATEGORY_ALREADY_EXISTS` | **409** | Colliding category name or code |
| `AssetCategoryInactiveError` | `assetCategoryErrors.ts` | `ASSET_CATEGORY_INACTIVE` | **400** | Attempted assignment of inactive category |
| `AssetCategoryDeletionNotAllowedError` | `assetCategoryErrors.ts` | `ASSET_CATEGORY_DELETION_NOT_ALLOWED` | **409** | Category referenced by existing assets |

---

## 7. Verification & Validation Summary

### 7.1 Automated Tests Executed
```
Test Files  112 passed (112)
     Tests  2022 passed (2022)
  Duration  32.12s
```

1. **TypeScript Typecheck**:
   - `npx tsc --noEmit` passed cleanly with 0 type errors.
2. **Asset Validation Suite** (`tests/asset/asset-validation.test.ts`):
   - 34 passed: create, update, tags, metadata, status transitions, transfers, queries.
3. **AssetCategory Validation Suite** (`tests/asset/asset-category-validation.test.ts`):
   - 11 passed: create, update, codes, sort order, queries.
4. **Error Taxonomy Suite** (`tests/asset/asset-errors.test.ts`):
   - 16 passed: error names, codes, statusCode, httpStatus, and single-definition referential identity (`expect(AssetCategoryNotFoundError).toBe(CatNotFoundError)`).
5. **PostgreSQL Live DB Integration Suite** (`tests/asset/asset-db-referential-integrity.integration.test.ts`):
   - 7 passed: Foreign key Restrict rules, cascade behavior, and null handling.
