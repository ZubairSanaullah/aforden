# Phase 1.10.1 — Inventory & Parts Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.10 Architecture Standard)
> **Domain**: Parts Catalog, Inventory Locations, Stock Balances, Stock Movements, Work Order Part Consumption, Technician Stock
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customers & Service Locations), Phase 1.5 (Service Catalog & Work Types), Phase 1.6 (Work Orders), Phase 1.7 (Assets & Equipment), Phase 1.8 (Scheduling & Dispatch), Phase 1.9 (Technician Operations)
> **Target Schema & Service Implementation**: Phase 1.10.2+

---

## Executive Summary

Phase 1.10 introduces the **Inventory & Parts** domain to the Aforden Field Service Management (FSM) platform. In prior phases, the platform established tenant isolation (1.1), authentication and RBAC (1.2), technician profiles and organizational hierarchies (1.3), customer premises and service locations (1.4), cataloged service offerings (1.5), operational WorkOrders (1.6), physical customer equipment (1.7), calendar scheduling and dispatch (1.8), and technician field execution workflows (1.9).

Phase 1.10 turns the platform from a labor-only FSM into a **labor-and-parts FSM** by introducing the ability to catalog spare parts and consumables, track stock levels across warehouses/vehicles/technician kits, atomically consume parts against WorkOrders, transfer stock between locations, and maintain an immutable audit ledger of every stock movement.

This document is the binding architectural contract for Phase 1.10. It defines all domain boundaries, entity models, invariants, integration contracts with WorkOrders (1.6) and Technician Operations (1.9), concurrency strategy, and API interfaces before any schema migration or service code is written.

---

```
+---------------------------------------------------------------------------------------------------+
|                                        WORKSPACE (Tenant)                                         |
|                                                                                                   |
|   +-----------------------+       +------------------------+       +--------------------------+   |
|   |       CUSTOMER        |       |    SERVICE LOCATION    |       |     ASSET / EQUIPMENT    |   |
|   |      (Phase 1.4)      |       |      (Phase 1.4)       |       |       (Phase 1.7)        |   |
|   +-----------+-----------+       +-----------+------------+       +------------+-------------+   |
|               |                               |                                 |                 |
|               +-----------------------+       |       +-------------------------+                 |
|                                       |       |       |                                           |
|                                       v       v       v                                           |
|                           +---------------------------------------+                               |
|                           |              WORK ORDER               |                               |
|                           |              (Phase 1.6)              |                               |
|                           |  - status: OPEN | ASSIGNED | ...      |                               |
|                           |  - assignedTechnicianId               |                               |
|                           +-------------------+-------------------+                               |
|                                               |                                                   |
|                                               | 1:N WorkOrderPart                                 |
|                                               v                                                   |
|   =============================================================================================   |
|   |                              INVENTORY & PARTS DOMAIN                                  |   |
|   |                                       (Phase 1.10)                                     |   |
|   |                                                                                         |   |
|   |   +-------------------+    +-------------------+    +-------------------------------+    |   |
|   |   |    Part Catalog   |    | InventoryLocation |    |     InventoryBalance          |    |   |
|   |   |  (workspace-scoped)|   |  (WAREHOUSE /     |    |  (partId + locationId)        |    |   |
|   |   |  name, sku, UoM   |    |   VEHICLE /        |    |  qtyOnHand, qtyReserved       |    |   |
|   |   |  unitCost, status |    |   TECHNICIAN_STOCK)|    |  qtyAvailable (computed)      |    |   |
|   |   +-------------------+    +-------------------+    +-------------------------------+    |   |
|   |            |                         |                         |                         |   |
|   |            v                         v                         v                         |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |   |                         StockMovement (Immutable Ledger)                         |   |   |
|   |   |  RECEIPT | TRANSFER_IN/OUT | ADJUSTMENT | RESERVATION | RELEASE | CONSUMPTION    |   |   |
|   |   |  RETURN                                                                  |   |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |            |                                                                            |   |
|   |            v                                                                            |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |   |                    WorkOrderPart (Consumption Records)                            |   |   |
|   |   |  workOrderId, partId, locationId, quantity, snapshot (name, sku, cost)            |   |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   =============================================================================================   |
+---------------------------------------------------------------------------------------------------+
```

---

## 1. Domain Boundary & Ownership Matrix

### 1.1 Strict Domain Ownership Rules

| Domain | Owns | Does NOT Own / Consumes |
| :--- | :--- | :--- |
| **Inventory & Parts** (Phase 1.10) | Part catalog entity, InventoryLocation entity, InventoryBalance (quantity on hand / reserved), StockMovement immutable ledger, WorkOrderPart consumption records, technician stock identity. | WorkOrder lifecycle/status transitions (Phase 1.6), technician time entries (Phase 1.9), scheduling/dispatch (Phase 1.8), customer information (Phase 1.4). |
| **WorkOrders** (Phase 1.6) | WorkOrder entity, canonical status state machine, priority, assignment, completion preconditions. Does NOT own part consumption records — these live in Inventory domain. | Parts catalog, stock balances, consumption recording (Phase 1.10). |
| **Technician Operations** (Phase 1.9) | Field execution workflows, time tracking, completion evidence. | Part catalog, stock management. Consumes Part data read-only for consumption recording. |
| **Quotes & Estimates** (Phase 1.11) | Estimates, line items, customer approval. | Live inventory transactions. |
| **Invoicing & Payments** (Phase 1.12) | Invoices, payment processing. | Consumes WorkOrderPart records for parts billing lines (read-only). |
| **Reporting & Analytics** (Phase 1.14) | Aggregated KPIs, utilization metrics. | Live inventory transactions (reads snapshots only). |

### 1.2 Explicit Exclusions from Phase 1.10

The following capabilities are **NOT** part of this phase:

- **Quotes & Estimates** (Phase 1.11) — quoting part costs to customers.
- **Invoicing & Payments** (Phase 1.12) — billing parts to customers.
- **Procurement / Purchase Orders** — ordering parts from suppliers.
- **Notifications** (Phase 1.13) — low-stock alerts, receipt confirmations.
- **Reporting & Analytics** (Phase 1.14) — inventory valuation reports, consumption analytics.
- **Barcode / RFID scanning** — hardware integration for scan-to-receive or scan-to-consume.
- **Multi-currency** — currency handling is deferred; unit costs are workspace-local Decimal values.
- **UI / Mobile Views** (Phase 1.23) — frontend interfaces.
- **Lot tracking / Expiry dates** — advanced traceability features beyond basic SKU tracking.

---

## 2. Existing Architecture Patterns (Observed & Reused)

### 2.1 Prisma Schema Conventions

| Convention | Observed Pattern | Phase 1.10 Adoption |
| :--- | :--- | :--- |
| **IDs** | `String @id @default(cuid())` on every model | ✅ Adopted identically |
| **Multi-tenancy** | Every domain entity has `workspaceId String` with `onDelete: Cascade` FK to `Workspace` | ✅ Adopted identically |
| **Soft delete** | Not used. Entities have `status` enums (ACTIVE/INACTIVE) and terminal states instead | ✅ Adopted — Part uses ACTIVE/INACTIVE, no destructive delete |
| **Audit timestamps** | `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` on mutable entities | ✅ Adopted on mutable entities; immutable ledger (StockMovement) has only `createdAt` |
| **History/audit tables** | Separate immutable history models (WorkOrderHistory, AssetHistory, ScheduleAppointmentHistory) with `eventType` enum, `actorMemberId`, `actorName`, `field`, `oldValue`, `newValue`, `metadata` | ✅ StockMovement IS the audit ledger — no separate history table needed |
| **onDelete patterns** | Cascade on `workspaceId`, Restrict on operational FKs, SetNull on optional references | ✅ Adopted identically |
| **Unique constraints** | `@@unique([workspaceId, fieldName])` for natural uniqueness (e.g., `[workspaceId, name]`, `[workspaceId, assetNumber]`) | ✅ Applied to SKU uniqueness |

### 2.2 Execution Chain Pattern

Every service function in the codebase follows this exact sequence:

