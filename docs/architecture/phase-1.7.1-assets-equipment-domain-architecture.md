# Phase 1.7.1 — Asset & Equipment Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.7 Architecture Standard)  
> **Domain**: Asset & Equipment Management  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & Authorization / RBAC), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customer & Service Locations), Phase 1.5 (Service Catalog & Work Types), Phase 1.6 (WorkOrder Domain)  
> **Target Schema & Service Implementation**: Phase 1.7.2 – Phase 1.7.12  

---

## Executive Summary

Phase 1.7 introduces the **Asset & Equipment** domain to the Aforden field service management platform. Physical assets (e.g., HVAC units, commercial chillers, diesel backup generators, elevators, commercial refrigeration systems, security panels, and pumps) represent the central physical subjects of field service maintenance, inspection, and repair operations.

While previous phases established workspace tenants (Phase 1.1), user identities and permissions (Phase 1.2), internal workforces (Phase 1.3), customer client accounts and physical service premises (Phase 1.4), cataloged service offerings (Phase 1.5), and executable work orders (Phase 1.6), Phase 1.7 establishes the system of record for the physical equipment installed across customer locations and internal depots.

This document formally establishes and locks the architectural decisions, structural boundaries, relational invariants, lifecycle state machines, RBAC policies, and error taxonomy for the Asset & Equipment domain before any database schemas, Prisma migrations, services, or API route handlers are implemented.

---

## Explicit Answers to Critical Architectural Questions

| Question | Architectural Decision | Formal Justification |
| :--- | :--- | :--- |
| **1. Does an asset belong to a Customer, a ServiceLocation, both, or either?** | **Both (Hierarchical Relationship), with Depot Exception.** | In 95% of field service scenarios, a customer asset belongs to a specific `Customer` and is installed at a specific `ServiceLocation` owned by that customer. To support tenant-owned equipment (e.g. loaner chillers, rental generators, staging stock), `customerId` and `locationId` are nullable. However, whenever an asset is assigned to a `ServiceLocation`, that location **must strictly belong** to the assigned `Customer`. Cross-customer location placement is mathematically prohibited by domain invariants. |
| **2. Can an asset move between locations, and if so is location history kept?** | **YES, location moves are fully supported, and an immutable history trail is preserved.** | Physical equipment is routinely relocated (e.g. moved from Building A to Building B of a corporate campus, reinstalled on a different rooftop, or returned to shop). Every location transfer writes an immutable `AssetHistory` event capturing source location, destination location, actor ID, timestamp, and relocation notes. |
| **3. Can an asset exist without a customer (e.g. tenant-owned equipment)?** | **YES (Tenant-Owned / Depot Assets).** | Field service contractors frequently own tools, mobile generators, temporary loaners, or equipment stored in a staging warehouse awaiting deployment to a client. Allowing `customerId = null` (and `locationId = null` or pointing to an internal depot) cleanly accommodates internal assets without requiring synthetic "dummy customer" workarounds. |
| **4. Can an asset have multiple identifiers (e.g. internal asset number vs. manufacturer serial number)?** | **YES, dual identification is explicitly modeled.** | Assets have an internal human-readable, tenant-unique `assetNumber` (e.g. `AST-000104` or barcoded company tag) AND a manufacturer-stamped `serialNumber` (e.g. `SN-CARRIER-9847291`). The `assetNumber` guarantees workspace-wide uniqueness, while `serialNumber` is indexed for vendor lookups. |
| **5. Can an asset be deactivated? Retired? Deleted? What's the difference?** | **YES, all three exist and represent fundamentally different lifecycle states.** | • **Deactivation (`DECOMMISSIONED`)**: Temporary/reversible suspension (e.g., seasonal facility shutdown, equipment mothballed). Asset retains relations and can be reactivated.<br>• **Retirement (`RETIRED`)**: Terminal end-of-life state (e.g. scrapped, recycled, destroyed). Permanently locked against new work orders, but retains all historical records.<br>• **Deletion (Hard Delete)**: Physical administrative purge. Permitted **ONLY** for draft or erroneously created assets with **ZERO** downstream WorkOrders or audit dependencies. |
| **6. Can an asset be reassigned to a different customer? What happens to its WorkOrder history?** | **YES, customer transfer is supported; historical WorkOrders remain permanently tied to their original customer.** | Real estate properties and equipment change hands (e.g. building sold to new management). When an asset is reassigned to Customer B, past WorkOrders executed under Customer A remain permanently frozen snapshots bound to Customer A for accounting, invoicing, and legal liability. The asset's `AssetHistory` logs the ownership transfer event. |
| **7. Can an asset have historical WorkOrders visible even after the asset is deactivated/retired?** | **YES, historical visibility is permanent and immutable.** | Compliance, warranty tracking, and regulatory inspections require complete lifetime service histories. Deactivating or retiring an asset prevents *new* operational work orders, but historical WorkOrders remain fully queryable. |
| **8. Can an asset have a historical record of past ownership/location changes?** | **YES, mandatory via the `AssetHistory` audit ledger.** | Every change of customer ownership, location transfer, status transition, or major specification edit is recorded in an append-only `AssetHistory` audit log. |

---

## 1. Domain Boundary & Responsibilities

```
+---------------------------------------------------------------------------------------------------+
|                                        WORKSPACE (Tenant)                                         |
|                                                                                                   |
|   +-----------------------+       +------------------------+       +--------------------------+   |
|   |       CUSTOMER        |       |    SERVICE LOCATION    |       |      ASSET CATEGORY      |   |
|   | (Owner / Client Org)  |       | (Physical Site/Address)|       |   (Tenant-defined type)  |   |
|   +-----------+-----------+       +-----------+------------+       +------------+-------------+   |
|               |                               |                                 |                 |
|               | 1:N (Optional)                | 1:N (Optional)                  | 1:N (Optional)  |
|               v                               v                                 v                 |
|   +-------------------------------------------------------------------------------------------+   |
|   |                                     ASSET / EQUIPMENT                                     |   |
|   |  - id: CUID (Internal system primary key)                                                 |   |
|   |  - assetNumber: Human-readable reference (e.g., AST-000142, unique per workspace)         |   |
|   |  - name, make/manufacturer, modelNumber, serialNumber                                     |   |
|   |  - status: OPERATIONAL | DEGRADED | OUT_OF_SERVICE | IN_STORAGE | DECOMMISSIONED | RETIRED |   |
|   |  - subLocationNotes: Specific physical placement (e.g., "Rooftop North, Unit 4")          |   |
|   |  - installationDate, warrantyExpiresAt, purchaseDate, purchaseCost                        |   |
|   |  - tags: String[] (e.g., ["critical", "rooftop", "tier-1-sla"])                           |   |
|   |  - metadata: JSON (Extensible key-value specs: voltage, refrigerant, tonnage)             |   |
|   |  - operational timestamps: createdAt, updatedAt, decommissionedAt, retiredAt              |   |
|   +-------------------------------------------------------------------------------------------+   |
|               |                                                     |                             |
|               | 1:N (Append-Only)                                   | 1:N (Optional Downstream)   |
|               v                                                     v                             |
|   +-----------------------+                             +------------------------+                |
|   |     ASSET HISTORY     |                             |       WORK ORDER       |                |
|   |  (Audit trail of moves|                             | (Operational execution |                |
|   |   status, & ownership)|                             |  targeting this asset) |                |
|   +-----------------------+                             +------------------------+                |
+---------------------------------------------------------------------------------------------------+
```

