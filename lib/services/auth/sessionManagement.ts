import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "@auth/core/adapters";
import { prisma } from "@/lib/prisma";

/**
 * Sliding-window idle timeout for workspace user sessions (4 hours).
 * Implements Phase 1.20.2 Authentication Hardening (Finding SEC-01).
 *
 * Rationale: 4 hours matches standard B2B enterprise SaaS operational norms,
 * preventing unattended session hijacking while avoiding midday session drops.
 */
export const WORKSPACE_SESSION_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours in ms

/**
 * Evaluates whether a session timestamp exceeds the idle timeout threshold.
 */
export function isSessionIdle(
    updatedAt: Date | string,
    timeoutMs: number = WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
    now: Date = new Date(),
): boolean {
    const lastActive = new Date(updatedAt).getTime();
    if (isNaN(lastActive)) return true;
    return now.getTime() - lastActive > timeoutMs;
}

/**
 * Asynchronously touches a session record's updatedAt timestamp to slide the idle window.
 * Non-throwing / fail-safe.
 */
export async function touchSession(
    sessionId: string,
    now: Date = new Date(),
): Promise<void> {
    try {
        await prisma.session.update({
            where: { id: sessionId },
            data: { updatedAt: now },
        });
    } catch {
        // Fire-and-forget: do not disrupt active request if touch fails
    }
}

/**
 * Creates an Auth.js Adapter wrapping PrismaAdapter that natively validates and slides
 * idle sessions at the exact sessionToken lookup boundary (Phase 1.20.2 - Finding SEC-01).
 *
 * Guarantee: getSessionAndUser receives the exact sessionToken presented by the request's
 * session cookie, ensuring 100% request-scoped validation with zero cross-device interference.
 */
export function createSlidingSessionAdapter(
    prismaClient: typeof prisma = prisma,
    idleTimeoutMs: number = WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
): Adapter {
    const baseAdapter = PrismaAdapter(prismaClient);

    return {
        ...baseAdapter,

        async getSessionAndUser(sessionToken: string) {
            const userAndSession = await prismaClient.session.findUnique({
                where: { sessionToken },
                include: { user: true },
            });

            if (!userAndSession) {
                return null;
            }

            const { user, ...session } = userAndSession;

            // Check hard expiration
            if (session.expires.getTime() <= Date.now()) {
                await prismaClient.session.delete({ where: { sessionToken } }).catch(() => {});
                return null;
            }

            // Check sliding-window idle timeout (Finding SEC-01)
            if (isSessionIdle(session.updatedAt, idleTimeoutMs)) {
                await prismaClient.session.delete({ where: { sessionToken } }).catch(() => {});
                return null;
            }

            // Asynchronously touch this specific session to slide its active window
            void prismaClient.session.update({
                where: { sessionToken },
                data: { updatedAt: new Date() },
            }).catch(() => {});

            return {
                user,
                session: {
                    id: session.id,
                    sessionToken: session.sessionToken,
                    userId: session.userId,
                    expires: session.expires,
                },
            };
        },
    };
}

/**
 * Validates whether a specific session is valid and not expired by idle inactivity.
 * If valid, slides the session window by updating updatedAt.
 */
export async function validateAndTouchSession(
    sessionId: string,
    options?: {
        idleTimeoutMs?: number;
        now?: Date;
    },
): Promise<{
    valid: boolean;
    reason?: "EXPIRED" | "IDLE_TIMEOUT" | "NOT_FOUND";
    session?: {
        id: string;
        userId: string;
        expires: Date;
        createdAt: Date;
        updatedAt: Date;
    };
}> {
    const now = options?.now || new Date();
    const timeoutMs = options?.idleTimeoutMs ?? WORKSPACE_SESSION_IDLE_TIMEOUT_MS;

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            userId: true,
            expires: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    if (!session) {
        return { valid: false, reason: "NOT_FOUND" };
    }

    if (session.expires.getTime() <= now.getTime()) {
        await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
        return { valid: false, reason: "EXPIRED" };
    }

    if (isSessionIdle(session.updatedAt, timeoutMs, now)) {
        await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
        return { valid: false, reason: "IDLE_TIMEOUT" };
    }

    void touchSession(session.id, now);

    return {
        valid: true,
        session,
    };
}

/**
 * Queries active, non-idle sessions for a user.
 * Strictly projects safe fields and excludes sensitive session tokens.
 */
export async function getUserSessions(
    userId: string,
    options?: {
        idleTimeoutMs?: number;
        now?: Date;
    },
) {
    const now = options?.now || new Date();
    const timeoutMs = options?.idleTimeoutMs ?? WORKSPACE_SESSION_IDLE_TIMEOUT_MS;
    const idleCutoff = new Date(now.getTime() - timeoutMs);

    const sessions = await prisma.session.findMany({
        where: {
            userId,
            expires: {
                gt: now,
            },
            updatedAt: {
                gt: idleCutoff,
            },
        },
        orderBy: {
            updatedAt: "desc",
        },
        select: {
            id: true,
            expires: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return sessions.map((session) => ({
        id: session.id,
        expires: session.expires,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    }));
}

export async function revokeSession(
    userId: string,
    sessionId: string,
): Promise<boolean> {
    const result = await prisma.session.deleteMany({
        where: {
            id: sessionId,
            userId,
        },
    });

    return result.count > 0;
}

export async function revokeAllSessions(
    userId: string,
    exceptSessionId?: string,
): Promise<number> {
    const result = await prisma.session.deleteMany({
        where: {
            userId,
            ...(exceptSessionId
                ? {
                      NOT: {
                          id: exceptSessionId,
                      },
                  }
                : {}),
        },
    });

    return result.count;
}

/**
 * Cleans up both hard-expired sessions (expires <= now) and idle-expired sessions (updatedAt <= cutoff).
 */
export async function cleanupIdleAndExpiredSessions(
    timeoutMs: number = WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
    now: Date = new Date(),
): Promise<{ expiredCount: number; idleCount: number; totalCount: number }> {
    const idleCutoff = new Date(now.getTime() - timeoutMs);

    const expiredResult = await prisma.session.deleteMany({
        where: {
            expires: {
                lte: now,
            },
        },
    });

    const idleResult = await prisma.session.deleteMany({
        where: {
            updatedAt: {
                lte: idleCutoff,
            },
        },
    });

    return {
        expiredCount: expiredResult.count,
        idleCount: idleResult.count,
        totalCount: expiredResult.count + idleResult.count,
    };
}
