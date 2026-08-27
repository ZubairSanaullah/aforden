import type { Permission } from "@/lib/services/authorization/permissions";
import type { MembershipRole, Prisma } from "@/generated/prisma/client";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { prisma } from "@/lib/prisma";
import type { z } from "zod";

/** Prisma models the Reporting domain is permitted to read. Closed set. */
export type ReportSourceModel =
  | "WorkOrder"
  | "WorkOrderHistory"
  | "ScheduleAppointment"
  | "ScheduleAppointmentHistory"
  | "TechnicianTimeEntry"
  | "Quote"
  | "Invoice"
  | "Payment"
  | "WorkOrderPart"
  | "StockMovement"
  | "InventoryBalance"
  | "Part"
  | "Asset"
  | "Customer";

export type MetricCategory =
  | "OPERATIONAL"   // work orders, scheduling, dispatch
  | "FINANCIAL"     // quotes, invoices, payments, AR
  | "TECHNICIAN"    // per-technician productivity & time
  | "INVENTORY"     // parts, stock, cost of parts consumed
  | "ASSET"
  | "CUSTOMER";

export type MetricValueType =
  | "COUNT"                 // integer
  | "AVG_COUNT"             // number, average ratio/count per entity (e.g. 1.5 work orders / customer)
  | "SUM_MONEY"             // Prisma.Decimal, serialized as a fixed-2 string
  | "SUM_QUANTITY"          // Prisma.Decimal, serialized as a fixed-4 string
  | "SUM_DURATION_MINUTES"  // integer, minutes
  | "AVG_DURATION_MINUTES"  // number, minutes
  | "AVG_DURATION_HOURS"    // number, hours
  | "AVG_DAYS"              // number, days
  | "RATE_PERCENT";         // number, 0..100, 2dp

/**
 * PERIOD        — the metric is meaningful over [startUtc, endUtc) and MUST declare a dateAnchor.
 * POINT_IN_TIME — the metric describes current state ("as of now"). It has NO dateAnchor, ignores
 *                 the requested range, reports meta.asOfUtc, and CANNOT be used in a time series.
 * AS_OF         — balance at a specific instant (e.g. AR aging). Evaluates asOfUtc.
 */
export type MetricTemporality = "PERIOD" | "POINT_IN_TIME" | "AS_OF";

/** The single timestamp column a PERIOD metric is filtered on. Closed set per source model. */
export interface MetricDateAnchor {
  model: ReportSourceModel;
  field: string;   // literal Prisma field name, e.g. "completedAt", "issueDate", "paymentDate"
}

export interface MaterializationTrigger {
  metricKey: MetricKey;
  thresholdName: string;
  thresholdValue: number;
  reason: string;
}

export type MetricKey =
  // --- OPERATIONAL (1.14.3) ---
  | "workOrders.createdCount"
  | "workOrders.completedCount"
  | "workOrders.cancelledCount"
  | "workOrders.openBacklogCount"          // POINT_IN_TIME
  | "workOrders.completionRate"
  | "workOrders.avgCycleTimeMinutes"
  // --- SCHEDULING (1.14.4) ---
  | "schedule.appointmentsScheduledCount"
  | "schedule.appointmentsCompletedCount"
  | "schedule.appointmentsCancelledCount"
  | "schedule.dispatchedCount"
  | "schedule.avgDispatchLatencyMinutes"
  | "schedule.avgAcknowledgeLatencyMinutes" // Deferred (501)
  // --- TECHNICIAN (1.14.5) ---
  | "technicians.completedWorkOrderCount"
  | "technicians.cancelledWorkOrderCount"
  | "technicians.avgJobDurationMinutes"
  | "technicians.onTimeArrivalRate"
  | "technicians.reassignmentAwayCount"
  | "technicians.onSiteMinutes"
  | "technicians.travelMinutes"
  | "technicians.trackedMinutes"
  | "technicians.onSiteShareOfTrackedTime"
  | "technicians.utilizationRate"     // Deferred (501)
  | "technicians.firstTimeFixRate"    // Deferred (501)
  // --- FINANCIAL (1.14.6) ---
  | "quotes.createdCount"
  | "quotes.approvedCount"
  | "quotes.rejectedCount"
  | "quotes.approvedTotal"
  | "quotes.pipelineTotal"
  | "quotes.winRate"
  | "invoices.invoicedRevenue"
  | "invoices.issuedCount"
  | "invoices.voidedCount"
  | "invoices.voidedTotal"
  | "invoices.outstandingBalance"          // AS_OF
  | "invoices.overdueBalance"              // AS_OF
  | "invoices.countByStatus"               // Deferred (501)
  | "invoices.avgDaysToPayment"
  | "invoices.collectionRate"              // Deferred (501)
  | "payments.collectedRevenue"
  | "payments.collectedCount"
  // --- INVENTORY / ASSET / CUSTOMER (1.14.7) ---
  | "inventory.partsConsumedCost"
  | "inventory.partsConsumedQuantity"
  | "inventory.quantityOnHand"             // AS_OF
  | "inventory.belowMinimumStockPartCount" // AS_OF
  | "inventory.stockValue"                 // Deferred (501)
  | "inventory.stockMovementCount"
  | "assets.count"                         // AS_OF
  | "assets.countByStatus"                 // AS_OF
  | "assets.warrantyExpiringCount"         // AS_OF
  | "assets.serviceEventCount"
  | "assets.avgServicesPerAsset"
  | "assets.mtbfHours"                     // Deferred (501)
  | "assets.mttrHours"                     // Deferred (501)
  | "assets.uptimePercentage"              // Deferred (501)
  | "assets.downtimeMinutes"               // Deferred (501)
  | "customers.newCount"
  | "customers.activeCount"                // AS_OF
  | "customers.countByStatus"              // AS_OF
  | "customers.workOrdersPerCustomer"
  | "customers.lifetimeInvoicedRevenue"    // AS_OF
  | "customers.repeatCustomerRate"
  | "customers.churnRate"                  // Deferred (501)
  | "customers.retentionRate";             // Deferred (501)