### 1.1 Domain Responsibilities (What the Asset Domain Owns)
- **Asset Identity & Identification**: Primary CUID, human-readable asset number, manufacturer serial number, make, model number, and descriptive name.
- **Physical & Operational Placement**: Binding to Customer and ServiceLocation, including granular sub-location placement details (e.g. "Basement Boiler Room B-2", "Rooftop North West").
- **Lifecycle & Operational Status**: Managing active operational states (`OPERATIONAL`, `DEGRADED`, `OUT_OF_SERVICE`, `IN_STORAGE`) and administrative terminal states (`DECOMMISSIONED`, `RETIRED`).
- **Taxonomy & Classification**: Tenant-configurable asset categorization (`AssetCategory`) and multi-dimensional tagging.
- **Technical & Commercial Metadata**: Core financial/warranty attributes (installation date, warranty expiration, purchase cost) and extensible technical equipment specifications (JSON payload).
- **Movement & Lifecycle Audit Ledger (`AssetHistory`)**: Maintaining an append-only historical record of location moves, ownership transfers, status changes, and critical metadata mutations.

### 1.2 External References (What the Asset Domain References)
- `workspaceId` $\rightarrow$ Multi-tenant partition anchor (`Workspace`).
- `customerId` $\rightarrow$ Optional client entity owning or leasing the equipment (`Customer`).
- `locationId` $\rightarrow$ Optional physical installation site (`ServiceLocation`).
- `categoryId` $\rightarrow$ Optional taxonomy classification (`AssetCategory`).

### 1.3 Explicit Exclusions (Out of Scope for Phase 1.7)
To prevent architectural drift and scope creep, the following capabilities are **strictly excluded** from Phase 1.7:
- ❌ **IoT Telemetry & Real-Time Sensor Ingestion** (live vibration, temperature, SCADA streaming).
- ❌ **Preventive Maintenance Automated Schedulers** (cron-based recurring maintenance engines — deferred to Automation & Workflows Phase 1.16).
- ❌ **Inventory Parts Breakdown & Bill of Materials (BOM)** (child component parts, exploded assemblies, truck stock depletion — deferred to Inventory Phase 1.10).
- ❌ **Asset Depreciation & Fixed Asset Accounting Schedules** (GAAP depreciation schedules, book value calculations — deferred to Invoicing/Accounting Phase 1.12).
- ❌ **GPS Tracking & Real-Time Beacon Geofencing** (live asset trackers, BLE beacons).
- ❌ **Customer Self-Service Asset Portal** (external customer equipment management).

---

## 2. Asset Lifecycle & State Machine

```
                              +-----------------------+
                              |                       |
                              |      IN_STORAGE       | <-----------------+
                              | (In depot/warehouse)  |                   |
                              +---+-------+-------+---+                   |
                                  |       |       |                       |
                           deploy |       |       | un-install / return   |
                                  v       |       +-----------------------+
                              +---+-------+-----------+                   |
                              |                       |                   |
                              |      OPERATIONAL      +-------------------+
                              |   (Normal operation)  |
                              +---+---+---+-------+---+
                                  |   |   |       ^
                       fault/wear |   |   |       | repair / restore
                                  v   |   |       |
                              +---+---+---+-------+---+
                              |                       |
                              |       DEGRADED        |
                              | (Reduced performance) |
                              +---+---+---+-------+---+
                                  |   |   |       ^
                        breakdown |   |   |       | repair / restore
                                  v   |   |       |
                              +---+---+---+-------+---+
                              |                       |
                              |    OUT_OF_SERVICE     |
                              | (Shut down / offline) |
                              +---+-------+-----------+
                                  |       |
          decommission (mothball) |       |
          from ANY operational   |       |
          state                   |       |
                                  v       |
                              +---+-------+-----------+
                              |                       |
                              |    DECOMMISSIONED     +------------+
                              | (Temporarily inactive)|            |
                              +-----------+-----------+            |
                                          |                        |
                               re-commission (reactivate)          |
                               (to IN_STORAGE / OPERATIONAL)       |
                                          |                        |
                                          v                        |
                                  (Active Lifecycle)               |
                                                                   |
                                  retire (End of Life)             |
    (Directly from IN_STORAGE, OPERATIONAL, DEGRADED,              |
     OUT_OF_SERVICE, or DECOMMISSIONED)                            |
    ===============================================================>
                                                                   |
                                                                   v
                                                       +-----------------------+
                                                       |                       |
                                                       |        RETIRED        |
                                                       |  (Terminal Lifecycle) |
                                                       +-----------------------+
```

### 2.1 Asset Status Enum (`AssetStatus`)
The `AssetStatus` enum consists of six distinct states:

| Status Enum Value | Classification | Meaning & Operational Semantics |
| :--- | :--- | :--- |
| `OPERATIONAL` | **Active Operational** | Asset is installed, fully functioning within operational tolerances, and eligible for standard service or preventative maintenance. |
| `DEGRADED` | **Active Operational** | Asset is running with reduced performance, warning alerts, or minor defects requiring corrective maintenance, but remains online. |
| `OUT_OF_SERVICE` | **Active Operational** | Asset is completely non-operational, broken down, or shut down for safety/emergency repair. Cannot perform normal function. |
| `IN_STORAGE` | **Staging / Depot** | Asset is physically uninstalled and stored in a warehouse, shop, or technician vehicle awaiting deployment. |
| `DECOMMISSIONED` | **Administrative Inactive** | Asset is mothballed, temporarily decommissioned, or shut down indefinitely. Excluded from active service routing, but can be reactivated. |
| `RETIRED` | **Terminal Lifecycle** | Asset has reached end of life, was scrapped, destroyed, recycled, or permanently replaced. **Irreversible terminal state**. |

### 2.2 Allowed State Transition Matrix