```
1. AUTHENTICATION         → requireWorkspaceAuthorization(workspaceId)
2. RBAC PERMISSION        → assertPermission(role, PERMISSIONS.XXX)
3. INPUT VALIDATION       → zodSchema.parse(input)
4. ENTITY RESOLUTION      → prisma.entity.findFirst({ where: { id, workspaceId } })
5. BUSINESS RULE CHECKS   → Domain-specific invariants, precondition guards
6. ATOMIC TRANSACTION     → prisma.$transaction(async (tx) => { ... })
   6a. PRIMARY MUTATION   → tx.entity.create/update
   6b. AUDIT RECORD       → tx.historyEntity.create (if applicable)
7. READ MODEL MAPPING     → Map raw Prisma model to canonical DTO
8. RETURN                 → Return read model to route handler
```

**File/Folder Structure** (observed across all domains):

```
lib/services/[domain]/
  ├── index.ts                          # Barrel exports
  ├── [domain]Errors.ts                 # Pure domain error classes
  ├── [domain].types.ts                 # Read model interfaces, input DTOs
  ├── [domain].schemas.ts               # Zod validation schemas (optional, sometimes in lib/validations/)
  ├── create[Entity].ts                 # One file per service operation
  ├── get[Entity].ts
  ├── get[Entities].ts
  ├── update[Entity].ts
  ├── delete[Entity].ts
  └── [action].ts                       # Domain-specific actions

lib/validations/[domain].ts             # Zod schemas (re-exports or standalone)

lib/utils/[domain]ApiError.ts           # Error-to-HTTP response mapping

app/api/[domain]/
  ├── route.ts                          # GET (list) + POST (create)
  └── [entityId]/
      ├── route.ts                      # GET (detail) + PATCH (update) + DELETE
      └── [action]/
          └── route.ts                  # Action-specific routes
```

### 2.3 RBAC Permission Model

Permissions are defined as `domain.action` string constants in `lib/services/authorization/permissions.ts`:

```typescript
export const PERMISSIONS = {
    WORK_ORDERS_VIEW: "work_orders.view",
    WORK_ORDERS_CREATE: "work_orders.create",
    // ...
    ASSETS_VIEW: "assets.view",
    ASSETS_CREATE: "assets.create",
    // ...
} as const;
```

Each role maps to a permission array in `lib/services/authorization/rolePermissions.ts`:

| Role | Access Level |
| :--- | :--- |
| **OWNER** | Full permissions (ALL_PERMISSIONS) |
| **ADMIN** | Full operational permissions including delete |
| **MANAGER** | Create, update, view — no delete |
| **DISPATCHER** | Create, update, view — limited domain scope |
| **TECHNICIAN** | View + limited update on assigned resources |
| **ACCOUNTANT** | View-only on operational domains, full billing |

**Phase 1.10 permissions** will follow this exact pattern (detailed in Section 13).

### 2.4 API Contract Conventions

**Success envelope**:
```json
{ "success": true, "data": { ... } }
```

**Error envelope**:
```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human-readable message." } }
```

**Validation error envelope** (422):
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid request data.", "fields": { ... } } }
```

**Missing workspace** (400):
```json
{ "success": false, "error": { "code": "MISSING_WORKSPACE", "message": "Workspace ID is required." } }
```

**Workspace extraction**: `x-workspace-id` header > `workspace-id` header > `?workspaceId=` query parameter.

**HTTP status codes**: 200 (success), 201 (created), 400 (bad request / missing workspace), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (conflict / lifecycle violation), 422 (validation / precondition), 500 (internal).

### 2.5 Transaction Primitive

The codebase uses **Prisma interactive transactions** throughout:

```typescript
const result = await prisma.$transaction(async (tx) => {
    // All operations within tx share a single database connection
    // and are committed atomically
});
```

This is confirmed in `createWorkOrder.ts`, `startTechnicianTravel.ts`, `recordTechnicianTimeEntry.ts`, and all other mutation services. No raw SQL transactions or alternative transaction managers are used.

### 2.6 Error Class Patterns

Two conventions coexist, both acceptable:

**Convention A** (WorkOrder pattern — pure domain errors, no HTTP properties):
```typescript
export class WorkOrderNotFoundError extends Error {
    constructor(message = "Work order not found.") {
        super(message);
        self.name = "WorkOrderNotFoundError";
    }
}
```

**Convention B** (Asset pattern — domain errors with code/statusCode metadata):
```typescript
export class AssetNotFoundError extends Error {
    readonly code = "ASSET_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;
    constructor(message = "Asset not found.") {
        super(message);
        this.name = "AssetNotFoundError";
    }
}
```

**Phase 1.10 adopts Convention B** (with `code`, `statusCode`, `httpStatus` readonly properties) because it simplifies the error-to-HTTP mapping function — the handler can check for the metadata properties generically rather than maintaining a long instanceof chain. This is the more recent pattern (Phase 1.7+) and reduces boilerplate in the error mapping utility.

---

## 3. Part Entity

### 3.1 Design Rationale

The Part entity follows the **WorkType** pattern from Phase 1.5: a catalog entity that can be referenced (consumed) by downstream operational records, with snapshot fields preserving the values at time of consumption.

Part is analogous to WorkType in the ServiceCatalog hierarchy:
- WorkType → consumed by WorkOrder (snapshot: workTypeName, workTypeCode)
- Part → consumed by WorkOrderPart (snapshot: partName, partSku, unitCostAtTimeOfUse)

However, Part is simpler than WorkType: it does not nest under a parent catalog. Parts are flat within a workspace, optionally grouped by category.

### 3.2 Proposed Fields

| Field | Type | Required | Default | Justification |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `String @id @default(cuid())` | ✅ | auto | Standard platform ID convention |
| `workspaceId` | `String` | ✅ | — | Multi-tenancy scoping (all entities) |
| `name` | `String` | ✅ | — | Human-readable part name. Follows `WorkType.name` / `ServiceCatalog.name` pattern. Max 200 chars. |
| `sku` | `String?` | ❌ | null | Stock Keeping Unit — optional user-assigned code. Unique per workspace when provided. Follows `Asset.assetNumber` / `WorkType.code` pattern. Max 50 chars. |
| `description` | `String? @db.Text` | ❌ | null | Extended description. Follows `ServiceCatalog.description` pattern. Max 4000 chars. |
| `unitOfMeasure` | `String` | ✅ | `"EACH"` | Unit of measure for the part (EACH, BOX, FOOT, METER, LITER, KIT, etc.). Required because quantity tracking is meaningless without knowing what "1" means. Defaults to EACH (discrete items). |
| `unitCost` | `Decimal? @db.Decimal(12, 2)` | ❌ | null | Current catalog cost per unit. Used as the default cost for new receipts. Nullable because cost may not be known at creation time. Follows `Asset.purchaseCost` Decimal pattern. Does NOT govern historical cost — that is snapshotted in StockMovement and WorkOrderPart. |
| `status` | `PartStatus @default(ACTIVE)` | ✅ | ACTIVE | Lifecycle status. ACTIVE parts can be received and consumed. INACTIVE parts cannot be newly received but historical references remain intact. |
| `createdAt` | `DateTime @default(now())` | ✅ auto | auto | Standard audit timestamp |
| `updatedAt` | `DateTime @updatedAt` | ✅ auto | auto | Standard audit timestamp |

### 3.3 Unique Constraints & Indexes

```prisma
@@unique([workspaceId, name])          // Natural uniqueness: one part name per workspace
@@unique([workspaceId, sku])           // SKU uniqueness (partial — only enforced when sku is non-null at DB level via application logic)
@@index([workspaceId])
@@index([workspaceId, status])
@@index([sku])                         // Global SKU lookup (cross-workspace for admin purposes)
```

**Note on SKU uniqueness**: PostgreSQL unique constraints treat NULL as distinct, so `@@unique([workspaceId, sku])` allows multiple NULL SKUs. If two parts in the same workspace both have `sku = "FILTER-001"`, the constraint catches it. If both have `sku = null`, that is permitted. This matches the desired behavior.

### 3.4 Lifecycle States

```
           createPart()
               │
               v
        ┌──────────────┐
        │    ACTIVE     │◄──── reactivatePart()
        └──────┬───────┘
               │
               │ deactivatePart()
               v
        ┌──────────────┐
        │   INACTIVE    │
        └──────────────┘
