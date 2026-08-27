import { Prisma } from "@/generated/prisma/client";
import type {
  MetricValue,
  MetricValueType,
  ReportResponse,
  ReportRowsReadModel,
  ReportScalarsReadModel,
  ReportSeriesReadModel,
} from "./reporting.types";

/**
 * Escapes a cell value conforming to RFC 4180 CSV specifications:
 * - Null or undefined values are rendered as empty strings (empty cell).
 * - Strings containing commas, double quotes, or newlines are enclosed in quotes.
 * - Double quotes inside values are escaped by doubling them ("").
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a metric value according to its value type:
 * - SUM_MONEY: Formatted to 2 decimal places preserving exact Decimal strings without intermediate float/Number parsing.
 * - Null / undefined: Empty string (empty cell).
 */
export function formatMetricCsvValue(
  val: MetricValue,
  valueType?: MetricValueType,
): string {
  if (val === null || val === undefined) {
    return "";
  }
  if (valueType === "SUM_MONEY") {
    if (val instanceof Prisma.Decimal || Prisma.Decimal.isDecimal(val)) {
      return val.toFixed(2);
    }
    if (typeof val === "string") {
      return new Prisma.Decimal(val).toFixed(2);
    }
  }
  return String(val);
}

/**
 * Serializes a ReportResponse (SCALARS, ROWS, or SERIES) into an RFC 4180 compliant CSV string.
 *
 * Design Decisions:
 * 1. Divide-by-zero (null) values serialize as empty cells ("").
 * 2. Money/currency fields maintain .toFixed(2) precision.
 * 3. CRLF (\r\n) line terminators are used per RFC 4180.
 */
export function serializeReportToCsv(report: ReportResponse): string {
  const meta = report.meta;
  const lines: string[] = [];

  if (meta.shape === "SCALARS") {
    const scalarModel = report as ReportScalarsReadModel;
    lines.push(["Metric", "Value"].map(escapeCsvCell).join(","));

    for (const metric of meta.metrics) {
      const rawVal =
        scalarModel.values[metric.key] ??
        scalarModel.values[metric.key.split(".")[1] ?? ""] ??
        null;
      const formatted = formatMetricCsvValue(rawVal, metric.valueType);
      lines.push(
        [escapeCsvCell(metric.label || metric.key), escapeCsvCell(formatted)].join(","),
      );
    }
  } else if (meta.shape === "ROWS") {
    const rowsModel = report as ReportRowsReadModel;
    const primaryDim = meta.dimensions[0];
    const dimKey = primaryDim?.key ?? "group";
    const dimLabel = primaryDim?.label ?? dimKey;

    const headers = [
      escapeCsvCell(dimLabel),
      ...meta.metrics.map((m) => escapeCsvCell(m.label || m.key)),
    ];
    lines.push(headers.join(","));

    for (const row of rowsModel.items) {
      const dimEntry = row.dimensions[dimKey];
      const dimDisplay = dimEntry?.label ?? dimEntry?.key ?? "";

      const rowValues = meta.metrics.map((m) => {
        const rawVal =
          row.values[m.key] ??
          row.values[m.key.split(".")[1] ?? ""] ??
          null;
        return escapeCsvCell(formatMetricCsvValue(rawVal, m.valueType));
      });

      lines.push([escapeCsvCell(dimDisplay), ...rowValues].join(","));
    }
  } else if (meta.shape === "SERIES") {
    const seriesModel = report as ReportSeriesReadModel;
    const headers = [
      escapeCsvCell("Bucket (UTC)"),
      escapeCsvCell("Bucket (Local)"),
      ...meta.metrics.map((m) => escapeCsvCell(m.label || m.key)),
    ];
    lines.push(headers.join(","));

    for (const bucket of seriesModel.series) {
      const bucketValues = meta.metrics.map((m) => {
        const rawVal =
          bucket.values[m.key] ??
          bucket.values[m.key.split(".")[1] ?? ""] ??
          null;
        return escapeCsvCell(formatMetricCsvValue(rawVal, m.valueType));
      });

      lines.push(
        [
          escapeCsvCell(bucket.bucketStartUtc),
          escapeCsvCell(bucket.bucketLocalLabel),
          ...bucketValues,
        ].join(","),
      );
    }
  }

  return lines.join("\r\n");
}