export interface MetricDefinition {
  key: MetricKey;
  category: MetricCategory;
  valueType: MetricValueType;
  temporality: MetricTemporality;
  sourceModel: ReportSourceModel;

  /** Required iff temporality === "PERIOD". Null iff "POINT_IN_TIME". */
  dateAnchor: MetricDateAnchor | null;

  /**
   * Non-negotiable predicate applied on top of workspace scope and the date range.
   * Expressed as a factory so it can never be mutated by a caller.
   * Example: workOrders.completedCount => () => ({ status: "COMPLETED" })
   */
  baseWhere: () => Record<string, unknown>;

  /** Aggregate pushed to PostgreSQL. */
  aggregation:
    | { kind: "COUNT" }
    | { kind: "SUM"; field: string }
    | { kind: "SUM_DURATION_MINUTES"; field: string }
    | { kind: "AVG_DURATION_MINUTES"; field: string }
    | { kind: "AVG_DATE_DIFF_MINUTES"; fromField: string; toField: string }
    | { kind: "SUM_PRODUCT"; leftField: string; rightField: string } // requires in-memory Decimal reduce (§8.3)
    | { kind: "RATE"; numerator: MetricKey; denominator: MetricKey }
    | { kind: "CUSTOM"; compute: string };

  requiredPermission: Permission;
  supportedDimensions: readonly DimensionKey[];

  /** true => the metric reads stored snapshot columns and must never re-derive pricing (§11.1). */
  isSnapshotDerived: boolean;

  /** null => live aggregation is sufficient indefinitely. Non-null => flagged in §4.5. */
  materializationTrigger: MaterializationTrigger | null;

  description: string;

  /** When present, getMetricDefinition throws 501 ReportMetricUnavailableError with this reason. */
  deferredReason?: string;
}

export type MetricRegistry = Readonly<Record<MetricKey, MetricDefinition>>;

export type DimensionKey =
  | "time.day" | "time.week" | "time.month" | "time.quarter" | "time.year"
  | "customer" | "technician" | "workType" | "serviceCatalog"
  | "workOrderStatus" | "workOrderPriority"
  | "appointmentStatus" | "dispatchStatus"
  | "quoteStatus" | "invoiceStatus" | "paymentMethod"
  | "assetStatus" | "assetCategory"
  | "part" | "inventoryLocation" | "timeEntryType";

export interface DimensionDefinition {
  key: DimensionKey;
  kind: "COLUMN" | "RELATION_ID" | "DATE_BUCKET";

  /**
   * Literal Prisma field name on the source model, resolved from THIS registry only.
   * Never assembled from, influenced by, or concatenated with request input.
   */
  groupByField: string | null;   // null for DATE_BUCKET

  /** Where the human-readable label comes from when the grouped value is an opaque id. */
  labelSource:
    | { kind: "ENUM" }
    | { kind: "SELF" }
    | { kind: "RELATION"; model: ReportSourceModel | "TechnicianProfile" | "WorkType" | "Part" | "InventoryLocation" | "AssetCategory"; labelFields: readonly string[] }
    | { kind: "DATE_BUCKET" };

  /** Governs the cardinality guard in §9.4. */
  cardinalityClass: "LOW" | "MEDIUM" | "HIGH";