```

**Invariants**:
- `ACTIVE` → `INACTIVE`: Allowed at any time. Part cannot be newly received or used in new reservations while INACTIVE. Existing reservations and consumption records are unaffected.
- `INACTIVE` → `ACTIVE`: Reactivation allowed. Restores full operational availability.
- **No destructive delete**: If a Part has any StockMovement records or WorkOrderPart records, hard deletion is blocked at the database level via `onDelete: Restrict` on those FKs. Even without historical references, deletion is blocked at the service layer to prevent accidental data loss (consistent with `WorkOrderDeletionNotAllowedError` and `AssetDeletionNotAllowedError` patterns).

---

## 4. InventoryLocation Entity

### 4.1 Design Rationale

InventoryLocation represents any physical or logical place where parts stock is held. The entity must be generic enough to represent:

- **Warehouses / depots** — central storage facilities
- **Service vehicles** — technician vans/trucks carrying stock
- **Technician kits** — personal tool/parts kits assigned to individual technicians
- **Customer site stock** — parts pre-positioned at a customer location (future extensibility)

This follows the `ServiceLocation` pattern (workspace-scoped, optional address, typed) but with inventory-specific attributes.

### 4.2 Proposed Fields

| Field | Type | Required | Default | Justification |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `String @id @default(cuid())` | ✅ | auto | Standard platform ID convention |
| `workspaceId` | `String` | ✅ | — | Multi-tenancy scoping |
| `name` | `String` | ✅ | — | Human-readable location name (e.g., "Main Warehouse", "Van #42", "John's Kit"). Max 100 chars. |
| `code` | `String?` | ❌ | null | Short code for quick reference (e.g., "WH-01", "VAN-42"). Max 20 chars. Unique per workspace. |
| `locationType` | `InventoryLocationType` | ✅ | `"WAREHOUSE"` | Categorizes the location: WAREHOUSE, VEHICLE, TECHNICIAN_STOCK, OTHER. Determines operational behavior (e.g., TECHNICIAN_STOCK locations are scoped to a single technician). |
| `technicianProfileId` | `String?` | ❌ | null | For `TECHNICIAN_STOCK` type: FK to `TechnicianProfile`. Links this location to a specific technician. Null for WAREHOUSE and VEHICLE types. `onDelete: SetNull` (location persists if technician profile is deactivated). |
| `addressLine1` | `String?` | ❌ | null | Physical address (optional, relevant for warehouses). Follows `ServiceLocation` pattern. |
| `addressLine2` | `String?` | ❌ | null | |
| `city` | `String?` | ❌ | null | |
| `state` | `String?` | ❌ | null | |
| `postalCode` | `String?` | ❌ | null | |
| `country` | `String?` | ❌ | null | |
| `notes` | `String? @db.Text` | ❌ | null | Free-text notes. Follows `Employee.notes` / `Asset.notes` pattern. Max 2000 chars. |
| `status` | `InventoryLocationStatus @default(ACTIVE)` | ✅ | ACTIVE | Lifecycle status. INACTIVE locations cannot receive new stock but existing balances remain intact. |
| `createdAt` | `DateTime @default(now())` | ✅ auto | auto | Standard audit timestamp |
| `updatedAt` | `DateTime @updatedAt` | ✅ auto | auto | Standard audit timestamp |

### 4.3 Unique Constraints & Indexes

```prisma
@@unique([workspaceId, name])          // Natural uniqueness
@@unique([workspaceId, code])          // Code uniqueness (partial — NULL allowed)
@@index([workspaceId])
@@index([workspaceId, status])
@@index([workspaceId, locationType])
@@index([technicianProfileId])          // Quick lookup: "show me John's stock location"
```

### 4.4 Location Type Semantics

| Type | Semantics | technicianProfileId | Address |
| :--- | :--- | :---: | :--- |
| `WAREHOUSE` | Central or regional storage facility. Multiple technicians may draw from this location. | Null | Optional (typically present) |
| `VEHICLE` | Service vehicle. Stock travels with the vehicle. May be assigned to one or more technicians. | Null | Not applicable |
| `TECHNICIAN_STOCK` | Personal parts kit assigned to a specific technician. Only that technician's stock is visible in this location. | **Required** (non-null) | Not applicable |
| `OTHER` | Catch-all for non-standard storage (e.g., customer site stock, temporary staging area). | Null | Optional |

**Invariant**: If `locationType = TECHNICIAN_STOCK`, then `technicianProfileId` MUST be non-null. Enforced at the service validation layer via Zod superRefine.

---

## 5. InventoryBalance Model

### 5.1 Design Rationale

InventoryBalance is the **current point-in-time snapshot** of how much of a given Part exists at a given InventoryLocation. It is NOT a ledger — it is the materialized result of all StockMovements applied to a (partId, locationId) pair.

This separation follows the **CQRS-lite** pattern: StockMovement is the write-optimized append-only ledger (source of truth), while InventoryBalance is the read-optimized current-state projection (derived from the ledger, but mutated directly for performance within the same transaction).

### 5.2 Proposed Fields

| Field | Type | Required | Default | Justification |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `String @id @default(cuid())` | ✅ | auto | Standard platform ID convention |
| `workspaceId` | `String` | ✅ | — | Multi-tenancy scoping (also enables workspace-level queries) |
| `partId` | `String` | ✅ | — | FK to Part. `onDelete: Restrict` — cannot delete a Part with active balances. |
| `locationId` | `String` | ✅ | — | FK to InventoryLocation. `onDelete: Restrict` — cannot delete a location with active balances. |
| `quantityOnHand` | `Decimal @db.Decimal(12, 4)` | ✅ | `0` | Total physical quantity currently at this location. Always >= 0. Precision of 4 decimal places supports fractional UoMs (e.g., 1.5 meters of pipe). |
| `quantityReserved` | `Decimal @db.Decimal(12, 4)` | ✅ | `0` | Quantity reserved for specific WorkOrders but not yet consumed. Always >= 0 and <= quantityOnHand. |
| `createdAt` | `DateTime @default(now())` | ✅ auto | auto | Standard audit timestamp |
| `updatedAt` | `DateTime @updatedAt` | ✅ auto | auto | Standard audit timestamp |

### 5.3 Derived Field: quantityAvailable

```
quantityAvailable = quantityOnHand - quantityReserved
```

This is computed at the service/read-model layer, NOT stored in the database. The invariant `quantityOnHand >= quantityReserved >= 0` is enforced at the transaction level (see Section 8 — Concurrency Strategy).

### 5.4 Unique Constraints & Indexes

```prisma
@@unique([workspaceId, partId, locationId])   // One balance per part per location per workspace
@@index([workspaceId])
@@index([workspaceId, partId])                 // "How much of Part X exists across all locations?"
@@index([workspaceId, locationId])             // "What parts are at Location Y?"
@@index([partId])                              // Cross-location part summary
```

### 5.5 Invariant: Non-Negative Quantities

Within every committed transaction:
- `quantityOnHand >= 0`
- `quantityReserved >= 0`
- `quantityOnHand >= quantityReserved` (equivalently: `quantityAvailable >= 0`)

These invariants are enforced by:
1. Application-level validation before mutation (service layer).
2. Row-level locking during transaction to prevent concurrent violations (Section 8).
3. Optional database CHECK constraints as a safety net (future hardening).

---

## 6. StockMovement Ledger

### 6.1 Design Rationale

StockMovement is the **immutable, append-only audit ledger** of every quantity change to any InventoryBalance. It is the single source of historical truth for:

- **What happened**: Which movement type occurred.
- **When it happened**: Timestamp of the movement.
- **Where it happened**: Source and destination locations.
- **Why it happened**: Reference to the triggering record (WorkOrder, transfer request, manual adjustment).
- **How much**: The quantity moved.
- **What it cost**: Unit cost at the time of the movement (snapshot).

StockMovement replaces the need for a separate `InventoryHistory` or `InventoryAuditLog` table. Unlike WorkOrderHistory/AssetHistory/ScheduleAppointmentHistory (which track entity field changes), StockMovement tracks **quantity flow events** — it IS the audit trail.

### 6.2 Movement Types

| Movement Type | Direction | Description | Requires |
| :--- | :--- | :--- | :--- |
| `RECEIPT` | Inbound (+) | Parts received into inventory from a supplier, return from field, or initial stock entry. | `locationId` (destination), `quantity`, `unitCostSnapshot` |
| `TRANSFER_OUT` | Outbound (−) | Parts moved FROM this location to another. Creates paired TRANSFER_IN at destination. | `fromLocationId`, `toLocationId`, `quantity` |
| `TRANSFER_IN` | Inbound (+) | Parts received at destination from a transfer. Paired with TRANSFER_OUT at source. | `fromLocationId`, `toLocationId`, `quantity` |
| `ADJUSTMENT` | Inbound (+) or Outbound (−) | Manual stock correction (e.g., cycle count correction, damage write-off, found extra stock). Can be positive or negative. | `locationId`, `quantity` (signed), `reason` |
| `RESERVATION` | Reserve (+) | Parts reserved for a specific WorkOrder. Increases `quantityReserved`, does NOT change `quantityOnHand`. | `locationId`, `quantity`, `workOrderId` |
| `RELEASE` | Un-reserve (−) | Reservation cancelled or reduced. Decreases `quantityReserved`. | `locationId`, `quantity`, `workOrderId` |
| `CONSUMPTION` | Outbound (−) | Parts actually consumed/used on a WorkOrder. Decreases `quantityOnHand` and `quantityReserved`. Creates WorkOrderPart record. | `locationId`, `quantity`, `workOrderId`, `unitCostSnapshot` |
| `RETURN` | Inbound (+) | Unused parts returned from a WorkOrder back to inventory. Increases `quantityOnHand` and decreases `quantityReserved` (if reservation exists). | `locationId`, `quantity`, `workOrderId` |

### 6.3 Proposed Fields

| Field | Type | Required | Default | Justification |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `String @id @default(cuid())` | ✅ | auto | Standard platform ID convention |
| `workspaceId` | `String` | ✅ | — | Multi-tenancy scoping |
| `partId` | `String` | ✅ | — | FK to Part. `onDelete: Restrict` — movements are immortal. |
| `locationId` | `String?` | ❌ | null | FK to InventoryLocation. Primary location affected. Null for cross-location conceptual movements (though in practice, all movements touch at least one location). |
| `movementType` | `StockMovementType` | ✅ | — | One of the eight types listed above. |
| `quantity` | `Decimal @db.Decimal(12, 4)` | ✅ | — | Absolute quantity of the movement. Always positive. The direction (inbound/outbound) is determined by `movementType`. |
| `fromLocationId` | `String?` | ❌ | null | FK to InventoryLocation. Required for TRANSFER_OUT and TRANSFER_IN movements. Source location. |
| `toLocationId` | `String?` | ❌ | null | FK to InventoryLocation. Required for TRANSFER_OUT and TRANSFER_IN movements. Destination location. |
| `workOrderId` | `String?` | ❌ | null | FK to WorkOrder (`onDelete: Restrict`). Links CONSUMPTION, RESERVATION, RELEASE, and RETURN movements to their originating WorkOrder. |
| `originalWorkOrderPartId` | `String?` | ❌ | null | FK to WorkOrderPart (`onDelete: SetNull`). For `RETURN` movements, links directly to the specific consumption record being partially or fully returned. Enables deterministic ledger-derived net consumption calculation. |
| `unitCostSnapshot` | `Decimal? @db.Decimal(12, 2)` | ❌ | null | Unit cost at the time of this movement. Snapshotted from Part.unitCost on RECEIPT, or from the most recent receipt cost. Preserved on CONSUMPTION for WorkOrderPart snapshot. |
| `reason` | `String? @db.Text` | ❌ | null | Human-readable reason for the movement. Required for ADJUSTMENT movements, optional for others. Max 2000 chars. |
| `referenceNumber` | `String?` | ❌ | null | Optional external reference (e.g., purchase order number, transfer ticket number). Max 100 chars. |
| `actorMemberId` | `String?` | ❌ | null | FK to WorkspaceMember (`onDelete: SetNull`). The authenticated user who initiated this movement. |
| `createdAt` | `DateTime @default(now())` | ✅ auto | auto | Immutable timestamp. No `updatedAt` — this record is never modified. |

### 6.4 Indexes

```prisma
@@index([workspaceId])
@@index([workspaceId, partId])
@@index([workspaceId, locationId])
@@index([workspaceId, movementType])
@@index([workOrderId])                   // "Show me all stock movements for WorkOrder X"
@@index([originalWorkOrderPartId])       // "Show all returns linked to a specific consumption record"
@@index([partId, createdAt])             // Movement history for a specific part
@@index([workspaceId, partId, locationId, createdAt])  // Balance reconstruction query
@@index([createdAt])                     // Time-based queries
```

### 6.5 Why StockMovement Is the Single Source of Truth

**Historical balance reconstruction**: Given a starting balance of 0 for a (partId, locationId) pair, applying all StockMovement records in chronological order reconstructs the current InventoryBalance. This is not done at runtime (balances are maintained directly), but it provides a verification mechanism and enables historical balance queries.

**No separate audit table**: Unlike WorkOrderHistory/AssetHistory (which record field-level entity changes), StockMovement directly records the quantitative events. There is no "InventoryHistory" table — the ledger IS the history.

**Immutable**: StockMovement records are never updated or deleted. Corrections are made via new ADJUSTMENT movements with opposite sign.

---

## 7. WorkOrderPart Entity (Consumption Records)

### 7.1 Design Rationale & Absolute Immutability

WorkOrderPart links a WorkOrder to the Parts consumed during its execution. It follows the **snapshot pattern** established by WorkOrder (which snapshots WorkType fields) and serves as the operational record that downstream Invoicing (Phase 1.12) and Reporting (Phase 1.14) will consume.

This entity lives entirely within the Inventory & Parts domain. It does NOT require modifying the locked WorkOrder schema (Phase 1.6) — it is a new related table with FK to WorkOrder.

**Absolute Immutability Contract**:
* `WorkOrderPart` records are **strictly write-once and immutable**.
* The `quantity`, financial snapshot, and catalog snapshot columns on `WorkOrderPart` are **never updated or mutated** after creation.
* The entity deliberately has **no `updatedAt` column**.
* Partial or full returns of consumed parts do **NOT** modify the `WorkOrderPart.quantity` column. Instead, returns are modeled purely as new `StockMovement` entries of type `RETURN` referencing `workOrderId`, `partId`, and `originalWorkOrderPartId`.

### 7.2 Proposed Fields

| Field | Type | Required | Default | Justification |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `String @id @default(cuid())` | ✅ | auto | Standard platform ID convention |
| `workspaceId` | `String` | ✅ | — | Multi-tenancy scoping |
| `workOrderId` | `String` | ✅ | — | FK to WorkOrder (`onDelete: Restrict`). A WorkOrder with consumed parts cannot be deleted. |
| `partId` | `String` | ✅ | — | FK to Part (`onDelete: Restrict`). A Part with consumption history cannot be deleted. |
| `locationId` | `String` | ✅ | — | FK to InventoryLocation. The location from which the part was consumed. |
| `quantity` | `Decimal @db.Decimal(12, 4)` | ✅ | — | Original gross quantity consumed. Always positive. Immutable — never mutated on returns. |
| `unitCostAtTimeOfUse` | `Decimal @db.Decimal(12, 2)` | ✅ | — | **Snapshot**: Unit cost at the moment of consumption. Independent of later Part.unitCost edits. Used for downstream billing. |
| `partName` | `String` | ✅ | — | **Snapshot**: Part name at time of consumption. Independent of later Part.name edits. |
| `partSku` | `String?` | ❌ | null | **Snapshot**: Part SKU at time of consumption. Independent of later Part.sku edits. |
| `unitOfMeasure` | `String` | ✅ | — | **Snapshot**: Part UoM at time of consumption. |
| `consumedByMemberId` | `String?` | ❌ | null | FK to WorkspaceMember (`onDelete: SetNull`). The authenticated user who recorded this consumption. |
| `consumedAt` | `DateTime @default(now())` | ✅ auto | auto | Timestamp of consumption. More semantically precise than createdAt for operational queries. |
| `notes` | `String? @db.Text` | ❌ | null | Optional consumption notes (e.g., "replaced filter per maintenance schedule"). Max 2000 chars. |
| `createdAt` | `DateTime @default(now())` | ✅ auto | auto | Standard audit timestamp (write-once, no updatedAt). |

### 7.3 Snapshot Protection & Ledger-Derived Net Quantity

**Snapshot Invariant**: `partName`, `partSku`, `unitCostAtTimeOfUse`, and `unitOfMeasure` are **write-once** values copied from the Part entity at the moment of consumption. They are NEVER updated after creation, even if the Part catalog entry is later modified.

**Ledger-Derived Net Quantity Calculation**:
Rather than mutating `WorkOrderPart.quantity` when unused parts are returned, the net consumed quantity is computed dynamically at the service and read-model layer:

$$\text{netQuantityConsumed} = \text{WorkOrderPart.quantity} - \sum_{\substack{M \in \text{StockMovement} \\ M.\text{movementType} = \text{RETURN} \\ M.\text{originalWorkOrderPartId} = \text{WorkOrderPart.id}}} M.\text{quantity}$$

For aggregated WorkOrder summaries across a part:

$$\text{totalNetConsumed}(\text{workOrderId}, \text{partId}) = \sum \text{CONSUMPTION movements} - \sum \text{RETURN movements}$$

This design guarantees complete mathematical traceability, prevents historical mutation anomalies, and adheres to the append-only ledger architecture.

### 7.4 Unique Constraints & Indexes

```prisma
@@index([workspaceId])
@@index([workspaceId, workOrderId])     // "Show all parts consumed on WorkOrder X"
@@index([workspaceId, partId])           // "Show all WorkOrders that consumed Part Y"
@@index([workOrderId])
@@index([partId])
@@index([locationId])
@@index([consumedAt])
```

---

## 8. Transaction Boundary & Concurrency Strategy

### 8.1 Transaction Boundary Design

Every inventory mutation that changes balance quantities executes the following atomically within a single `prisma.$transaction`:

```
prisma.$transaction(async (tx) => {
    // 1. Lock the InventoryBalance row(s) via SELECT FOR UPDATE
    // 2. Validate invariants (non-negative stock, sufficient quantity)
    // 3. Mutate InventoryBalance (upsert quantityOnHand / quantityReserved)
    // 4. Create StockMovement record(s)
    // 5. Create WorkOrderPart record (if CONSUMPTION)
    // 6. Create/update any related audit records
})
```

This matches the existing codebase pattern where `prisma.$transaction` wraps all multi-step mutations (see `createWorkOrder.ts` lines with `runTx`, `startTechnicianTravel.ts`, etc.).

### 8.2 Concurrency Strategy: Pessimistic Row Locking (SELECT FOR UPDATE)

**Chosen approach**: Pessimistic locking via `SELECT ... FOR UPDATE` within interactive transactions.

**Justification**:
1. **Consistent with existing patterns**: The codebase already uses `prisma.$transaction` for all mutations. Adding `SELECT FOR UPDATE` within these transactions is a natural extension.
2. **Prevents negative stock**: Under concurrent consumption (two technicians consuming the same part from the same location simultaneously), optimistic concurrency (version numbers / compare-and-swap) would require retry loops and could lead to starvation under high contention. Pessimistic locking guarantees that the second transaction waits until the first commits or rolls back.
3. **Simplicity**: No retry logic, no version conflict handling, no compensation transactions.
4. **PostgreSQL native**: `SELECT ... FOR UPDATE` is a standard PostgreSQL feature, and the project uses PostgreSQL via `@prisma/adapter-pg`.

**Implementation approach**:

Since Prisma's query API does not natively support `SELECT ... FOR UPDATE`, the lock will be acquired via `prisma.$queryRaw` within the interactive transaction:

```typescript
// Conceptual pattern (not implementation — spec only):
const balance = await tx.$queryRaw`
    SELECT * FROM "InventoryBalance"
    WHERE "partId" = ${partId} AND "locationId" = ${locationId}
    FOR UPDATE
`;
```

This locks the specific row for the duration of the transaction, preventing concurrent mutations to the same (partId, locationId) balance.

**Alternative considered**: Optimistic concurrency (adding a `version` column and using `WHERE version = ?` in UPDATE). Rejected because:
- Requires retry loops on conflict.
- Under high contention (popular part, single location), retry storms degrade performance.
- Does not prevent the negative-stock race condition as cleanly — the validation read and the write are not atomic without the lock.

### 8.3 Concurrency Scenarios

| Scenario | Without Lock | With FOR UPDATE Lock |
| :--- | :--- | :--- |
| Two technicians consume last unit of Part X from Location A simultaneously | Both read qtyOnHand=1, both pass validation, both subtract 1. Result: qtyOnHand=-1 (VIOLATION). | Transaction A locks the row, reads qtyOnHand=1, subtracts 1, commits. Transaction B waits, reads qtyOnHand=0, fails validation, throws InsufficientStockError. |
| Receipt and consumption on same part simultaneously | Race condition on qtyOnHand. Result: unpredictable. | Serialized: receipt completes first, then consumption reads updated balance. |

---

## 9. Technician Stock Integration with Phase 1.9

### 9.1 Architectural Principle

Technician stock is represented as an `InventoryLocation` with `locationType = "TECHNICIAN_STOCK"` and a `technicianProfileId` link. This means:

- Each technician has **exactly one** personal stock location (enforced at the service layer: cannot create two TECHNICIAN_STOCK locations for the same technicianProfileId).
- Stock movements to/from a technician's kit are regular StockMovement records with the technician's location as source or destination.
- Technician stock visibility is scoped: a technician can only see balances at their own TECHNICIAN_STOCK location (plus any WAREHOUSE/VEHICLE locations they have access to).
- **Provisioning Policy**: Provisioning of a `TECHNICIAN_STOCK` `InventoryLocation` is **ALWAYS an explicit action** initiated by a Manager or Admin via `POST /api/inventory-locations` with `locationType = "TECHNICIAN_STOCK"` and `technicianProfileId` set. There is no automatic or implicit provisioning on first receipt, technician onboarding, or anywhere else.

### 9.2 Role-Based Access Matrix for Technician Stock

| Operation | OWNER | ADMIN | MANAGER | DISPATCHER | TECHNICIAN |
| :--- | :---: | :---: | :---: | :---: | :---: |
| View all stock locations & balances | ✅ | ✅ | ✅ | ✅ | ❌ |
| View own technician stock balance | ✅ | ✅ | ✅ | ✅ | ✅ |
| View warehouse/vehicle stock balances | ✅ | ✅ | ✅ | ✅ | ✅ (read-only) |
| Transfer stock TO technician (warehouse→technician) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Transfer stock FROM technician (technician→warehouse) | ✅ | ✅ | ✅ | ✅ | ✅ (own stock only) |
| Consume parts from own stock on assigned WorkOrder | ✅ | ✅ | ✅ | ✅ | ✅ |
| Consume parts from warehouse on any WorkOrder | ✅ | ✅ | ✅ | ✅ | ❌ |
| Receive stock (initial receipt into warehouse) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Adjust stock (cycle counts, corrections) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reserve stock for WorkOrder | ✅ | ✅ | ✅ | ✅ | ❌ |
| Release reservation | ✅ | ✅ | ✅ | ✅ | ❌ |
| Return unused parts from WorkOrder | ✅ | ✅ | ✅ | ✅ | ✅ (own stock only) |
| Create/manage Part catalog entries | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create/manage InventoryLocation entries | ✅ | ✅ | ✅ | ❌ | ❌ |

### 9.3 Technician Consumption Flow

When a technician consumes a part during WorkOrder execution (Phase 1.9):

1. Technician calls `POST /api/technician/work-orders/[workOrderId]/parts` with `{ partId, locationId, quantity }`.
2. Service resolves `TechnicianExecutionContext` via `resolveTechnicianContext()` (same as Phase 1.9 pattern).
3. **Authorization checks**:
   - Caller must be TECHNICIAN role (Invariant 2 from Phase 1.9).
   - Caller must be the assigned technician on the WorkOrder (Invariant 3 from Phase 1.9).
   - WorkOrder must be in `IN_PROGRESS` or `ON_HOLD` status (technicians can never consume against `COMPLETED` or `CANCELLED` orders).
   - `locationId` must be the technician's own TECHNICIAN_STOCK location OR be a WAREHOUSE/VEHICLE location the technician is authorized to consume from.
4. **Atomic transaction**:
   - Lock InventoryBalance row for (partId, locationId).
   - Validate sufficient `quantityAvailable`.
   - Create CONSUMPTION StockMovement.
   - Decrement InventoryBalance (`quantityOnHand -= quantity`, `quantityReserved -= quantity` if reserved).
   - Create WorkOrderPart record with snapshot fields.

### 9.4 What Technicians CANNOT Do (Requires Manager/Dispatcher)

- **Cannot receive new stock** into any location (RECEIPT movements).
- **Cannot transfer stock between locations** (TRANSFER_IN/OUT) — only Managers/Dispatchers can move stock to/from technician kits.
- **Cannot adjust stock** (ADJUSTMENT movements — cycle counts, write-offs).
- **Cannot create or manage Part catalog entries** or InventoryLocation entries.
- **Cannot consume parts from another technician's stock** or from warehouse locations directly (only from their own TECHNICIAN_STOCK location).
- **Cannot consume parts against COMPLETED or CANCELLED WorkOrders**.

---

## 10. WorkOrder Integration Boundary

### 10.1 Integration Contract

Inventory & Parts integrates with WorkOrders (Phase 1.6) through **exactly one mechanism**: the `WorkOrderPart` entity (Section 7), which has a foreign key to `WorkOrder`.

**This does NOT require modifying the locked WorkOrder schema.** The WorkOrder model in `prisma/schema.prisma` remains untouched. The integration is purely through a new related table (`WorkOrderPart`) with `onDelete: Restrict` on the `workOrderId` FK.

### 10.2 What WorkOrderPart Touches in the WorkOrders Domain

| Touch | Impact on WorkOrder Schema | Impact on WorkOrder Services |
| :--- | :--- | :--- |
| `WorkOrderPart.workOrderId -> WorkOrder.id` | New FK with `onDelete: Restrict` | None — WorkOrder deletion is already blocked if it has time entries (`TechnicianTimeEntry` with `onDelete: Restrict`). WorkOrderPart adds another Restrict constraint. |
| Reading WorkOrder data for consumption context | Read-only | WorkOrder services are NOT modified. The Inventory domain reads WorkOrder data directly via Prisma (tenant-scoped queries). |
| Completion preconditions | None | Phase 1.9 `completeWorkOrder()` completion preconditions are NOT modified. Parts consumption is independent of WorkOrder status transitions. |

### 10.3 Design Decision: No Foreign Key from WorkOrder to Inventory

The WorkOrder model does NOT gain any inventory-related fields. All inventory integration flows through WorkOrderPart, which lives in the Inventory domain's schema space. This preserves the locked boundary of Phase 1.6.

### 10.4 WorkOrder Completion and Parts Lifecycle Invariants

1. **Pre-Completion Decoupling**: Parts consumption does NOT block or modify WorkOrder completion. A WorkOrder can be transitioned to `COMPLETED` even if parts were reserved but not yet consumed (unconsumed reservations are released).
2. **Post-Completion Consumption Boundaries**:
   * **Managers and Admins**: MAY record part consumption on WorkOrders in `COMPLETED` status with **no fixed time window** (trusted role boundary for administrative reconciliation, billing true-ups, and late paperwork).
   * **Technicians**: Strictly restricted to `IN_PROGRESS` or `ON_HOLD` WorkOrders only — **never `COMPLETED`**, regardless of elapsed time.
   * **Cancelled WorkOrders**: Part consumption is strictly blocked across all roles for WorkOrders in `CANCELLED` status.

---

## 11. Historical Snapshot Protection & Absolute Immutability

### 11.1 Snapshot Fields on WorkOrderPart

The following fields on `WorkOrderPart` are **write-once snapshots** copied from the Part entity at the moment of consumption:

| Snapshot Field | Source | Purpose |
| :--- | :--- | :--- |
| `partName` | `Part.name` | Preserves the part name as understood at time of use, even if the Part catalog entry is later renamed. |
| `partSku` | `Part.sku` | Preserves the SKU as understood at time of use. |
| `unitCostAtTimeOfUse` | `Part.unitCost` (or last receipt cost) | Preserves the cost for downstream billing (Phase 1.12). Critical for accurate invoicing. |
| `unitOfMeasure` | `Part.unitOfMeasure` | Preserves the UoM for quantity interpretation. |

### 11.2 Snapshot Fields on StockMovement

StockMovement records also preserve `unitCostSnapshot` — the unit cost at the time of each movement. This enables:

- Historical cost reconstruction (what did this part cost when it was received?).
- FIFO/LIFO cost calculations for consumption (future extensibility).
- Audit trail for cost changes over time.

### 11.3 Write-Once Immutability Contract

This pattern is directly established in Phase 1.6:

```prisma
// From WorkOrder model — snapshot fields from WorkType:
workTypeName      String
workTypeCode      String?
estimatedDuration Int?
```

These are copied from WorkType at WorkOrder creation and never updated. 

In Phase 1.10:
* `WorkOrderPart.partName`, `partSku`, `unitCostAtTimeOfUse`, `unitOfMeasure`, and `quantity` follow the identical write-once rule.
* Neither catalog edits nor partial/full returns will ever mutate a persisted `WorkOrderPart` row.
* Returns append a new `StockMovement` row with `movementType = RETURN` referencing `originalWorkOrderPartId`. Net quantities consumed are always calculated dynamically from the ledger.

---

## 12. Error Taxonomy

### 12.1 Domain Error Classes

All errors follow Convention B (with `code`, `statusCode`, `httpStatus` readonly properties):

| Error Class | Error Code | HTTP | Trigger Condition |
| :--- | :--- | :---: | :--- |
| `PartNotFoundError` | `PART_NOT_FOUND` | 404 | Part not found in authorized workspace. |
| `PartInactiveError` | `PART_INACTIVE` | 409 | Attempted to use an INACTIVE part in a new receipt, reservation, or consumption. |
| `PartImmutableError` | `PART_IMMUTABLE` | 409 | Attempted to modify a part that has historical StockMovement or WorkOrderPart references in a way that violates integrity (e.g., changing UoM when balances exist). |
| `DuplicatePartSkuError` | `DUPLICATE_PART_SKU` | 409 | A part with this SKU already exists in this workspace. |
| `PartDeletionNotAllowedError` | `PART_DELETION_NOT_ALLOWED` | 409 | Cannot delete a part with active balances, stock movements, or consumption records. |
| `InventoryLocationNotFoundError` | `INVENTORY_LOCATION_NOT_FOUND` | 404 | Location not found in authorized workspace. |
| `InventoryLocationInactiveError` | `INVENTORY_LOCATION_INACTIVE` | 409 | Attempted to receive stock at an INACTIVE location. |
| `DuplicateInventoryLocationError` | `DUPLICATE_INVENTORY_LOCATION` | 409 | A location with this name or code already exists in this workspace. |
| `InventoryLocationDeletionNotAllowedError` | `INVENTORY_LOCATION_DELETION_NOT_ALLOWED` | 409 | Cannot delete a location with active stock balances. |
| `TechnicianStockLocationAlreadyExistsError` | `TECHNICIAN_STOCK_LOCATION_ALREADY_EXISTS` | 409 | Attempted to create a second TECHNICIAN_STOCK location for the same technician. |
| `InsufficientStockError` | `INSUFFICIENT_STOCK` | 409 | Attempted to consume or transfer more parts than available (`quantityAvailable < requested`). |
| `NegativeStockError` | `NEGATIVE_STOCK` | 409 | A stock operation would result in negative on-hand or reserved quantities. |
| `InsufficientReservationError` | `INSUFFICIENT_RESERVATION` | 409 | Attempted to consume more reserved quantity than exists for this WorkOrder at this location. |
| `WorkOrderPartNotFoundError` | `WORK_ORDER_PART_NOT_FOUND` | 404 | Consumption record not found in authorized workspace. |
| `DuplicatePartNameError` | `DUPLICATE_PART_NAME` | 409 | A part with this name already exists in this workspace. |
| `InvalidMovementTypeError` | `INVALID_MOVEMENT_TYPE` | 422 | Movement type not valid for the requested operation. |
| `TransferSameLocationError` | `TRANSFER_SAME_LOCATION` | 422 | Source and destination locations are the same. |
| `StockMovementNotFoundError` | `STOCK_MOVEMENT_NOT_FOUND` | 404 | Stock movement record not found. |

### 12.2 Reused Errors from Existing Domains

| Error | Source Domain | When Reused |
| :--- | :--- | :--- |
| `WorkOrderNotFoundError` | Phase 1.6 | Consuming parts against a non-existent WorkOrder. |
| `UnauthorizedError` | Phase 1.2 | Missing/invalid session. |
| `ForbiddenError` | Phase 1.2 | Role lacks required permission. |
| `WorkspaceAccessDeniedError` | Phase 1.2 | User not an active member of the workspace. |
| `WorkspaceNotFoundError` | Phase 1.2 | Target workspace does not exist. |
| `TechnicianProfileNotFoundError` | Phase 1.9 | Technician stock operations for a non-existent profile. |

---

## 13. RBAC Permissions & Candidate API Routes

### 13.1 New Permissions

Following the existing `PERMISSIONS` object pattern in `lib/services/authorization/permissions.ts`:

```typescript
// Inventory & Parts permissions (Phase 1.10)
PARTS_VIEW: "parts.view",
PARTS_CREATE: "parts.create",
PARTS_UPDATE: "parts.update",
PARTS_DELETE: "parts.delete",

