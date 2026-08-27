import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type { MetricDefinition } from "../reporting.types";
import { registerMetric } from "../metricRegistry";

export const SCHEDULING_DIMENSIONS = [
  "technician",
  "appointmentStatus",
  "dispatchStatus",
  "time.day",
  "time.week",
  "time.month",
  "time.quarter",
  "time.year",
] as const;

export const schedulingMetricDefinitions: readonly MetricDefinition[] = [
  {
    key: "schedule.appointmentsScheduledCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointment", field: "createdAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: SCHEDULING_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of schedule appointments created/scheduled within the specified date range [startUtc, endUtc).",
  },
  {
    key: "schedule.appointmentsCompletedCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointmentHistory", field: "createdAt" },
    // Anchored directly to immutable ScheduleAppointmentHistory completion event
    baseWhere: () => ({
      history: {
        some: {
          eventType: "COMPLETED",
        },
      },
    }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: [
      "technician",
      "dispatchStatus",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of appointments completed within the specified date range, anchored to the immutable ScheduleAppointmentHistory.createdAt timestamp with eventType = 'COMPLETED'.",
  },
  {
    key: "schedule.appointmentsCancelledCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointmentHistory", field: "createdAt" },
    // Anchored directly to immutable ScheduleAppointmentHistory cancellation event
    baseWhere: () => ({
      history: {
        some: {
          eventType: "CANCELLED",
        },
      },
    }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: [
      "technician",
      "dispatchStatus",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of appointments cancelled within the specified date range, anchored to the immutable ScheduleAppointmentHistory.createdAt timestamp with eventType = 'CANCELLED'.",
  },
  {
    key: "schedule.dispatchedCount",
    category: "OPERATIONAL",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointmentHistory", field: "createdAt" },
    baseWhere: () => ({
      history: {
        some: {
          eventType: "DISPATCHED",
        },
      },
    }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: SCHEDULING_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of appointments dispatched within the specified date range, anchored to the immutable ScheduleAppointmentHistory.createdAt timestamp with eventType = 'DISPATCHED'.",
  },
  {
    key: "schedule.avgDispatchLatencyMinutes",
    category: "OPERATIONAL",
    valueType: "AVG_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointmentHistory", field: "createdAt" },
    baseWhere: () => ({
      history: {
        some: {
          eventType: "DISPATCHED",
        },
      },
    }),
    aggregation: {
      kind: "AVG_DATE_DIFF_MINUTES",
      fromField: "createdAt",
      toField: "history.createdAt",
    },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: SCHEDULING_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Average elapsed duration in minutes from appointment creation to dispatch for appointments dispatched in the period, anchored to the immutable ScheduleAppointmentHistory.createdAt timestamp.",
  },
  {
    key: "schedule.avgAcknowledgeLatencyMinutes",
    category: "OPERATIONAL",
    valueType: "AVG_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "ScheduleAppointment",
    dateAnchor: { model: "ScheduleAppointment", field: "updatedAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "AVG_DURATION_MINUTES", field: "updatedAt" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: SCHEDULING_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: ScheduleAppointment model lacks acknowledgedAt timestamp field and ScheduleHistoryEventType has no ACKNOWLEDGED member.",
    deferredReason:
      'Metric "schedule.avgAcknowledgeLatencyMinutes" cannot be computed: ScheduleAppointment model lacks "acknowledgedAt" timestamp field and ScheduleHistoryEventType has no "ACKNOWLEDGED" member (Phase 1.8 dependency gap).',
  },
];

/**
 * Registers all scheduling metric definitions into the global METRIC_REGISTRY.
 */
export function registerSchedulingMetrics(): void {
  for (const def of schedulingMetricDefinitions) {
    registerMetric(def);
  }
}

// Automatically register scheduling metrics on module load
registerSchedulingMetrics();
