# Phase 1.14.7-C2 — Inventory, Asset & Customer Metrics and Reports Walkthrough

---

## 1. Locked-File Disclosure Section

In accordance with the Phase 1.14 governance rules, below is the comprehensive disclosure of every locked file originating from Phases 1.14.2–1.14.6 that was modified, along with the technical rationale, baseline counts, and exact assertion diffs.

### 1.1 `lib/services/reporting/reportingConstants.ts` (Phase 1.14.2)
- **Change**: Added `export const ASSET_WARRANTY_WINDOW_DAYS = 90;`.
- **Rationale**: Replaces hardcoded numeric literals with a named constant for the warranty expiration forward-looking horizon.

### 1.2 `lib/services/reporting/reporting.types.ts` (Phase 1.14.2)
- **Changes**:
  1. Added `AVG_COUNT` and `AVG_DURATION_HOURS` to `MetricValueType` to distinguish entity-level decimal averages/ratios (e.g. 1.5 services/asset, 2.3 work orders/customer) from percentage rates (`RATE_PERCENT`), and hour-denominated durations from minutes.
  2. Added Phase 1.14.7 metric keys to `MetricKey` union.
  3. Added `"asset.summary"` to `ReportKey`.
  4. Added `"Part"` to `ReportSourceModel`.
  5. Added `totalUncappedCount?: number` to `ReportMeta` and `ReportRowsReadModel`.
  6. Broadened `ReportMeta.truncated` from literal `false` to `boolean` to support group payload truncation above 1,000 items.
  7. Exported `ReportResponse` union type (`ReportScalarsReadModel | ReportRowsReadModel | ReportSeriesReadModel`).

### 1.3 `lib/services/reporting/reporting.schemas.ts` (Phase 1.14.2)
- **Changes**:
  1. Updated `METRIC_KEYS` array to include all Phase 1.14.7 metric keys ($47 \to 62$).
  2. Updated `REPORT_KEYS` array to include `"asset.summary"` ($10 \to 11$).

### 1.4 `lib/services/reporting/dimensionRegistry.ts` (Phase 1.14.2)
- **Baseline**: 13 dimension definitions registered across Phase 1.14.3 (`technician`, `workType`, `serviceCatalog`, `workOrderStatus`, `workOrderPriority`, `customer`, `time.day`, `time.week`, `time.month`, `time.quarter`, `time.year`) and Phase 1.14.4 (`appointmentStatus`, `dispatchStatus`).
- **Phase 1.14.7 Additions**: 8 new dimension definitions registered (`part`, `inventoryLocation`, `assetCategory`, `assetStatus`, `invoiceStatus`, `paymentMethod`, `quoteStatus`, `timeEntryType`).
- **Total Registered**: $13 + 8 = \mathbf{21}$ `DIMENSION_KEYS`.
- **Integrity Verification**: All 13 pre-existing dimension definitions remain **100% byte-for-byte identical** in field mappings, label sources, cardinality classes, and descriptions. Zero changes to existing sort ordering, label resolution, or PII masking.

### 1.5 `lib/services/reporting/filterRegistry.ts` (Phase 1.14.2)
- **Baseline**: 8 filter definitions registered across Phase 1.14.3 (`customerId`, `technicianId`, `workTypeId`, `serviceCatalogId`, `workOrderStatus`, `workOrderPriority`) and Phase 1.14.4 (`appointmentStatus`, `dispatchStatus`).
- **Phase 1.14.7 Additions**: 8 new filter definitions registered (`partId`, `inventoryLocationId`, `assetCategoryId`, `assetStatus`, `quoteStatus`, `invoiceStatus`, `paymentMethod`, `timeEntryType`).
- **Total Registered**: $8 + 8 = \mathbf{16}$ `FILTER_KEYS`.
- **Integrity Verification**: All 8 pre-existing filter definitions remain **100% byte-for-byte identical** in key name, valueType, coercion, applicableModels, buildWhere logic, and tenant validation requirements.