INVENTORY_VIEW: "inventory.view",
INVENTORY_RECEIVE: "inventory.receive",
INVENTORY_TRANSFER: "inventory.transfer",
INVENTORY_ADJUST: "inventory.adjust",
INVENTORY_RESERVE: "inventory.reserve",
INVENTORY_CONSUME: "inventory.consume",
INVENTORY_RETURN: "inventory.return",

INVENTORY_LOCATIONS_VIEW: "inventory_locations.view",
INVENTORY_LOCATIONS_MANAGE: "inventory_locations.manage",
```

### 13.2 Permission-to-Role Mapping

| Permission | OWNER | ADMIN | MANAGER | DISPATCHER | TECHNICIAN | ACCOUNTANT |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `parts.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `parts.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `parts.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `parts.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `inventory.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `inventory.receive` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `inventory.transfer` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.adjust` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `inventory.reserve` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.consume` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `inventory.return` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `inventory_locations.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `inventory_locations.manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

### 13.3 Candidate API Route List

All routes follow the existing thin-adapter pattern. Naming conventions match the established REST patterns (`/api/work-orders`, `/api/assets`, `/api/technician/work-orders`).

```
# ─── Part Catalog ────────────────────────────────────────────────
GET    /api/parts                              -> getParts (list, search, filter, paginate)
POST   /api/parts                              -> createPart
GET    /api/parts/[partId]                     -> getPart (detail)
PATCH  /api/parts/[partId]                     -> updatePart
PATCH  /api/parts/[partId]/status              -> transitionPartStatus (ACTIVE ↔ INACTIVE)

# ─── Inventory Locations ─────────────────────────────────────────
GET    /api/inventory-locations                -> getInventoryLocations (list, filter)
POST   /api/inventory-locations                -> createInventoryLocation
GET    /api/inventory-locations/[locationId]   -> getInventoryLocation (detail)
PATCH  /api/inventory-locations/[locationId]   -> updateInventoryLocation
PATCH  /api/inventory-locations/[locationId]/status -> transitionInventoryLocationStatus

# ─── Stock Balances ──────────────────────────────────────────────
GET    /api/inventory/balances                 -> getInventoryBalances (list, filter by partId/locationId)
GET    /api/inventory/balances/[balanceId]     -> getInventoryBalance (detail)

# ─── Stock Movements ─────────────────────────────────────────────
GET    /api/inventory/movements                -> getStockMovements (list, filter, paginate)
POST   /api/inventory/movements/receive        -> receiveStock (RECEIPT)
POST   /api/inventory/movements/transfer       -> transferStock (TRANSFER_OUT + TRANSFER_IN pair)
POST   /api/inventory/movements/adjust         -> adjustStock (ADJUSTMENT)
POST   /api/inventory/movements/reserve        -> reserveStock (RESERVATION)
POST   /api/inventory/movements/release        -> releaseStock (RELEASE)
POST   /api/inventory/movements/consume        -> consumeStock (CONSUMPTION) — administrative
POST   /api/inventory/movements/return         -> returnStock (RETURN)

# ─── WorkOrder Part Consumption ──────────────────────────────────
GET    /api/work-orders/[workOrderId]/parts    -> getWorkOrderParts (list consumed parts for a WO)
POST   /api/work-orders/[workOrderId]/parts    -> consumePartOnWorkOrder (admin/dispatcher)
POST   /api/work-orders/[workOrderId]/parts/[workOrderPartId]/return -> returnWorkOrderPart (records RETURN StockMovement)

# ─── Technician Stock (scoped to authenticated technician) ───────
GET    /api/technician/inventory               -> getTechnicianStock (own stock balance summary)
POST   /api/technician/work-orders/[workOrderId]/parts -> consumePartTechnician (tech consumes from own kit)

# ─── Inventory Summary / Dashboard ───────────────────────────────
GET    /api/inventory/summary                  -> getInventorySummary (aggregate counts, low-stock indicators)
```

