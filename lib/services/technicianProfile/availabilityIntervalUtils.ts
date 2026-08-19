import type {
    AvailabilityDay,
    TechnicianAvailability,
    TechnicianAvailabilityException,
} from "@/generated/prisma/client";
import type {
    RecurringAvailabilityWindow,
    BlockingExceptionInfo,
} from "./technicianAvailabilityCheck.types";

interface ZonedTimeParts {
    dateStr: string;
    dayOfWeek: AvailabilityDay;
    minutesFromMidnight: number;
}

const DAY_NAME_TO_ENUM: Record<string, AvailabilityDay> = {
    Monday: "MONDAY",
    Tuesday: "TUESDAY",
    Wednesday: "WEDNESDAY",
    Thursday: "THURSDAY",
    Friday: "FRIDAY",
    Saturday: "SATURDAY",
    Sunday: "SUNDAY",
};

/**
 * Parses time in "HH:mm" format to minutes from midnight (0 to 1440).
 */
export function parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

/**
 * Extracts zoned calendar date, day of week enum, and minutes from midnight for a timestamp in a given timezone.
 */
export function getZonedTimeParts(
    date: Date,
    timeZone: string,
): ZonedTimeParts {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    let year = "1970",
        month = "01",
        day = "01",
        weekday = "Monday",
        hour = "00",
        minute = "00",
        second = "00";

    for (const part of parts) {
        if (part.type === "year") year = part.value;
        if (part.type === "month") month = part.value;
        if (part.type === "day") day = part.value;
        if (part.type === "weekday") weekday = part.value;
        if (part.type === "hour") hour = part.value;
        if (part.type === "minute") minute = part.value;
        if (part.type === "second") second = part.value;
    }

    const dayOfWeek = DAY_NAME_TO_ENUM[weekday] || "MONDAY";
    const dateStr = `${year}-${month}-${day}`;
    const h = hour === "24" ? 0 : parseInt(hour, 10);
    const m = parseInt(minute, 10);
    const s = parseInt(second, 10);
    const minutesFromMidnight = h * 60 + m + s / 60;

    return {
        dateStr,
        dayOfWeek,
        minutesFromMidnight,
    };
}

export interface DaySlice {
    dateStr: string;
    dayOfWeek: AvailabilityDay;
    startMinutes: number;
    endMinutes: number;
}

/**
 * Slices a requested [startsAt, endsAt) interval into calendar day intervals in the specified timezone.
 */
export function sliceIntervalByZonedDays(
    startsAt: Date,
    endsAt: Date,
    timeZone: string,
): DaySlice[] {
    const slices: DaySlice[] = [];
    let current = new Date(startsAt.getTime());

    while (current.getTime() < endsAt.getTime()) {
        const startZoned = getZonedTimeParts(current, timeZone);
        const endZoned = getZonedTimeParts(endsAt, timeZone);

        if (startZoned.dateStr === endZoned.dateStr) {
            // Slices end on the same calendar day
            slices.push({
                dateStr: startZoned.dateStr,
                dayOfWeek: startZoned.dayOfWeek,
                startMinutes: startZoned.minutesFromMidnight,
                endMinutes: endZoned.minutesFromMidnight,
            });
            break;
        } else {
            // Slices span to end of this calendar day (1440 minutes)
            slices.push({
                dateStr: startZoned.dateStr,
                dayOfWeek: startZoned.dayOfWeek,
                startMinutes: startZoned.minutesFromMidnight,
                endMinutes: 1440,
            });

            // Advance current past midnight in the target timezone
            const remainingMinutesInDay = 1440 - startZoned.minutesFromMidnight;
            current = new Date(
                current.getTime() + remainingMinutesInDay * 60 * 1000 + 1000,
            );
        }
    }

    return slices;
}

export interface IntervalEvaluationResult {
    isCoveredByRecurring: boolean;
    matchingAvailability: RecurringAvailabilityWindow[];
    blockingExceptions: BlockingExceptionInfo[];
}

/**
 * Evaluates whether a requested [startsAt, endsAt) interval is fully covered by recurring availability
 * and identifies matching availability windows and blocking exceptions.
 */
export function evaluateIntervalAvailability(
    startsAt: Date,
    endsAt: Date,
    timeZone: string,
    activeAvailabilities: TechnicianAvailability[],
    activeExceptions: TechnicianAvailabilityException[],
): IntervalEvaluationResult {
    // 1. Check Exceptions Overlap
    const blockingExceptions: BlockingExceptionInfo[] = [];

    for (const exc of activeExceptions) {
        if (exc.status === "ACTIVE") {
            const overlaps =
                exc.startsAt.getTime() < endsAt.getTime() &&
                startsAt.getTime() < exc.endsAt.getTime();

            if (overlaps) {
                blockingExceptions.push({
                    id: exc.id,
                    type: exc.type,
                    title: exc.title,
                    startsAt: exc.startsAt,
                    endsAt: exc.endsAt,
                    isAllDay: exc.isAllDay,
                });
            }
        }
    }

    // 2. Slice Interval and Check Recurring Availability Coverage
    const slices = sliceIntervalByZonedDays(startsAt, endsAt, timeZone);
    const matchingWindowsMap = new Map<string, RecurringAvailabilityWindow>();
    let isCoveredByRecurring = slices.length > 0;

    for (const slice of slices) {
        const windowsForDay = activeAvailabilities.filter(
            (a) => a.status === "ACTIVE" && a.dayOfWeek === slice.dayOfWeek,
        );

        if (windowsForDay.length === 0) {
            isCoveredByRecurring = false;
            continue;
        }

        // Collect matching windows that intersect this slice
        const parsedWindows: Array<{
            window: TechnicianAvailability;
            start: number;
            end: number;
        }> = [];

        for (const w of windowsForDay) {
            const startMin = parseTimeToMinutes(w.startTime);
            const endMin = parseTimeToMinutes(w.endTime);
            parsedWindows.push({ window: w, start: startMin, end: endMin });

            // Check if window intersects slice: startMin < slice.endMinutes && slice.startMinutes < endMin
            if (startMin < slice.endMinutes && slice.startMinutes < endMin) {
                matchingWindowsMap.set(w.id, {
                    id: w.id,
                    dayOfWeek: w.dayOfWeek,
                    startTime: w.startTime,
                    endTime: w.endTime,
                });
            }
        }

        // Merge touching/overlapping windows for continuous coverage checking
        parsedWindows.sort((a, b) => a.start - b.start);
        const mergedIntervals: Array<[number, number]> = [];

        for (const pw of parsedWindows) {
            if (mergedIntervals.length === 0) {
                mergedIntervals.push([pw.start, pw.end]);
            } else {
                const last = mergedIntervals[mergedIntervals.length - 1];
                if (pw.start <= last[1]) {
                    last[1] = Math.max(last[1], pw.end);
                } else {
                    mergedIntervals.push([pw.start, pw.end]);
                }
            }
        }

        // Verify if slice [slice.startMinutes, slice.endMinutes) is completely covered
        const isSliceCovered = mergedIntervals.some(
            ([mStart, mEnd]) =>
                mStart <= slice.startMinutes && slice.endMinutes <= mEnd,
        );

        if (!isSliceCovered) {
            isCoveredByRecurring = false;
        }
    }

    return {
        isCoveredByRecurring,
        matchingAvailability: Array.from(matchingWindowsMap.values()),
        blockingExceptions,
    };
}
