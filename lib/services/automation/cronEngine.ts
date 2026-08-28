/**
 * Phase 1.16.7 — Cron Expression Engine
 *
 * Standalone, deterministic, zero-dependency 5-field UTC cron parser and
 * next-run-time calculator.
 *
 * Syntax: `minute hour dayOfMonth month dayOfWeek`
 * - minute: 0–59
 * - hour: 0–23
 * - dayOfMonth: 1–31
 * - month: 1–12
 * - dayOfWeek: 0–7 (0 & 7 = Sunday, 1 = Monday, ..., 6 = Saturday)
 *
 * Supported operators per field:
 * - Asterisk wildcard: `*`
 * - Step values: `*\/5`, `10-30/5`
 * - Ranges: `1-5`, `9-17`
 * - Lists: `1,15,30`, `1,3,5`
 */

import { AutomationInvalidCronExpressionError } from "./automationErrors";

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  isDayOfMonthWildcard: boolean;
  isDayOfWeekWildcard: boolean;
  raw: string;
}

const FIELD_BOUNDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dayOfWeek", min: 0, max: 7 },
];


/**
 * Parses a single cron field token into a set of matching integers.
 */
function parseCronField(
  token: string,
  min: number,
  max: number,
  fieldName: string,
  rawCron: string,
): Set<number> {
  const result = new Set<number>();
  const subTokens = token.split(",");

  for (const sub of subTokens) {
    if (!sub || sub.trim() === "") {
      throw new AutomationInvalidCronExpressionError(
        rawCron,
        `Empty sub-token in ${fieldName} field`,
      );
    }

    const stepParts = sub.split("/");
    if (stepParts.length > 2) {
      throw new AutomationInvalidCronExpressionError(
        rawCron,
        `Invalid step syntax '${sub}' in ${fieldName} field`,
      );
    }

    const rangePart = stepParts[0];
    const step = stepParts.length === 2 ? parseInt(stepParts[1], 10) : 1;

    if (isNaN(step) || step <= 0) {
      throw new AutomationInvalidCronExpressionError(
        rawCron,
        `Invalid step value '${stepParts[1]}' in ${fieldName} field`,
      );
    }

    let rangeStart = min;
    let rangeEnd = max;

    if (rangePart === "*") {
      rangeStart = min;
      rangeEnd = max;
    } else if (rangePart.includes("-")) {
      const bounds = rangePart.split("-");
      if (bounds.length !== 2) {
        throw new AutomationInvalidCronExpressionError(
          rawCron,
          `Invalid range syntax '${rangePart}' in ${fieldName} field`,
        );
      }
      rangeStart = parseInt(bounds[0], 10);
      rangeEnd = parseInt(bounds[1], 10);
    } else {
      const val = parseInt(rangePart, 10);
      if (isNaN(val)) {
        throw new AutomationInvalidCronExpressionError(
          rawCron,
          `Invalid value '${rangePart}' in ${fieldName} field`,
        );
      }
      if (stepParts.length === 1) {
        rangeStart = val;
        rangeEnd = val;
      } else {
        rangeStart = val;
        rangeEnd = max;
      }
    }

    if (isNaN(rangeStart) || isNaN(rangeEnd)) {
      throw new AutomationInvalidCronExpressionError(
        rawCron,
        `Non-numeric value in ${fieldName} field: '${rangePart}'`,
      );
    }

    if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
      throw new AutomationInvalidCronExpressionError(
        rawCron,
        `Range ${rangeStart}-${rangeEnd} out of bounds [${min}-${max}] in ${fieldName} field`,
      );
    }

    for (let i = rangeStart; i <= rangeEnd; i += step) {
      if (fieldName === "dayOfWeek" && i === 7) {
        result.add(0); // Normalize Sunday 7 -> 0
      } else {
        result.add(i);
      }
    }
  }

  if (result.size === 0) {
    throw new AutomationInvalidCronExpressionError(
      rawCron,
      `No valid values resolved for ${fieldName} field`,
    );
  }

  return result;
}

/**
 * Validates and parses a 5-field cron expression.
 */