  /** Source models this dimension is reachable from without a synthetic join. */
  applicableModels: readonly ReportSourceModel[];

  description: string;
}

export type DimensionRegistry = Readonly<Record<DimensionKey, DimensionDefinition>>;

export type ReportKey =
  | "operational.workOrderVolume"
  | "operational.workOrderThroughput"
  | "scheduling.dispatchPerformance"
  | "technician.productivity"
  | "technician.selfScorecard"
  | "financial.revenueSummary"
  | "financial.arAging"
  | "financial.quotePipeline"
  | "financial.quoteConversion"
  | "inventory.partsConsumption"
  | "asset.summary"
  | "customer.activitySummary";

export interface QueryArgs<TWhere = Record<string, unknown>> {
  where?: TWhere;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
  take?: number;
  skip?: number;
  by?: readonly string[];
  _count?: boolean | Record<string, boolean>;
  _sum?: Record<string, boolean>;
  _avg?: Record<string, boolean>;
  _min?: Record<string, boolean>;
  _max?: Record<string, boolean>;
}

export interface ScopedModelDelegate<T = Record<string, unknown>> {
  findMany<R = T>(args?: QueryArgs): Promise<R[]>;
  findFirst<R = T>(args?: QueryArgs): Promise<R | null>;
  count(args?: QueryArgs): Promise<number>;
  groupBy(args?: QueryArgs): Promise<Array<Record<string, unknown>>>;
}

export interface UnscopedModelDelegate<T = Record<string, unknown>> {
  findMany?<R = T>(args?: QueryArgs): Promise<R[]>;
  findFirst?<R = T>(args?: QueryArgs): Promise<R | null>;
  count?(args?: QueryArgs): Promise<number>;
  groupBy?(args?: QueryArgs): Promise<Array<Record<string, unknown>>>;
}

export interface ScopedReportDb {
  readonly workOrder: ScopedModelDelegate;
  readonly scheduleAppointment: ScopedModelDelegate;
  readonly scheduleAppointmentHistory: ScopedModelDelegate;
  readonly technicianProfile: ScopedModelDelegate;
  readonly technicianTimeEntry: ScopedModelDelegate;
  readonly workOrderHistory: ScopedModelDelegate;
  readonly quote: ScopedModelDelegate;
  readonly invoice: ScopedModelDelegate;
  readonly payment: ScopedModelDelegate;
  readonly workOrderPart: ScopedModelDelegate;
  readonly part: ScopedModelDelegate;
  readonly inventoryLocation: ScopedModelDelegate;
  readonly inventoryBalance: ScopedModelDelegate;
  readonly stockMovement: ScopedModelDelegate;
  readonly asset: ScopedModelDelegate;
  readonly assetCategory: ScopedModelDelegate;
  readonly customer: ScopedModelDelegate;
  readonly workType: ScopedModelDelegate;
  readonly serviceCatalog: ScopedModelDelegate;
  readonly employee: ScopedModelDelegate;
}

export type UnscopedReportDb =
  | Partial<Record<keyof ScopedReportDb, UnscopedModelDelegate>>
  | typeof prisma;

export interface ReportDefinition {
  reportKey: ReportKey;
  category: MetricCategory;
  title: string;

  metrics: readonly MetricKey[];
  allowedDimensions: readonly DimensionKey[];
  allowedFilters: readonly FilterKey[];
  allowedSortKeys: readonly (MetricKey | DimensionKey)[];
  defaultSort: { key: MetricKey | DimensionKey; order: "asc" | "desc" };

  requiredPermission: Permission;
  /** Roles for which the viewer's own technician scope is injected structurally (§7.3). */
  selfScopedRoles: readonly MembershipRole[];

  supportsTimeSeries: boolean;
  supportsCsvExport: boolean;

  paramsSchema: z.ZodType<unknown>;
  description: string;

  /**
   * Optional typed escape hatch executor for complex domain aggregations (Phase 1.14.8).
   * Executes under strict workspace scope; cannot bypass tenant isolation.
   */
  customExecutor?: ReportCustomExecutor;
}

export interface ReportQueryContext {
  readonly workspaceId: string;
  readonly auth: WorkspaceAuthorizationContext;
  readonly range: ResolvedReportDateRange;
  readonly rawFilters: Record<string, unknown>;
  readonly baseWhere: Record<string, unknown>;
  readonly requestedMetrics: readonly MetricKey[];
  readonly requestedDimensions: readonly DimensionKey[];
  readonly params: Record<string, unknown>;
  readonly scopedDb: ScopedReportDb;
}

export type ReportCustomExecutor = (
  ctx: ReportQueryContext,
) => Promise<{
  scalarValues?: Record<string, string | number | null>;
  rows?: Array<{
    groupKey: string;
    values: Record<string, string | number | null>;
  }>;
}>;