### 13.4 Route Naming Convention Validation

All route names follow existing conventions:

| Convention | Existing Example | Phase 1.10 Route |
| :--- | :--- | :--- |
| Plural nouns for collections | `/api/work-orders`, `/api/assets`, `/api/customers` | `/api/parts`, `/api/inventory-locations` |
| Kebab-case URLs | `/api/work-orders`, `/api/service-catalogs` | `/api/inventory-locations`, `/api/inventory/movements` |
| Nested action routes | `/api/technician/work-orders/[id]/travel` | `/api/inventory/movements/receive`, `/api/work-orders/[id]/parts/[id]/return` |
| Nested sub-resource routes | `/api/work-orders/[id]/history` | `/api/work-orders/[id]/parts` |
| Status transition routes | `/api/work-orders/[id]/status` | `/api/parts/[id]/status` |

---

## 14. Execution Chain Mapping

### 14.1 File Structure for Phase 1.10

```
lib/services/inventory/
  ├── index.ts
  ├── part/
  │   ├── partErrors.ts
  │   ├── part.types.ts
  │   ├── part.schemas.ts
  │   ├── createPart.ts
  │   ├── getPart.ts
  │   ├── getParts.ts
  │   ├── updatePart.ts
  │   ├── transitionPartStatus.ts
  │   └── index.ts
  ├── inventoryLocation/
  │   ├── inventoryLocationErrors.ts
  │   ├── inventoryLocation.types.ts
  │   ├── inventoryLocation.schemas.ts
  │   ├── createInventoryLocation.ts
  │   ├── getInventoryLocation.ts
  │   ├── getInventoryLocations.ts
  │   ├── updateInventoryLocation.ts
  │   ├── transitionInventoryLocationStatus.ts
  │   └── index.ts
  ├── balance/
  │   ├── inventoryBalance.types.ts
  │   ├── getInventoryBalances.ts
  │   ├── getInventoryBalance.ts
  │   ├── upsertInventoryBalance.ts       # Internal: called within transactions
  │   └── index.ts
  ├── movement/
  │   ├── stockMovementErrors.ts
  │   ├── stockMovement.types.ts
  │   ├── stockMovement.schemas.ts
  │   ├── receiveStock.ts
  │   ├── transferStock.ts
  │   ├── adjustStock.ts
  │   ├── reserveStock.ts
  │   ├── releaseStock.ts
  │   ├── consumeStock.ts
  │   ├── returnStock.ts
  │   ├── getStockMovements.ts
  │   ├── lockInventoryBalance.ts          # Internal: SELECT FOR UPDATE helper
  │   └── index.ts
  ├── workOrderPart/
  │   ├── workOrderPart.types.ts
  │   ├── workOrderPart.schemas.ts
  │   ├── consumePartOnWorkOrder.ts
  │   ├── getWorkOrderParts.ts
  │   ├── returnWorkOrderPart.ts
  │   └── index.ts
  └── technicianStock/
      ├── getTechnicianStock.ts
      ├── consumePartTechnician.ts
      └── index.ts

lib/validations/
  ├── part.ts                              # Re-exports from part.schemas.ts
  ├── inventoryLocation.ts                 # Re-exports from inventoryLocation.schemas.ts
  └── inventoryMovement.ts                 # Re-exports from stockMovement.schemas.ts

lib/utils/
  └── inventoryApiError.ts                 # Error-to-HTTP response mapping

app/api/
  ├── parts/
  │   ├── route.ts                         # GET (list) + POST (create)
  │   └── [partId]/
  │       ├── route.ts                     # GET (detail) + PATCH (update)
  │       └── status/
  │           └── route.ts                 # PATCH (status transition)
  ├── inventory-locations/
  │   ├── route.ts                         # GET (list) + POST (create)
  │   └── [locationId]/
  │       ├── route.ts                     # GET (detail) + PATCH (update)
  │       └── status/
  │           └── route.ts                 # PATCH (status transition)
  ├── inventory/
  │   ├── balances/
  │   │   └── route.ts                     # GET (list balances)
  │   ├── movements/
  │   │   ├── route.ts                     # GET (list movements)
  │   │   ├── receive/
  │   │   │   └── route.ts                 # POST (receive stock)
  │   │   ├── transfer/
  │   │   │   └── route.ts                 # POST (transfer stock)
  │   │   ├── adjust/
  │   │   │   └── route.ts                 # POST (adjust stock)
  │   │   ├── reserve/
  │   │   │   └── route.ts                 # POST (reserve stock)
  │   │   ├── release/
  │   │   │   └── route.ts                 # POST (release reservation)
  │   │   ├── consume/
  │   │   │   └── route.ts                 # POST (consume stock — admin)
  │   │   └── return/
  │   │       └── route.ts                 # POST (return stock)
  │   └── summary/
  │       └── route.ts                     # GET (inventory summary)
  └── technician/
      └── inventory/
          └── route.ts                     # GET (technician's own stock)
```

