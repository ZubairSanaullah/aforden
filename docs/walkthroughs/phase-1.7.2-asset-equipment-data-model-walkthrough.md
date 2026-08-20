# Phase 1.7.2 — Asset & Equipment Data Model Walkthrough

## 1. Executive Summary

Phase 1.7.2 implements the persistent data model for the **Asset & Equipment** domain in Aforden, strictly conforming to the locked domain specification at [`docs/architecture/phase-1.7.1-assets-equipment-domain-architecture.md`](../architecture/phase-1.7.1-assets-equipment-domain-architecture.md).

All schema additions, migrations, uniqueness constraints, and foreign-key referential actions are validated and tested against both unit mock suites and live PostgreSQL integration tests.

---

## 2. Scope & Migration Separation Resolution

### WorkOrderHistory Clarification & Migration Splitting
During Phase 1.6, `WorkOrderHistory` was designed and specified in `phase-1.6.1-workorder-domain-architecture.md` (Section 9) and added to `schema.prisma`. However, its raw DDL had not been committed into a dedicated migration file during Phase 1.6. When `prisma migrate diff` executed, it picked up the pending `WorkOrderHistory` table.

**Resolution Applied**:
1. Isolated `WorkOrderHistory` into its own dedicated migration:
   - [`prisma/migrations/20260820123000_add_work_order_history/migration.sql`](../../prisma/migrations/20260820123000_add_work_order_history/migration.sql)
2. Kept the Asset domain migration 100% self-contained:
   - [`prisma/migrations/20260820155000_add_asset_and_equipment_domain/migration.sql`](../../prisma/migrations/20260820155000_add_asset_and_equipment_domain/migration.sql)
   - Contains **only** `AssetStatus`, `AssetCategoryStatus`, `AssetHistoryEventType`, `AssetCategory`, `Asset`, `AssetHistory`, and `WorkOrder.assetId`.

---

## 3. Schema & Database Invariants

### 3.1. Enums
```prisma
enum AssetStatus {
  OPERATIONAL
  DEGRADED
  OUT_OF_SERVICE
  IN_STORAGE
  DECOMMISSIONED
  RETIRED
}

enum AssetCategoryStatus {
  ACTIVE
  INACTIVE
}

enum AssetHistoryEventType {
  CREATED
  UPDATED
  STATUS_CHANGED
  LOCATION_TRANSFERRED
  OWNERSHIP_TRANSFERRED
  DECOMMISSIONED
  REACTIVATED
  RETIRED
}
```

### 3.2. Models
```prisma
model AssetCategory {
  id          String              @id @default(cuid())
  workspaceId String
  name        String
  code        String?
  description String?             @db.Text
  status      AssetCategoryStatus @default(ACTIVE)
  sortOrder   Int                 @default(0)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  assets    Asset[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([workspaceId, name])
  @@unique([workspaceId, code])
  @@index([workspaceId])
  @@index([status])
  @@index([workspaceId, status])
  @@index([sortOrder])
}

model Asset {
  id          String  @id @default(cuid())
  workspaceId String
  customerId  String?
  locationId  String?
  categoryId  String?

  assetNumber  String
  name         String
  manufacturer String?
  modelNumber  String?
  serialNumber String?
  status       AssetStatus @default(OPERATIONAL)

  subLocationNotes  String?   @db.Text
  installationDate  DateTime?
  warrantyExpiresAt DateTime?
  purchaseDate      DateTime?
  purchaseCost      Decimal?  @db.Decimal(12, 2)
  notes             String?   @db.Text
  tags              String[]  @default([])
  metadata          Json?

  decommissionedAt DateTime?
  retiredAt        DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  workspace  Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  customer   Customer?        @relation(fields: [customerId], references: [id], onDelete: Restrict)
  location   ServiceLocation? @relation(fields: [locationId], references: [id], onDelete: Restrict)
  category   AssetCategory?   @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  history    AssetHistory[]
  workOrders WorkOrder[]

  @@unique([workspaceId, assetNumber])
  @@index([workspaceId])
  @@index([customerId])
  @@index([locationId])
  @@index([categoryId])
  @@index([status])
  @@index([workspaceId, status])
  @@index([workspaceId, serialNumber])
  @@index([workspaceId, modelNumber])
  @@index([workspaceId, manufacturer])
  @@index([tags], type: Gin)
}

model AssetHistory {
  id          String                @id @default(cuid())
  workspaceId String
  assetId     String
  eventType   AssetHistoryEventType
  actorUserId String?
  actorRole   MembershipRole
  reason      String?               @db.Text
  metadata    Json?

  createdAt DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  asset     Asset     @relation(fields: [assetId], references: [id], onDelete: Cascade)
  actorUser User?     @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([workspaceId])
  @@index([assetId])
  @@index([workspaceId, assetId, createdAt])
}
```

