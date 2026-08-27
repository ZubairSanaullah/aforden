import { UnknownDimensionError } from "./reportingErrors";
import type { DimensionDefinition, DimensionKey } from "./reporting.types";

/**
 * Dimension Registry (Closed compile-time allowlist).
 * Populated incrementally across Phase 1.14.3 – 1.14.7.
 */
export const DIMENSION_REGISTRY: Partial<Record<DimensionKey, DimensionDefinition>> = {};

/**
 * Retrieves a registered dimension definition by key.
 * Throws UnknownDimensionError if the key is not registered.
 */
export function getDimensionDefinition(key: DimensionKey): DimensionDefinition {
  const definition = DIMENSION_REGISTRY[key];
  if (!definition) {
    throw new UnknownDimensionError(`Unknown or unregistered dimension key: "${key}".`);
  }
  return definition;
}

/**
 * Internal helper to register dimension definitions into the registry.
 */
export function registerDimension(definition: DimensionDefinition): void {
  DIMENSION_REGISTRY[definition.key] = definition;
}

/**
 * Internal helper for testing (to remove temporary registrations).
 */
export function unregisterDimension(key: DimensionKey): void {
  delete DIMENSION_REGISTRY[key];
}

// =========================================================================
// WorkOrder Reachable Dimension Definitions (Phase 1.14.3)
// =========================================================================
export const workOrderDimensionDefinitions: readonly DimensionDefinition[] = [
  {
    key: "technician",
    kind: "RELATION_ID",
    groupByField: "assignedTechnicianId",
    labelSource: {
      kind: "RELATION",
      model: "TechnicianProfile",
      labelFields: ["id"],
    },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder", "ScheduleAppointment"],
    description: "Assigned technician profile foreign key ID.",
  },
  {
    key: "workType",
    kind: "RELATION_ID",
    groupByField: "workTypeId",
    labelSource: {
      kind: "RELATION",
      model: "WorkType",
      labelFields: ["name", "code"],
    },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder"],
    description: "Work type foreign key ID.",
  },
  {
    key: "serviceCatalog",
    kind: "RELATION_ID",
    groupByField: "workTypeId", // Reachable via workType relation
    labelSource: {
      kind: "RELATION",
      model: "WorkType",
      labelFields: ["catalogId"],
    },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder"],
    description: "Service catalog grouping via work type.",
  },
  {
    key: "workOrderStatus",
    kind: "COLUMN",
    groupByField: "status",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["WorkOrder"],
    description: "Work order lifecycle status (OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED).",
  },
  {
    key: "workOrderPriority",
    kind: "COLUMN",
    groupByField: "priority",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["WorkOrder"],
    description: "Work order urgency/priority (LOW, MEDIUM, HIGH, URGENT).",
  },
  {
    key: "customer",
    kind: "RELATION_ID",
    groupByField: "customerId",
    labelSource: {
      kind: "RELATION",
      model: "Customer",
      labelFields: ["name", "customerNumber"],
    },
    cardinalityClass: "HIGH",
    applicableModels: ["WorkOrder", "Invoice", "Asset", "Quote"],
    description: "Customer account foreign key ID.",
  },
  {
    key: "time.day",
    kind: "DATE_BUCKET",
    groupByField: null,
    labelSource: { kind: "DATE_BUCKET" },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder", "ScheduleAppointment", "Invoice", "Payment", "WorkOrderPart", "StockMovement"],
    description: "Daily aggregation time bucket in workspace timezone.",
  },
  {
    key: "time.week",
    kind: "DATE_BUCKET",
    groupByField: null,
    labelSource: { kind: "DATE_BUCKET" },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder", "ScheduleAppointment", "Invoice", "Payment", "WorkOrderPart", "StockMovement"],
    description: "Weekly (Monday-first) aggregation time bucket in workspace timezone.",
  },
  {
    key: "time.month",
    kind: "DATE_BUCKET",
    groupByField: null,
    labelSource: { kind: "DATE_BUCKET" },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder", "ScheduleAppointment", "Invoice", "Payment", "WorkOrderPart", "StockMovement"],
    description: "Monthly aggregation time bucket in workspace timezone.",
  },
  {
    key: "time.quarter",
    kind: "DATE_BUCKET",
    groupByField: null,
    labelSource: { kind: "DATE_BUCKET" },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder", "ScheduleAppointment", "Invoice", "Payment", "WorkOrderPart", "StockMovement"],
    description: "Quarterly aggregation time bucket in workspace timezone.",
  },
  {
    key: "time.year",
    kind: "DATE_BUCKET",
    groupByField: null,
    labelSource: { kind: "DATE_BUCKET" },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrder", "ScheduleAppointment", "Invoice", "Payment", "WorkOrderPart", "StockMovement"],
    description: "Annual aggregation time bucket in workspace timezone.",
  },
];