---

## 15. Open Questions & Architectural Resolutions

The following domain decisions govern the implementation of Phase 1.10:

### Q1: Are Reservations Tied to WorkOrder Scheduling (Phase 1.8)?

**Decision**: Reservations are **explicit/manual** in Phase 1.10. Dispatchers explicitly reserve parts when scheduling or dispatching jobs. This avoids over-allocation and accommodates shared vehicle stock across multi-day jobs. Automated reservation workflows are deferred to Phase 1.16 (Automation & Workflows).

### Q2: Do Returns Support Partial Quantities?

**Decision**: **Yes, partial returns are fully supported via the immutable ledger.**
* Returns are modeled purely as new `StockMovement` entries of type `RETURN` referencing `workOrderId`, `partId`, and `originalWorkOrderPartId`.
* The return quantity must satisfy:
  $$0 < \text{returnQuantity} \le \text{WorkOrderPart.quantity} - \sum \text{prior RETURN movements for this record}$$
* `WorkOrderPart` remains **strictly immutable** (the row is never updated, and its `quantity` column remains the original gross consumption).
* "Net quantity consumed" is dynamically derived in read models:
  $$\text{netQuantityConsumed} = \text{WorkOrderPart.quantity} - \sum \text{StockMovement(RETURN for this originalWorkOrderPartId).quantity}$$

