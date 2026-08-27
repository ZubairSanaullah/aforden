import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { resolveReportDateRange } from "./dateRange";
import { getReportDefinition } from "./reportRegistry";
import { getDimensionDefinition } from "./dimensionRegistry";
import { getMetricDefinition, findMetricDefinition } from "./metricRegistry";
import { getFilterDefinition } from "./filterRegistry";
import { validateTenantFilters } from "./tenantFilterValidation";
import { resolveEffectiveTechnicianScope, type EffectiveTechnicianScope } from "./technicianScope";
import { hydrateDimensionLabels } from "./labelHydration";
import { z } from "zod";
import {
  ReportScopeViolationError,
  ReportCardinalityExceededError,
  ReportParameterValidationError,
  UnsupportedMetricDimensionCombinationError,
} from "./reportingErrors";
import { MAX_GROUP_CARDINALITY } from "./reportingConstants";
import type {
  DateBucketGranularity,
  DateRangePreset,
  DimensionKey,
  FilterKey,
  MetricKey,
  QueryArgs,
  ReportKey,
  ReportMeta,
  ReportRow,
  ReportRowsReadModel,
  ReportScalarsReadModel,
  ReportResponse,
  ScopedModelDelegate,
  ScopedReportDb,
  UnscopedModelDelegate,
  UnscopedReportDb,
} from "./reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Side-effect imports to register canonical report executors
import "./reports/workOrderVolumeReport";
import "./reports/workOrderThroughputReport";
import "./reports/dispatchPerformanceReport";
import "./reports/technicianProductivityReport";
import "./reports/revenueSummaryReport";
import "./reports/arAgingReport";
import "./reports/partsConsumptionReport";
import "./reports/assetSummaryReport";
import "./reports/customerSummaryReport";
import "./reports/quoteConversionReport";

/**
 * Creates a structurally workspace-scoped database accessor (Phase 1.14.8 Hardening).
 * Pre-binds all model delegates to automatically intersect workspaceId into every query where clause.
 */
export function createScopedDb(
  workspaceId: string,
  baseDb: UnscopedReportDb,
): ScopedReportDb {
  const wrapModel = (modelName: keyof ScopedReportDb): ScopedModelDelegate => {
    const rawModel = (baseDb as Record<string, UnscopedModelDelegate | undefined>)[modelName];
    return {
      findMany: <R = Record<string, unknown>>(args: QueryArgs = {}): Promise<R[]> => {
        const where = { ...(args.where ?? {}), workspaceId };
        return rawModel?.findMany
          ? (rawModel.findMany<R>({ ...args, where }) as Promise<R[]>)
          : Promise.resolve([]);
      },
      findFirst: <R = Record<string, unknown>>(args: QueryArgs = {}): Promise<R | null> => {
        const where = { ...(args.where ?? {}), workspaceId };
        return rawModel?.findFirst
          ? (rawModel.findFirst<R>({ ...args, where }) as Promise<R | null>)
          : Promise.resolve(null);
      },
      count: (args: QueryArgs = {}) => {
        const where = { ...(args.where ?? {}), workspaceId };
        return rawModel?.count
          ? rawModel.count({ ...args, where })
          : Promise.resolve(0);
      },
      groupBy: (args: QueryArgs = {}) => {
        const where = { ...(args.where ?? {}), workspaceId };
        return rawModel?.groupBy
          ? rawModel.groupBy({ ...args, where })
          : Promise.resolve([]);
      },
    };
  };

  return {
    workOrder: wrapModel("workOrder"),
    scheduleAppointment: wrapModel("scheduleAppointment"),
    scheduleAppointmentHistory: wrapModel("scheduleAppointmentHistory"),
    technicianProfile: wrapModel("technicianProfile"),
    technicianTimeEntry: wrapModel("technicianTimeEntry"),
    workOrderHistory: wrapModel("workOrderHistory"),
    quote: wrapModel("quote"),
    invoice: wrapModel("invoice"),
    payment: wrapModel("payment"),
    workOrderPart: wrapModel("workOrderPart"),
    part: wrapModel("part"),
    inventoryLocation: wrapModel("inventoryLocation"),
    inventoryBalance: wrapModel("inventoryBalance"),
    stockMovement: wrapModel("stockMovement"),
    asset: wrapModel("asset"),
    assetCategory: wrapModel("assetCategory"),
    customer: wrapModel("customer"),
    workType: wrapModel("workType"),
    serviceCatalog: wrapModel("serviceCatalog"),
    employee: wrapModel("employee"),
  };
}

/**
 * Generic Report Composition Engine (Phase 1.14.8).
 * Executes the canonical 10-stage reporting pipeline across all report types.
 */