| From Status | To Status | Allowed Roles | Preconditions & Validation Rules | Side Effects & Audit Entry |
| :--- | :--- | :--- | :--- | :--- |
| `IN_STORAGE` | `OPERATIONAL` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Must be assigned to an active `customerId` and `locationId`. | Sets status. Logs `STATUS_CHANGED` and `DEPLOYED` in `AssetHistory`. |
| `IN_STORAGE` | `DECOMMISSIONED`| `OWNER`, `ADMIN`, `MANAGER` | `statusReason` required. | Sets status. Logs `DECOMMISSIONED` in `AssetHistory`. |
| `IN_STORAGE` | `RETIRED` | `OWNER`, `ADMIN`, `MANAGER` | `statusReason` required. (Direct transition from storage to retired). | Sets `retiredAt = now()`. Logs `RETIRED` in `AssetHistory`. |
| `OPERATIONAL` | `DEGRADED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | `statusReason` required. (*Technician can report degradation on site). | Sets status. Logs `STATUS_CHANGED` in `AssetHistory`. |
| `OPERATIONAL` | `OUT_OF_SERVICE`| `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | `statusReason` required. (*Technician can flag safety shutdown on site). | Sets status. Logs `STATUS_CHANGED` in `AssetHistory`. |
| `OPERATIONAL` | `IN_STORAGE` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Asset uninstalled. Sets `locationId = null` (Sole exception to transfer governance). `statusReason` required. | Sets status and `locationId = null`. Logs `UNINSTALLED` in `AssetHistory`. |
| `OPERATIONAL` | `DECOMMISSIONED`| `OWNER`, `ADMIN`, `MANAGER` | `statusReason` required. | Sets `decommissionedAt = now()`. Logs `DECOMMISSIONED` in `AssetHistory`. |
| `OPERATIONAL` | `RETIRED` | `OWNER`, `ADMIN`, `MANAGER` | `statusReason` required. (Direct transition from operational to retired). | Sets `retiredAt = now()`. Logs `RETIRED` in `AssetHistory`. |
| `DEGRADED` | `OPERATIONAL` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | Corrective maintenance completed. | Sets status. Logs `STATUS_CHANGED` in `AssetHistory`. |
| `DEGRADED` | `OUT_OF_SERVICE`| `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | Performance collapsed; asset shut down. `statusReason` required. | Sets status. Logs `STATUS_CHANGED` in `AssetHistory`. |
| `DEGRADED` | `IN_STORAGE` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Asset removed for bench repair or depot storage. Sets `locationId = null`. `statusReason` required. | Sets status and `locationId = null`. Logs `UNINSTALLED` in `AssetHistory`. |
| `DEGRADED` | `DECOMMISSIONED`| `OWNER`, `ADMIN`, `MANAGER` | `statusReason` required. | Sets `decommissionedAt = now()`. Logs `DECOMMISSIONED`. |
| `DEGRADED` | `RETIRED` | `OWNER`, `ADMIN`, `MANAGER` | Repair uneconomical. `statusReason` required. (Direct transition from degraded to retired). | Sets `retiredAt = now()`. Logs `RETIRED`. |
| `OUT_OF_SERVICE`| `OPERATIONAL` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | Full repair verified. | Sets status. Logs `STATUS_CHANGED` in `AssetHistory`. |
| `OUT_OF_SERVICE`| `DEGRADED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | Partial fix achieved; monitoring required. | Sets status. Logs `STATUS_CHANGED` in `AssetHistory`. |
| `OUT_OF_SERVICE`| `IN_STORAGE` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Removed from customer site to depot. Sets `locationId = null`. `statusReason` required. | Sets status and `locationId = null`. Logs `UNINSTALLED` in `AssetHistory`. |
| `OUT_OF_SERVICE`| `DECOMMISSIONED`| `OWNER`, `ADMIN`, `MANAGER` | `statusReason` required. | Sets `decommissionedAt = now()`. Logs `DECOMMISSIONED`. |
| `OUT_OF_SERVICE`| `RETIRED` | `OWNER`, `ADMIN`, `MANAGER` | Major failure / scrapped on site. `statusReason` required. (Direct transition from out-of-service to retired). | Sets `retiredAt = now()`. Logs `RETIRED`. |
| `DECOMMISSIONED`| `IN_STORAGE` | `OWNER`, `ADMIN`, `MANAGER` | Reactivated to inventory/depot. `statusReason` required. | Clears `decommissionedAt = null`. Logs `REACTIVATED`. |
| `DECOMMISSIONED`| `OPERATIONAL` | `OWNER`, `ADMIN`, `MANAGER` | Recommissioned directly into service at site. | Clears `decommissionedAt = null`. Logs `REACTIVATED`. |
| `DECOMMISSIONED`| `RETIRED` | `OWNER`, `ADMIN`, `MANAGER` | End of storage life. `statusReason` required. | Sets `retiredAt = now()`. Logs `RETIRED`. |
| `RETIRED` | *(Any)* | **NONE** | **STRICTLY FORBIDDEN**. `RETIRED` is an irreversible terminal state. | Throws `AssetImmutableError` (409 Conflict). |

*Any state transition not explicitly listed in the table above is strictly **INVALID** and will be rejected with `ASSET_INVALID_STATUS_TRANSITION` (409 Conflict).*

---

## 3. Relational Architecture: Customer & ServiceLocation Interactions

### 3.1 Relational Topology & Cardinality
The Asset domain establishes the following entity relationships:

| Related Entity | Relationship Cardinality | Nullability | Prisma Foreign Key Rule | Operational Invariants |
| :--- | :--- | :--- | :--- | :--- |
| **Workspace** | Many-to-One (`Asset.workspaceId -> Workspace.id`) | **Non-Nullable** | `onDelete: Cascade` | Every asset belongs to exactly one workspace tenant. |
| **Customer** | Many-to-One (`Asset.customerId -> Customer.id`) | **Nullable** | `onDelete: Restrict` | If populated, represents the client account. Hard deletion of a `Customer` is **BLOCKED** (409 Conflict) if referenced by any `Asset`. |
| **ServiceLocation**| Many-to-One (`Asset.locationId -> ServiceLocation.id`) | **Nullable** | `onDelete: Restrict` | If populated, represents the physical installation address. Hard deletion of a `ServiceLocation` is **BLOCKED** (409 Conflict) if referenced by any `Asset`. |
| **AssetCategory** | Many-to-One (`Asset.categoryId -> AssetCategory.id`) | **Nullable** | `onDelete: Restrict` | Hard deletion of an `AssetCategory` is **BLOCKED** if referenced by any active `Asset`. |
| **AssetHistory** | One-to-Many (`Asset.id -> AssetHistory.assetId`) | **1:N** | `onDelete: Cascade` | Append-only audit trail of state transitions, location transfers, and ownership changes. |
| **WorkOrder** | One-to-Many (`Asset.id -> WorkOrder.assetId`) | **1:N (Optional)** | `onDelete: Restrict` | Downstream service work orders targeting this equipment. |

### 3.2 Relational Consistency Invariants
1. **The Customer-Location Ownership Parity Invariant**:
   If both `customerId` and `locationId` are defined on an `Asset`, the `ServiceLocation` **MUST belong to that exact Customer**:
   $$\text{Asset.location.customerId} == \text{Asset.customerId}$$
   Attempting to link an Asset to Location X while setting Customer Y (where $X.\text{customerId} \neq Y$) is strictly rejected with `ASSET_LOCATION_CUSTOMER_MISMATCH` (422 Unprocessable Entity).
2. **Depot / Unassigned Equipment Rule**:
   If `customerId` is `null`, `locationId` must also be `null` (representing unassigned tenant inventory/depot assets).
3. **Inactive Customer / Location Guard**:
   Creating an Asset or transferring an Asset to a Customer with `status === "INACTIVE"` is strictly rejected with `ASSET_CUSTOMER_INACTIVE` (400 Bad Request).

---

## 4. Location Movements & Ownership Transfer Strategy

### 4.1 Physical Relocation Workflow (`transferAssetLocation`)
Equipment frequently moves between service locations (e.g., transferred from Warehouse to Site A, or moved between buildings on a corporate campus).
- **Execution**: Managed via a dedicated atomic mutation (`transferAssetLocation`).
- **Validation**:
  1. Validates destination `locationId` belongs to the asset's current `customerId`.
  2. Ensures the asset is in a moveable state (`OPERATIONAL`, `DEGRADED`, `OUT_OF_SERVICE`, or `IN_STORAGE`). Decommissioned or Retired assets must be reactivated before moving.