### Q3: Should Consumption Against COMPLETED WorkOrders Be Restricted?

**Decision**: Consumption authorization is **strictly bounded by role**, with no arbitrary timer or grace period:
* **Managers and Admins**: MAY record part consumption on WorkOrders in `COMPLETED` status with **no fixed time window** (trusted role boundary for administrative reconciliation, billing true-ups, and late paperwork processing).
* **Technicians**: Strictly restricted to `IN_PROGRESS` or `ON_HOLD` WorkOrders only — **never `COMPLETED`**, regardless of elapsed time.
* **Cancelled WorkOrders**: Part consumption is strictly blocked across all roles for WorkOrders in `CANCELLED` status.

### Q4: Default Technician Stock Location Provisioning

**Decision**: `TECHNICIAN_STOCK` `InventoryLocation` provisioning is **ALWAYS an explicit action**:
* A Manager or Admin must explicitly create the location via `POST /api/inventory-locations` with `locationType = "TECHNICIAN_STOCK"` and `technicianProfileId` populated.
* There is **no automatic or implicit provisioning** on technician creation or upon first stock receipt.

### Q5: Is There a Maximum Reservation Duration?

**Decision**: No auto-expiry in Phase 1.10. Reservations persist until manually released, consumed, or automatically cleared upon WorkOrder completion/cancellation. Automated expiration policies belong in Phase 1.16.