// =========================================================================
// Scheduling Reachable Dimension Definitions (Phase 1.14.4)
// =========================================================================
export const schedulingDimensionDefinitions: readonly DimensionDefinition[] = [
  {
    key: "appointmentStatus",
    kind: "COLUMN",
    groupByField: "status",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["ScheduleAppointment"],
    description:
      "Schedule appointment lifecycle status (SCHEDULED, RESCHEDULED, CANCELLED, COMPLETED).",
  },
  {
    key: "dispatchStatus",
    kind: "COLUMN",
    groupByField: "dispatchStatus",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["ScheduleAppointment"],
    description:
      "Dispatch progression status (PENDING_DISPATCH, DISPATCHED, ACKNOWLEDGED).",
  },
];

// =========================================================================
// Inventory, Asset & Financial Dimensions (Phase 1.14.6 – 1.14.7)
// =========================================================================
export const domainDimensionDefinitions: readonly DimensionDefinition[] = [
  {
    key: "part",
    kind: "RELATION_ID",
    groupByField: "partId",
    labelSource: {
      kind: "RELATION",
      model: "Part",
      labelFields: ["name", "sku"],
    },
    cardinalityClass: "HIGH",
    applicableModels: ["WorkOrderPart", "StockMovement", "InventoryBalance"],
    description: "Inventory part/item foreign key ID.",
  },
  {
    key: "inventoryLocation",
    kind: "RELATION_ID",
    groupByField: "locationId",
    labelSource: {
      kind: "RELATION",
      model: "InventoryLocation",
      labelFields: ["name"],
    },
    cardinalityClass: "MEDIUM",
    applicableModels: ["WorkOrderPart", "StockMovement", "InventoryBalance"],
    description: "Inventory warehouse/vehicle location foreign key ID.",
  },
  {
    key: "assetCategory",
    kind: "RELATION_ID",
    groupByField: "categoryId",
    labelSource: {
      kind: "RELATION",
      model: "AssetCategory",
      labelFields: ["name"],
    },
    cardinalityClass: "MEDIUM",
    applicableModels: ["Asset"],
    description: "Asset category foreign key ID.",
  },
  {
    key: "assetStatus",
    kind: "COLUMN",
    groupByField: "status",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["Asset"],
    description: "Asset lifecycle status (OPERATIONAL, DEGRADED, OUT_OF_SERVICE, IN_STORAGE, DECOMMISSIONED, RETIRED).",
  },
  {
    key: "invoiceStatus",
    kind: "COLUMN",
    groupByField: "status",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["Invoice"],
    description: "Invoice status (DRAFT, ISSUED, PARTIALLY_PAID, PAID, OVERDUE, VOID).",
  },
  {
    key: "paymentMethod",
    kind: "COLUMN",
    groupByField: "paymentMethod",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["Payment"],
    description: "Payment method (CASH, CHECK, CREDIT_CARD, BANK_TRANSFER, ACH, OTHER).",
  },
  {
    key: "quoteStatus",
    kind: "COLUMN",
    groupByField: "status",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["Quote"],
    description: "Quote status (DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, EXPIRED, CONVERTED).",
  },
  {
    key: "timeEntryType",
    kind: "COLUMN",
    groupByField: "entryType",
    labelSource: { kind: "ENUM" },
    cardinalityClass: "LOW",
    applicableModels: ["TechnicianTimeEntry"],
    description: "Time entry type (ON_SITE, TRAVEL, BREAK, ADMIN).",
  },
];

for (const def of workOrderDimensionDefinitions) {
  registerDimension(def);
}

for (const def of schedulingDimensionDefinitions) {
  registerDimension(def);
}

for (const def of domainDimensionDefinitions) {
  registerDimension(def);
}
