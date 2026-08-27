import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type { MetricDefinition } from "../reporting.types";
import { registerMetric } from "../metricRegistry";

export const ASSET_DIMENSIONS = [
  "assetCategory",
  "assetStatus",
  "customer",
  "time.day",
  "time.week",
  "time.month",
  "time.quarter",
  "time.year",
] as const;

export const assetMetricDefinitions: readonly MetricDefinition[] = [
  {
    key: "assets.count",
    category: "ASSET",
    valueType: "COUNT",
    temporality: "AS_OF",
    sourceModel: "Asset",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description: "Total count of assets in workspace as of now.",
  },
  {
    key: "assets.countByStatus",
    category: "ASSET",
    valueType: "COUNT",
    temporality: "AS_OF",
    sourceModel: "Asset",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description: "Count of assets bucketed by their current lifecycle status as of now.",
  },
  {
    key: "assets.warrantyExpiringCount",
    category: "ASSET",
    valueType: "COUNT",
    temporality: "AS_OF",
    sourceModel: "Asset",
    dateAnchor: null,
    baseWhere: () => ({
      warrantyExpiresAt: { not: null },
    }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of active assets whose manufacturer/installation warranty expires within the configured warranty window (ASSET_WARRANTY_WINDOW_DAYS = 90 days from asOfUtc).",
  },
  {
    key: "assets.serviceEventCount",
    category: "ASSET",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({ status: "COMPLETED", assetId: { not: null } }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of completed maintenance/service work orders associated with assets during the reporting period (anchored on write-once WorkOrder.completedAt).",
  },
  {
    key: "assets.avgServicesPerAsset",
    category: "ASSET",
    valueType: "AVG_COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({ status: "COMPLETED", assetId: { not: null } }),
    aggregation: { kind: "CUSTOM", compute: "serviceEvents / activeAssets" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Average number of completed service events per serviced asset in the reporting period.",
  },
  {
    key: "assets.mtbfHours",
    category: "ASSET",
    valueType: "AVG_DURATION_HOURS",
    temporality: "PERIOD",
    sourceModel: "Asset",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: AssetHistoryEventType lacks FAILURE/BREAKDOWN incident events to determine mean time between failures.",
    deferredReason:
      'Metric "assets.mtbfHours" cannot be computed: AssetHistoryEventType lacks FAILURE/BREAKDOWN incident events to determine mean time between failures (Phase 1.9 constraint).',
  },
  {
    key: "assets.mttrHours",
    category: "ASSET",
    valueType: "AVG_DURATION_HOURS",
    temporality: "PERIOD",
    sourceModel: "Asset",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: AssetHistoryEventType lacks RESTORATION/REPAIR_END completion events to determine mean time to repair.",
    deferredReason:
      'Metric "assets.mttrHours" cannot be computed: AssetHistoryEventType lacks RESTORATION/REPAIR_END completion events to determine mean time to repair (Phase 1.9 constraint).',
  },
  {
    key: "assets.uptimePercentage",
    category: "ASSET",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "Asset",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: Asset domain lacks continuous telemetry / incident downtime duration logging.",
    deferredReason:
      'Metric "assets.uptimePercentage" cannot be computed: Asset domain lacks continuous telemetry / incident downtime duration logging (Phase 1.9 constraint).',
  },
  {
    key: "assets.downtimeMinutes",
    category: "ASSET",
    valueType: "SUM_DURATION_MINUTES",
    temporality: "PERIOD",
    sourceModel: "Asset",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ASSET_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: Asset domain lacks incident breakdown duration logging.",
    deferredReason:
      'Metric "assets.downtimeMinutes" cannot be computed: Asset domain lacks incident breakdown duration logging (Phase 1.9 constraint).',
  },
];

for (const metric of assetMetricDefinitions) {
  registerMetric(metric);
}
