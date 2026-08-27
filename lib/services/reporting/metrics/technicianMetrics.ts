import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type { MetricDefinition } from "../reporting.types";
import { registerMetric } from "../metricRegistry";

export const TECHNICIAN_DIMENSIONS = [
  "technician",
  "time.day",
  "time.week",
  "time.month",
  "time.quarter",
  "time.year",
] as const;

export const technicianMetricDefinitions: readonly MetricDefinition[] = [
  {
    key: "technicians.completedWorkOrderCount",
    category: "TECHNICIAN",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({ status: "COMPLETED" }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of work orders completed by the technician within the specified date range [startUtc, endUtc) (anchored on completedAt with status = COMPLETED).",
  },
  {
    key: "technicians.cancelledWorkOrderCount",
    category: "TECHNICIAN",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "cancelledAt" },
    baseWhere: () => ({ status: "CANCELLED" }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of work orders assigned to the technician that were cancelled within the specified date range (anchored on cancelledAt with status = CANCELLED).",
  },
  {
    key: "technicians.avgJobDurationMinutes",
    category: "TECHNICIAN",
    valueType: "AVG_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({ status: "COMPLETED" }),
    aggregation: { kind: "CUSTOM", compute: "totalCompletedOnSiteMinutes / completedWorkOrderCount" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Average duration in minutes of on-site work across completed work orders for the technician within the reporting period (anchored on completedAt). Numerator and denominator both anchor on completed work orders in the period.",
  },
  {
    key: "technicians.reassignmentAwayCount",
    category: "TECHNICIAN",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrderHistory",
    dateAnchor: { model: "WorkOrderHistory", field: "createdAt" },
    baseWhere: () => ({
      field: "assignedTechnicianId",
      eventType: { in: ["REASSIGNED", "UNASSIGNED"] },
    }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of work orders reassigned away from this technician during the reporting period (anchored on immutable WorkOrderHistory.createdAt where field = 'assignedTechnicianId', eventType in ['REASSIGNED', 'UNASSIGNED'], and oldValue matching the technician).",
  },
  {
    key: "technicians.onSiteMinutes",
    category: "TECHNICIAN",
    valueType: "SUM_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "TechnicianTimeEntry",
    dateAnchor: { model: "TechnicianTimeEntry", field: "startedAt" },
    baseWhere: () => ({ entryType: "ON_SITE", status: "COMPLETED" }),
    aggregation: { kind: "SUM_DURATION_MINUTES", field: "durationMinutes" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Total minutes of completed on-site work (entryType = ON_SITE, status = COMPLETED) logged by the technician during the specified date range.",
  },
  {
    key: "technicians.travelMinutes",
    category: "TECHNICIAN",
    valueType: "SUM_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "TechnicianTimeEntry",
    dateAnchor: { model: "TechnicianTimeEntry", field: "startedAt" },
    baseWhere: () => ({ entryType: "TRAVEL", status: "COMPLETED" }),
    aggregation: { kind: "SUM_DURATION_MINUTES", field: "durationMinutes" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Total minutes of completed travel (entryType = TRAVEL, status = COMPLETED) logged by the technician during the specified date range.",
  },
  {
    key: "technicians.trackedMinutes",
    category: "TECHNICIAN",
    valueType: "SUM_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "TechnicianTimeEntry",
    dateAnchor: { model: "TechnicianTimeEntry", field: "startedAt" },
    baseWhere: () => ({ status: "COMPLETED" }),
    aggregation: { kind: "SUM_DURATION_MINUTES", field: "durationMinutes" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Total minutes of completed time logged across all four entry types (ON_SITE, TRAVEL, BREAK, ADMIN) by the technician during the period (status = COMPLETED).",
  },
  {
    key: "technicians.onSiteShareOfTrackedTime",
    category: "TECHNICIAN",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "TechnicianTimeEntry",
    dateAnchor: { model: "TechnicianTimeEntry", field: "startedAt" },
    baseWhere: () => ({ status: "COMPLETED" }),
    aggregation: {
      kind: "CUSTOM",
      compute: "(onSiteMinutes / trackedMinutes) * 100",
    },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Percentage of total completed tracked time spent on-site (onSiteMinutes / trackedMinutes * 100). Returns null if trackedMinutes is 0.",
  },
  {
    key: "technicians.onTimeArrivalRate",
    category: "TECHNICIAN",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointment", field: "updatedAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "RATE", numerator: "technicians.completedWorkOrderCount", denominator: "technicians.completedWorkOrderCount" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: ScheduleHistoryEventType lacks ARRIVED event member and fieldExecutionStartedAt is mutable column.",
    deferredReason:
      'Metric "technicians.onTimeArrivalRate" cannot be computed: ScheduleHistoryEventType lacks an ARRIVED event member and ScheduleAppointment.fieldExecutionStartedAt is a mutable column rather than an immutable history table (Phase 1.8 dependency gap).',
  },
  {
    key: "technicians.utilizationRate",
    category: "TECHNICIAN",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "TechnicianTimeEntry",
    dateAnchor: { model: "TechnicianTimeEntry", field: "startedAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "RATE", numerator: "technicians.trackedMinutes", denominator: "technicians.trackedMinutes" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: System lacks scheduled capacity / planned shift calendar integration to compare against worked time.",
    deferredReason:
      'Metric "technicians.utilizationRate" cannot be computed: System lacks scheduled capacity / planned shift calendar integration to compare against worked time (Phase 1.8 dependency gap).',
  },
  {
    key: "technicians.firstTimeFixRate",
    category: "TECHNICIAN",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "RATE", numerator: "workOrders.completedCount", denominator: "workOrders.completedCount" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    supportedDimensions: TECHNICIAN_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: WorkOrder model lacks firstTimeFix boolean flag and repeat-visit recurrence tracking.",
    deferredReason:
      'Metric "technicians.firstTimeFixRate" cannot be computed: WorkOrder model lacks firstTimeFix boolean flag and repeat-visit recurrence tracking (Phase 1.8 dependency gap).',
  },
];

/**
 * Registers all technician metric definitions into the global METRIC_REGISTRY.
 */
export function registerTechnicianMetrics(): void {
  for (const def of technicianMetricDefinitions) {
    registerMetric(def);
  }
}

// Automatically register technician metrics on module load
registerTechnicianMetrics();
