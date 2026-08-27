import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type { MetricDefinition } from "../reporting.types";
import { registerMetric } from "../metricRegistry";

export const INVENTORY_DIMENSIONS = [
  "part",
  "inventoryLocation",
  "time.day",
  "time.week",
  "time.month",
  "time.quarter",
  "time.year",
] as const;

export const inventoryMetricDefinitions: readonly MetricDefinition[] = [
  {
    key: "inventory.quantityOnHand",
    category: "INVENTORY",
    valueType: "SUM_QUANTITY",
    temporality: "AS_OF",
    sourceModel: "InventoryBalance",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "SUM", field: "quantityOnHand" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: INVENTORY_DIMENSIONS,
    isSnapshotDerived: true,
    materializationTrigger: null,
    description:
      "Physical stock quantity on hand as of the specified instant (evaluates InventoryBalance.quantityOnHand at current time, or replays StockMovement ledger for historical asOf requests).",
  },
  {
    key: "inventory.belowMinimumStockPartCount",
    category: "INVENTORY",
    valueType: "COUNT",
    temporality: "AS_OF",
    sourceModel: "Part",
    dateAnchor: null,
    baseWhere: () => ({ status: "ACTIVE", minimumStockLevel: { not: null } }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: ["part", "inventoryLocation"],
    isSnapshotDerived: true,
    materializationTrigger: null,
    description:
      "Count of active parts whose total stock on hand is less than or equal to their configured minimumStockLevel as of now.",
  },
  {
    key: "inventory.partsConsumedQuantity",
    category: "INVENTORY",
    valueType: "SUM_QUANTITY",
    temporality: "PERIOD",
    sourceModel: "WorkOrderPart",
    dateAnchor: { model: "WorkOrderPart", field: "consumedAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "SUM", field: "quantity" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: INVENTORY_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Total quantity of parts consumed on work orders during the reporting period (anchored on write-once WorkOrderPart.consumedAt).",
  },
  {
    key: "inventory.partsConsumedCost",
    category: "INVENTORY",
    valueType: "SUM_MONEY",
    temporality: "PERIOD",
    sourceModel: "WorkOrderPart",
    dateAnchor: { model: "WorkOrderPart", field: "consumedAt" },
    baseWhere: () => ({}),
    aggregation: {
      kind: "SUM_PRODUCT",
      leftField: "quantity",
      rightField: "unitCostAtTimeOfUse",
    },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: INVENTORY_DIMENSIONS,
    isSnapshotDerived: true,
    materializationTrigger: null,
    description:
      "Total cost of parts consumed on work orders during the reporting period (quantity * unitCostAtTimeOfUse snapshot, anchored on write-once consumedAt).",
  },
  {
    key: "inventory.stockMovementCount",
    category: "INVENTORY",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "StockMovement",
    dateAnchor: { model: "StockMovement", field: "createdAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: INVENTORY_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Total number of stock movement transactions recorded in the period (anchored on immutable StockMovement.createdAt).",
  },
  {
    key: "inventory.stockValue",
    category: "INVENTORY",
    valueType: "SUM_MONEY",
    temporality: "AS_OF",
    sourceModel: "InventoryBalance",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "SUM", field: "quantityOnHand" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: INVENTORY_DIMENSIONS,
    isSnapshotDerived: true,
    materializationTrigger: null,
    description:
      "Deferred to 501: System stores static Part.unitCost but does not model an inventory costing method (FIFO, LIFO, or weighted average cost layers) for balance valuation.",
    deferredReason:
      'Metric "inventory.stockValue" cannot be computed: System stores static Part.unitCost but does not model an inventory costing method (FIFO, LIFO, or weighted average cost layers) for balance valuation (Phase 1.10 constraint).',
  },
];

for (const metric of inventoryMetricDefinitions) {
  registerMetric(metric);
}
