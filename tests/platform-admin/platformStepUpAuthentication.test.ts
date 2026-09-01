import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";

const {
    authMock,
    userFindUniqueMock,
    profileUpdateMock,
    auditCreateMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    profileUpdateMock: vi.fn(),
    auditCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: userFindUniqueMock,
        },
        platformAdminProfile: {
            update: profileUpdateMock,
        },
        platformAuditLog: {
            create: auditCreateMock,
        },
        $transaction: vi.fn(async (cb) => {
            return cb({
                platformAdminProfile: {
                    update: profileUpdateMock,
                },
                platformAuditLog: {
                    create: auditCreateMock,
                },
            });
        }),
    },
}));

import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
} from "@/lib/services/platform/authorization/types";
import {
    PLATFORM_AUDIT_EVENTS,
} from "@/lib/services/platform/audit";
import {
    PlatformActionValidationError,
    assertTier2StepUpAuthenticated,
    PLATFORM_STEP_UP_MAX_AGE_MS,
} from "@/lib/services/platform/workspaces";
import {
    verifyPlatformStepUpChallenge,
    getPlatformStepUpStatus,
    PlatformStepUpChallengeFailedError,
} from "@/lib/services/platform/security";
import {
    PlatformStepUpAuthenticationRequiredError,
} from "@/lib/services/platform/authorization";
import { POST as stepUpPostRoute, GET as stepUpGetRoute } from "@/app/api/platform/auth/step-up/route";