- **Side Effects**:
  1. Updates `Asset.locationId` and `Asset.subLocationNotes`.
  2. Writes an `AssetHistory` record with `eventType = "LOCATION_TRANSFERRED"`, capturing `fromLocationId`, `toLocationId`, `transferReason`, actor ID, and timestamp.

### 4.2 Customer Ownership Transfer Workflow (`transferAssetOwnership`)
When a commercial property changes hands or equipment is sold/transferred to a new customer:
- **Execution**: Managed via a dedicated atomic mutation (`transferAssetOwnership`).
- **Validation**:
  1. Validates target `customerId` exists in the workspace and is `ACTIVE`.
  2. Validates new `locationId` belongs to the new customer (or clears `locationId` to `null`).
- **Historical WorkOrder Integrity (The Snapshot Rule)**:
  - WorkOrders previously executed against the asset under the *old* customer remain **permanently frozen** and bound to the old `customerId` and old `locationId`.
  - Past work orders are historical accounting and execution events; they are NEVER rewritten upon asset transfer.
- **Side Effects**:
  1. Updates `Asset.customerId` and `Asset.locationId`.
  2. Writes an `AssetHistory` record with `eventType = "OWNERSHIP_TRANSFERRED"`, capturing `fromCustomerId`, `toCustomerId`, `transferReason`, actor ID, and timestamp.

---

## 5. Identification Model & Dual-Identifier Strategy

```
+---------------------------------------------------------------------------------------------------+
|                                      ASSET IDENTIFIER SCHEME                                      |
|                                                                                                   |
|   1. System Primary Key (CUID)             id: "ast_ckz893hd700018v..."  (High-entropy, immutable)|
|   2. Human Internal Asset Number           assetNumber: "AST-000104"      (Tenant-Unique, Barcode)|
|   3. Manufacturer Hardware Serial Number   serialNumber: "SN-CARRIER-987" (Chassis Plate, Indexed)|
|   4. Manufacturer Model Number             modelNumber: "58TP0A070V1716"  (Equipment Type/Model)  |
+---------------------------------------------------------------------------------------------------+
```

### 5.1 Identifier Definitions & Scope

| Identifier Field | Type | Scope & Uniqueness | Required / Optional | Description & Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `String` (CUID) | Globally Unique (Primary Key) | **Required** (System Generated) | High-entropy internal identifier used for database relations, foreign keys, and REST URLs. |
| `assetNumber` | `String` | **Unique per Workspace** (`@@unique([workspaceId, assetNumber])`) | **Required** (Auto-generated or custom) | Human-readable company asset tag (e.g. `AST-000001`, `AC-1029`). Used for barcode labels, QR codes, and phone support dispatch. |
| `serialNumber` | `String` | Workspace-Indexed (`@@index([workspaceId, serialNumber])`) | **Optional** | Manufacturer hardware serial number stamped on equipment chassis. Not strictly unique because distinct manufacturers may share simple sequence formats. |
| `modelNumber` | `String` | Workspace-Indexed (`@@index([workspaceId, modelNumber])`) | **Optional** | Manufacturer model/catalog number (e.g. `Carrier 58TP0A`). |
| `manufacturer` | `String` | Workspace-Indexed (`@@index([workspaceId, manufacturer])`) | **Optional** | Manufacturer or brand name (e.g. `Trane`, `Carrier`, `Siemens`, `Caterpillar`). |

### 5.2 `assetNumber` Generation Strategy
- **Default Format**: `AST-XXXXXX` (e.g., `AST-000001`, `AST-000142`) with 6-digit zero-padding per workspace.
- **Custom Input**: Tenants may provide their own custom asset tag number during creation (e.g., `HVAC-RTU-04`). If provided, the system asserts workspace uniqueness (`DUPLICATE_ASSET_NUMBER`).
- **Auto-Generation**: If omitted in `POST /api/assets`, the service atomically calculates the next sequence number for the workspace inside a transaction.

---

## 6. Classification, Categorization & Taxonomy Strategy

### 6.1 Strategic Evaluation: Fixed Enum vs. Free-Text vs. Tenant-Defined Taxonomy

| Strategy | Architectural Pros | Architectural Cons | Decision & Evaluation |
| :--- | :--- | :--- | :--- |
| **Option A: Fixed System Enum** (`HVAC`, `PLUMBING`, `ELEVATOR`) | Zero configuration; simple database column. | Inflexible. Field service contractors specialize in diverse industries (medical devices, marine engines, commercial chillers, agricultural machinery). Cannot anticipate all domains. | ❌ **REJECTED** |
| **Option B: Free-Text String** (`category: String?`) | Maximum flexibility; zero setup. | Severe data degradation. Leads to inconsistent spelling (`HVAC`, `hvac`, `H-VAC`, `Air Conditioning`), preventing accurate filtering and reporting. | ❌ **REJECTED** |
| **Option C: Tenant-Defined Entity (`AssetCategory`) + Optional Free-Text Subtype** | Standardized taxonomy within workspace; fully customizable per tenant; matches Phase 1.5 `ServiceCatalog` pattern. | Requires dedicated management table. | ✅ **LOCKED & ADOPTED** |

### 6.2 The `AssetCategory` Entity Architecture
Workspaces define their equipment taxonomy via a dedicated `AssetCategory` entity:
- `id`: CUID
- `workspaceId`: Tenant partition anchor
- `name`: Category display name (e.g. `Commercial HVAC`, `Emergency Power Generators`, `Fire Protection Systems`)
- `code`: Optional alphanumeric code (e.g. `HVAC-COMM`, `GEN-PWR`)
- `description`: Scope of category
- `status`: `ACTIVE` | `INACTIVE`
- `sortOrder`: Integer display order
- Constraints: `@@unique([workspaceId, name])` and `@@unique([workspaceId, code])`.

### 6.3 `AssetCategory` Lifecycle, Service Layer Functions & REST Routes
To support first-class management of equipment taxonomies, the following service operations, REST routes, and RBAC governance are defined for `AssetCategory`:

#### 1. Service Layer Functions (`lib/services/assetCategory/`)
- `createAssetCategory.ts`: Creates a new category scoped to `workspaceId` with unique `name` and optional unique `code`. Asserts caller holds `PERMISSIONS.ASSET_CATEGORIES_MANAGE`.
- `getAssetCategories.ts`: Lists categories for the workspace, supporting filtering by `status` (`ACTIVE`, `INACTIVE`, `ALL`) and ordering by `sortOrder` ascending.
- `getAssetCategory.ts`: Retrieves a single category by ID with workspace isolation.
- `updateAssetCategory.ts`: Updates category `name`, `code`, `description`, and `sortOrder`.
- `deactivateAssetCategory.ts`: Toggles category status (`ACTIVE` $\leftrightarrow$ `INACTIVE`). Deactivated categories cannot be assigned to new assets, but existing asset references remain intact.
- `deleteAssetCategory.ts`: Administratively deletes a category. Foreign key constraint `onDelete: Restrict` prevents deletion if referenced by any `Asset`, throwing `AssetCategoryDeletionNotAllowedError` (409 Conflict).
- `assetCategoryErrors.ts`: Error classes (`AssetCategoryNotFoundError`, `AssetCategoryAlreadyExistsError`, `AssetCategoryDeletionNotAllowedError`, `AssetCategoryInactiveError`).
- `assetCategory.types.ts`: Service input/output DTOs.

