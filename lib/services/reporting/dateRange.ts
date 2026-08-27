import {
  InvalidReportDateRangeError,
  ReportDateRangeTooLargeError,
} from "./reportingErrors";
import {
  MAX_BUCKETS_BY_GRANULARITY,
  MAX_RANGE_DAYS,
} from "./reportingConstants";
import type {
  DateBucketGranularity,
  DateRangePreset,
  ResolvedReportDateRange,
} from "./reporting.types";

/**
 * Calculates the offset, in milliseconds, of `timeZone` at instant `at`.
 * Formula: (localWallClockAsUtc - actualInstant)
 */
export function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const hour = get("hour") === 24 ? 0 : get("hour"); // Intl may emit "24" for midnight
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * Converts a local wall clock date/time in `timeZone` to the corresponding UTC instant.
 * Handles DST spring-forward (gap) and fall-back (overlap) disambiguation.
 */
export function zonedWallClockToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s); // treat wall clock as if it were UTC
  const off1 = zoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - off1;

  const off2 = zoneOffsetMs(new Date(utc), timeZone); // re-probe at the corrected instant
  if (off2 !== off1) {
    utc = guess - off2;
    if (zoneOffsetMs(new Date(utc), timeZone) !== off2) {
      // Neither offset round-trips: the requested wall clock does not exist (spring-forward gap).
      // Resolve FORWARD using the pre-transition (smaller) offset so boundaries don't collapse.
      utc = guess - Math.min(off1, off2);
    }
  }
  return new Date(utc);
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 1 = Monday, ..., 7 = Sunday
}

/**
 * Extracts the local calendar date parts for a given instant in a timezone.
 */
function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "narrow",
  }).formatToParts(date);

  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");

  // Determine weekday with Monday = 1 ... Sunday = 7
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  const weekdayShort = dayFormatter.format(date);
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const dayOfWeek = weekdayMap[weekdayShort] ?? 1;

  return { year, month, day, dayOfWeek };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatLocalDateString(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function parseAndValidateLocalDate(dateStr: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new InvalidReportDateRangeError(
      `Invalid date format "${dateStr}". Expected YYYY-MM-DD.`,
    );
  }

  const [yStr, mStr, dStr] = dateStr.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);

  if (month < 1 || month > 12) {
    throw new InvalidReportDateRangeError(
      `Invalid month ${month} in date "${dateStr}".`,
    );
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    throw new InvalidReportDateRangeError(
      `Invalid day ${day} for month ${month} in date "${dateStr}".`,
    );
  }

  return { year, month, day };
}

function addDaysToLocalDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function resolvePresetToLocalDates(
  preset: DateRangePreset,
  now: Date,
  timeZone: string,
): { fromLocalDate: string; toLocalDate: string } {
  const localNow = getLocalDateParts(now, timeZone);
  const { year, month, day, dayOfWeek } = localNow;

  switch (preset) {
    case "TODAY": {
      const todayStr = formatLocalDateString(year, month, day);
      return { fromLocalDate: todayStr, toLocalDate: todayStr };
    }
    case "YESTERDAY": {
      const yest = addDaysToLocalDate(year, month, day, -1);
      const yestStr = formatLocalDateString(yest.year, yest.month, yest.day);
      return { fromLocalDate: yestStr, toLocalDate: yestStr };
    }
    case "THIS_WEEK": {
      // Monday is 1, Sunday is 7
      const mon = addDaysToLocalDate(year, month, day, -(dayOfWeek - 1));
      const sun = addDaysToLocalDate(year, month, day, 7 - dayOfWeek);
      return {
        fromLocalDate: formatLocalDateString(mon.year, mon.month, mon.day),
        toLocalDate: formatLocalDateString(sun.year, sun.month, sun.day),
      };
    }
    case "LAST_WEEK": {
      const mon = addDaysToLocalDate(year, month, day, -(dayOfWeek - 1) - 7);
      const sun = addDaysToLocalDate(year, month, day, 7 - dayOfWeek - 7);
      return {
        fromLocalDate: formatLocalDateString(mon.year, mon.month, mon.day),
        toLocalDate: formatLocalDateString(sun.year, sun.month, sun.day),
      };
    }
    case "THIS_MONTH": {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        fromLocalDate: formatLocalDateString(year, month, 1),
        toLocalDate: formatLocalDateString(year, month, lastDay),
      };
    }
    case "LAST_MONTH": {
      let prevYear = year;
      let prevMonth = month - 1;
      if (prevMonth < 1) {
        prevMonth = 12;
        prevYear -= 1;
      }
      const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
      return {
        fromLocalDate: formatLocalDateString(prevYear, prevMonth, 1),
        toLocalDate: formatLocalDateString(prevYear, prevMonth, lastDay),
      };
    }
    case "THIS_QUARTER": {
      const quarter = Math.floor((month - 1) / 3); // 0, 1, 2, 3
      const startMonth = quarter * 3 + 1;
      const endMonth = startMonth + 2;
      const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
      return {
        fromLocalDate: formatLocalDateString(year, startMonth, 1),
        toLocalDate: formatLocalDateString(year, endMonth, lastDay),
      };
    }
    case "LAST_QUARTER": {
      let qYear = year;
      let prevQuarter = Math.floor((month - 1) / 3) - 1;
      if (prevQuarter < 0) {
        prevQuarter = 3;
        qYear -= 1;
      }
      const startMonth = prevQuarter * 3 + 1;
      const endMonth = startMonth + 2;
      const lastDay = new Date(Date.UTC(qYear, endMonth, 0)).getUTCDate();
      return {
        fromLocalDate: formatLocalDateString(qYear, startMonth, 1),
        toLocalDate: formatLocalDateString(qYear, endMonth, lastDay),
      };
    }
    case "THIS_YEAR": {
      return {
        fromLocalDate: formatLocalDateString(year, 1, 1),
        toLocalDate: formatLocalDateString(year, 12, 31),
      };
    }
    case "LAST_YEAR": {
      return {
        fromLocalDate: formatLocalDateString(year - 1, 1, 1),
        toLocalDate: formatLocalDateString(year - 1, 12, 31),
      };
    }
    case "LAST_7_DAYS": {
      const start = addDaysToLocalDate(year, month, day, -6);
      return {
        fromLocalDate: formatLocalDateString(start.year, start.month, start.day),
        toLocalDate: formatLocalDateString(year, month, day),
      };
    }
    case "LAST_30_DAYS": {
      const start = addDaysToLocalDate(year, month, day, -29);
      return {
        fromLocalDate: formatLocalDateString(start.year, start.month, start.day),
        toLocalDate: formatLocalDateString(year, month, day),
      };
    }
    case "LAST_90_DAYS": {
      const start = addDaysToLocalDate(year, month, day, -89);
      return {
        fromLocalDate: formatLocalDateString(start.year, start.month, start.day),
        toLocalDate: formatLocalDateString(year, month, day),
      };
    }
    case "LAST_12_MONTHS": {
      // From 1st day of month 11 months ago through end of current month
      let startYear = year;
      let startMonth = month - 11;
      while (startMonth < 1) {
        startMonth += 12;
        startYear -= 1;
      }
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        fromLocalDate: formatLocalDateString(startYear, startMonth, 1),
        toLocalDate: formatLocalDateString(year, month, lastDay),
      };
    }
  }
}

function countBuckets(
  startLocal: { year: number; month: number; day: number },
  endLocal: { year: number; month: number; day: number },
  granularity: DateBucketGranularity,
): number {
  const startUtcMidnight = Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day);
  const endUtcMidnight = Date.UTC(endLocal.year, endLocal.month - 1, endLocal.day);
  const totalDays = Math.round((endUtcMidnight - startUtcMidnight) / 86_400_000) + 1;

  switch (granularity) {
    case "DAY":
      return totalDays;
    case "WEEK":
      return Math.ceil(totalDays / 7);
    case "MONTH":
      return (endLocal.year - startLocal.year) * 12 + (endLocal.month - startLocal.month) + 1;
    case "QUARTER": {
      const startQ = Math.floor((startLocal.month - 1) / 3);
      const endQ = Math.floor((endLocal.month - 1) / 3);
      return (endLocal.year - startLocal.year) * 4 + (endQ - startQ) + 1;
    }
    case "YEAR":
      return endLocal.year - startLocal.year + 1;
  }
}

function selectDefaultGranularity(
  startLocal: { year: number; month: number; day: number },
  endLocal: { year: number; month: number; day: number },
): DateBucketGranularity {
  const dayBuckets = countBuckets(startLocal, endLocal, "DAY");
  if (dayBuckets <= MAX_BUCKETS_BY_GRANULARITY.DAY) return "DAY";

  const weekBuckets = countBuckets(startLocal, endLocal, "WEEK");
  if (weekBuckets <= MAX_BUCKETS_BY_GRANULARITY.WEEK) return "WEEK";

  const monthBuckets = countBuckets(startLocal, endLocal, "MONTH");
  if (monthBuckets <= MAX_BUCKETS_BY_GRANULARITY.MONTH) return "MONTH";

  const quarterBuckets = countBuckets(startLocal, endLocal, "QUARTER");
  if (quarterBuckets <= MAX_BUCKETS_BY_GRANULARITY.QUARTER) return "QUARTER";

  return "YEAR";
}