### 3.3. Extensions on Existing Models
- `WorkOrder.assetId`: Nullable foreign key (`Many-to-One: WorkOrder -> Asset`), indexed with `@@index([assetId])` and governed by `onDelete: Restrict`.
- `Customer.assets`: `Asset[]`
- `ServiceLocation.assets`: `Asset[]`
- `Workspace.assets`: `Asset[]`, `Workspace.assetCategories: AssetCategory[]`, `Workspace.assetHistories: AssetHistory[]`
- `User.assetHistories`: `AssetHistory[]`

---

## 4. Key Design Invariants Confirmed

1. **GIN Indexing on `tags`**:
   - `@@index([tags], type: Gin)` generates `CREATE INDEX "Asset_tags_idx" ON "Asset" USING GIN ("tags");` natively in PostgreSQL. Prisma 7.x supports native index types in GA without preview flags.
2. **`AssetCategory.code` Uniqueness**:
   - `@@unique([workspaceId, code])` adheres to PostgreSQL standard null semantics, permitting multiple `code = null` rows within the same tenant while strictly forbidding duplicate non-null codes.
3. **`AssetStatus` Default**:
   - Set to `OPERATIONAL` in the persistent schema, representing the standard state for newly commissioned client assets. Depot assets can explicitly supply `IN_STORAGE` on creation in the service layer.
4. **`AssetHistory.actorRole`**:
   - Uses the existing `MembershipRole` enum (`OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`, `ACCOUNTANT`) without introducing duplicate enums.

---

## 5. Live PostgreSQL Referential Integrity Verification

In addition to fast mocked unit tests, **real database integration tests** were added in [`tests/asset/asset-db-referential-integrity.integration.test.ts`](../../tests/asset/asset-db-referential-integrity.integration.test.ts) and executed against the live Supabase PostgreSQL database.

| Scenario | Constraint / Action | Live DB Result |
| :--- | :---: | :---: |
| Deleting Customer referenced by Asset | `onDelete: Restrict` | **BLOCKED (Postgres P2003)** |
| Deleting ServiceLocation referenced by Asset | `onDelete: Restrict` | **BLOCKED (Postgres P2003)** |
| Deleting AssetCategory referenced by Asset | `onDelete: Restrict` | **BLOCKED (Postgres P2003)** |
| Deleting Asset referenced by WorkOrder | `onDelete: Restrict` | **BLOCKED (Postgres P2003)** |
| Deleting Asset with AssetHistory rows | `onDelete: Cascade` | **PURGED (2 $\rightarrow$ 0 child records)** |
| Deleting User referenced in AssetHistory | `onDelete: SetNull` | **UPDATED (`actorUserId = null`)** |
| Multiple AssetCategory rows with `code = null` | PostgreSQL Null Uniqueness | **ALLOWED (Both created in same workspace)** |

---

## 6. Test Suite Metrics

- **Total Test Files**: 109 passed (109)
- **Total Tests**: 1,961 passed (1,961 passed, 0 failed)
- **TypeScript Typecheck (`npx tsc --noEmit`)**: 0 errors
- **Prisma Schema Validation (`npx prisma validate`)**: Valid