#### 2. REST API Routes for Asset Categories
| HTTP Method | Route Path | Action / Purpose | Permission Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/asset-categories` | List categories (supports `?status=ACTIVE`) | `ASSETS_VIEW` or `ASSET_CATEGORIES_MANAGE` |
| `POST` | `/api/asset-categories` | Create new category | `ASSET_CATEGORIES_MANAGE` |
| `GET` | `/api/asset-categories/[categoryId]` | Get single category details | `ASSETS_VIEW` or `ASSET_CATEGORIES_MANAGE` |
| `PATCH` | `/api/asset-categories/[categoryId]` | Update category name, code, description, sort order, or status | `ASSET_CATEGORIES_MANAGE` |
| `DELETE` | `/api/asset-categories/[categoryId]` | Delete unreferenced category | `ASSET_CATEGORIES_MANAGE` |

---

## 7. Tagging & Metadata Strategy

### 7.1 Multi-Dimensional Tagging (`tags: String[]`)
To support cross-cutting operational classifications that do not fit into a single hierarchical category, `Asset` includes a native string array `tags: String[]`:
- **Examples**: `["critical-infrastructure", "rooftop-crane-required", "confined-space", "tier-1-sla", "warranty-active", "hazmat"]`.
- **Validation**: Lowercased, alphanumeric + hyphen strings (max 30 characters per tag, max 20 tags per asset).
- **Indexing**: Backed by PostgreSQL GIN index (`@@index([tags], type: Gin)`) for high-performance set-containment search (`tags ? 'critical-infrastructure'`).

### 7.2 Hybrid Technical Metadata Strategy (Core Structured Columns + Extensible JSON)
Equipment technical specifications vary drastically across trades:
- **HVAC**: Refrigerant type (R-410A), cooling capacity (tonnage), CFM airflow, electrical phase (3-Phase 480V), filter size (`20x25x4`).
- **Generators**: Fuel type (Diesel/Natural Gas), kW output (250kW), battery voltage (24VDC), fuel tank capacity (500 gal).
- **Elevators**: Capacity (2500 lbs), speed (350 fpm), motor type (Traction/Hydraulic), suspension rope type.

#### The Hybrid Solution:
1. **First-Class Structured Columns**: Universal attributes common to all physical assets are modeled as dedicated indexed columns:
   - `name`, `assetNumber`, `serialNumber`, `modelNumber`, `manufacturer`
   - `installationDate`: `DateTime?`
   - `warrantyExpiresAt`: `DateTime?`
   - `purchaseDate`: `DateTime?`
   - `purchaseCost`: `Decimal?`
   - `subLocationNotes`: `String?`
   - `notes`: `String?` (Text)
2. **Extensible JSON Metadata (`metadata: Json?`)**: Industry-specific and machine-specific key-value technical specifications are stored in a typed JSON column:
   ```json
   {
     "tonnage": 10.5,
     "refrigerantType": "R-410A",
     "voltage": "480V 3-Phase",
     "beltSize": "B-54",
     "filterDimensions": "20x25x4",
     "lastFilterChange": "2026-04-12"
   }
   ```
   - **Validation**: Schema-validated via Zod (object with string/number/boolean primitives or shallow arrays, max depth 2, max payload 32KB).

---

## 8. Asset History & Immutable Audit Ledger

### 8.1 Why a Dedicated `AssetHistory` Model is Mandatory
Physical assets are high-value capital assets with stringent regulatory, safety, and operational liabilities. If an air conditioning compressor blows up or a backup generator fails during a hospital power outage, technicians and legal investigators require an immutable audit trail of who serviced the asset, when it was moved, when its status changed, and what repairs were executed.

### 8.2 Historical Event Types (`AssetHistoryEventType`)
The `AssetHistory` table captures the following event taxonomy:

| Event Type Enum | Trigger Condition | Recorded Data Snapshot |
| :--- | :--- | :--- |
| `CREATED` | Asset registered in workspace. | Initial asset properties, serial, customer, location. |
| `UPDATED` | Core attributes or metadata modified. | Diff of changed fields (`oldValue`, `newValue`). |
| `STATUS_CHANGED` | Operational status changed (e.g. OPERATIONAL $\rightarrow$ OUT_OF_SERVICE). | Old status, new status, required `statusReason`. |
| `LOCATION_TRANSFERRED` | Physical location changed. | Source location, destination location, `transferReason`. |
| `OWNERSHIP_TRANSFERRED` | Customer reassignment. | Old customer, new customer, old location, `transferReason`. |
| `DECOMMISSIONED` | Asset placed on inactive hold. | `decommissionedAt`, `statusReason`. |
| `REACTIVATED` | Asset restored from decommissioned state. | Restoration timestamp, target status, reason. |
| `RETIRED` | Asset permanently retired / scrapped. | `retiredAt`, `statusReason`. |

### 8.3 `AssetHistory` Entity Schema Structure (Conceptual)
- `id`: CUID (Primary Key)
- `workspaceId`: Tenant partition anchor
- `assetId`: Target asset reference (`onDelete: Cascade`)
- `eventType`: `AssetHistoryEventType`
- `actorUserId`: User ID of operator who performed the action (`onDelete: SetNull`)
- `actorRole`: MembershipRole at time of action (e.g. `MANAGER`, `TECHNICIAN`)
- `reason`: Human-readable justification for status change or transfer
- `metadata`: JSON snapshot of changed properties
- `createdAt`: Immutable timestamp (`@default(now())`)

---

## 9. WorkOrder ↔ Asset Relationship Architecture

### 9.1 Relationship Topology & Future Integration
While WorkOrder domain implementation was completed in Phase 1.6, the architectural bridge to Phase 1.7 Assets is defined as follows:

```
+-----------------------------------------------------------------------------------+
|                                  WORK ORDER                                       |
|  - id, workOrderNumber, status, priority, title                                   |
|  - customerId -> Customer.id                                                      |
|  - locationId -> ServiceLocation.id                                               |
|  - workTypeId -> WorkType.id                                                      |
|  - assetId?   -> Asset.id  (Nullable link to physical equipment being serviced)   |
+-----------------------------------------------------------------------------------+
                                      |
                                      | Many-to-One (Optional)
                                      v
