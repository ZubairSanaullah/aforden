/**
 * Phase 1.16.7 — Interval Scheduling Engine
 *
 * Computes deterministic recurring execution times based on fixed intervalSeconds.
 */

import { AutomationValidationError } from "./automationErrors";

/**
 * Computes the next scheduled execution timestamp for an interval-based job.
 *
 * @param intervalSeconds - Interval duration in seconds (must be > 0)
 * @param lastRunAt - Previous execution timestamp (if any)
 * @param fromDate - Reference anchor time (defaults to now)
 */
export function computeNextIntervalRun(
  intervalSeconds: number,
  lastRunAt?: Date | null,
  fromDate: Date = new Date(),
): Date {
  if (
    typeof intervalSeconds !== "number" ||
    isNaN(intervalSeconds) ||
    intervalSeconds <= 0
  ) {
    throw new AutomationValidationError(
      `intervalSeconds must be a positive integer, got ${intervalSeconds}`,
    );
  }

  const intervalMs = Math.round(intervalSeconds * 1000);
  const anchorTime = fromDate.getTime();

  if (!lastRunAt) {
    // First run: schedule intervalSeconds after reference anchor
    return new Date(anchorTime + intervalMs);
  }

  const lastTime = lastRunAt.getTime();
  let nextTime = lastTime + intervalMs;

  // If nextTime is in the past relative to fromDate, advance by necessary intervals
  if (nextTime <= anchorTime) {
    const elapsed = anchorTime - lastTime;
    const intervalsPassed = Math.floor(elapsed / intervalMs);
    nextTime = lastTime + (intervalsPassed + 1) * intervalMs;
  }

  return new Date(nextTime);
}
