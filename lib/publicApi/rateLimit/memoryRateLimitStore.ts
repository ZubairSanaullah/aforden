import { RateLimitResult, RateLimitStore } from "./rateLimit.types";

/**
 * In-Memory Sliding Window Log implementation of RateLimitStore.
 *
 * Tracks granular request timestamps within a sliding window to provide accurate
 * burst-smoothed rate limiting without fixed-window boundary spikes.
 *
 * NOTE: For multi-instance horizontal deployments, this can be swapped with a
 * distributed Redis-backed implementation (e.g. via Redis sliding-window zset)
 * conforming to the same `RateLimitStore` interface.
 */
export class MemoryRateLimitStore implements RateLimitStore {
    private readonly store = new Map<string, number[]>();
    private lastCleanupTime: number = Date.now();
    private readonly cleanupIntervalMs: number = 60 * 1000; // prune every 60s

    async incrementAndCheck(
        key: string,
        limit: number,
        windowMs: number,
        currentTime?: number,
    ): Promise<RateLimitResult> {
        const now = currentTime ?? Date.now();
        const windowStart = now - windowMs;

        // Periodic maintenance to prevent memory bloat from inactive keys
        if (now - this.lastCleanupTime > this.cleanupIntervalMs) {
            this.purgeStaleEntries(now, windowMs);
            this.lastCleanupTime = now;
        }

        let timestamps = this.store.get(key);
        if (!timestamps) {
            timestamps = [];
            this.store.set(key, timestamps);
        }

        // Filter out timestamps outside the sliding window
        // (Timestamps are in ascending order, so find first index >= windowStart)
        let firstValidIdx = 0;
        while (
            firstValidIdx < timestamps.length &&
            timestamps[firstValidIdx] <= windowStart
        ) {
            firstValidIdx++;
        }

        if (firstValidIdx > 0) {
            timestamps = timestamps.slice(firstValidIdx);
            this.store.set(key, timestamps);
        }

        const currentCount = timestamps.length;

        if (currentCount < limit) {
            // Request is allowed
            timestamps.push(now);
            const remaining = limit - currentCount - 1;
            const oldest = timestamps[0];
            const resetEpochSeconds = Math.ceil((oldest + windowMs) / 1000);

            return {
                allowed: true,
                limit,
                remaining,
                resetEpochSeconds,
                retryAfterSeconds: 0,
            };
        } else {
            // Limit exceeded (429)
            const oldest = timestamps[0] ?? now;
            const timeUntilOldestExpiresMs = oldest + windowMs - now;
            const retryAfterSeconds = Math.max(
                1,
                Math.ceil(timeUntilOldestExpiresMs / 1000),
            );
            const resetEpochSeconds = Math.ceil((oldest + windowMs) / 1000);

            return {
                allowed: false,
                limit,
                remaining: 0,
                resetEpochSeconds,
                retryAfterSeconds,
            };
        }
    }

    async reset(key: string): Promise<void> {
        this.store.delete(key);
    }

    async clear(): Promise<void> {
        this.store.clear();
    }

    private purgeStaleEntries(now: number, windowMs: number): void {
        const windowStart = now - windowMs;
        for (const [key, timestamps] of this.store.entries()) {
            if (
                timestamps.length === 0 ||
                timestamps[timestamps.length - 1] <= windowStart
            ) {
                this.store.delete(key);
            }
        }
    }
}

// Global default in-memory singleton
export const defaultMemoryRateLimitStore = new MemoryRateLimitStore();