+-----------------------------------------------------------------------------------+
|                               ASSET / EQUIPMENT                                   |
|  - id, assetNumber, name, serialNumber, modelNumber                               |
|  - customerId -> Customer.id                                                      |
|  - locationId -> ServiceLocation.id                                               |
+-----------------------------------------------------------------------------------+
```

### 9.2 Key Architectural Invariants for WorkOrder Integration
1. **WorkOrder `assetId` is Nullable**:
   Many field service calls (e.g. "Residential electrical outlet inspection", "General plumbing diagnostic", "Consultation") do not target a pre-registered physical asset. Therefore, `WorkOrder.assetId` is strictly optional.
2. **Customer & Location Consistency Invariant**:
   When a WorkOrder references both an `assetId` and a `customerId` / `locationId`:
   - The Asset's `customerId` **must match** the WorkOrder's `customerId` (unless the asset is unassigned tenant depot equipment being deployed during the job).
   - The Asset's `locationId` **must match** the WorkOrder's `locationId`.
3. **Historical Referential Integrity (`onDelete: Restrict`)**:
   Foreign key constraints prevent deleting an Asset that is referenced by any historical `WorkOrder`.
4. **Permanent WorkOrder History on Asset**:
   An Asset exposes a 1:N query relation to all historical WorkOrders (`Asset.workOrders: WorkOrder[]`). Querying an asset's full service history retrieves all past completed work orders, including parts used, diagnostic notes, and technician resolution comments.

---

## 10. Multi-Tenant Isolation & Security Rules

### 10.1 Workspace Resolution & Enforcement
1. **Never Trust Client Body**: `workspaceId` is NEVER accepted or parsed from client request payloads (`POST`, `PATCH`, `PUT`).
2. **Standard Resolution**: The active workspace is resolved using `extractWorkspaceId(request)` from HTTP headers (`x-workspace-id`) or query parameters.
3. **Session Verification**: The resolved workspace is validated via `requireWorkspaceAuthorization(workspaceId)`, ensuring:
   - User is authenticated with an active session.
   - User account status is `ACTIVE`.
   - User holds an active `WorkspaceMember` record (`membership.status === "ACTIVE"`).

### 10.2 Strict Workspace-Scoped Queries
Every database query in the Asset service layer must explicitly enforce workspace boundary filters:
```typescript
// Example: Scoped Asset Lookup
const asset = await prisma.asset.findFirst({
    where: {
        id: assetId,
        workspaceId, // Tenant Anchor
    },
    include: {
        customer: true,
        location: true,
        category: true,
    },
});
```

### 10.3 IDOR Defense & Cross-Tenant Error Handling (404 Not Found Precedent)
In alignment with the locked security architecture established across Phases 1.4, 1.5, and 1.6:
- If a client requests an `assetId`, `customerId`, `locationId`, or `categoryId` that belongs to another workspace, the service **MUST throw `AssetNotFoundError`** or `AssetCategoryNotFoundError` (translated to HTTP **404 Not Found**).
- *Returning 403 Forbidden for cross-tenant resource IDs is strictly prohibited because it leaks the existence of sensitive resources across tenant boundaries.*

---

## 11. Role-Based Access Control (RBAC) Matrix

### 11.1 Asset Domain Permissions
The following permission constants govern the Asset domain:

| Permission Constant | String Value | Description |
| :--- | :--- | :--- |
| `PERMISSIONS.ASSETS_VIEW` | `"assets.view"` | View equipment list, details, specifications, and service history. |
| `PERMISSIONS.ASSETS_CREATE` | `"assets.create"` | Create new equipment records and asset tags in the workspace. |
| `PERMISSIONS.ASSETS_UPDATE` | `"assets.update"` | Update mutable asset properties, specifications, tags, and notes. |
| `PERMISSIONS.ASSETS_TRANSFER` | `"assets.transfer"` | Transfer equipment between physical locations or customer accounts. |
| `PERMISSIONS.ASSETS_STATUS_CHANGE`| `"assets.status_change"` | Transition operational lifecycle status (`OPERATIONAL`, `DEGRADED`, `OUT_OF_SERVICE`, `IN_STORAGE`). |
| `PERMISSIONS.ASSETS_RETIRE` | `"assets.retire"` | Decommission or permanently retire equipment. |
| `PERMISSIONS.ASSETS_DELETE` | `"assets.delete"` | Administratively purge draft/unreferenced asset records. |
| `PERMISSIONS.ASSET_CATEGORIES_MANAGE` | `"asset_categories.manage"` | Create, update, sort, and deactivate equipment categories in the workspace. |

### 11.2 Role-to-Operation Permission Matrix

| Membership Role | View Assets | Create Asset | Update Specs/Notes | Transfer Location/Customer | Status Change (Degraded/Down/Up) | Decommission / Retire | Administrative Delete | Manage Categories | Scoped Visibility & Operational Rules |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **OWNER** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full Workspace Access |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full Workspace Access |
| **MANAGER** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | Full Workspace Operational Authority |
| **DISPATCHER** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | Operational dispatch, creation, location transfer |
| **TECHNICIAN** | ✅* | ❌ | ✅* | ❌ | ✅* | ❌ | ❌ | ❌ | *Scoped access: Can view assets at assigned jobs; can update diagnostic notes and report operational status (e.g. flag DEGRADED or OUT_OF_SERVICE during repair). |
| **ACCOUNTANT** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Read-Only Access (Equipment valuation, depreciation, warranty auditing). |

*\**Technician Scoping Rule*: A caller holding the `TECHNICIAN` role is authorized to view or update an asset / report status change if and only if the technician is assigned to an active WorkOrder (`OPEN`, `ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`) that explicitly references that `assetId` or that asset's `locationId`.

---

## 12. Service Layer Boundaries

### 12.1 Asset Service Layer (`lib/services/asset/`)
The Asset service module contains pure, self-contained business logic:
- `createAsset.ts`: Validates customer/location parity, verifies category, auto-generates `assetNumber`, creates asset and logs `CREATED` in `AssetHistory`.
- `getAsset.ts`: Retrieves single asset by ID with relations and authorization checks.
- `getAssets.ts`: Paginated list and multi-filter search (`customerId`, `locationId`, `categoryId`, `status`, `search`, `tags`).
- `getAssetOperationalSummary.ts`: Aggregate metrics (counts by status, counts by category, critical out-of-service assets).
- `getAssetHistory.ts`: Retrieves append-only audit trail for an asset.
- `getAssetWorkOrders.ts`: Retrieves past and active WorkOrders targeting this asset.
- `updateAsset.ts`: Updates mutable fields, technical metadata, tags, and writes diff to `AssetHistory`.
- `transitionAssetStatus.ts`: Executes valid state machine transitions with reason tracking; handles the sole exception of setting `locationId = null` upon transition to `IN_STORAGE`.
- `transferAssetLocation.ts`: Relocates equipment to a different site under the same customer.
- `transferAssetOwnership.ts`: Transfers equipment to a different customer with location validation.
- `retireAsset.ts`: Moves asset to terminal `RETIRED` state.
- `deleteAsset.ts`: Administratively purges draft asset with zero references.
- `assetErrors.ts`: Domain error class hierarchy.
- `asset.types.ts`: TypeScript service interfaces and DTOs.

### 12.2 Asset Category Service Layer (`lib/services/assetCategory/`)
The AssetCategory service module manages tenant taxonomy:
- `createAssetCategory.ts`: Creates a new category in workspace.
- `getAssetCategories.ts`: Lists categories for workspace with status filtering (`ACTIVE`, `INACTIVE`, `ALL`).
- `getAssetCategory.ts`: Retrieves single category by ID.
- `updateAssetCategory.ts`: Updates category name, code, description, and sort order.
- `deactivateAssetCategory.ts`: Toggles category status (`ACTIVE` / `INACTIVE`).
- `deleteAssetCategory.ts`: Administratively deletes unreferenced category.
- `assetCategoryErrors.ts`: Category-specific domain error hierarchy.
- `assetCategory.types.ts`: Category service DTOs and interfaces.

### 12.3 External Service Dependencies
- `lib/services/authorization/`: Validates workspace session, role memberships, and granular permission enforcement.
- `lib/services/customer/`: Asserts customer existence and `ACTIVE` status.
- `lib/services/customer/getServiceLocation.ts`: Asserts location existence and customer ownership.

---

## 13. REST API Surface

### 13.1 Asset API Routes
| HTTP Method | Route Path | Action / Purpose | Permission Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/assets` | List, search, filter, and paginate assets | `ASSETS_VIEW` |
| `POST` | `/api/assets` | Create a new asset | `ASSETS_CREATE` |
| `GET` | `/api/assets/summary` | Retrieve operational metrics (counts by status/category) | `ASSETS_VIEW` |
| `GET` | `/api/assets/[assetId]` | Get single asset details with customer, location, and metadata | `ASSETS_VIEW` |
| `PATCH` | `/api/assets/[assetId]` | Update mutable specifications, metadata, tags, and notes | `ASSETS_UPDATE` |
| `PATCH` | `/api/assets/[assetId]/status` | Transition operational status (`OPERATIONAL`, `DEGRADED`, etc.) | `ASSETS_STATUS_CHANGE` / `ASSETS_RETIRE` |
| `POST` | `/api/assets/[assetId]/transfer` | Transfer asset to a different location or customer | `ASSETS_TRANSFER` |
| `GET` | `/api/assets/[assetId]/history` | Retrieve immutable audit trail and move history | `ASSETS_VIEW` |
| `GET` | `/api/assets/[assetId]/work-orders`| Retrieve lifetime WorkOrders executed on this asset | `ASSETS_VIEW` |
| `DELETE` | `/api/assets/[assetId]` | Administratively purge draft/unreferenced asset | `ASSETS_DELETE` |

