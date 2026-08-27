import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { REPORT_KEYS } from "./reporting.schemas";
import { ReportNotFoundError, ReportParameterValidationError } from "./reportingErrors";
import { reportQueryParamsSchema } from "./reporting.schemas";
import type { ReportDefinition, ReportKey, ReportCustomExecutor } from "./reporting.types";

/**
 * Report Registry (Closed compile-time allowlist).
 * Populated incrementally across Phase 1.14.3 – 1.14.7.
 */
export const REPORT_REGISTRY: Partial<Record<ReportKey, ReportDefinition>> = {};

/**
 * Retrieves a registered report definition by key.
 * Throws ReportNotFoundError if the key is not registered.
 */
export function getReportDefinition(key: ReportKey): ReportDefinition {
  const definition = REPORT_REGISTRY[key];
  if (!definition) {
    throw new ReportNotFoundError(`Report definition not found for key: "${key}".`);
  }
  return definition;
}

/**
 * Internal helper to register report definitions into the registry.
 * Strictly enforces compile-time closed allowlist membership.
 */
export function registerReport(definition: ReportDefinition): void {
  if (!REPORT_KEYS.includes(definition.reportKey)) {
    throw new ReportParameterValidationError(
      `Cannot register report "${definition.reportKey}": key is not part of the closed REPORT_KEYS allowlist (Phase 1.14.2 constraint).`,
    );
  }
  REPORT_REGISTRY[definition.reportKey] = definition;
}

/**
 * Internal helper to register/bind a report custom query executor.
 */
export function registerReportExecutor(
  key: ReportKey,
  executor: ReportCustomExecutor,
): void {
  const definition = REPORT_REGISTRY[key];
  if (definition) {
    definition.customExecutor = executor;
  }
}

/**
 * Internal helper for testing (to remove temporary registrations).
 */
export function unregisterReport(key: ReportKey): void {
  delete REPORT_REGISTRY[key];
}