export async function composeReport(
  reportKey: ReportKey,
  workspaceId: string,
  rawParams?: unknown,
  actor?: WorkspaceAuthorizationContext,
  db: UnscopedReportDb = prisma,
): Promise<ReportResponse> {
  const definition = getReportDefinition(reportKey);

  // Stage 1: Scope Resolution & RBAC Authorization
  const auth = actor ?? (await requireWorkspaceAuthorization(workspaceId));
  assertPermission(auth.membership.role, definition.requiredPermission);

  // Stage 2: Parameter Validation & Normalization
  let params: Record<string, unknown>;
  try {
    params = definition.paramsSchema.parse(rawParams ?? {}) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ReportParameterValidationError(err.issues.map((i) => i.message).join("; "));
    }
    throw err;
  }

  // Stage 3: Canonical Date Range Resolution
  const range = resolveReportDateRange({
    workspaceTimezone: auth.workspace.timezone,
    preset: params.preset as DateRangePreset | undefined,
    fromLocalDate: params.from as string | undefined,
    toLocalDate: params.to as string | undefined,
    granularity: params.granularity as DateBucketGranularity | undefined,
  });

  // Stage 4: Tenant Filter Validation & Compilation
  const scopedDb = createScopedDb(workspaceId, db);

  const rawFilters: Record<string, unknown> = {};
  for (const filterKey of definition.allowedFilters) {
    if (params[filterKey] !== undefined) {
      getFilterDefinition(filterKey as FilterKey);
      rawFilters[filterKey] = params[filterKey];
    }
  }
  if (Object.keys(rawFilters).length > 0) {
    await validateTenantFilters(workspaceId, rawFilters, scopedDb);
  }

  // Stage 5: Metrics & Dimensions Validation
  const defaultMetricKeys = definition.metrics.filter(
    (k) => !findMetricDefinition(k)?.deferredReason,
  );
  const requestedMetricKeys: MetricKey[] = params.metrics
    ? (Array.isArray(params.metrics) ? params.metrics : [params.metrics])
    : defaultMetricKeys;

  for (const k of requestedMetricKeys) {
    const d = getMetricDefinition(k);
    if (!definition.metrics.includes(k)) {
      throw new UnsupportedMetricDimensionCombinationError(
        `Metric "${k}" is not supported by report "${definition.reportKey}".`,
      );
    }
    if (
      d.temporality === "AS_OF" &&
      params.dimensions &&
      Array.isArray(params.dimensions) &&
      params.dimensions.some((dim: string) => dim.startsWith("time."))
    ) {
      throw new UnsupportedMetricDimensionCombinationError(
        `AS_OF metric "${k}" cannot be evaluated over time-series period dimension in "${definition.reportKey}".`,
      );
    }
  }

  const requestedDimensions: DimensionKey[] = params.dimensions
    ? (Array.isArray(params.dimensions) ? params.dimensions : [params.dimensions])
    : (definition.reportKey === "technician.productivity" ? ["technician"] : []);

  for (const dimKey of requestedDimensions) {
    getDimensionDefinition(dimKey);
    if (!definition.allowedDimensions.includes(dimKey)) {
      throw new UnsupportedMetricDimensionCombinationError(
        `Dimension "${dimKey}" is not supported by report "${definition.reportKey}".`,
      );
    }
  }

  const isScalars = requestedDimensions.length === 0;

  // Build base where clause
  const baseWhere: Record<string, unknown> = {
    workspaceId,
  };

  // Self-scoping resolution if applicable
  let effectiveScope: EffectiveTechnicianScope | null = null;
  if (
    definition.selfScopedRoles.includes(auth.membership.role) ||
    (definition.allowedFilters.includes("technicianId") && params.technicianId)
  ) {
    effectiveScope = await resolveEffectiveTechnicianScope(
      workspaceId,
      auth,
      params.technicianId as string | readonly string[] | null | undefined,
      scopedDb,
    );
    if (effectiveScope && !effectiveScope.isAll) {
      baseWhere.assignedTechnicianId = { in: [...effectiveScope.technicianIds] };
    }
  }

  // Compile other filters into baseWhere
  for (const [k, v] of Object.entries(rawFilters)) {
    if (k === "customerId") baseWhere.customerId = String(v);
    else if (k === "technicianId") baseWhere.assignedTechnicianId = String(v);
    else if (k === "workTypeId") baseWhere.workTypeId = String(v);
    else if (k === "serviceCatalogId") baseWhere.workType = { catalogId: String(v) };
    else if (k === "partId") baseWhere.partId = String(v);
    else if (k === "inventoryLocationId") baseWhere.locationId = String(v);
    else if (k === "assetCategoryId") baseWhere.categoryId = String(v);
    else if (
      k === "workOrderStatus" ||
      k === "appointmentStatus" ||
      k === "dispatchStatus" ||
      k === "assetStatus" ||
      k === "quoteStatus" ||
      k === "invoiceStatus"
    ) {
      baseWhere.status = Array.isArray(v) ? { in: v } : v;
    }
  }

  // Build metadata
  const meta: ReportMeta = {
    reportKey: definition.reportKey,
    title: definition.title,
    generatedAt: new Date().toISOString(),
    timezone: range.timezone,
    shape: isScalars ? "SCALARS" : "ROWS",
    scope: "WORKSPACE",
    range: {
      startUtc: range.startUtc.toISOString(),
      endUtc: range.endUtc.toISOString(),
      startLocalDate: range.startLocalDate,
      endLocalDate: range.endLocalDate,
      preset: range.preset,
      granularity: range.granularity,
    },
    asOfUtc: params.asOf ? new Date(String(params.asOf)).toISOString() : null,
    metrics: requestedMetricKeys.map((k) => {
      const d = getMetricDefinition(k);
      return {
        key: d.key,
        label: d.key,
        valueType: d.valueType,
        temporality: d.temporality,
      };
    }),
    dimensions: requestedDimensions.map((d) => {
      const dim = getDimensionDefinition(d);
      return { key: dim.key, label: dim.key };
    }),
    appliedFilters: Object.entries(rawFilters).map(([k, v]) => ({
      key: k as FilterKey,
      value: v as string | string[],
    })),
    sort: {
      key: (params.sortBy ?? definition.defaultSort.key) as string,
      order: (params.sortOrder ?? definition.defaultSort.order) as "asc" | "desc",
    },
    sortedInMemory: true,
    truncated: false,
  };

  // Stage 6: Custom Executor (Typed Escape Hatch)
  if (definition.customExecutor) {
    const executed = await definition.customExecutor({
      workspaceId,
      auth,
      range,
      rawFilters,
      baseWhere,
      requestedMetrics: requestedMetricKeys,
      requestedDimensions,
      params,
      scopedDb,
    });

    if (executed.scalarValues) {
      meta.shape = "SCALARS";
      return {
        meta,
        values: executed.scalarValues,
      };
    }

    if (executed.rows) {
      meta.shape = "ROWS";
      const primaryDimensionKey = requestedDimensions[0] ?? "customer";
      const allGroupKeys = executed.rows.map((r) => r.groupKey);

      // Stage 8: Label Hydration
      const labelMap = await hydrateDimensionLabels(
        primaryDimensionKey,
        allGroupKeys,
        workspaceId,
        scopedDb,
      );

      const allRows: ReportRow[] = executed.rows.map((r) => {
        const label =
          labelMap.get(r.groupKey) ?? (r.groupKey === "UNASSIGNED" ? "Unassigned" : r.groupKey);
        return {
          dimensions: {
            [primaryDimensionKey]: {
              key: r.groupKey,
              label,
            },
          },
          values: r.values,
        };
      });

      // Stage 9: Deterministic Sorting & Cardinality Cap
      const sortKey = (params.sortBy ?? definition.defaultSort.key) as string;
      const sortOrder = (params.sortOrder ?? definition.defaultSort.order) as "asc" | "desc";

      allRows.sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;

        if (sortKey in a.values) {
          const rawA = a.values[sortKey] ?? 0;
          const rawB = b.values[sortKey] ?? 0;
          const numA = typeof rawA === "number" ? rawA : parseFloat(String(rawA));
          const numB = typeof rawB === "number" ? rawB : parseFloat(String(rawB));
          if (!isNaN(numA) && !isNaN(numB)) {
            valA = numA;
            valB = numB;
          } else {
            valA = String(rawA);
            valB = String(rawB);
          }
        } else if (sortKey === primaryDimensionKey) {
          valA = a.dimensions[primaryDimensionKey]?.label ?? "";
          valB = b.dimensions[primaryDimensionKey]?.label ?? "";
        } else {
          valA = a.dimensions[primaryDimensionKey]?.key ?? "";
          valB = b.dimensions[primaryDimensionKey]?.key ?? "";
        }

        if (valA < valB) return sortOrder === "asc" ? -1 : 1;
        if (valA > valB) return sortOrder === "asc" ? 1 : -1;
        return a.dimensions[primaryDimensionKey].key.localeCompare(
          b.dimensions[primaryDimensionKey].key,
        );
      });

      const totalUncappedCount = allRows.length;
      const isTruncated = totalUncappedCount > MAX_GROUP_CARDINALITY;

      meta.truncated = isTruncated;
      meta.totalUncappedCount = totalUncappedCount;

      let finalRows: ReportRow[];
      let page: number;
      let limit: number;
      let totalPages: number;

      if (params.page !== undefined || params.limit !== undefined) {
        page = typeof params.page === "number" ? params.page : Number(params.page ?? 1);
        limit = typeof params.limit === "number" ? params.limit : Number(params.limit ?? 20);
        totalPages = Math.ceil(totalUncappedCount / limit) || 1;
        const startIndex = (page - 1) * limit;
        finalRows = allRows.slice(startIndex, startIndex + limit);
      } else {
        page = 1;
        limit = isTruncated ? MAX_GROUP_CARDINALITY : totalUncappedCount;
        totalPages = 1;
        finalRows = isTruncated ? allRows.slice(0, MAX_GROUP_CARDINALITY) : allRows;
      }

      meta.pagination = {
        page,
        limit,
        totalPages,
        totalRows: totalUncappedCount,
      };

      return {
        meta,
        items: finalRows,
        total: totalUncappedCount,
        page,
        limit,
        totalPages,
      };
    }
  }

  throw new Error(`Report "${reportKey}" does not have an execution strategy registered.`);
}
