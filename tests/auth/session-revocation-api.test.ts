import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        session: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
            delete: vi.fn(),
            deleteMany: vi.fn(),
            update: vi.fn(),
        },
    },
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

import { DELETE as deleteSessionRoute } from "@/app/api/auth/sessions/[sessionId]/route";
import { POST as revokeAllSessionsRoute } from "@/app/api/auth/sessions/revoke-all/route";
import { GET as getSessionsRoute } from "@/app/api/auth/sessions/route";
import {
    isSessionIdle,
    touchSession,
    validateAndTouchSession,
    getUserSessions,
    revokeSession,
    revokeAllSessions,
    cleanupIdleAndExpiredSessions,
    WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
} from "@/lib/services/auth/sessionManagement";

describe("Phase 1.21.2 — Session Revocation & Lifecycle Edge Cases", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Single Session Revocation Route (`DELETE /api/auth/sessions/[sessionId]`)", () => {
        function makeContext(sessionId: string) {
            return {
                params: Promise.resolve({ sessionId }),
            };
        }

        it("returns 401 when request is unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);

            const req = new Request("http://localhost:3000/api/auth/sessions/sess_123", {
                method: "DELETE",
            });
            const res = await deleteSessionRoute(req, makeContext("sess_123"));
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Authentication is required.");
        });

        it("returns 400 when sessionId param is missing or empty", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_1" } });

            const req = new Request("http://localhost:3000/api/auth/sessions/", {
                method: "DELETE",
            });
            const res = await deleteSessionRoute(req, makeContext(""));
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Session ID is required.");
        });

        it("returns 404 when session belongs to a different user or does not exist", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_attacker" } });
            // deleteMany returns count 0 because sessionId exists for user_victim, not user_attacker
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 0 });

            const req = new Request("http://localhost:3000/api/auth/sessions/sess_victim", {
                method: "DELETE",
            });
            const res = await deleteSessionRoute(req, makeContext("sess_victim"));
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Session could not be found.");

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    id: "sess_victim",
                    userId: "user_attacker",
                },
            });
        });

        it("returns 200 OK when user's own session is successfully revoked", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 });

            const req = new Request("http://localhost:3000/api/auth/sessions/sess_123", {
                method: "DELETE",
            });
            const res = await deleteSessionRoute(req, makeContext("sess_123"));
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.message).toBe("Session revoked successfully.");
        });

        it("returns 500 when database throws unexpected exception", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
            mocks.prisma.session.deleteMany.mockRejectedValue(new Error("DB connection failure"));

            const req = new Request("http://localhost:3000/api/auth/sessions/sess_123", {
                method: "DELETE",
            });
            const res = await deleteSessionRoute(req, makeContext("sess_123"));
            expect(res.status).toBe(500);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Unable to revoke the session.");
        });
    });

    describe("2. Bulk Revocation & List Routes", () => {
        it("POST /api/auth/sessions/revoke-all revokes all sessions and returns 200", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 3 });

            const res = await revokeAllSessionsRoute();
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.revokedSessions).toBe(3);
        });

        it("POST /api/auth/sessions/revoke-all returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);

            const res = await revokeAllSessionsRoute();
            expect(res.status).toBe(401);
        });

        it("POST /api/auth/sessions/revoke-all returns 500 on unexpected error", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
            mocks.prisma.session.deleteMany.mockRejectedValue(new Error("DB error"));

            const res = await revokeAllSessionsRoute();
            expect(res.status).toBe(500);
        });

        it("GET /api/auth/sessions returns 200 with safe session projections", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
            mocks.prisma.session.findMany.mockResolvedValue([
                {
                    id: "sess_1",
                    expires: new Date("2026-09-04T00:00:00.000Z"),
                    createdAt: new Date("2026-09-01T00:00:00.000Z"),
                    updatedAt: new Date("2026-09-03T10:00:00.000Z"),
                },
            ]);

            const res = await getSessionsRoute();
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.sessions.length).toBe(1);
            expect(json.sessions[0].id).toBe("sess_1");
        });

        it("GET /api/auth/sessions returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);

            const res = await getSessionsRoute();
            expect(res.status).toBe(401);
        });

        it("GET /api/auth/sessions returns 500 on unexpected error", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
            mocks.prisma.session.findMany.mockRejectedValue(new Error("DB error"));

            const res = await getSessionsRoute();
            expect(res.status).toBe(500);
        });
    });

    describe("3. Session Service Utilities (`lib/services/auth/sessionManagement.ts`)", () => {
        it("isSessionIdle returns true on invalid date string or elapsed timeout", () => {
            expect(isSessionIdle("invalid-date")).toBe(true);

            const now = new Date("2026-09-03T12:00:00.000Z");
            const recent = new Date("2026-09-03T11:00:00.000Z"); // 1 hour ago (< 4h)
            const ancient = new Date("2026-09-03T06:00:00.000Z"); // 6 hours ago (> 4h)

            expect(isSessionIdle(recent, WORKSPACE_SESSION_IDLE_TIMEOUT_MS, now)).toBe(false);
            expect(isSessionIdle(ancient, WORKSPACE_SESSION_IDLE_TIMEOUT_MS, now)).toBe(true);
        });

        it("touchSession catches and swallows database update errors gracefully", async () => {
            mocks.prisma.session.update.mockRejectedValue(new Error("Session locked"));
            await expect(touchSession("sess_err")).resolves.not.toThrow();
        });

        it("revokeAllSessions supports exceptSessionId exclusion", async () => {
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 2 });

            const count = await revokeAllSessions("user_1", "sess_keep");
            expect(count).toBe(2);
            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "user_1",
                    NOT: { id: "sess_keep" },
                },
            });
        });

        it("validateAndTouchSession handles NOT_FOUND, EXPIRED, IDLE_TIMEOUT, and VALID", async () => {
            const now = new Date("2026-09-03T12:00:00.000Z");

            // Not found
            mocks.prisma.session.findUnique.mockResolvedValueOnce(null);
            const r1 = await validateAndTouchSession("s1", { now });
            expect(r1.valid).toBe(false);
            expect(r1.reason).toBe("NOT_FOUND");

            // Hard expired
            mocks.prisma.session.findUnique.mockResolvedValueOnce({
                id: "s2",
                userId: "u1",
                expires: new Date("2026-09-03T10:00:00.000Z"), // before now
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            mocks.prisma.session.delete.mockResolvedValue({});
            const r2 = await validateAndTouchSession("s2", { now });
            expect(r2.valid).toBe(false);
            expect(r2.reason).toBe("EXPIRED");

            // Idle timeout
            mocks.prisma.session.findUnique.mockResolvedValueOnce({
                id: "s3",
                userId: "u1",
                expires: new Date("2026-09-04T00:00:00.000Z"),
                createdAt: new Date(),
                updatedAt: new Date("2026-09-03T05:00:00.000Z"), // 7h ago
            });
            const r3 = await validateAndTouchSession("s3", { now });
            expect(r3.valid).toBe(false);
            expect(r3.reason).toBe("IDLE_TIMEOUT");

            // Valid
            mocks.prisma.session.findUnique.mockResolvedValueOnce({
                id: "s4",
                userId: "u1",
                expires: new Date("2026-09-04T00:00:00.000Z"),
                createdAt: new Date(),
                updatedAt: new Date("2026-09-03T11:30:00.000Z"), // 30m ago
            });
            const r4 = await validateAndTouchSession("s4", { now });
            expect(r4.valid).toBe(true);
            expect(r4.session?.id).toBe("s4");
        });

        it("cleanupIdleAndExpiredSessions deletes hard-expired and idle-expired records", async () => {
            mocks.prisma.session.deleteMany
                .mockResolvedValueOnce({ count: 5 }) // expired
                .mockResolvedValueOnce({ count: 8 }); // idle

            const result = await cleanupIdleAndExpiredSessions(
                WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
                new Date("2026-09-03T12:00:00.000Z"),
            );

            expect(result.expiredCount).toBe(5);
            expect(result.idleCount).toBe(8);
            expect(result.totalCount).toBe(13);
        });
    });
});
