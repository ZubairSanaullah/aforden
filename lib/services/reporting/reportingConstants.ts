import type { DateBucketGranularity } from "./reporting.types";

export const MATERIALIZATION_TRIGGERS = {
  /** Any single workspace exceeding this WorkOrder row count. */
  WORK_ORDER_ROWS_PER_WORKSPACE: 250_000,
  /** Any single workspace exceeding this TechnicianTimeEntry row count. */
  TIME_ENTRY_ROWS_PER_WORKSPACE: 500_000,
  /** Any single workspace exceeding this Invoice row count. */
  INVOICE_ROWS_PER_WORKSPACE: 200_000,
  /** Observed p95 latency for any single report endpoint. */
  REPORT_P95_LATENCY_MS: 1_500,
} as const;

export const MAX_BUCKETS_BY_GRANULARITY: Readonly<Record<DateBucketGranularity, number>> = {
  DAY: 92,      // ~1 quarter of daily points
  WEEK: 53,     // ~1 year
  MONTH: 36,    // 3 years
  QUARTER: 20,  // 5 years
  YEAR: 10,
} as const;

/** Absolute span ceiling for any single report request. */
export const MAX_RANGE_DAYS = 1_100; // ~3 years

/** Maximum rows permitted to scan into memory for derived calculations (§8.3). */
export const MAX_SCAN_ROWS = 50_000;

/** Maximum distinct groups returned in a grouped query (§9.4). */
export const MAX_GROUP_CARDINALITY = 1_000;

/** Maximum rows permitted in a single CSV export (§13.1). */
export const MAX_EXPORT_ROWS = 50_000;

export const GRANULARITY_SQL_TOKEN: Readonly<Record<DateBucketGranularity, string>> = {
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  QUARTER: "quarter",
  YEAR: "year",
} as const;

export const SQL_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Tolerance in milliseconds (2 minutes) for client-server clock skew on AS_OF historical aging checks. */
export const HISTORICAL_AGING_TOLERANCE_MS = 120_000;

/** Default forward-looking horizon in days for warranty expiration alerts and reports (§1.14.7). */
export const ASSET_WARRANTY_WINDOW_DAYS = 90;
