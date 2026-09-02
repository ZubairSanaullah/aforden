import {
    cleanupIdleAndExpiredSessions,
    WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
} from "./sessionManagement";

export async function cleanupExpiredSessions(
    idleTimeoutMs: number = WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
    now: Date = new Date(),
): Promise<number> {
    const result = await cleanupIdleAndExpiredSessions(idleTimeoutMs, now);
    return result.totalCount;
}