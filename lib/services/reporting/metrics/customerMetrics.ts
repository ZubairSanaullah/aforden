import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import type { MetricDefinition } from "../reporting.types";
import { registerMetric } from "../metricRegistry";

export const CUSTOMER_DIMENSIONS = [
  "customer",
  "time.day",
  "time.week",
  "time.month",
  "time.quarter",
  "time.year",
] as const;

export const customerMetricDefinitions: readonly MetricDefinition[] = [
  {
    key: "customers.activeCount",
    category: "CUSTOMER",
    valueType: "COUNT",
    temporality: "AS_OF",
    sourceModel: "Customer",
    dateAnchor: null,
    baseWhere: () => ({ status: "ACTIVE" }),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description: "Total count of active customer accounts (Customer.status = ACTIVE) as of now.",
  },
  {
    key: "customers.countByStatus",
    category: "CUSTOMER",
    valueType: "COUNT",
    temporality: "AS_OF",
    sourceModel: "Customer",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description: "Count of customers bucketed by their current account status as of now.",
  },
  {
    key: "customers.newCount",
    category: "CUSTOMER",
    valueType: "COUNT",
    temporality: "PERIOD",
    sourceModel: "Customer",
    dateAnchor: { model: "Customer", field: "createdAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Count of new customer accounts created within the reporting period (anchored on immutable Customer.createdAt).",
  },
  {
    key: "customers.workOrdersPerCustomer",
    category: "CUSTOMER",
    valueType: "AVG_COUNT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "createdAt" },
    baseWhere: () => ({}),
    aggregation: { kind: "CUSTOM", compute: "workOrdersCount / distinctCustomersCount" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Average number of work orders created per active customer in the reporting period.",
  },
  {
    key: "customers.lifetimeInvoicedRevenue",
    category: "CUSTOMER",
    valueType: "SUM_MONEY",
    temporality: "AS_OF",
    sourceModel: "Invoice",
    dateAnchor: null,
    baseWhere: () => ({
      status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE"] },
    }),
    aggregation: { kind: "SUM", field: "total" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_FINANCIAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: true,
    materializationTrigger: null,
    description:
      "Total lifetime invoiced revenue (sum of non-draft, non-void Invoice.total snapshots) for each customer as of now.",
  },
  {
    key: "customers.repeatCustomerRate",
    category: "CUSTOMER",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "WorkOrder",
    dateAnchor: { model: "WorkOrder", field: "completedAt" },
    baseWhere: () => ({ status: "COMPLETED" }),
    aggregation: {
      kind: "CUSTOM",
      compute: "(repeatCustomersCount / totalServicedCustomersCount) * 100",
    },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Percentage of serviced customers who had 2 or more completed work orders in the period (repeatCustomers / totalServicedCustomers * 100). Returns null if 0 serviced customers.",
  },
  {
    key: "customers.churnRate",
    category: "CUSTOMER",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "Customer",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: Customer model lacks subscription duration / churn date event tracking.",
    deferredReason:
      'Metric "customers.churnRate" cannot be computed: Customer model lacks subscription duration / churn date event tracking (Phase 1.6 constraint).',
  },
  {
    key: "customers.retentionRate",
    category: "CUSTOMER",
    valueType: "RATE_PERCENT",
    temporality: "PERIOD",
    sourceModel: "Customer",
    dateAnchor: null,
    baseWhere: () => ({}),
    aggregation: { kind: "COUNT" },
    requiredPermission: PERMISSIONS.REPORTS_VIEW_OPERATIONAL,
    supportedDimensions: CUSTOMER_DIMENSIONS,
    isSnapshotDerived: false,
    materializationTrigger: null,
    description:
      "Deferred to 501: Customer model lacks cohort retention / contract renewal lifecycle tracking.",
    deferredReason:
      'Metric "customers.retentionRate" cannot be computed: Customer model lacks cohort retention / contract renewal lifecycle tracking (Phase 1.6 constraint).',
  },
];

for (const metric of customerMetricDefinitions) {
  registerMetric(metric);
}