### 13.2 Asset Category API Routes
| HTTP Method | Route Path | Action / Purpose | Permission Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/asset-categories` | List categories (supports `?status=ACTIVE`) | `ASSETS_VIEW` or `ASSET_CATEGORIES_MANAGE` |
| `POST` | `/api/asset-categories` | Create new category | `ASSET_CATEGORIES_MANAGE` |
| `GET` | `/api/asset-categories/[categoryId]` | Get single category details | `ASSETS_VIEW` or `ASSET_CATEGORIES_MANAGE` |
| `PATCH` | `/api/asset-categories/[categoryId]` | Update category name, code, description, sort order, status | `ASSET_CATEGORIES_MANAGE` |
| `DELETE` | `/api/asset-categories/[categoryId]` | Delete unreferenced category | `ASSET_CATEGORIES_MANAGE` |

---

## 14. Error Taxonomy & HTTP Status Mapping

All Asset and AssetCategory domain errors inherit from standard TypeScript `Error` classes and are translated into standardized JSON responses by `handleAssetApiError()`:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable sanitized error description.",
    "details": {}
  }
}
```

| Domain Error Class | Error Code String | HTTP Status | Trigger Condition |
| :--- | :--- | :---: | :--- |
| `AssetNotFoundError` | `ASSET_NOT_FOUND` | **404** | Asset does not exist in authorized workspace (also used for cross-tenant IDOR protection). |
| `AssetCustomerNotFoundError` | `ASSET_CUSTOMER_NOT_FOUND` | **404** | Specified `customerId` not found in workspace. |
| `AssetCustomerInactiveError` | `ASSET_CUSTOMER_INACTIVE` | **400** | Attempted to assign asset to a deactivated/inactive Customer. |
| `AssetLocationNotFoundError` | `ASSET_LOCATION_NOT_FOUND` | **404** | Specified `locationId` not found in workspace. |
| `AssetLocationCustomerMismatchError`| `ASSET_LOCATION_CUSTOMER_MISMATCH` | **422** | Specified `locationId` does not belong to the specified `customerId`. |
| `AssetCategoryNotFoundError` | `ASSET_CATEGORY_NOT_FOUND` | **404** | Specified `categoryId` not found in workspace. |
| `AssetCategoryAlreadyExistsError` | `ASSET_CATEGORY_ALREADY_EXISTS` | **409** | Name or code collision on `[workspaceId, name]` or `[workspaceId, code]`. |
| `AssetCategoryInactiveError` | `ASSET_CATEGORY_INACTIVE` | **400** | Attempted to assign a deactivated category to an asset. |
| `AssetCategoryDeletionNotAllowedError`| `ASSET_CATEGORY_DELETION_NOT_ALLOWED` | **409** | Attempted to delete a category referenced by existing assets. |
| `AssetInvalidStatusTransitionError`| `ASSET_INVALID_STATUS_TRANSITION` | **409** | Requested `(from, to)` status transition is not permitted by state machine. |
| `AssetMissingStatusReasonError` | `ASSET_MISSING_STATUS_REASON` | **422** | Required `statusReason` omitted for critical transition (e.g. OUT_OF_SERVICE, RETIRED). |
| `AssetMissingTransferReasonError` | `ASSET_MISSING_TRANSFER_REASON` | **422** | Required `transferReason` omitted for location or ownership transfer. |
| `AssetImmutableError` | `ASSET_IMMUTABLE` | **409** | Attempted to mutate fields on a terminal (`RETIRED`) asset. |
| `AssetDeletionNotAllowedError` | `ASSET_DELETION_NOT_ALLOWED` | **409** | Attempted to delete an asset that has downstream WorkOrders or audit dependencies. |
| `DuplicateAssetNumberError` | `DUPLICATE_ASSET_NUMBER` | **409** | Uniqueness collision on `[workspaceId, assetNumber]`. |
| `ZodError` | `VALIDATION_ERROR` | **422** | Request payload failed schema validation. |
| `UnauthorizedError` | `UNAUTHORIZED` | **401** | Missing or expired user session. |
| `WorkspaceAccessDeniedError` | `FORBIDDEN` | **403** | User not an active member of the workspace. |
| `ForbiddenError` | `FORBIDDEN` | **403** | Caller lacks required RBAC permission for this operation. |

---

## 15. Canonical Asset Read Model (Conceptual DTOs)

### 15.1 Detailed Asset Model (`AssetDetailViewModel`)
```json
{
  "id": "ast_cl9384jd7000108vb2x",
  "workspaceId": "ws_alpha_corp",
  "assetNumber": "AST-000142",
  "name": "Rooftop Chiller Unit #4",
  "status": "OPERATIONAL",
  "manufacturer": "Carrier",
  "modelNumber": "30RAP-055",
  "serialNumber": "SN-2024-884920-X",
  "subLocationNotes": "North Rooftop, Access via Ladder Bay 3",
  "installationDate": "2024-03-15T00:00:00.000Z",
  "warrantyExpiresAt": "2029-03-15T00:00:00.000Z",
  "purchaseDate": "2024-02-01T00:00:00.000Z",
  "purchaseCost": "45000.00",
  "notes": "Annual coil cleaning required every March.",
  "tags": ["critical-infrastructure", "rooftop", "tier-1-sla"],
  "metadata": {
    "tonnage": 55,
    "refrigerantType": "R-410A",
    "voltage": "480V 3-Phase",
    "compressorCount": 2
  },
  "customer": {
    "id": "cust_88294719",
    "customerNumber": "CUST-00102",
    "name": "Acme Industrial Logistics"
  },
  "location": {
    "id": "loc_99281726",
    "name": "Main Distribution Warehouse",
    "addressLine1": "100 Industrial Parkway",
    "city": "Dallas",
    "state": "TX",
    "latitude": 32.7767,
    "longitude": -96.7970
  },
  "category": {
    "id": "cat_77192834",
    "name": "Commercial Chillers",
    "code": "HVAC-CHILL"
  },
  "createdAt": "2024-03-15T10:00:00.000Z",
  "updatedAt": "2026-08-20T14:30:00.000Z",
  "decommissionedAt": null,
  "retiredAt": null
}
```