// =========================================================================
// Operational WorkOrder Report Definitions (Phase 1.14.3)
// =========================================================================
export const operationalReportDefinitions: readonly ReportDefinition[] = [
  {
    reportKey: "operational.workOrderVolume",
    category: "OPERATIONAL",
    title: "Work Order Volume & Throughput",
    metrics: [
      "workOrders.createdCount",
      "workOrders.completedCount",
      "workOrders.cancelledCount",
      "workOrders.completionRate",
    ],
    allowedDimensions: [
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
    ],
    allowedFilters: [
      "customerId",
      "technicianId",
      "workTypeId",
      "serviceCatalogId",
      "workOrderStatus",
      "workOrderPriority",
    ],
    allowedSortKeys: [
      "workOrders.createdCount",
      "workOrders.completedCount",
      "workOrders.cancelledCount",
      "workOrders.completionRate",
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
    ],
    defaultSort: { key: "workOrders.createdCount", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Volume and completion rate metrics for work orders across dimensions and time periods.",
  },
  {
    reportKey: "operational.workOrderThroughput",
    category: "OPERATIONAL",
    title: "Work Order Throughput & Cycle Time",
    metrics: [
      "workOrders.completedCount",
      "workOrders.avgCycleTimeMinutes",
    ],
    allowedDimensions: [
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
    allowedFilters: [
      "customerId",
      "technicianId",
      "workTypeId",
      "serviceCatalogId",
      "workOrderPriority",
    ],
    allowedSortKeys: [
      "workOrders.completedCount",
      "workOrders.avgCycleTimeMinutes",
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
    defaultSort: { key: "workOrders.completedCount", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Completion volume and average cycle time duration for completed work orders.",
  },
];

// =========================================================================
// Scheduling Report Definitions (Phase 1.14.4)
// =========================================================================
export const schedulingReportDefinitions: readonly ReportDefinition[] = [
  {
    reportKey: "scheduling.dispatchPerformance",
    category: "OPERATIONAL",
    title: "Scheduling & Dispatch Performance",
    metrics: [
      "schedule.appointmentsScheduledCount",
      "schedule.appointmentsCompletedCount",
      "schedule.appointmentsCancelledCount",
      "schedule.dispatchedCount",
      "schedule.avgDispatchLatencyMinutes",
    ],
    allowedDimensions: [
      "technician",
      "appointmentStatus",
      "dispatchStatus",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: [
      "technicianId",
      "appointmentStatus",
      "dispatchStatus",
    ],
    allowedSortKeys: [
      "schedule.appointmentsScheduledCount",
      "schedule.appointmentsCompletedCount",
      "schedule.appointmentsCancelledCount",
      "schedule.dispatchedCount",
      "schedule.avgDispatchLatencyMinutes",
      "technician",
      "appointmentStatus",
      "dispatchStatus",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "schedule.appointmentsScheduledCount", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Dispatch latency, scheduled, completed, and cancelled appointment volume across technicians and dispatch statuses.",
  },
];

// =========================================================================
// Technician Report Definitions (Phase 1.14.5)
// =========================================================================
export const technicianReportDefinitions: readonly ReportDefinition[] = [
  {
    reportKey: "technician.productivity",
    category: "TECHNICIAN",
    title: "Technician Productivity & Work Performance",
    metrics: [
      "technicians.completedWorkOrderCount",
      "technicians.cancelledWorkOrderCount",
      "technicians.avgJobDurationMinutes",
      "technicians.onTimeArrivalRate",
      "technicians.reassignmentAwayCount",
      "technicians.onSiteMinutes",
      "technicians.travelMinutes",
      "technicians.trackedMinutes",
      "technicians.onSiteShareOfTrackedTime",
    ],
    allowedDimensions: [
      "technician",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: ["technicianId", "timeEntryType"],
    allowedSortKeys: [
      "technicians.completedWorkOrderCount",
      "technicians.cancelledWorkOrderCount",
      "technicians.avgJobDurationMinutes",
      "technicians.onTimeArrivalRate",
      "technicians.reassignmentAwayCount",
      "technicians.onSiteMinutes",
      "technicians.travelMinutes",
      "technicians.trackedMinutes",
      "technicians.onSiteShareOfTrackedTime",
      "technician",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "technicians.completedWorkOrderCount", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Per-technician completed/cancelled jobs, on-site/travel duration, on-time arrival rate, and reassignment volume for managers and dispatchers.",
  },
  {
    reportKey: "technician.selfScorecard",
    category: "TECHNICIAN",
    title: "Technician Self-Scorecard",
    metrics: [
      "technicians.completedWorkOrderCount",
      "technicians.cancelledWorkOrderCount",
      "technicians.avgJobDurationMinutes",
      "technicians.onTimeArrivalRate",
      "technicians.reassignmentAwayCount",
      "technicians.onSiteMinutes",
      "technicians.travelMinutes",
      "technicians.trackedMinutes",
      "technicians.onSiteShareOfTrackedTime",
    ],
    allowedDimensions: [
      "technician",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: ["technicianId", "timeEntryType"],
    allowedSortKeys: [
      "technicians.completedWorkOrderCount",
      "technicians.cancelledWorkOrderCount",
      "technicians.avgJobDurationMinutes",
      "technicians.onTimeArrivalRate",
      "technicians.reassignmentAwayCount",
      "technicians.onSiteMinutes",
      "technicians.travelMinutes",
      "technicians.trackedMinutes",
      "technicians.onSiteShareOfTrackedTime",
      "technician",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "technicians.completedWorkOrderCount", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_TECHNICIAN,
    selfScopedRoles: ["TECHNICIAN"],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Self-service scorecard for individual technicians to view their personal performance metrics.",
  },
];

// =========================================================================
// Financial Report Definitions (Phase 1.14.6)
// =========================================================================
export const financialReportDefinitions: readonly ReportDefinition[] = [
  {
    reportKey: "financial.revenueSummary",
    category: "FINANCIAL",
    title: "Revenue Summary Report",
    metrics: [
      "invoices.invoicedRevenue",
      "invoices.issuedCount",
      "payments.collectedRevenue",
      "payments.collectedCount",
      "invoices.voidedTotal",
      "invoices.voidedCount",
      "invoices.outstandingBalance",
      "invoices.overdueBalance",
      "invoices.avgDaysToPayment",
    ],
    allowedDimensions: [
      "customer",
      "paymentMethod",
      "invoiceStatus",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: ["customerId", "paymentMethod", "invoiceStatus"],
    allowedSortKeys: [
      "invoices.invoicedRevenue",
      "invoices.issuedCount",
      "payments.collectedRevenue",
      "payments.collectedCount",
      "invoices.voidedTotal",
      "invoices.voidedCount",
      "invoices.outstandingBalance",
      "invoices.overdueBalance",
      "invoices.avgDaysToPayment",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "invoices.invoicedRevenue", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Comprehensive revenue summary comparing invoiced amounts, collected payments, voided totals, and open/overdue balances.",
  },
  {
    reportKey: "financial.arAging",
    category: "FINANCIAL",
    title: "Accounts Receivable (AR) Aging",
    metrics: ["invoices.outstandingBalance"],
    allowedDimensions: ["customer"],
    allowedFilters: ["customerId", "invoiceStatus"],
    allowedSortKeys: ["invoices.outstandingBalance", "customer"],
    defaultSort: { key: "invoices.outstandingBalance", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    selfScopedRoles: [],
    supportsTimeSeries: false,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Accounts receivable aging analysis bucketed into Current, 1-30, 31-60, 61-90, and 90+ days past due as of now.",
  },
  {
    reportKey: "financial.quoteConversion",
    category: "FINANCIAL",
    title: "Quote Conversion & Pipeline Summary",
    metrics: [
      "quotes.createdCount",
      "quotes.approvedCount",
      "quotes.rejectedCount",
      "quotes.approvedTotal",
      "quotes.pipelineTotal",
      "quotes.winRate",
    ],
    allowedDimensions: [
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: ["customerId", "quoteStatus"],
    allowedSortKeys: [
      "quotes.createdCount",
      "quotes.approvedCount",
      "quotes.rejectedCount",
      "quotes.approvedTotal",
      "quotes.pipelineTotal",
      "quotes.winRate",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "quotes.pipelineTotal", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Quote conversion volumes, pending pipeline monetary totals, and win rates across customers and time periods.",
  },
];

// =========================================================================
// Inventory, Asset & Customer Report Definitions (Phase 1.14.7)
// =========================================================================
export const domainReportDefinitions: readonly ReportDefinition[] = [
  {
    reportKey: "inventory.partsConsumption",
    category: "INVENTORY",
    title: "Inventory & Parts Consumption Report",
    metrics: [
      "inventory.quantityOnHand",
      "inventory.belowMinimumStockPartCount",
      "inventory.partsConsumedQuantity",
      "inventory.partsConsumedCost",
      "inventory.stockMovementCount",
    ],
    allowedDimensions: [
      "part",
      "inventoryLocation",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: ["partId", "inventoryLocationId"],
    allowedSortKeys: [
      "inventory.quantityOnHand",
      "inventory.belowMinimumStockPartCount",
      "inventory.partsConsumedQuantity",
      "inventory.partsConsumedCost",
      "inventory.stockMovementCount",
      "part",
      "inventoryLocation",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "inventory.partsConsumedQuantity", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Physical inventory on hand (with historical movement replay), minimum stock alerts, and parts consumption volumes/costs.",
  },
  {
    reportKey: "asset.summary",
    category: "ASSET",
    title: "Asset Fleet & Activity Summary",
    metrics: [
      "assets.count",
      "assets.warrantyExpiringCount",
      "assets.serviceEventCount",
      "assets.avgServicesPerAsset",
    ],
    allowedDimensions: [
      "assetCategory",
      "assetStatus",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: ["customerId", "assetCategoryId", "assetStatus"],
    allowedSortKeys: [
      "assets.count",
      "assets.warrantyExpiringCount",
      "assets.serviceEventCount",
      "assets.avgServicesPerAsset",
      "assetCategory",
      "assetStatus",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "assets.count", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Asset fleet counts, warranty expiration windows (90 days), and completed maintenance service events.",
  },
  {
    reportKey: "customer.activitySummary",
    category: "CUSTOMER",
    title: "Customer Activity & Lifetime Value Report",
    metrics: [
      "customers.activeCount",
      "customers.newCount",
      "customers.workOrdersPerCustomer",
      "customers.lifetimeInvoicedRevenue",
      "customers.repeatCustomerRate",
    ],
    allowedDimensions: [
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    allowedFilters: ["customerId"],
    allowedSortKeys: [
      "customers.activeCount",
      "customers.newCount",
      "customers.workOrdersPerCustomer",
      "customers.lifetimeInvoicedRevenue",
      "customers.repeatCustomerRate",
      "customer",
      "time.day",
      "time.week",
      "time.month",
      "time.quarter",
      "time.year",
    ],
    defaultSort: { key: "customers.lifetimeInvoicedRevenue", order: "desc" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    selfScopedRoles: [],
    supportsTimeSeries: true,
    supportsCsvExport: true,
    paramsSchema: reportQueryParamsSchema,
    description:
      "Customer account activity, new acquisitions, repeat customer rates (>= 2 work orders), and lifetime invoiced revenue (minimum PII).",
  },
];

for (const def of operationalReportDefinitions) {
  registerReport(def);
}

for (const def of schedulingReportDefinitions) {
  registerReport(def);
}

for (const def of technicianReportDefinitions) {
  registerReport(def);
}

for (const def of financialReportDefinitions) {
  registerReport(def);
}

for (const def of domainReportDefinitions) {
  registerReport(def);
}

