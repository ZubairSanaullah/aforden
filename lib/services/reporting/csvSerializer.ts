import { Prisma } from "@/generated/prisma/client";
import { MAX_EXPORT_ROWS } from "./reportingConstants";
import { ReportCardinalityExceededError } from "./reportingErrors";
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
 * Generates RFC 4180 compliant CSV chunks iteratively from a ReportResponse.
 *
 * SEC-04 Hardening:
 * 1. Streams CSV line-by-line or chunk-by-chunk using a Generator rather than
 *    allocating the entire output as a single contiguous string in memory.
 * 2. Enforces MAX_EXPORT_ROWS (50,000) ceiling to prevent memory/CPU exhaustion.
 * 3. Uses standard CRLF (\r\n) line terminators per RFC 4180.
 */
export function* generateReportCsvChunks(
  report: ReportResponse,
  chunkSize: number = 100,
): Generator<string, void, unknown> {
  const meta = report.meta;

  if (meta.shape === "SCALARS") {
    const scalarModel = report as ReportScalarsReadModel;
    yield ["Metric", "Value"].map(escapeCsvCell).join(",") + "\r\n";

    const lines: string[] = [];
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
    if (lines.length > 0) {
      yield lines.join("\r\n");
    }
  } else if (meta.shape === "ROWS") {
    const rowsModel = report as ReportRowsReadModel;

    // SEC-04 Guard: Enforce export ceiling to prevent DoS via unbounded result sets
    if (rowsModel.items.length > MAX_EXPORT_ROWS) {
      throw new ReportCardinalityExceededError(
        `Report export row count (${rowsModel.items.length}) exceeds maximum allowable export ceiling of ${MAX_EXPORT_ROWS} rows.`,
      );
    }

    const primaryDim = meta.dimensions[0];
    const dimKey = primaryDim?.key ?? "group";
    const dimLabel = primaryDim?.label ?? dimKey;

    const headers = [
      escapeCsvCell(dimLabel),
      ...meta.metrics.map((m) => escapeCsvCell(m.label || m.key)),
    ];
    yield headers.join(",") + "\r\n";

    let buffer: string[] = [];
    for (let i = 0; i < rowsModel.items.length; i++) {
      const row = rowsModel.items[i];
      const dimEntry = row.dimensions[dimKey];
      const dimDisplay = dimEntry?.label ?? dimEntry?.key ?? "";

      const rowValues = meta.metrics.map((m) => {
        const rawVal =
          row.values[m.key] ??
          row.values[m.key.split(".")[1] ?? ""] ??
          null;
        return escapeCsvCell(formatMetricCsvValue(rawVal, m.valueType));
      });

      buffer.push([escapeCsvCell(dimDisplay), ...rowValues].join(","));

      if (buffer.length >= chunkSize || i === rowsModel.items.length - 1) {
        const isLast = i === rowsModel.items.length - 1;
        yield buffer.join("\r\n") + (isLast ? "" : "\r\n");
        buffer = [];
      }
    }
  } else if (meta.shape === "SERIES") {
    const seriesModel = report as ReportSeriesReadModel;

    if (seriesModel.series.length > MAX_EXPORT_ROWS) {
      throw new ReportCardinalityExceededError(
        `Report export series count (${seriesModel.series.length}) exceeds maximum allowable export ceiling of ${MAX_EXPORT_ROWS} rows.`,
      );
    }

    const headers = [
      escapeCsvCell("Bucket (UTC)"),
      escapeCsvCell("Bucket (Local)"),
      ...meta.metrics.map((m) => escapeCsvCell(m.label || m.key)),
    ];
    yield headers.join(",") + "\r\n";

    let buffer: string[] = [];
    for (let i = 0; i < seriesModel.series.length; i++) {
      const bucket = seriesModel.series[i];
      const bucketValues = meta.metrics.map((m) => {
        const rawVal =
          bucket.values[m.key] ??
          bucket.values[m.key.split(".")[1] ?? ""] ??
          null;
        return escapeCsvCell(formatMetricCsvValue(rawVal, m.valueType));
      });

      buffer.push(
        [
          escapeCsvCell(bucket.bucketStartUtc),
          escapeCsvCell(bucket.bucketLocalLabel),
          ...bucketValues,
        ].join(","),
      );

      if (buffer.length >= chunkSize || i === seriesModel.series.length - 1) {
        const isLast = i === seriesModel.series.length - 1;
        yield buffer.join("\r\n") + (isLast ? "" : "\r\n");
        buffer = [];
      }
    }
  }
}

/**
 * Creates a standard Web ReadableStream<Uint8Array> that yields encoded CSV chunks.
 * Enables zero-buffer chunked HTTP streaming responses for large report exports.
 */
export function createReportCsvStream(
  report: ReportResponse,
  chunkSize: number = 100,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const generator = generateReportCsvChunks(report, chunkSize);

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const { value, done } = generator.next();
        if (done) {
          controller.close();
        } else if (value) {
          controller.enqueue(encoder.encode(value));
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Serializes a ReportResponse into an RFC 4180 compliant CSV string.
 * Retained for backwards compatibility in existing scalar unit tests.
 */
export function serializeReportToCsv(report: ReportResponse): string {
  let result = "";
  for (const chunk of generateReportCsvChunks(report, 500)) {
    result += chunk;
  }
  return result;
}
