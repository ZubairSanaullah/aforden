import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { MATERIALIZATION_TRIGGERS } from "../reportingConstants";
import type { MetricDefinition } from "../reporting.types";
import { registerMetric } from "../metricRegistry";

/**
 * Non-terminal WorkOrderStatus enum values representing the active open backlog.
 * Verified against WorkOrderStatus in prisma/schema.prisma:
 * OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD (terminal: COMPLETED, CANCELLED).
 */
export const OPEN_WORK_ORDER_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
] as const;

export const WORK_ORDER_OPERATIONAL_DIMENSIONS = [
  "technician",
  "workType",
  "serviceCatalog",
  "workOrderStatus",
  "workOrderPriority",
  "customer",
  "time.day",
  "time.week",
  "time.month",
  "time.quarter",
  "time.year",
] as const;

export const operationalMetricDefinitions: readonly MetricDefinition[] = [
  {
    key: "workOrders.createdCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "createdAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: WORK_ORDER_OPERATIONAL_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of work orders created within the specified date range [startUtc, endUtc).",
  },
  {
    key: "workOrders.completedCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    // Mandatory completion guard (§11.3): must filter on status = COMPLETED to exclude work orders completed and subsequently cancelled
    baseWhere: () => ({ status: "COMPLETED" }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: [
      "technician",
      "workType",
      "serviceCatalog",
      "workOrderPriority",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of work orders completed within the specified date range (anchored on completedAt with status = COMPLETED).",
  },
  {
    key: "workOrders.cancelledCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "cancelledAt" },
    baseWhere: () => ({ status: "CANCELLED" }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: [
      "technician",
      "workType",
      "serviceCatalog",
      "workOrderPriority",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of work orders cancelled within the specified date range (anchored on cancelledAt with status = CANCELLED).",
  },
  {
    key: "workOrders.openBacklogCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "POINT_IN_TIME",
    sourceModel: "WorkOrder",
    dateAnchor: null, // POINT_IN_TIME has no date anchor (§2.4)
    baseWhere: () => ({ status: { in: [...OPEN_WORK_ORDER_STATUSES] } }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: [
      "technician",
      "workType",
      "serviceCatalog",
      "workOrderStatus",
      "workOrderPriority",
      "customer",
    ],
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Current point-in-time count of open work orders in non-terminal statuses (OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD) as of query time.",
  },
  {
    key: "workOrders.completionRate",
    category: "OPERATIONAL",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({}),
    aggregation: {
      kind: "RATE",
      numerator: "workOrders.completedCount",
      denominator: "workOrders.createdCount",
    },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: [
      "technician",
      "workType",
      "serviceCatalog",
      "workOrderPriority",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Percentage of work orders completed relative to created (completedCount / createdCount * 100) where numerator (completedCount) and denominator (createdCount) are computed against the identical resolved date range [startUtc, endUtc) from resolveReportDateRange().",
  },
  {
    key: "workOrders.avgCycleTimeMinutes",
    category: "OPERATIONAL",
    valueType: "AVG_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({
      status: "COMPLETED",
      completedAt: { not: null },
      createdAt: { not: null },
    }),
    aggregation: {
      kind: "AVG_DATE_DIFF_MINUTES",
      fromField: "createdAt",
      toField: "completedAt",
    },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: [
      "technician",
      "workType",
      "serviceCatalog",
      "workOrderPriority",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    isSnapshotDerived: false,
    materializationTrigger: {
      metricKey: "workOrders.avgCycleTimeMinutes",
      thresholdName: "WORK_ORDER_ROWS_PER_WORKSPACE",
      thresholdValue: MATERIALIZATION_TRIGGERS.WORK_ORDER_ROWS_PER_WORKSPACE,
      reason:
        "AVG(completedAt - createdAt) scans rows into memory; primary candidate for daily completion summary precomputation once volume exceeds threshold.",
    },
    description:
      "Average elapsed duration in minutes from work order creation to completion for work orders completed in the period.",
  },
];

/**
 * Registers all operational metric definitions into the global METRIC_REGISTRY.
 */
export function registerOperationalMetrics(): void {
  for (const def of operationalMetricDefinitions) {
    registerMetric(def);
  }
}

// Automatically register operational metrics on module load
registerOperationalMetrics();
