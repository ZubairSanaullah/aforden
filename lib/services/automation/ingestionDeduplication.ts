/**
 * Phase 1.16.3 — Tier 1 Ingestion Deduplication (Invariant 5)
 *
 * Implements Tier 1 Ingestion Deduplication using SHA-256 hash computation
 * over (workspaceId, eventType, sourceEntity, sourceId, eventTimestamp)
 * checked against a rolling 5-minute deduplication window.
 */

import { createHash } from "crypto";
import type { IngestionDedupeResult } from "./automation.types";

/**
 * In-memory rolling deduplication cache: Map<compositeKey, timestampMs>.
 * Uses a 5-minute (300,000 ms) TTL window per Invariant 5.
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const dedupeCache = new Map<string, number>();

/**
 * Computes the canonical SHA-256 deduplication key for an incoming domain event per Invariant 5:
 * dedupeKey = SHA256(workspaceId + ":" + eventType + ":" + sourceEntity + ":" + sourceId + ":" + eventTimestamp)
 */
export function computeIngestionDedupeKey(
  workspaceId: string,
  eventType: string,
  sourceEntity: string,
  sourceId: string,
  eventTimestamp: Date | string | number = new Date()
): string {
  let tsStr: string;
  if (eventTimestamp instanceof Date) {
    tsStr = eventTimestamp.toISOString();
  } else if (typeof eventTimestamp === "number") {
    tsStr = new Date(eventTimestamp).toISOString();
  } else {
    tsStr = String(eventTimestamp);
  }

  const rawKey = `${workspaceId}:${eventType}:${sourceEntity}:${sourceId}:${tsStr}`;
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Evicts cache entries older than the 5-minute rolling window.
 */
function sweepExpiredDedupeKeys(nowMs: number = Date.now()): void {
  for (const [key, timestamp] of dedupeCache.entries()) {
    if (nowMs - timestamp > DEDUPE_WINDOW_MS) {
      dedupeCache.delete(key);
    }
  }
}

/**
 * Checks if the given dedupeKey has already been ingested within the 5-minute rolling window.
 * If not, records the key and returns isDuplicate: false.
 * If duplicate, returns isDuplicate: true.
 */
export function checkAndRecordIngestionDedupe(
  workspaceId: string,
  dedupeKey: string,
  nowMs: number = Date.now()
): IngestionDedupeResult {
  sweepExpiredDedupeKeys(nowMs);

  const compositeCacheKey = `${workspaceId}:${dedupeKey}`;
  const existing = dedupeCache.get(compositeCacheKey);

  if (existing !== undefined && nowMs - existing <= DEDUPE_WINDOW_MS) {
    return {
      dedupeKey,
      isDuplicate: true,
    };
  }

  // Record key with current timestamp
  dedupeCache.set(compositeCacheKey, nowMs);

  return {
    dedupeKey,
    isDuplicate: false,
  };
}

/**
 * Phase 1.16.9 — Distributed Tier 1 Ingestion Deduplication (Invariant 5)
 * Checks in-memory fast cache first, and verifies persistence against database
 * within rolling 5-minute window for distributed multi-instance safety.
 */
export async function checkAndRecordIngestionDedupeAsync(
  workspaceId: string,
  dedupeKey: string,
  db?: any,
  nowMs: number = Date.now()
): Promise<IngestionDedupeResult> {
  // 1. In-memory fast path
  const localResult = checkAndRecordIngestionDedupe(workspaceId, dedupeKey, nowMs);
  if (localResult.isDuplicate) {
    return localResult;
  }

  // 2. Database distributed check if db client is provided
  if (db && typeof db.automationExecution?.findFirst === "function") {
    const fiveMinutesAgo = new Date(nowMs - DEDUPE_WINDOW_MS);
    const existing = await db.automationExecution.findFirst({
      where: {
        workspaceId,
        dedupeKey,
        createdAt: { gte: fiveMinutesAgo },
      },
      select: { id: true },
    });

    if (existing) {
      return {
        dedupeKey,
        isDuplicate: true,
      };
    }
  }

  return {
    dedupeKey,
    isDuplicate: false,
  };
}

/**
 * Explicitly clears the in-memory deduplication cache (for testing/cleanup).
 */
export function clearIngestionDedupeCache(): void {
  dedupeCache.clear();
}

