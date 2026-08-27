import { UnknownFilterError } from "./reportingErrors";
import type { FilterDefinition, FilterKey } from "./reporting.types";

/**
 * Filter Registry (Closed compile-time allowlist).
 * Populated incrementally across Phase 1.14.3 – 1.14.7.
 */
export const FILTER_REGISTRY: Partial<Record<FilterKey, FilterDefinition>> = {};

/**
 * Retrieves a registered filter definition by key.
 * Throws UnknownFilterError if the key is not registered.
 */
export function getFilterDefinition(key: FilterKey): FilterDefinition {
  const definition = FILTER_REGISTRY[key];
  if (!definition) {
    throw new UnknownFilterError(`Unknown or unregistered filter key: "${key}".`);
  }
  return definition;
}

/**
 * Internal helper to register filter definitions into the registry.
 */
export function registerFilter(definition: FilterDefinition): void {
  FILTER_REGISTRY[definition.key] = definition;
}

/**
 * Internal helper for testing (to remove temporary registrations).
 */
export function unregisterFilter(key: FilterKey): void {
  delete FILTER_REGISTRY[key];
}

// =========================================================================
// WorkOrder Reachable Filter Definitions (Phase 1.14.3)
// =========================================================================
export const workOrderFilterDefinitions: readonly FilterDefinition[] = [
  {
    key: "customerId",
    valueType: "CUID",
    applicableModels: ["WorkOrder", "Invoice", "Asset", "Quote"],
    buildWhere: (value: unknown) => ({ customerId: String(value) }),
    requiresTenantValidation: true,
  },
  {
    key: "technicianId",
    valueType: "CUID",
    applicableModels: ["WorkOrder", "ScheduleAppointment"],
    buildWhere: (value: unknown) => ({
      // On WorkOrder: assignedTechnicianId, on ScheduleAppointment: technicianId
      assignedTechnicianId: String(value),
      technicianId: String(value),
    }),
    requiresTenantValidation: true,
  },
  {
    key: "workTypeId",
    valueType: "CUID",
    applicableModels: ["WorkOrder"],
    buildWhere: (value: unknown) => ({ workTypeId: String(value) }),
    requiresTenantValidation: true,
  },
  {
    key: "serviceCatalogId",
    valueType: "CUID",
    applicableModels: ["WorkOrder"],
    buildWhere: (value: unknown) => ({ workType: { catalogId: String(value) } }),
    requiresTenantValidation: true,
  },
  {
    key: "workOrderStatus",
    valueType: "ENUM",
    enumValues: [
      "OPEN",
      "ASSIGNED",
      "IN_PROGRESS",
      "ON_HOLD",
      "COMPLETED",
      "CANCELLED",
    ],
    applicableModels: ["WorkOrder"],
    buildWhere: (value: unknown) => ({
      status: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
  {
    key: "workOrderPriority",
    valueType: "ENUM",
    enumValues: ["LOW", "MEDIUM", "HIGH", "URGENT"],
    applicableModels: ["WorkOrder"],
    buildWhere: (value: unknown) => ({
      priority: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
];

// =========================================================================
// Scheduling Reachable Filter Definitions (Phase 1.14.4)
// =========================================================================
export const schedulingFilterDefinitions: readonly FilterDefinition[] = [
  {
    key: "appointmentStatus",
    valueType: "ENUM",
    enumValues: ["SCHEDULED", "RESCHEDULED", "CANCELLED", "COMPLETED"],
    applicableModels: ["ScheduleAppointment"],
    buildWhere: (value: unknown) => ({
      status: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
  {
    key: "dispatchStatus",
    valueType: "ENUM",
    enumValues: ["PENDING_DISPATCH", "DISPATCHED", "ACKNOWLEDGED"],
    applicableModels: ["ScheduleAppointment"],
    buildWhere: (value: unknown) => ({
      dispatchStatus: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
];

// =========================================================================
// Domain Filter Definitions (Phase 1.14.6 – 1.14.7)
// =========================================================================
export const domainFilterDefinitions: readonly FilterDefinition[] = [
  {
    key: "partId",
    valueType: "CUID",
    applicableModels: ["WorkOrderPart", "StockMovement", "InventoryBalance", "Part"],
    buildWhere: (value: unknown) => ({ partId: String(value) }),
    requiresTenantValidation: true,
  },
  {
    key: "inventoryLocationId",
    valueType: "CUID",
    applicableModels: ["WorkOrderPart", "StockMovement", "InventoryBalance"],
    buildWhere: (value: unknown) => ({ locationId: String(value) }),
    requiresTenantValidation: true,
  },
  {
    key: "assetCategoryId",
    valueType: "CUID",
    applicableModels: ["Asset"],
    buildWhere: (value: unknown) => ({ categoryId: String(value) }),
    requiresTenantValidation: true,
  },
  {
    key: "assetStatus",
    valueType: "ENUM",
    enumValues: ["OPERATIONAL", "DEGRADED", "OUT_OF_SERVICE", "IN_STORAGE", "DECOMMISSIONED", "RETIRED"],
    applicableModels: ["Asset"],
    buildWhere: (value: unknown) => ({
      status: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
  {
    key: "quoteStatus",
    valueType: "ENUM",
    enumValues: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"],
    applicableModels: ["Quote"],
    buildWhere: (value: unknown) => ({
      status: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
  {
    key: "invoiceStatus",
    valueType: "ENUM",
    enumValues: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"],
    applicableModels: ["Invoice"],
    buildWhere: (value: unknown) => ({
      status: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
  {
    key: "paymentMethod",
    valueType: "ENUM",
    enumValues: ["CASH", "CHECK", "CREDIT_CARD", "BANK_TRANSFER", "ACH", "OTHER"],
    applicableModels: ["Payment"],
    buildWhere: (value: unknown) => ({
      paymentMethod: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
  {
    key: "timeEntryType",
    valueType: "ENUM",
    enumValues: ["ON_SITE", "TRAVEL", "BREAK", "ADMIN"],
    applicableModels: ["TechnicianTimeEntry"],
    buildWhere: (value: unknown) => ({
      entryType: Array.isArray(value) ? { in: value } : value,
    }),
    requiresTenantValidation: false,
  },
];

for (const def of workOrderFilterDefinitions) {
  registerFilter(def);
}

for (const def of schedulingFilterDefinitions) {
  registerFilter(def);
}

for (const def of domainFilterDefinitions) {
  registerFilter(def);
}