---

## 16. Field Mutability & Immutability Rules

| Entity | Classification | Field Name(s) | Mutation Policy & Governance |
| :--- | :--- | :--- | :--- |
| **Asset** | **Strictly Immutable** | `id`, `workspaceId`, `createdAt` | **Write-Once at Creation**. Cannot be altered under any circumstances. |
| **Asset** | **Admin-Guarded Unique** | `assetNumber` | Set at creation. Mutable only by `OWNER` / `ADMIN` prior to downstream work order association. Locked once historical work orders exist. |
| **Asset** | **Standard Mutable** | `name`, `manufacturer`, `modelNumber`, `serialNumber`, `subLocationNotes`, `installationDate`, `warrantyExpiresAt`, `purchaseDate`, `purchaseCost`, `notes`, `tags`, `metadata`, `categoryId` | Mutable via `PATCH /api/assets/[assetId]` by authorized roles (`OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, or assigned `TECHNICIAN`). |
| **Asset** | **State-Machine Governed** | `status`, `decommissionedAt`, `retiredAt` | **Mutable ONLY via `transitionAssetStatus` or `retireAsset`**. Direct HTTP payload overwrites are stripped and rejected. |
| **Asset** | **Transfer & Location Governed** | `customerId`, `locationId` | **Mutable ONLY via `transferAssetLocation` or `transferAssetOwnership`**.<br><br>*Explicit Exception*: The `transitionAssetStatus` service is the **sole exception** permitted to set `locationId = null`, and strictly when transitioning an asset from an active site into `IN_STORAGE` (uninstallation back to depot). Direct HTTP `PATCH` payload overwrites are stripped and rejected. |
| **AssetCategory**| **Strictly Immutable** | `id`, `workspaceId`, `createdAt` | **Write-Once at Creation**. Cannot be altered under any circumstances. |
| **AssetCategory**| **Category Mutable** | `name`, `code`, `description`, `sortOrder`, `status` | Mutable via `PATCH /api/asset-categories/[categoryId]` by `OWNER`, `ADMIN`, `MANAGER` holding `PERMISSIONS.ASSET_CATEGORIES_MANAGE`. |

---

## 17. Deletion, Deactivation & Retirement Governance

```
+---------------------------------------------------------------------------------------------------+
|                                 LIFECYCLE SEPARATION OF CONCERNS                                  |
|                                                                                                   |
|   +---------------------+     +--------------------------+     +------------------------------+   |
|   |    HARD DELETION    |     | DEACTIVATION (MOTHBALL)  |     |      RETIREMENT (TERMINAL)   |   |
|   | (Purge Draft/Error) |     | (Temporary Interruption) |     |    (End of Physical Life)    |   |
|   +----------+----------+     +------------+-------------+     +--------------+---------------+   |
|              |                             |                                  |                   |
|              v                             v                                  v                   |
|   • Allowed ONLY if 0 WorkOrders • Preserves all historical records • Permanent end-of-life state |
|   • Purges record from database  • Prevents NEW work orders         • Locked against new jobs     |
|   • Restricted to OWNER/ADMIN    • Reversible back to active        • Retains full audit history  |
+---------------------------------------------------------------------------------------------------+
```

### 17.1 Hard Deletion Policy (`deleteAsset`)
- **Strict Invariant**: Hard deletion of an Asset is permitted **ONLY** for draft or mistakenly registered assets that have **ZERO downstream `WorkOrder` associations** and zero operational dependencies.
- **Foreign Key Enforcement**: PostgreSQL `onDelete: Restrict` prevents deletion if any `WorkOrder` references `assetId`. Prisma error `P2003` is caught and translated to `AssetDeletionNotAllowedError` (409 Conflict).
- **RBAC Gating**: Restricted exclusively to `OWNER` and `ADMIN` roles holding `assets.delete`.

### 17.2 Deactivation / Decommissioning Policy (`DECOMMISSIONED`)
- **Semantics**: Asset is taken offline indefinitely or mothballed (e.g., winter building closure, tenant vacancy).
- **Behavior**:
  - Existing WorkOrders and location links remain intact.
  - Creating new operational WorkOrders against this asset is **BLOCKED** (except for specialized "Recommissioning Inspection" work types).
  - Can be reactivated back to `OPERATIONAL` or `IN_STORAGE` at any time by authorized managers.

### 17.3 Retirement Policy (`RETIRED`)
- **Semantics**: Physical hardware has reached end of life, was scrapped, destroyed in an accident, or permanently replaced.
- **Behavior**:
  - Irreversible terminal state.
  - Sets `retiredAt = now()`.
  - Creating new WorkOrders is permanently **BLOCKED**.
  - Retains all historical records, past WorkOrders, parts history, and audit trails forever.

---

## Summary of Decisions, Flags & Open Sign-Off Items

### 1. Permissions Defined for Phase 1.7
The following permissions govern Phase 1.7 and will be added to `lib/services/authorization/permissions.ts`:
- `PERMISSIONS.ASSETS_VIEW = "assets.view"`
- `PERMISSIONS.ASSETS_CREATE = "assets.create"`
- `PERMISSIONS.ASSETS_UPDATE = "assets.update"`
- `PERMISSIONS.ASSETS_TRANSFER = "assets.transfer"`
- `PERMISSIONS.ASSETS_STATUS_CHANGE = "assets.status_change"`
- `PERMISSIONS.ASSETS_RETIRE = "assets.retire"`
- `PERMISSIONS.ASSETS_DELETE = "assets.delete"`
- `PERMISSIONS.ASSET_CATEGORIES_MANAGE = "asset_categories.manage"`

### 2. Open Items for Human Review Before Phase 1.7.2 (Prisma Schema)
1. **Asset Number Prefix Customization**: The standard auto-generation uses `AST-XXXXXX` (e.g. `AST-000104`). Should workspaces be allowed to configure a custom prefix in `Workspace.settings` in a future phase (e.g. `EQ-` or `HVAC-`), or is `AST-` standard acceptable?
2. **Technician Asset Creation on Mobile/Field**: In current RBAC, `TECHNICIAN` cannot create new assets from scratch (only Owner/Admin/Manager/Dispatcher). In field service, technicians often discover unregistered equipment on site. Should technicians have a restricted "Register Discovered Asset" capability, or should creation remain manager-only? (Currently locked to Owner/Admin/Manager/Dispatcher).
3. **Multi-Asset WorkOrders**: Currently, `WorkOrder.assetId` models 1:1 primary asset targeting per work order (nullable). If multi-asset inspections (e.g. inspecting 30 fire extinguishers on one work order) are required later, a junction model `WorkOrderAsset` will be added in a future phase.
