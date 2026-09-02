import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
    prismaMock: {
        user: {
            findUnique: vi.fn(),
        },
        session: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            deleteMany: vi.fn(),
        },
        workspace: {
            findUnique: vi.fn(),
        },
        workspaceMember: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
        },
        employee: {
            findFirst: vi.fn(),
        },
    },
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: prismaMock,
}));

import {
    WORKSPACE_SESSION_IDLE_TIMEOUT_MS,
    isSessionIdle,
    touchSession,
    validateAndTouchSession,
    getUserSessions,
    cleanupIdleAndExpiredSessions,
    createSlidingSessionAdapter,
} from "@/lib/services/auth/sessionManagement";
import { requireAuthenticatedUser } from "@/lib/auth/api";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { requireActiveUser } from "@/lib/services/auth/requireActiveUser";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import { resolveTechnicianContext } from "@/lib/services/technicianOperations/resolveTechnicianContext";
import { GET as getSessionsRoute } from "@/app/api/auth/sessions/route";

describe("Phase 1.20.2 — Workspace Session Idle & Authentication Hardening Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Finding SEC-01: Sliding-Window Idle Session Timeout Logic", () => {
        it("defines the standard 4-hour idle timeout constant (14,400,000 ms)", () => {
            expect(WORKSPACE_SESSION_IDLE_TIMEOUT_MS).toBe(4 * 60 * 60 * 1000);
            expect(WORKSPACE_SESSION_IDLE_TIMEOUT_MS).toBe(14400000);
        });

        it("correctly identifies active sessions within the 4-hour idle window", () => {
            const now = new Date("2026-09-02T12:00:00.000Z");
            const recentActivity = new Date("2026-09-02T10:30:00.000Z"); // 1.5 hours ago

            const idle = isSessionIdle(recentActivity, WORKSPACE_SESSION_IDLE_TIMEOUT_MS, now);
            expect(idle).toBe(false);
        });

        it("correctly flags sessions exceeding 4 hours of inactivity as idle", () => {
            const now = new Date("2026-09-02T12:00:00.000Z");
            const staleActivity = new Date("2026-09-02T07:59:59.000Z"); // 4 hours and 1 second ago

            const idle = isSessionIdle(staleActivity, WORKSPACE_SESSION_IDLE_TIMEOUT_MS, now);
            expect(idle).toBe(true);
        });

        it("touches active session updatedAt timestamp asynchronously", async () => {
            const now = new Date("2026-09-02T12:00:00.000Z");
            prismaMock.session.update.mockResolvedValue({ id: "sess-1", updatedAt: now } as any);

            await touchSession("sess-1", now);

            expect(prismaMock.session.update).toHaveBeenCalledWith({
                where: { id: "sess-1" },
                data: { updatedAt: now },
            });
        });

        it("validateAndTouchSession validates active session and triggers touch", async () => {
            const now = new Date("2026-09-02T12:00:00.000Z");
            const sessionRecord = {
                id: "sess-valid",
                userId: "user-1",
                expires: new Date("2026-10-02T12:00:00.000Z"),
                createdAt: new Date("2026-09-02T08:00:00.000Z"),
                updatedAt: new Date("2026-09-02T10:00:00.000Z"), // 2 hours ago (within 4h)
            };

            prismaMock.session.findUnique.mockResolvedValue(sessionRecord as any);
            prismaMock.session.update.mockResolvedValue({ ...sessionRecord, updatedAt: now } as any);

            const result = await validateAndTouchSession("sess-valid", { now });

            expect(result.valid).toBe(true);
            expect(result.session?.id).toBe("sess-valid");
            expect(prismaMock.session.update).toHaveBeenCalledWith({
                where: { id: "sess-valid" },
                data: { updatedAt: now },
            });
        });

        it("validateAndTouchSession invalidates and deletes idle-expired session", async () => {
            const now = new Date("2026-09-02T12:00:00.000Z");
            const idleSession = {
                id: "sess-stale",
                userId: "user-1",
                expires: new Date("2026-10-02T12:00:00.000Z"),
                createdAt: new Date("2026-09-01T08:00:00.000Z"),
                updatedAt: new Date("2026-09-02T07:00:00.000Z"), // 5 hours ago (> 4h)
            };

            prismaMock.session.findUnique.mockResolvedValue(idleSession as any);
            prismaMock.session.delete.mockResolvedValue(idleSession as any);

            const result = await validateAndTouchSession("sess-stale", { now });

            expect(result.valid).toBe(false);
            expect(result.reason).toBe("IDLE_TIMEOUT");
            expect(prismaMock.session.delete).toHaveBeenCalledWith({
                where: { id: "sess-stale" },
            });
        });

        it("cleanupIdleAndExpiredSessions removes both hard-expired and idle-expired records", async () => {
            const now = new Date("2026-09-02T12:00:00.000Z");
            const cutoff = new Date("2026-09-02T08:00:00.000Z");

            prismaMock.session.deleteMany
                .mockResolvedValueOnce({ count: 5 }) // Hard expired
                .mockResolvedValueOnce({ count: 12 }); // Idle expired

            const cleanupResult = await cleanupIdleAndExpiredSessions(WORKSPACE_SESSION_IDLE_TIMEOUT_MS, now);

            expect(cleanupResult.expiredCount).toBe(5);
            expect(cleanupResult.idleCount).toBe(12);
            expect(cleanupResult.totalCount).toBe(17);

            expect(prismaMock.session.deleteMany).toHaveBeenNthCalledWith(1, {
                where: { expires: { lte: now } },
            });
            expect(prismaMock.session.deleteMany).toHaveBeenNthCalledWith(2, {
                where: { updatedAt: { lte: cutoff } },
            });
        });
    });

    describe("2. Authentication Contract Assertions (401 Response Boundary)", () => {
        it("returns 401 when no session exists in requireAuthenticatedUser", async () => {
            authMock.mockResolvedValue(null);

            await expect(requireAuthenticatedUser()).rejects.toThrow();
        });

        it("returns 401 when session has empty user id", async () => {
            authMock.mockResolvedValue({ user: { id: "" } });

            await expect(requireAuthenticatedUser()).rejects.toThrow();
        });

        it("returns 401 when user is deleted from database", async () => {
            authMock.mockResolvedValue({ user: { id: "deleted-user" } });
            prismaMock.user.findUnique.mockResolvedValue(null);

            await expect(requireAuthenticatedUser()).rejects.toThrow();
        });

        it("maps UnauthorizedError to standardized HTTP 401 JSON response", () => {
            const response = authorizationErrorResponse(new UnauthorizedError());

            expect(response).not.toBeNull();
            expect(response?.status).toBe(401);
        });

        it("returns 401 in requireActiveUser when session is missing", async () => {
            authMock.mockResolvedValue(null);

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "AuthenticationRequiredError",
            });
        });
    });

    describe("3. Authorization & Status Contract Assertions (403 Response Boundary)", () => {
        it("returns 403 when user is suspended in requireAuthenticatedUser", async () => {
            authMock.mockResolvedValue({ user: { id: "user-suspended" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-suspended",
                status: "SUSPENDED",
                emailVerified: new Date(),
            } as any);

            await expect(requireAuthenticatedUser()).rejects.toThrow();
        });

        it("returns 403 when user email is not verified in requireAuthenticatedUser", async () => {
            authMock.mockResolvedValue({ user: { id: "user-unverified" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-unverified",
                status: "ACTIVE",
                emailVerified: null,
            } as any);

            await expect(requireAuthenticatedUser()).rejects.toThrow();
        });

        it("returns 403 when user is deactivated in requireActiveUser", async () => {
            authMock.mockResolvedValue({ user: { id: "user-deactivated" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-deactivated",
                name: "Deactivated User",
                email: "deactivated@example.com",
                status: "DEACTIVATED",
                emailVerified: new Date(),
                avatarUrl: null,
            } as any);

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "AccountInactiveError",
            });
        });

        it("maps ForbiddenError, WorkspaceAccessDeniedError, and WorkspaceNotFoundError to HTTP 403", () => {
            const resForbidden = authorizationErrorResponse(new ForbiddenError());
            const resDenied = authorizationErrorResponse(new WorkspaceAccessDeniedError());
            const resNotFound = authorizationErrorResponse(new WorkspaceNotFoundError());

            expect(resForbidden?.status).toBe(403);
            expect(resDenied?.status).toBe(403);
            expect(resNotFound?.status).toBe(403);
        });
    });

    describe("4. Workspace Isolation & Membership Contract", () => {
        it("allows active member to access authorized workspace", async () => {
            authMock.mockResolvedValue({ user: { id: "user-owner" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-owner",
                name: "Owner User",
                email: "owner@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);

            prismaMock.workspace.findUnique.mockResolvedValue({
                id: "ws-alpha",
                name: "Alpha Heating & Air",
                slug: "alpha",
                logoUrl: null,
                timezone: "America/New_York",
            } as any);

            prismaMock.workspaceMember.findUnique.mockResolvedValue({
                id: "mem-1",
                userId: "user-owner",
                workspaceId: "ws-alpha",
                role: "OWNER",
                status: "ACTIVE",
            } as any);

            const context = await requireWorkspaceAuthorization("ws-alpha");

            expect(context.user.id).toBe("user-owner");
            expect(context.workspace.id).toBe("ws-alpha");
            expect(context.membership.role).toBe("OWNER");
        });

        it("strictly denies user access to foreign workspace where they have no membership (Cross-Workspace Isolation)", async () => {
            authMock.mockResolvedValue({ user: { id: "user-alpha" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-alpha",
                name: "Alpha User",
                email: "alpha@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);

            prismaMock.workspace.findUnique.mockResolvedValue({
                id: "ws-beta",
                name: "Beta Plumbing",
                slug: "beta",
                logoUrl: null,
                timezone: "America/Chicago",
            } as any);

            // User is NOT a member of ws-beta
            prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

            await expect(requireWorkspaceAuthorization("ws-beta")).rejects.toThrow();
        });

        it("strictly denies user access when their membership status is SUSPENDED or REVOKED", async () => {
            authMock.mockResolvedValue({ user: { id: "user-revoked" } });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-revoked",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);

            prismaMock.workspace.findUnique.mockResolvedValue({
                id: "ws-alpha",
                name: "Alpha Heating & Air",
            } as any);

            prismaMock.workspaceMember.findUnique.mockResolvedValue({
                id: "mem-revoked",
                userId: "user-revoked",
                workspaceId: "ws-alpha",
                role: "TECHNICIAN",
                status: "SUSPENDED",
            } as any);

            await expect(requireWorkspaceAuthorization("ws-alpha")).rejects.toThrow();
        });
    });

    describe("5. Session Information Disclosure Protection", () => {
        it("getUserSessions strictly omits raw sessionToken and secrets from client responses", async () => {
            const now = new Date("2026-09-02T12:00:00.000Z");
            const dbSessions = [
                {
                    id: "sess-1",
                    sessionToken: "raw_secret_bearer_token_1234567890",
                    userId: "user-1",
                    expires: new Date("2026-09-10T12:00:00.000Z"),
                    createdAt: new Date("2026-09-01T12:00:00.000Z"),
                    updatedAt: new Date("2026-09-02T11:00:00.000Z"),
                },
                {
                    id: "sess-2",
                    sessionToken: "raw_secret_bearer_token_0987654321",
                    userId: "user-1",
                    expires: new Date("2026-09-12T12:00:00.000Z"),
                    createdAt: new Date("2026-09-01T14:00:00.000Z"),
                    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
                },
            ];

            prismaMock.session.findMany.mockResolvedValue(dbSessions as any);

            const result = await getUserSessions("user-1", { now });

            expect(result).toHaveLength(2);

            for (const item of result) {
                expect(item).toHaveProperty("id");
                expect(item).toHaveProperty("expires");
                expect(item).toHaveProperty("createdAt");
                expect(item).toHaveProperty("updatedAt");

                // CRITICAL: Must never expose sessionToken or userId
                expect(item).not.toHaveProperty("sessionToken");
                expect((item as any).sessionToken).toBeUndefined();
                expect(item).not.toHaveProperty("userId");
            }
        });

        it("GET /api/auth/sessions returns 401 when session is missing/unauthenticated", async () => {
            authMock.mockResolvedValue(null);

            const response = await getSessionsRoute();
            expect(response.status).toBe(401);

            const body = await response.json();
            expect(body.success).toBe(false);
            expect(body.message).toBe("Authentication is required.");
        });

        it("GET /api/auth/sessions returns only safe session DTO fields to client", async () => {
            authMock.mockResolvedValue({ user: { id: "user-safe" } });

            prismaMock.session.findMany.mockResolvedValue([
                {
                    id: "sess-active",
                    expires: new Date("2026-09-15T12:00:00.000Z"),
                    createdAt: new Date("2026-09-01T12:00:00.000Z"),
                    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
                },
            ] as any);

            const response = await getSessionsRoute();
            expect(response.status).toBe(200);

            const body = await response.json();
            expect(body.success).toBe(true);
            expect(body.sessions).toHaveLength(1);
            expect(body.sessions[0]).toEqual({
                id: "sess-active",
                expires: expect.any(String),
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            });
            expect(body.sessions[0].sessionToken).toBeUndefined();
        });
    });

    describe("6. Employee & Technician Identity Resolution Hardening", () => {
        it("strictly rejects resolveTechnicianContext with 401 when session is idle-expired or missing", async () => {
            authMock.mockResolvedValue(null);

            await expect(resolveTechnicianContext("ws-alpha")).rejects.toThrow(UnauthorizedError);
            expect(prismaMock.employee.findFirst).not.toHaveBeenCalled();
        });

        it("strictly rejects resolveTechnicianContext with 401 when session user id is cleared by idle invalidation", async () => {
            authMock.mockResolvedValue({ user: { id: "" } });

            await expect(resolveTechnicianContext("ws-alpha")).rejects.toThrow(UnauthorizedError);
            expect(prismaMock.employee.findFirst).not.toHaveBeenCalled();
        });

        it("resolves canonical technician context only for authenticated active employee with linked technician profile", async () => {
            authMock.mockResolvedValue({ user: { id: "user-tech-1" } });

            prismaMock.user.findUnique.mockResolvedValue({
                id: "user-tech-1",
                name: "Bob Technician",
                email: "bob@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            } as any);

            prismaMock.workspace.findUnique.mockResolvedValue({
                id: "ws-alpha",
                name: "Alpha HVAC",
                slug: "alpha-hvac",
            } as any);

            prismaMock.workspaceMember.findUnique.mockResolvedValue({
                id: "mem-tech-1",
                userId: "user-tech-1",
                workspaceId: "ws-alpha",
                role: "TECHNICIAN",
                status: "ACTIVE",
            } as any);

            prismaMock.employee.findFirst.mockResolvedValue({
                id: "emp-101",
                workspaceId: "ws-alpha",
                workspaceMemberId: "mem-tech-1",
                displayName: "Bob T.",
                status: "ACTIVE",
                technicianProfile: {
                    id: "tech-prof-501",
                },
            } as any);

            const techContext = await resolveTechnicianContext("ws-alpha");

            expect(techContext.userId).toBe("user-tech-1");
            expect(techContext.workspaceId).toBe("ws-alpha");
            expect(techContext.membershipId).toBe("mem-tech-1");
            expect(techContext.role).toBe("TECHNICIAN");
            expect(techContext.employeeId).toBe("emp-101");
            expect(techContext.technicianProfileId).toBe("tech-prof-501");
            expect(techContext.technicianName).toBe("Bob T.");
        });
    });

    describe("7. Auth.js Adapter Multi-Device Request-Scoped Session Isolation", () => {
        const USER_ID = "user-multi-device-123";
        const userDbRecord = {
            id: USER_ID,
            name: "Multi User",
            email: "multi@example.com",
            status: "ACTIVE",
            emailVerified: new Date("2026-09-01T00:00:00.000Z"),
        };

        const sessionDesktop = {
            id: "sess-desktop-1",
            sessionToken: "token-desktop-abc",
            userId: USER_ID,
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            updatedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago (FRESH)
            user: userDbRecord,
        };

        const sessionMobile = {
            id: "sess-mobile-2",
            sessionToken: "token-mobile-xyz",
            userId: USER_ID,
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago (IDLE EXPIRED > 4h)
            user: userDbRecord,
        };

        it("createSlidingSessionAdapter getSessionAndUser resolves and touches fresh desktop session without affecting mobile", async () => {
            const adapter = createSlidingSessionAdapter(prismaMock as any);

            prismaMock.session.findUnique.mockImplementation(async ({ where }: any) => {
                if (where.sessionToken === "token-desktop-abc") {
                    return sessionDesktop as any;
                }
                if (where.sessionToken === "token-mobile-xyz") {
                    return sessionMobile as any;
                }
                return null;
            });

            prismaMock.session.update.mockResolvedValue({ ...sessionDesktop, updatedAt: new Date() } as any);

            // Desktop request presenting token-desktop-abc
            const result = await adapter.getSessionAndUser?.("token-desktop-abc");

            expect(result).not.toBeNull();
            expect(result?.user.id).toBe(USER_ID);
            expect(result?.session.sessionToken).toBe("token-desktop-abc");

            // Proves ONLY desktop session was touched
            expect(prismaMock.session.update).toHaveBeenCalledWith({
                where: { sessionToken: "token-desktop-abc" },
                data: { updatedAt: expect.any(Date) },
            });
            expect(prismaMock.session.update).not.toHaveBeenCalledWith(
                expect.objectContaining({ where: { sessionToken: "token-mobile-xyz" } }),
            );
            expect(prismaMock.session.delete).not.toHaveBeenCalled();
        });

        it("createSlidingSessionAdapter getSessionAndUser rejects and deletes idle mobile session without touching desktop session", async () => {
            const adapter = createSlidingSessionAdapter(prismaMock as any);

            prismaMock.session.findUnique.mockImplementation(async ({ where }: any) => {
                if (where.sessionToken === "token-desktop-abc") {
                    return sessionDesktop as any;
                }
                if (where.sessionToken === "token-mobile-xyz") {
                    return sessionMobile as any;
                }
                return null;
            });

            prismaMock.session.delete.mockResolvedValue(sessionMobile as any);

            // Mobile request presenting token-mobile-xyz
            const result = await adapter.getSessionAndUser?.("token-mobile-xyz");

            expect(result).toBeNull();

            // Proves ONLY the idle mobile session was deleted
            expect(prismaMock.session.delete).toHaveBeenCalledWith({
                where: { sessionToken: "token-mobile-xyz" },
            });
            // Desktop session is never touched or deleted during mobile invalidation
            expect(prismaMock.session.delete).not.toHaveBeenCalledWith(
                expect.objectContaining({ where: { sessionToken: "token-desktop-abc" } }),
            );
        });
    });
});
