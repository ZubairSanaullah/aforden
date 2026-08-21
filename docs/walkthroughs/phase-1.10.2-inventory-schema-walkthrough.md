# Phase 1.10.2 — Inventory & Parts Schema Walkthrough

## Overview

This walkthrough documents the verified implementation of **Phase 1.10.2: Inventory & Parts Schema Additions** in exact accordance with the locked architecture standard in [`docs/architecture/phase-1.10.1-inventory-parts-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.10.1-inventory-parts-domain-architecture.md).

No service logic, validation schemas, or API routes have been introduced yet. This phase introduces only the schema definitions, relational constraints, foreign keys, and indexes required for Phase 1.10.

---

## 1. Domain Enums & Models Added

### 1.1 Enums Added

| Enum | Values | Description |
| :--- | :--- | :--- |
| `PartStatus` | `ACTIVE`, `INACTIVE` | Lifecycle status for catalog parts. |
| `PartUnitOfMeasure` | `EACH`, `BOX`, `PACK`, `PAIR`, `KIT`, `FOOT`, `METER`, `LITER`, `GAL`, `LB`, `KG`, `ROLL`, `SHEET`, `SET` | Standard quantification unit for catalog parts and consumption snapshots. |
| `InventoryLocationType` | `WAREHOUSE`, `VEHICLE`, `TECHNICIAN_STOCK`, `OTHER` | Storage location classification. |
| `InventoryLocationStatus`| `ACTIVE`, `INACTIVE` | Lifecycle status for storage locations. |
| `StockMovementType` | `RECEIPT`, `TRANSFER_IN`, `TRANSFER_OUT`, `ADJUSTMENT`, `RESERVATION`, `RELEASE`, `CONSUMPTION`, `RETURN` | Atomic classification for the append-only stock movement ledger. |

### 1.2 Models Added

1. **`Part`**: Catalog of materials and consumables. Scoped to workspace with name and SKU uniqueness constraints, `PartUnitOfMeasure` enum typing, and `minimumStockLevel`.
2. **`InventoryLocation`**: Generic storage locations (warehouses, vans, technician kits). Includes optional link to `TechnicianProfile` (`onDelete: SetNull`).
3. **`InventoryBalance`**: Materialized point-in-time stock levels (`quantityOnHand`, `quantityReserved`). Unique per `[workspaceId, partId, locationId]`.
4. **`StockMovement`**: Immutable ledger of stock quantity changes. Carries references to source/destination locations, `workOrder` FK (`onDelete: Restrict`), `originalWorkOrderPartId` (for returns), snapshot unit cost, and actor metadata.
5. **`WorkOrderPart`**: Write-once consumption records on work orders. Preserves point-in-time snapshots of part name, SKU, UoM, and unit cost. Linked to `workOrder` with `onDelete: Restrict`. Does not mutate upon returns; net consumption is derived from linked `RETURN` movements in `StockMovement`.

---

## 2. Relational Integrity & Non-Destructive Extension

### 2.1 Back-Relations Added to Existing Models

Only the minimal necessary back-relations were added:

* **`Workspace`**:
  * `parts Part[]`
  * `inventoryLocations InventoryLocation[]`
  * `inventoryBalances InventoryBalance[]`
  * `stockMovements StockMovement[]`
  * `workOrderParts WorkOrderPart[]`
* **`TechnicianProfile`**:
  * `inventoryLocations InventoryLocation[]`
* **`WorkspaceMember`**:
  * `stockMovements StockMovement[]`
  * `workOrderParts WorkOrderPart[]`
* **`WorkOrder`** (Virtual relation arrays only — no new scalar/database columns):
  * `stockMovements StockMovement[]`
  * `workOrderParts WorkOrderPart[]`

### 2.2 Locked Domains Integrity Confirmation

The following locked domain models gained **NO SCALAR/BUSINESS FIELDS** (only virtual back-relation arrays where required by Prisma for incoming foreign keys):
* `WorkOrder` (Phase 1.6) — gained only `stockMovements StockMovement[]` and `workOrderParts WorkOrderPart[]` to satisfy incoming FKs (`onDelete: Restrict`).
* `Asset` (Phase 1.7) — 0 lines altered.
* `ScheduleAppointment` (Phase 1.8) — 0 lines altered.
* `TechnicianTimeEntry` (Phase 1.9) — 0 lines altered.

---

## 3. Verification & Validation Evidence

### 3.1 `npx prisma format`
```
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
Formatted prisma\schema.prisma in 69ms 🚀
```

### 3.2 `npx prisma validate`
```
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀
```

### 3.3 TypeScript Validation (`npx tsc --noEmit`)
```
Command exited with code 0 (0 compilation errors).
```

---

## 4. Verbatim Post-Format Diff of `prisma/schema.prisma`

```diff
diff --git a/prisma/schema.prisma b/prisma/schema.prisma
index 4552b2f..f0a4fbc 100644
--- a/prisma/schema.prisma
+++ b/prisma/schema.prisma
@@ -211,6 +211,51 @@ enum TimeEntryStatus {
   COMPLETED
 }
 
+enum PartStatus {
+  ACTIVE
+  INACTIVE
+}
+
+enum PartUnitOfMeasure {
+  EACH
+  BOX
+  PACK
+  PAIR
+  KIT
+  FOOT
+  METER
+  LITER
+  GAL
+  LB
+  KG
+  ROLL
+  SHEET
+  SET
+}
+
+enum InventoryLocationType {
+  WAREHOUSE
+  VEHICLE
+  TECHNICIAN_STOCK
+  OTHER
+}
+
+enum InventoryLocationStatus {
+  ACTIVE
+  INACTIVE
+}
+
+enum StockMovementType {
+  RECEIPT
+  TRANSFER_IN
+  TRANSFER_OUT
+  ADJUSTMENT
+  RESERVATION
+  RELEASE
+  CONSUMPTION
+  RETURN
+}
+
 model User {
   id            String     @id @default(cuid())
   name          String?
@@ -260,6 +305,11 @@ model Workspace {
   scheduleAppointments         ScheduleAppointment[]
   scheduleAppointmentHistories ScheduleAppointmentHistory[]
   technicianTimeEntries        TechnicianTimeEntry[]
+  parts                        Part[]
+  inventoryLocations           InventoryLocation[]
+  inventoryBalances            InventoryBalance[]
+  stockMovements               StockMovement[]
+  workOrderParts               WorkOrderPart[]
 
   createdAt DateTime @default(now())
   updatedAt DateTime @updatedAt
@@ -314,6 +364,8 @@ model WorkspaceMember {
   undispatchedAppointments     ScheduleAppointment[]        @relation("UndispatchedByMember")
   scheduleAppointmentHistories ScheduleAppointmentHistory[]
   createdTechnicianTimeEntries TechnicianTimeEntry[]
+  stockMovements               StockMovement[]
+  workOrderParts               WorkOrderPart[]
 
   createdAt DateTime @default(now())
   updatedAt DateTime @updatedAt
@@ -409,6 +461,7 @@ model TechnicianProfile {
   workOrders                       WorkOrder[]
   scheduleAppointments             ScheduleAppointment[]
   technicianTimeEntries            TechnicianTimeEntry[]
+  inventoryLocations               InventoryLocation[]
 
   createdAt DateTime @default(now())
   updatedAt DateTime @updatedAt
@@ -768,6 +821,8 @@ model WorkOrder {
   asset                 Asset?                @relation(fields: [assetId], references: [id], onDelete: Restrict)
   scheduleAppointments  ScheduleAppointment[]
   technicianTimeEntries TechnicianTimeEntry[]
+  stockMovements        StockMovement[]
+  workOrderParts        WorkOrderPart[]
 
   @@unique([workspaceId, workOrderNumber])
   @@index([workspaceId])
@@ -1073,3 +1128,158 @@ model TechnicianTimeEntry {
   @@index([workspaceId, workOrderId])
   @@index([startedAt])
 }
+
+model Part {
+  id                String            @id @default(cuid())
+  workspaceId       String
+  name              String
+  sku               String?
+  description       String?           @db.Text
+  unitOfMeasure     PartUnitOfMeasure @default(EACH)
+  unitCost          Decimal?          @db.Decimal(12, 2)
+  minimumStockLevel Decimal?          @db.Decimal(12, 4)
+  status            PartStatus        @default(ACTIVE)
+
+  workspace      Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
+  balances       InventoryBalance[]
+  stockMovements StockMovement[]
+  workOrderParts WorkOrderPart[]
+
+  createdAt DateTime @default(now())
+  updatedAt DateTime @updatedAt
+
+  @@unique([workspaceId, name])
+  @@unique([workspaceId, sku])
+  @@index([workspaceId])
+  @@index([workspaceId, status])
+  @@index([sku])
+}
+
+model InventoryLocation {
+  id                  String                  @id @default(cuid())
+  workspaceId         String
+  name                String
+  code                String?
+  locationType        InventoryLocationType   @default(WAREHOUSE)
+  technicianProfileId String?
+  addressLine1        String?
+  addressLine2        String?
+  city                String?
+  state               String?
+  postalCode          String?
+  country             String?
+  notes               String?                 @db.Text
+  status              InventoryLocationStatus @default(ACTIVE)
+
+  workspace         Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
+  technicianProfile TechnicianProfile? @relation(fields: [technicianProfileId], references: [id], onDelete: SetNull)
+
+  balances           InventoryBalance[]
+  stockMovements     StockMovement[]    @relation("StockMovementLocation")
+  fromStockMovements StockMovement[]    @relation("StockMovementFromLocation")
+  toStockMovements   StockMovement[]    @relation("StockMovementToLocation")
+  workOrderParts     WorkOrderPart[]
+
+  createdAt DateTime @default(now())
+  updatedAt DateTime @updatedAt
+
+  @@unique([workspaceId, name])
+  @@unique([workspaceId, code])
+  @@index([workspaceId])
+  @@index([workspaceId, status])
+  @@index([workspaceId, locationType])
+  @@index([technicianProfileId])
+}
+
+model InventoryBalance {
+  id               String  @id @default(cuid())
+  workspaceId      String
+  partId           String
+  locationId       String
+  quantityOnHand   Decimal @default(0) @db.Decimal(12, 4)
+  quantityReserved Decimal @default(0) @db.Decimal(12, 4)
+
+  workspace Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
+  part      Part              @relation(fields: [partId], references: [id], onDelete: Restrict)
+  location  InventoryLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)
+
+  createdAt DateTime @default(now())
+  updatedAt DateTime @updatedAt
+
+  @@unique([workspaceId, partId, locationId])
+  @@index([workspaceId])
+  @@index([workspaceId, partId])
+  @@index([workspaceId, locationId])
+  @@index([partId])
+}
+
+model StockMovement {
+  id                      String            @id @default(cuid())
+  workspaceId             String
+  partId                  String
+  locationId              String?
+  movementType            StockMovementType
+  quantity                Decimal           @db.Decimal(12, 4)
+  fromLocationId          String?
+  toLocationId            String?
+  workOrderId             String?
+  originalWorkOrderPartId String?
+  unitCostSnapshot        Decimal?          @db.Decimal(12, 2)
+  reason                  String?           @db.Text
+  referenceNumber         String?
+  actorMemberId           String?
+
+  workspace             Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
+  part                  Part               @relation(fields: [partId], references: [id], onDelete: Restrict)
+  location              InventoryLocation? @relation("StockMovementLocation", fields: [locationId], references: [id], onDelete: Restrict)
+  fromLocation          InventoryLocation? @relation("StockMovementFromLocation", fields: [fromLocationId], references: [id], onDelete: Restrict)
+  toLocation            InventoryLocation? @relation("StockMovementToLocation", fields: [toLocationId], references: [id], onDelete: Restrict)
+  workOrder             WorkOrder?         @relation(fields: [workOrderId], references: [id], onDelete: Restrict)
+  originalWorkOrderPart WorkOrderPart?     @relation(fields: [originalWorkOrderPartId], references: [id], onDelete: SetNull)
+  actorMember           WorkspaceMember?   @relation(fields: [actorMemberId], references: [id], onDelete: SetNull)
+
+  createdAt DateTime @default(now())
+
+  @@index([workspaceId])
+  @@index([workspaceId, partId])
+  @@index([workspaceId, locationId])
+  @@index([workspaceId, movementType])
+  @@index([workOrderId])
+  @@index([originalWorkOrderPartId])
+  @@index([partId, createdAt])
+  @@index([workspaceId, partId, locationId, createdAt])
+  @@index([createdAt])
+}
+
+model WorkOrderPart {
+  id                  String            @id @default(cuid())
+  workspaceId         String
+  workOrderId         String
+  partId              String
+  locationId          String
+  quantity            Decimal           @db.Decimal(12, 4)
+  unitCostAtTimeOfUse Decimal           @db.Decimal(12, 2)
+  partName            String
+  partSku             String?
+  unitOfMeasure       PartUnitOfMeasure
+  consumedByMemberId  String?
+  consumedAt          DateTime          @default(now())
+  notes               String?           @db.Text
+
+  workspace        Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
+  workOrder        WorkOrder         @relation(fields: [workOrderId], references: [id], onDelete: Restrict)
+  part             Part              @relation(fields: [partId], references: [id], onDelete: Restrict)
+  location         InventoryLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)
+  consumedByMember WorkspaceMember?  @relation(fields: [consumedByMemberId], references: [id], onDelete: SetNull)
+  stockMovements   StockMovement[]
+
+  createdAt DateTime @default(now())
+
+  @@index([workspaceId])
+  @@index([workspaceId, workOrderId])
+  @@index([workspaceId, partId])
+  @@index([workOrderId])
+  @@index([partId])
+  @@index([locationId])
+  @@index([consumedAt])
+}
```