### 1.6 `lib/services/reporting/reportRegistry.ts` (Phase 1.14.2)
- **Baseline**: 8 report definitions registered across Phase 1.14.3 (`operational.workOrderVolume`, `operational.workOrderThroughput`), Phase 1.14.4 (`scheduling.dispatchPerformance`), Phase 1.14.5 (`technician.productivity`, `technician.selfScorecard`), and Phase 1.14.6 (`financial.revenueSummary`, `financial.arAging`, `financial.quotePipeline` [deferred]).
- **Phase 1.14.7 Additions**: 3 domain report definitions registered (`inventory.partsConsumption`, `asset.summary`, `customer.activitySummary`).
- **Total Registered**: $8 + 3 = \mathbf{11}$ `REPORT_KEYS`.
- **Integrity Verification**: All 8 pre-existing report definitions remain untouched.

### 1.7 `tests/reporting/reportingFoundation.test.ts` (Phase 1.14.2)
- **Changes & Diffs**:
```diff
-      expect(METRIC_KEYS.length).toBe(47);
+      expect(METRIC_KEYS.length).toBe(62);

-      expect(REPORT_KEYS.length).toBe(10);
+      expect(REPORT_KEYS.length).toBe(11);
+      expect(REPORT_KEYS).toContain("asset.summary");

-      expect(() => getDimensionDefinition("quoteStatus" as any)).toThrow(UnknownDimensionError);
+      expect(() => getDimensionDefinition("unregistered.fakeDimension" as any)).toThrow(UnknownDimensionError);

-      expect(() => getFilterDefinition("quoteStatus" as any)).toThrow(UnknownFilterError);
+      expect(() => getFilterDefinition("unregistered.fakeFilter" as any)).toThrow(UnknownFilterError);
```

### 1.8 `tests/reporting/operationalMetricsAndReports.test.ts` (Phase 1.14.3)
- **Changes & Diffs**:
```diff
-      expect(() => getDimensionDefinition("inventoryLocation" as any)).toThrow(UnknownDimensionError);
+      expect(() => getDimensionDefinition("unregistered.fakeDimension" as any)).toThrow(UnknownDimensionError);
```