describe("Phase 1.19.17 — Dangerous-Action Protection (Step-Up Auth Enforcement)", () => {
    const TEST_PASSWORD = "CorrectPlatformPassword123!";
    let testPasswordHash: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        testPasswordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    });

    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN,
        stepUpConfirmedAt: Date | null = new Date()
    ): PlatformAuthorizationContext {
        return {
            userId: "usr_operator_1",
            email: "operator@aforden.com",
            name: "Platform Operator",
            avatarUrl: null,
            platformRole: role,
            profileId: "prof_operator_1",
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt,
            metadata: null,
        };
    }

    function mockDatabaseUser(overrides?: Partial<any>) {
        userFindUniqueMock.mockResolvedValue({
            id: "usr_operator_1",
            email: "operator@aforden.com",
            passwordHash: testPasswordHash,
            status: "ACTIVE",
            platformRole: PlatformRole.PLATFORM_ADMIN,
            platformAdminProfile: {
                id: "prof_operator_1",
                status: PlatformAdminStatus.ACTIVE,
                lastActiveAt: new Date(),
                lastLoginAt: new Date(),
                stepUpConfirmedAt: null,
                metadata: null,
            },
            ...overrides,
        });
    }

    function mockSession(role: PlatformRole = PlatformRole.PLATFORM_ADMIN) {
        authMock.mockResolvedValue({
            user: {
                id: "usr_operator_1",
                email: "operator@aforden.com",
            },
        });
        mockDatabaseUser({ platformRole: role });
    }

    function createMockRequest(
        url: string,
        method: string = "GET",
        body?: unknown
    ): NextRequest {
        return new NextRequest(new URL(url, "https://platform.aforden.com"), {
            method,
            headers: {
                "Content-Type": "application/json",
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
    }

    // =========================================================================
    // 1. Cryptographic Challenge Verification (verifyPlatformStepUpChallenge)
    // =========================================================================
    describe("1. Cryptographic Challenge Verification", () => {
        it("successfully verifies correct password, updates stepUpConfirmedAt, and records audit event", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, null);
            mockDatabaseUser();
            profileUpdateMock.mockResolvedValueOnce({ id: "prof_operator_1", stepUpConfirmedAt: new Date() });
            auditCreateMock.mockResolvedValueOnce({ id: "audit_stepup_1" });

            const result = await verifyPlatformStepUpChallenge(context, {
                password: TEST_PASSWORD,
                reason: "Re-authenticating for tenant suspension.",
            });

            expect(result.stepUpConfirmedAt).toBeInstanceOf(Date);
            expect(result.expiresInSeconds).toBe(300);
            expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

            // Profile update verification
            expect(profileUpdateMock).toHaveBeenCalledWith({
                where: { id: "prof_operator_1" },
                data: { stepUpConfirmedAt: expect.any(Date) },
            });

            // Security audit event verification
            expect(auditCreateMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: PLATFORM_AUDIT_EVENTS.STEP_UP_CHALLENGE_SUCCESS,
                        actorUserId: "usr_operator_1",
                        targetType: "OPERATOR",
                        targetId: "usr_operator_1",
                    }),
                })
            );
        });

        it("fails verification and emits STEP_UP_CHALLENGE_FAILED audit event when password does not match", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, null);
            mockDatabaseUser();
            auditCreateMock.mockResolvedValueOnce({ id: "audit_fail_1" });

            await expect(
                verifyPlatformStepUpChallenge(context, {
                    password: "WrongPassword999!",
                    reason: "Failed attempt.",
                })
            ).rejects.toThrow(PlatformStepUpChallengeFailedError);

            expect(profileUpdateMock).not.toHaveBeenCalled();
            expect(auditCreateMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: PLATFORM_AUDIT_EVENTS.STEP_UP_CHALLENGE_FAILED,
                        actorUserId: "usr_operator_1",
                        targetType: "OPERATOR",
                        targetId: "usr_operator_1",
                    }),
                })
            );
        });

        it("rejects when password is empty or missing with PlatformActionValidationError", async () => {
            const context = createMockPlatformContext();
            await expect(
                verifyPlatformStepUpChallenge(context, { password: "" })
            ).rejects.toThrow(PlatformActionValidationError);

            await expect(
                verifyPlatformStepUpChallenge(context, {} as any)
            ).rejects.toThrow(PlatformActionValidationError);
        });

        it("rejects and audits failure when user account is inactive or profile is missing", async () => {
            const context = createMockPlatformContext();
            mockDatabaseUser({ status: "SUSPENDED" });
            auditCreateMock.mockResolvedValueOnce({ id: "audit_fail_2" });

            await expect(
                verifyPlatformStepUpChallenge(context, { password: TEST_PASSWORD })
            ).rejects.toThrow(PlatformStepUpChallengeFailedError);

            expect(auditCreateMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: PLATFORM_AUDIT_EVENTS.STEP_UP_CHALLENGE_FAILED,
                    }),
                })
            );
        });
    });

    // =========================================================================
    // 2. Server-Side 5-Minute Window Enforcement (assertTier2StepUpAuthenticated)
    // =========================================================================
    describe("2. Server-Side 5-Minute Window Enforcement", () => {
        it("accepts context when stepUpConfirmedAt is recent (< 5 minutes ago)", () => {
            const recent = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, recent);
            expect(() => assertTier2StepUpAuthenticated(context)).not.toThrow();
        });

        it("throws PlatformStepUpAuthenticationRequiredError when stepUpConfirmedAt is null", () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, null);
            expect(() => assertTier2StepUpAuthenticated(context)).toThrow(
                PlatformStepUpAuthenticationRequiredError
            );
        });

        it("throws PlatformStepUpAuthenticationRequiredError when step-up has expired (> 5 minutes)", () => {
            const expired = new Date(Date.now() - (PLATFORM_STEP_UP_MAX_AGE_MS + 1000)); // 5m 1s ago
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, expired);
            expect(() => assertTier2StepUpAuthenticated(context)).toThrow(
                PlatformStepUpAuthenticationRequiredError
            );
        });

        it("throws PlatformStepUpAuthenticationRequiredError on future timestamp / clock skew", () => {
            const futureSkew = new Date(Date.now() + 60 * 1000); // 1 minute in future
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, futureSkew);
            expect(() => assertTier2StepUpAuthenticated(context)).toThrow(
                PlatformStepUpAuthenticationRequiredError
            );
        });
    });

    // =========================================================================
    // 3. Step-Up Status Inspection (getPlatformStepUpStatus)
    // =========================================================================
    describe("3. Step-Up Status Inspection", () => {
        it("returns isStepUpActive = true with remainingSeconds when active", () => {
            const activeTime = new Date(Date.now() - 60 * 1000); // 1 minute ago
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, activeTime);
            const status = getPlatformStepUpStatus(context);

            expect(status.isStepUpActive).toBe(true);
            expect(status.stepUpConfirmedAt).toEqual(activeTime);
            expect(status.remainingSeconds).toBeGreaterThan(230);
            expect(status.remainingSeconds).toBeLessThanOrEqual(240);
        });

        it("returns isStepUpActive = false and remainingSeconds = 0 when expired", () => {
            const expiredTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, expiredTime);
            const status = getPlatformStepUpStatus(context);

            expect(status.isStepUpActive).toBe(false);
            expect(status.remainingSeconds).toBe(0);
        });

        it("returns isStepUpActive = false when stepUpConfirmedAt is null", () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN, null);
            const status = getPlatformStepUpStatus(context);

            expect(status.isStepUpActive).toBe(false);
            expect(status.stepUpConfirmedAt).toBeNull();
            expect(status.remainingSeconds).toBe(0);
        });
    });

    // =========================================================================
    // 4. HTTP Transport Boundary (/api/platform/auth/step-up)
    // =========================================================================
    describe("4. HTTP Transport Boundary (/api/platform/auth/step-up)", () => {
        it("POST /api/platform/auth/step-up: returns 200 on successful challenge", async () => {
            mockSession();
            profileUpdateMock.mockResolvedValueOnce({ id: "prof_operator_1", stepUpConfirmedAt: new Date() });
            auditCreateMock.mockResolvedValueOnce({ id: "audit_ok" });

            const req = createMockRequest("/api/platform/auth/step-up", "POST", {
                password: TEST_PASSWORD,
                reason: "Step-up challenge test.",
            });

            const res = await stepUpPostRoute(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.expiresInSeconds).toBe(300);
            expect(json.data.stepUpConfirmedAt).toBeDefined();
        });

        it("POST /api/platform/auth/step-up: returns 401 when unauthenticated", async () => {
            authMock.mockResolvedValueOnce(null);
            const req = createMockRequest("/api/platform/auth/step-up", "POST", {
                password: TEST_PASSWORD,
            });

            const res = await stepUpPostRoute(req);
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("POST /api/platform/auth/step-up: returns 403 STEP_UP_CHALLENGE_FAILED on invalid credentials", async () => {
            mockSession();
            auditCreateMock.mockResolvedValueOnce({ id: "audit_fail" });

            const req = createMockRequest("/api/platform/auth/step-up", "POST", {
                password: "IncorrectPassword",
            });

            const res = await stepUpPostRoute(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.error.code).toBe("STEP_UP_CHALLENGE_FAILED");
        });

        it("POST /api/platform/auth/step-up: returns 400 when password missing", async () => {
            mockSession();
            const req = createMockRequest("/api/platform/auth/step-up", "POST", {});
            const res = await stepUpPostRoute(req);
            expect(res.status).toBe(400);
        });

        it("GET /api/platform/auth/step-up: returns 200 with step-up status", async () => {
            mockSession();
            const req = createMockRequest("/api/platform/auth/step-up", "GET");
            const res = await stepUpGetRoute(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toHaveProperty("isStepUpActive");
            expect(json.data).toHaveProperty("remainingSeconds");
        });

        it("GET /api/platform/auth/step-up: returns 401 when unauthenticated", async () => {
            authMock.mockResolvedValueOnce(null);
            const req = createMockRequest("/api/platform/auth/step-up", "GET");
            const res = await stepUpGetRoute(req);
            expect(res.status).toBe(401);
        });
    });
});