### Q6: Should Parts Have a Minimum Stock Level (Reorder Point)?

**Decision**: **Yes**, add `minimumStockLevel Decimal?` to `Part`. This is an additive schema property with zero operational runtime overhead in Phase 1.10, providing immediate support for inventory health checks and paving the way for Phase 1.13 alerting.

### Q7: Should the InventorySummary Endpoint Include Low-Stock Alerts?

**Decision**: **Yes**. `GET /api/inventory/summary` returns aggregate counts and lists parts where total on-hand stock across active locations is $\le \text{minimumStockLevel}$.

### Q8: Can Multiple Parts Be Consumed in a Single Atomic Operation?

**Decision**: Phase 1.10 service APIs support single-part consumption per call. Batch operations are client-orchestrated compositions (Phase 1.23).

### Q9: Unit of Measure Standardization

**Decision**: Standardized `PartUnitOfMeasure` enum: `EACH`, `BOX`, `PACK`, `PAIR`, `KIT`, `FOOT`, `METER`, `LITER`, `GAL`, `LB`, `KG`, `ROLL`, `SHEET`, `SET`.

---

## 16. Conflicts & Complications with Existing Codebase

### 16.1 No Destructive Schema Modifications Required

All existing locked schemas (WorkOrder, TechnicianTimeEntry, ScheduleAppointment, Asset, etc.) remain completely untouched. Phase 1.10 adds new models only.

### 16.2 `extractWorkspaceId` Duplication

The `extractWorkspaceId` utility function is currently duplicated in `lib/utils/workOrderApiError.ts`, `lib/utils/assetApiError.ts`, and `lib/utils/technicianOperationsApiError.ts`. Phase 1.10 will add its own copy in `lib/utils/inventoryApiError.ts` to maintain consistency with the existing (duplicated) pattern.

**Note**: A future refactoring phase should extract `extractWorkspaceId` into a shared utility (e.g., `lib/utils/workspace.ts`). This is out of scope for Phase 1.10.

### 16.3 `PaginationMetadata` Duplication

The `PaginationMetadata` interface is duplicated across `lib/services/serviceCatalog/serviceCatalog.types.ts`, `lib/services/schedule/schedule.types.ts`, `lib/services/customer/customer.types.ts`, and `lib/services/technicianProfile/technicianDirectory.types.ts`. Phase 1.10 will import from the nearest existing source (`lib/services/serviceCatalog/serviceCatalog.types.ts`) to maintain consistency.

### 16.4 Prisma Adapter Transaction Support

The project uses `@prisma/adapter-pg` with interactive transactions (`prisma.$transaction(async (tx) => { ... })`). The `SELECT ... FOR UPDATE` pattern requires `tx.$queryRaw`, which is supported within interactive transactions. This has been verified against the Prisma adapter-pg documentation — raw queries within interactive transactions execute on the same connection and participate in the same transaction.

### 16.5 WorkOrder Deletion Already Restricted

The `TechnicianTimeEntry.workOrderId` FK already uses `onDelete: Restrict`, meaning WorkOrders with time entries cannot be hard-deleted. Adding `WorkOrderPart.workOrderId` with `onDelete: Restrict` adds a second restriction — consistent but not conflicting.

---

## Architectural Sign-Off

The domain architecture, entity models, concurrency strategy, integration contracts, error taxonomy, and API interfaces defined in this document are locked as the authoritative engineering standard for **Phase 1.10: Inventory & Parts**.

No Prisma schema migrations, API routes, or service implementations have been created. This document serves as the binding specification for downstream implementation phases.