export type ReportRegistry = Readonly<Record<ReportKey, ReportDefinition>>;

export type FilterKey =
  | "customerId" | "technicianId" | "workTypeId" | "serviceCatalogId"
  | "workOrderStatus" | "workOrderPriority"
  | "appointmentStatus" | "dispatchStatus"
  | "quoteStatus" | "invoiceStatus" | "paymentMethod"
  | "assetStatus" | "assetCategoryId"
  | "partId" | "inventoryLocationId"
  | "timeEntryType";

export interface FilterDefinition {
  key: FilterKey;
  valueType: "CUID" | "ENUM" | "CUID_ARRAY" | "ENUM_ARRAY";
  enumValues?: readonly string[];          // for ENUM kinds — validated by Zod
  applicableModels: readonly ReportSourceModel[];
  /** Returns a fixed `where` fragment. Request input supplies the VALUE only, never a field name. */
  buildWhere: (value: unknown) => Record<string, unknown>;
  /** true => the id must be tenant-validated before use (§6.4). */
  requiresTenantValidation: boolean;
  description?: string;
}

export type FilterRegistry = Readonly<Record<FilterKey, FilterDefinition>>;

export type DateRangePreset =
  | "TODAY" | "YESTERDAY"
  | "THIS_WEEK" | "LAST_WEEK"
  | "THIS_MONTH" | "LAST_MONTH"
  | "THIS_QUARTER" | "LAST_QUARTER"
  | "THIS_YEAR" | "LAST_YEAR"
  | "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS" | "LAST_12_MONTHS";

export type DateBucketGranularity = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

export interface ResolvedReportDateRange {
  readonly startUtc: Date;   // INCLUSIVE  [
  readonly endUtc: Date;     // EXCLUSIVE  )
  readonly timezone: string; // Workspace.timezone — the calendar these boundaries were computed in
  readonly granularity: DateBucketGranularity;
  readonly preset: DateRangePreset | null;
  readonly startLocalDate: string; // "2026-08-01" — inclusive first local day
  readonly endLocalDate: string;   // "2026-08-31" — inclusive LAST local day (display label)
  readonly bucketCount: number;
}

export interface PaginatedReportRows<TRow> {
  items: TRow[];
  total: number;      // total distinct groups matching the query
  page: number;       // 1-based
  limit: number;
  totalPages: number; // Math.ceil(total / limit) || 1
}

export interface ReportMeta {
  reportKey: ReportKey;
  title: string;
  generatedAt: string;                 // ISO-8601 UTC — self-dates the result (§11.4)
  timezone: string;                    // Workspace.timezone — the calendar used
  shape: "SCALARS" | "ROWS" | "SERIES";
  scope: "WORKSPACE" | "SELF";         // §7.3
  range: {
    startUtc: string; endUtc: string;  // half-open [startUtc, endUtc)
    startLocalDate: string; endLocalDate: string; // inclusive local labels
    preset: DateRangePreset | null;
    granularity: DateBucketGranularity;
  } | null;                            // null when every requested metric is POINT_IN_TIME
  asOfUtc: string | null;              // set when a POINT_IN_TIME metric is present
  metrics: Array<{
    key: MetricKey; label: string; valueType: MetricValueType;
    temporality: MetricTemporality; currencyCode?: string;
  }>;
  dimensions: Array<{ key: DimensionKey; label: string }>;
  appliedFilters: Array<{ key: FilterKey; value: string | string[] }>;
  sort: { key: string; order: "asc" | "desc" };
  sortedInMemory: boolean;             // §9.3 — which sort path executed
  truncated: boolean;                  // true if results were capped (§9.4)
  totalUncappedCount?: number;         // total count before truncation
  pagination?: {
    page: number;
    limit: number;
    totalPages: number;
    totalRows: number;
  };
}

export type MetricValue = string | number | null | Prisma.Decimal;

export interface ReportScalarsReadModel {
  meta: ReportMeta;
  values: Record<string, MetricValue>;
}

export interface ReportRow {
  dimensions: Record<string, { key: string; label: string }>;
  values: Record<string, MetricValue>;
}

export interface ReportRowsReadModel {
  meta: ReportMeta;
  items: ReportRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReportSeriesReadModel {
  meta: ReportMeta;
  series: Array<{
    bucketStartUtc: string;
    bucketLocalLabel: string;                        // e.g. "2026-08" / "2026-08-27"
    values: Record<string, MetricValue>;
  }>;                                                // zero-filled, contiguous, ascending (§8.4.4)
}

export type ReportResponse = ReportScalarsReadModel | ReportRowsReadModel | ReportSeriesReadModel;