export function resolveReportDateRange(input: {
  workspaceTimezone: string;
  preset?: DateRangePreset;
  fromLocalDate?: string;
  toLocalDate?: string;
  granularity?: DateBucketGranularity;
  now?: Date;
}): ResolvedReportDateRange {
  const { workspaceTimezone, preset, fromLocalDate, toLocalDate, granularity, now = new Date() } = input;

  if (!workspaceTimezone || workspaceTimezone.trim().length === 0) {
    throw new InvalidReportDateRangeError("Workspace timezone is required.");
  }

  // Validate timezone string with Intl
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: workspaceTimezone });
  } catch {
    throw new InvalidReportDateRangeError(`Invalid workspace timezone: "${workspaceTimezone}".`);
  }

  const hasPreset = Boolean(preset);
  const hasCustomDates = Boolean(fromLocalDate || toLocalDate);

  // Rule 1: Mutual exclusivity
  if (hasPreset && hasCustomDates) {
    throw new InvalidReportDateRangeError(
      "Preset and custom from/to dates are mutually exclusive.",
    );
  }

  let startLocalStr: string;
  let endLocalStr: string;

  if (hasPreset) {
    const dates = resolvePresetToLocalDates(preset!, now, workspaceTimezone);
    startLocalStr = dates.fromLocalDate;
    endLocalStr = dates.toLocalDate;
  } else if (fromLocalDate && toLocalDate) {
    startLocalStr = fromLocalDate;
    endLocalStr = toLocalDate;
  } else if (!fromLocalDate && !toLocalDate) {
    // Rule 2: Default to THIS_MONTH
    const dates = resolvePresetToLocalDates("THIS_MONTH", now, workspaceTimezone);
    startLocalStr = dates.fromLocalDate;
    endLocalStr = dates.toLocalDate;
  } else {
    throw new InvalidReportDateRangeError(
      "Both fromLocalDate and toLocalDate must be provided when not using a preset.",
    );
  }

  // Rule 3: Strict parse and validate
  const startLocal = parseAndValidateLocalDate(startLocalStr);
  const endLocal = parseAndValidateLocalDate(endLocalStr);

  // Rule 6: start <= end
  if (startLocalStr > endLocalStr) {
    throw new InvalidReportDateRangeError(
      `fromLocalDate ("${startLocalStr}") cannot be after toLocalDate ("${endLocalStr}").`,
    );
  }

  // Rule 4 & 5: Half-open interval [startUtc, endUtc)
  // startUtc = local 00:00:00.000 on startLocal
  const startUtc = zonedWallClockToUtc(
    startLocal.year,
    startLocal.month,
    startLocal.day,
    0,
    0,
    0,
    workspaceTimezone,
  );

  // endUtc = local 00:00:00.000 on day AFTER endLocal (next midnight)
  const nextLocalDay = addDaysToLocalDate(endLocal.year, endLocal.month, endLocal.day, 1);
  const endUtc = zonedWallClockToUtc(
    nextLocalDay.year,
    nextLocalDay.month,
    nextLocalDay.day,
    0,
    0,
    0,
    workspaceTimezone,
  );

  // Check max range days limit
  const approxDays = Math.round((endUtc.getTime() - startUtc.getTime()) / 86_400_000);
  if (approxDays > MAX_RANGE_DAYS) {
    throw new ReportDateRangeTooLargeError(
      `The requested range (${approxDays} days) exceeds the maximum allowed range of ${MAX_RANGE_DAYS} days.`,
    );
  }

  // Rule 8: Granularity resolution and bucket count calculation
  const resolvedGranularity = granularity ?? selectDefaultGranularity(startLocal, endLocal);
  const bucketCount = countBuckets(startLocal, endLocal, resolvedGranularity);

  const maxAllowedBuckets = MAX_BUCKETS_BY_GRANULARITY[resolvedGranularity];
  if (bucketCount > maxAllowedBuckets) {
    throw new ReportDateRangeTooLargeError(
      `The requested range produces ${bucketCount} ${resolvedGranularity.toLowerCase()} buckets, exceeding the maximum of ${maxAllowedBuckets} for ${resolvedGranularity}. Consider using a coarser granularity.`,
    );
  }

  return {
    startUtc,
    endUtc,
    timezone: workspaceTimezone,
    granularity: resolvedGranularity,
    preset: preset ?? (hasCustomDates ? null : "THIS_MONTH"),
    startLocalDate: startLocalStr,
    endLocalDate: endLocalStr,
    bucketCount,
  };
}