export function parseCronExpression(cron: string): ParsedCron {
  if (!cron || typeof cron !== "string") {
    throw new AutomationInvalidCronExpressionError(
      String(cron),
      "Cron expression must be a non-empty string",
    );
  }

  const trimmed = cron.trim();
  const fields = trimmed.split(/\s+/);

  if (fields.length !== 5) {
    throw new AutomationInvalidCronExpressionError(
      trimmed,
      `Expected exactly 5 fields (minute hour dayOfMonth month dayOfWeek), found ${fields.length}`,
    );
  }

  const minutes = parseCronField(fields[0], FIELD_BOUNDS[0].min, FIELD_BOUNDS[0].max, FIELD_BOUNDS[0].name, trimmed);
  const hours = parseCronField(fields[1], FIELD_BOUNDS[1].min, FIELD_BOUNDS[1].max, FIELD_BOUNDS[1].name, trimmed);
  const daysOfMonth = parseCronField(fields[2], FIELD_BOUNDS[2].min, FIELD_BOUNDS[2].max, FIELD_BOUNDS[2].name, trimmed);
  const months = parseCronField(fields[3], FIELD_BOUNDS[3].min, FIELD_BOUNDS[3].max, FIELD_BOUNDS[3].name, trimmed);
  const daysOfWeek = parseCronField(fields[4], FIELD_BOUNDS[4].min, FIELD_BOUNDS[4].max, FIELD_BOUNDS[4].name, trimmed);

  const isDayOfMonthWildcard = fields[2] === "*";
  const isDayOfWeekWildcard = fields[4] === "*";

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    isDayOfMonthWildcard,
    isDayOfWeekWildcard,
    raw: trimmed,
  };
}

/**
 * Validates a cron expression string.
 */
export function validateCronExpression(cron: string): { valid: boolean; error?: string } {
  try {
    parseCronExpression(cron);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

/**
 * Calculates the next UTC Date on or after `fromDate` that matches the cron expression.
 * Result is strictly greater than `fromDate`.
 *
 * Standard cron day semantics:
 * - If BOTH day-of-month and day-of-week are restricted (neither is "*"), match if EITHER matches (OR logic).
 * - If only one is restricted, match that restricted field.
 * - If neither is restricted, match all days.
 *
 * @param cron - 5-field cron expression
 * @param fromDate - Reference start time (defaults to now)
 */
export function computeNextCronRun(cron: string, fromDate: Date = new Date()): Date {
  const parsed = parseCronExpression(cron);

  // Start checking from the next full minute (truncate seconds/ms)
  const next = new Date(fromDate.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);

  // Maximum iteration safety ceiling: 5 years into the future
  const maxIterations = 5 * 366 * 24 * 60;
  let iterations = 0;

  while (iterations < maxIterations) {
    const month = next.getUTCMonth() + 1; // 1-12
    if (!parsed.months.has(month)) {
      // Advance to start of next month
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      next.setUTCHours(0, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const dayOfMonth = next.getUTCDate(); // 1-31
    const dayOfWeek = next.getUTCDay(); // 0-6 (0=Sun)
    const domMatch = parsed.daysOfMonth.has(dayOfMonth);
    const dowMatch = parsed.daysOfWeek.has(dayOfWeek);

    let dayMatch: boolean;
    if (!parsed.isDayOfMonthWildcard && !parsed.isDayOfWeekWildcard) {
      // Standard POSIX/Vixie cron: when BOTH DOM and DOW are specified, fire when EITHER matches (OR logic)
      dayMatch = domMatch || dowMatch;
    } else if (!parsed.isDayOfMonthWildcard) {
      dayMatch = domMatch;
    } else if (!parsed.isDayOfWeekWildcard) {
      dayMatch = dowMatch;
    } else {
      dayMatch = true;
    }

    if (!dayMatch) {
      // Advance to next day
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(0, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const hour = next.getUTCHours(); // 0-23
    if (!parsed.hours.has(hour)) {
      // Advance to next hour
      next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const minute = next.getUTCMinutes(); // 0-59
    if (!parsed.minutes.has(minute)) {
      // Advance to next minute
      next.setUTCMinutes(next.getUTCMinutes() + 1);
      iterations++;
      continue;
    }

    // Found match
    return next;
  }

  throw new AutomationInvalidCronExpressionError(
    cron,
    "No valid execution time found within 5-year search window",
  );
}