### 1.9 Deletion of Obsolete File
- Removed temporary alias file [`lib/services/reporting/reports/inventoryStatusReport.ts`](file:///d:/Download/aforden/lib/services/reporting/reports/inventoryStatusReport.ts) to eliminate stale re-exports; all consumers reference [`partsConsumptionReport.ts`](file:///d:/Download/aforden/lib/services/reporting/reports/partsConsumptionReport.ts) directly.

---

## 2. Registry Accounting & Arithmetic

Below is the complete reconciliation of compile-time registry keys across Phase 1.14.7:

### 2.1 `REPORT_KEYS` Reconciliation
```
Schema Keys History:
  - Phase 1.14.2 Schemas declared 10 report keys:
      * 7 operational / scheduling / technician / financial reports implemented in 1.14.3–1.14.6
      * 1 financial report deferred in 1.14.6 (financial.quotePipeline)
      * 2 pre-declared inventory/customer keys (inventory.partsConsumption, customer.activitySummary)
  - Phase 1.14.7 Addition:
      + 1 new asset report key: asset.summary
  - Total Schema Keys: 10 + 1 = 11 REPORT_KEYS.

Report Implementation Services History:
  - Implemented in 1.14.3–1.14.6 (7 services):
      workOrderVolumeReport, workOrderThroughputReport, dispatchPerformanceReport,
      technicianProductivityReport, technicianSelfScorecardReport,
      revenueSummaryReport, arAgingReport
  - Implemented in 1.14.7 (3 services):
      partsConsumptionReport, assetSummaryReport, customerSummaryReport
  - Total Active Implementation Files: 7 + 3 = 10 active services (+ 1 deferred quote pipeline = 11 keys).
```

### 2.2 `METRIC_KEYS` Reconciliation
```
Baseline at Phase 1.14.6 Lock:                47 METRIC_KEYS
  - Pre-existing Schema Keys for 1.14.7 (8):
      inventory.partsConsumedCost, inventory.partsConsumedQuantity,
      inventory.quantityOnHand, inventory.belowMinimumStockPartCount,
      assets.count, assets.warrantyExpiringCount,
      customers.newCount, customers.activeCount
  - Operational / Scheduling / Tech / Financial Keys (39)

Phase 1.14.7 Definitions Registered (23 total definitions):
  1. Pre-existing Metric Keys Instantiated (8):
     - inventory.partsConsumedCost, inventory.partsConsumedQuantity,
       inventory.quantityOnHand, inventory.belowMinimumStockPartCount,
       assets.count, assets.warrantyExpiringCount,
       customers.newCount, customers.activeCount
  2. Brand New Active Metric Keys Added (8):
     - inventory.stockMovementCount
     - assets.countByStatus, assets.serviceEventCount, assets.avgServicesPerAsset
     - customers.countByStatus, customers.workOrdersPerCustomer,
       customers.lifetimeInvoicedRevenue, customers.repeatCustomerRate
  3. Brand New 501 Deferred Metric Keys Added (7):
     - inventory.stockValue (501)
     - assets.mtbfHours, assets.mttrHours, assets.uptimePercentage, assets.downtimeMinutes (501)
     - customers.churnRate, customers.retentionRate (501)

Total Metric Definitions Registered in 1.14.7: 8 (pre-existing) + 8 (new active) + 7 (new deferred) = 23 definitions.
Net New Keys Added to METRIC_KEYS array:        8 (new active) + 7 (new deferred) = 15 keys.
Total METRIC_KEYS.length:                      47 + 15 = 62.
```

---

## 3. Step 0 — Mandatory Schema Verification

Verbatim schema verification with paths and line numbers:

### 3.1 Inventory Domain
- **Part Model** ([`prisma/schema.prisma:1328-1354`](file:///d:/Download/aforden/prisma/schema.prisma#L1328-L1354)):
  - `id String @id @default(cuid())`
  - `workspaceId String`
  - `name String`
  - `sku String`
  - `unitOfMeasure String`
  - `unitCost Decimal(12, 2)` (Static catalog unit cost; no FIFO/LIFO/weighted average cost layers modelled)
  - `minimumStockLevel Decimal(12, 4)?` (Nullable threshold)
  - `status PartStatus @default(ACTIVE)` (`ACTIVE`, `INACTIVE`, `DISCONTINUED`)
- **InventoryLocation Model** ([`prisma/schema.prisma:1356-1390`](file:///d:/Download/aforden/prisma/schema.prisma#L1356-L1390)):
  - `id String @id @default(cuid())`, `workspaceId String`, `name String`, `code String`, `locationType LocationType` (`WAREHOUSE`, `VEHICLE`, `JOB_SITE`, `VIRTUAL`), `technicianProfileId String?`, `status LocationStatus @default(ACTIVE)`.
- **InventoryBalance Model** ([`prisma/schema.prisma:1392-1412`](file:///d:/Download/aforden/prisma/schema.prisma#L1392-L1412)):
  - `id String @id @default(cuid())`, `workspaceId String`, `partId String`, `locationId String`, `quantityOnHand Decimal(12, 4) @default(0)`, `quantityReserved Decimal(12, 4) @default(0)`.
  - **Stock is strictly per-location (`partId` + `locationId`)**.
- **StockMovement Model (Immutable Transaction Ledger)** ([`prisma/schema.prisma:1414-1450`](file:///d:/Download/aforden/prisma/schema.prisma#L1414-L1450)):
  - `id String @id @default(cuid())`, `workspaceId String`, `partId String`, `locationId String`, `movementType StockMovementType` (`RECEIPT`, `TRANSFER_IN`, `TRANSFER_OUT`, `CONSUMPTION`, `ADJUSTMENT`, `RETURN`), `quantity Decimal(12, 4)`, `fromLocationId String?`, `toLocationId String?`, `unitCostSnapshot Decimal(12, 2)?`, `createdAt DateTime @default(now())`.
- **WorkOrderPart Model** ([`prisma/schema.prisma:1452-1484`](file:///d:/Download/aforden/prisma/schema.prisma#L1452-L1484)):
  - `id String @id @default(cuid())`, `workspaceId String`, `workOrderId String`, `partId String`, `locationId String?`, `quantity Decimal(12, 4)`, `unitCostAtTimeOfUse Decimal(12, 2)` (write-once snapshot), `consumedAt DateTime @default(now())` (write-once anchor).

### 3.2 Asset Domain
- **Asset Model** ([`prisma/schema.prisma:1144-1191`](file:///d:/Download/aforden/prisma/schema.prisma#L1144-L1191)):
  - `id String @id @default(cuid())`, `workspaceId String`, `customerId String?`, `locationId String?`, `categoryId String?`, `assetNumber String`, `name String`, `status AssetStatus @default(OPERATIONAL)`, `installationDate DateTime?`, `warrantyExpiresAt DateTime?` (Nullable threshold), `purchaseCost Decimal(12, 2)?`, `createdAt DateTime @default(now())`.
- **AssetHistory Model** ([`prisma/schema.prisma:1193-1212`](file:///d:/Download/aforden/prisma/schema.prisma#L1193-L1212)) & **AssetHistoryEventType** ([`prisma/schema.prisma:168-177`](file:///d:/Download/aforden/prisma/schema.prisma#L168-L177)):
  - `CREATED`, `UPDATED`, `STATUS_CHANGED`, `LOCATION_TRANSFERRED`, `OWNERSHIP_TRANSFERRED`, `DECOMMISSIONED`, `REACTIVATED`, `RETIRED`.
  - **No `FAILURE`, `BREAKDOWN`, or restoration events exist in schema.**

### 3.3 Customer Domain
- **Customer Model** ([`prisma/schema.prisma:832-867`](file:///d:/Download/aforden/prisma/schema.prisma#L832-L867)):
  - `id String @id @default(cuid())`, `workspaceId String`, `customerNumber String`, `name String`, `email String?` (PII), `phone String?` (PII), `addressLine1 String?` / `addressLine2 String?` (PII), `status CustomerStatus @default(ACTIVE)`, `createdAt DateTime @default(now())`.

---

## 4. Historical Stock Reconstruction & Replay Invariant

- **Determination**: **Case 1 holds for Inventory**.
  - `StockMovement` table at `prisma/schema.prisma:1414-1450` provides an immutable, write-once transaction ledger.
  - For historical `asOf` requests, stock levels are reconstructed by replaying movements up to `asOfDate`. Current `asOf` queries read live `InventoryBalance.quantityOnHand`.
- **Sign Conventions for `StockMovementType`**:
  - `RECEIPT`: $+qty$ (stock received into inventory)
  - `RETURN`: $+qty$ (stock returned from field execution back to inventory)
  - `TRANSFER_IN`: $+qty$ (stock received at destination location)
  - `TRANSFER_OUT`: $-qty$ (stock dispatched from source location)
  - `CONSUMPTION`: $-qty$ (stock used/consumed on work order)
  - `ADJUSTMENT`: $\pm qty$ (signed quantity adjustment recorded by Phase 1.10 stock adjustment service)
- **Replay Reconciliation Invariant**:
  - Replaying all movements from system inception to *now* equals live `InventoryBalance.quantityOnHand` byte-for-byte ($90 = 90$). Verified in test suite.

---

## 5. Domain Metric Registries & 501 Deferrals

### 5.1 Inventory Metrics
| Metric Key | Temporality | Value Type | Source Model | Date Anchor | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `inventory.quantityOnHand` | `AS_OF` | `SUM_QUANTITY` | `InventoryBalance` / `StockMovement` | `null` | Active |
| `inventory.belowMinimumStockPartCount` | `AS_OF` | `COUNT` | `Part` | `null` | Active |
| `inventory.partsConsumedQuantity` | `PERIOD` | `SUM_QUANTITY` | `WorkOrderPart` | `WorkOrderPart.consumedAt` | Active |
| `inventory.partsConsumedCost` | `PERIOD` | `SUM_MONEY` | `WorkOrderPart` | `WorkOrderPart.consumedAt` | Active |
| `inventory.stockMovementCount` | `PERIOD` | `COUNT` | `StockMovement` | `StockMovement.createdAt` | Active |
| `inventory.stockValue` | `AS_OF` | `SUM_MONEY` | `InventoryBalance` | `null` | **Deferred (501)** via `deferredReason` |

### 5.2 Asset Metrics
| Metric Key | Temporality | Value Type | Source Model | Date Anchor | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `assets.count` | `AS_OF` | `COUNT` | `Asset` | `null` | Active |
| `assets.countByStatus` | `AS_OF` | `COUNT` | `Asset` | `null` | Active |
| `assets.warrantyExpiringCount` | `AS_OF` | `COUNT` | `Asset` | `null` (90-day window) | Active |
| `assets.serviceEventCount` | `PERIOD` | `COUNT` | `WorkOrder` | `WorkOrder.completedAt` | Active |
| `assets.avgServicesPerAsset` | `PERIOD` | `AVG_COUNT` | `WorkOrder` | `WorkOrder.completedAt` | Active |
| `assets.mtbfHours` | `PERIOD` | `AVG_DURATION_HOURS` | `Asset` | `null` | **Deferred (501)** via `deferredReason` |
| `assets.mttrHours` | `PERIOD` | `AVG_DURATION_HOURS` | `Asset` | `null` | **Deferred (501)** via `deferredReason` |
| `assets.uptimePercentage` | `PERIOD` | `RATE_PERCENT` | `Asset` | `null` | **Deferred (501)** via `deferredReason` |
| `assets.downtimeMinutes` | `PERIOD` | `SUM_DURATION_MINUTES` | `Asset` | `null` | **Deferred (501)** via `deferredReason` |

### 5.3 Customer Metrics
| Metric Key | Temporality | Value Type | Source Model | Date Anchor | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `customers.activeCount` | `AS_OF` | `COUNT` | `Customer` | `null` | Active |
| `customers.countByStatus` | `AS_OF` | `COUNT` | `Customer` | `null` | Active |
| `customers.newCount` | `PERIOD` | `COUNT` | `Customer` | `Customer.createdAt` | Active |
| `customers.workOrdersPerCustomer` | `PERIOD` | `AVG_COUNT` | `WorkOrder` | `WorkOrder.createdAt` | Active |
| `customers.lifetimeInvoicedRevenue` | `AS_OF` | `SUM_MONEY` | `Invoice` | `null` (Pure Decimal snapshots) | Active |
| `customers.repeatCustomerRate` | `PERIOD` | `RATE_PERCENT` | `WorkOrder` | `WorkOrder.completedAt` | Active |
| `customers.churnRate` | `PERIOD` | `RATE_PERCENT` | `Customer` | `null` | **Deferred (501)** via `deferredReason` |
| `customers.retentionRate` | `PERIOD` | `RATE_PERCENT` | `Customer` | `null` | **Deferred (501)** via `deferredReason` |

---

## 6. Nullable Thresholds & Per-Location vs Aggregate Decision

1. **Nullable Threshold Handling**:
   - `Part.minimumStockLevel`: When `minimumStockLevel == null`, the part has no threshold configured and is strictly excluded from `inventory.belowMinimumStockPartCount`.
   - `Asset.warrantyExpiresAt`: When `warrantyExpiresAt == null`, the asset has no warranty tracking and is strictly excluded from `assets.warrantyExpiringCount`.
2. **Per-Location vs Aggregate Stock Decision**:
   - When an `inventoryLocationId` filter is provided: stock on hand for the part at that specific location is compared against `Part.minimumStockLevel`.
   - When no location filter is provided (workspace aggregate): the part's total stock on hand summed across all locations is compared against `Part.minimumStockLevel`.
   - Tested: A part with `minStock = 10` having 6 in Van 1 and 6 in Warehouse (total = 12) triggers low stock when queried for Van 1, but is healthy when queried at workspace aggregate.

---

## 7. Cardinality Guard & Untruncated Population

- **Reasoning**: In realistic enterprise tenants (5,000–25,000 parts, 2,000–15,000 customers), unpaginated group responses must have a protective ceiling against memory exhaustion in live aggregations. `MAX_GROUP_CARDINALITY = 1_000` serves as this guard rail for high-cardinality widget queries.
- **Untruncated Total**: When rows exceed 1,000, `meta.truncated: true` is emitted and `meta.totalUncappedCount` returns the true pre-truncation population count (e.g. `1005`), sorted deterministically with secondary tie-break on `id`.

---

## 8. Financial Money Rules & Currency Scoping

- `customers.lifetimeInvoicedRevenue` evaluates stored snapshots of `Invoice.total` in pure `Prisma.Decimal` (zero floating-point accumulation).
- **Single-Currency Enforcement**: If a workspace contains multiple invoice currencies, the report requires a `currencyCode` filter and throws `ReportParameterValidationError` if omitted. Tested with multi-currency fixture (`USD` + `EUR`).

---

## 9. Customer Anchor Reconciliation & File Naming

1. **Customer Anchor Distinction**:
   - `customers.workOrdersPerCustomer` measures **demand/intake volume** generated in the reporting period $\to$ anchored on write-once `WorkOrder.createdAt`.
   - `customers.repeatCustomerRate` measures **completed service delivery** frequency ($\ge 2$ completed visits) $\to$ anchored on write-once `WorkOrder.completedAt`.
2. **Report File Naming**:
   - Implementation file: [`lib/services/reporting/reports/partsConsumptionReport.ts`](file:///d:/Download/aforden/lib/services/reporting/reports/partsConsumptionReport.ts) matches report key `inventory.partsConsumption`.
   - Obsolete `inventoryStatusReport.ts` removed.

---

## 10. Role-by-Report Authorization Matrix & Denials

| Report Key | Required Permission | Allowed Roles | Denied Roles |
| :--- | :--- | :--- | :--- |
| `inventory.partsConsumption` | `REPORTS_VIEW_OPERATIONAL` | `ADMIN`, `MANAGER`, `DISPATCHER` | `TECHNICIAN` (403) |
| `asset.summary` | `REPORTS_VIEW_OPERATIONAL` | `ADMIN`, `MANAGER`, `DISPATCHER` | `TECHNICIAN` (403) |
| `customer.activitySummary` | `REPORTS_VIEW_OPERATIONAL` | `ADMIN`, `MANAGER`, `DISPATCHER` | `TECHNICIAN` (403) |

Role denials tested and verified for all 3 reports with `TECHNICIAN` actor context.

---

## 11. Test Mapping for the 10 Corrections

Below is the explicit test mapping proving all 10 correction items in `tests/reporting/inventoryAssetCustomerReports.test.ts`:

| # | Correction Item | Proving Test Name | Coverage Method |
| :--- | :--- | :--- | :--- |
| 1 | Value types (`AVG_COUNT`, `AVG_DURATION_HOURS`) | `verifies asset metric definitions and value types (AVG_COUNT & AVG_DURATION_HOURS)` & `verifies customer metric definitions and value types (AVG_COUNT)` | Extended existing test |
| 2 | Nullable threshold exclusions (`minimumStockLevel`, `warrantyExpiresAt`) | `excludes nullable thresholds (minimumStockLevel null on Part, warrantyExpiresAt null on Asset)` | New standalone test |
| 3 | Per-location vs aggregate discrimination (6 at Van 1 / 12 aggregate) | `evaluates low-stock threshold per-location vs aggregate workspace level` | New standalone test |
| 4 | Replay reconciliation invariant ($90 = 90$) & 6 movement sign conventions | `satisfies replay reconciliation invariant: replaying all movements to now matches live InventoryBalance exactly` | New standalone test |
| 5 | Row cap scale justification & `totalUncappedCount` | `truncates at MAX_GROUP_CARDINALITY (1,000) returning explicit truncated signal, totalUncappedCount, and tie-break ordering` | Extended existing test |
| 6 | 1.14.6 single-currency rule on `lifetimeInvoicedRevenue` (USD + EUR) | `enforces 1.14.6 single-currency rule on lifetime revenue and rejects mixed currency workspaces without filter` | New standalone test |
| 7 | Locked-file disclosure for all 1.14.2–1.14.6 files | Full §1 of this Walkthrough artifact | Walkthrough artifact |
| 8 | Registry accounting & arithmetic | Full §2 of this Walkthrough artifact | Walkthrough artifact |
| 9 | Role denials across all 3 reports | `denies TECHNICIAN role on inventory report with 403`, `denies TECHNICIAN role on asset report with 403`, `denies TECHNICIAN role on customer report with 403` | Extended with 2 new standalone tests |
| 10 | Customer anchor reconciliation & report file renaming | `verifies customer metric definitions and value types (AVG_COUNT)` & `partsConsumptionReport.ts` | Codebase refactor + test import |

---

## 12. Final Test Results & Verification Summary

### 12.1 Test Suite Breakdown (`tests/reporting/inventoryAssetCustomerReports.test.ts`)
```
 ✓ tests/reporting/inventoryAssetCustomerReports.test.ts (19 tests)
       ✓ verifies inventory metric definitions and write-once date anchors
       ✓ verifies asset metric definitions and value types (AVG_COUNT & AVG_DURATION_HOURS)
       ✓ verifies customer metric definitions and value types (AVG_COUNT)
       ✓ verifies Open-Closed 501 deferrals on metric definitions across all 3 domains
       ✓ satisfies replay reconciliation invariant: replaying all movements to now matches live InventoryBalance exactly
       ✓ evaluates low-stock threshold per-location vs aggregate workspace level
       ✓ excludes nullable thresholds (minimumStockLevel null on Part, warrantyExpiresAt null on Asset)
       ✓ computes parts consumed volume and monetary cost in pure Decimal
       ✓ evaluates warranty expiration boundary at exactly ASSET_WARRANTY_WINDOW_DAYS = 90
       ✓ aggregates completed maintenance work orders per asset as an average ratio (AVG_COUNT)
       ✓ evaluates repeat customer boundary at exactly 2 completed work orders
       ✓ enforces 1.14.6 single-currency rule on lifetime revenue and rejects mixed currency workspaces without filter
       ✓ aggregates customer lifetime invoiced revenue in pure Decimal snapshots with minimum PII
       ✓ truncates at MAX_GROUP_CARDINALITY (1,000) returning explicit truncated signal, totalUncappedCount, and tie-break ordering
       ✓ preserves zero-activity parts and customers in grouped queries
       ✓ denies TECHNICIAN role on inventory report with 403
       ✓ denies TECHNICIAN role on asset report with 403
       ✓ denies TECHNICIAN role on customer report with 403
       ✓ ensures foreign workspace inventory and customer data is invisible
```

### 12.2 Verification Summary
- **Type Checking (`npx tsc --noEmit`)**: **0 errors** (exit code 0).
- **Reporting Test Suite (`npx vitest run tests/reporting`)**: **161 / 161 passed** across 7 test files (up from 142 at 1.14.6 lock).
- **Workspace-wide Test Suite (`npx vitest run`)**: **3,632 / 3,632 passed** across 197 test files (up from 3,613 at 1.14.6 lock). Net +19 new tests.
- **Zero Schema Drift**: 0 new tables/models, 0 new columns, 0 Prisma migrations.
