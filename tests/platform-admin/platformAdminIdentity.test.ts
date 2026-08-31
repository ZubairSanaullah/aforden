import { describe, it, expect, vi, beforeEach } from "vitest";

const {
    authMock,
    userFindUniqueMock,
    profileUpdateMock,
    workspaceMemberFindFirstMock,
    workspaceMemberFindManyMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    profileUpdateMock: vi.fn(),
    workspaceMemberFindFirstMock: vi.fn(),
    workspaceMemberFindManyMock: vi.fn(),
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
        workspaceMember: {
            findFirst: workspaceMemberFindFirstMock,
            findMany: workspaceMemberFindManyMock,
        },
    },
}));

import {
    getPlatformAuthorizationContext,
    requirePlatformAuthorization,
    touchPlatformAdminLastActive,
    PlatformRole,
    PlatformAdminStatus,
    PlatformUnauthorizedError,
    PlatformAccessDeniedError,
    PlatformAdminInactiveError,
    PlatformSessionExpiredError,
    PLATFORM_SESSION_IDLE_TIMEOUT_MS,
} from "@/lib/services/platform/authorization";
import { toScheduleAppointmentReadModel } from "@/lib/services/schedule/scheduleReadModel";
import { getWorkspaceMembership } from "@/lib/services/workspace/getWorkspaceMembership";
import { getUserWorkspaces } from "@/lib/services/workspace/getUserWorkspaces";

describe("Phase 1.19.2 — Platform Administrator Identity Model Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Identity Resolution & Sanctioned Reader Gateway", () => {
        it("resolves to null when user has no platformRole", async () => {
            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_regular",
                name: "Regular User",
                email: "user@example.com",
                avatarUrl: null,
        status: "ACTIVE",
                platformAdminProfile: null,
            });

            const context = await getPlatformAuthorizationContext("usr_regular");
            expect(context).toBeNull();
        });

        it("resolves to correct PlatformAuthorizationContext for active platform operator", async () => {
            const now = new Date();
            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_owner",
                name: "Platform Owner",
                email: "owner@aforden.com",
                avatarUrl: "https://avatar.com/owner.png",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_OWNER,
                platformAdminProfile: {
                    id: "prof_1",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: now,
                    lastLoginAt: now,
                    stepUpConfirmedAt: null,
                    metadata: { department: "Engineering" },
                },
            });

            const context = await getPlatformAuthorizationContext("usr_owner");
            expect(context).not.toBeNull();
            expect(context?.userId).toBe("usr_owner");
            expect(context?.email).toBe("owner@aforden.com");
            expect(context?.name).toBe("Platform Owner");
            expect(context?.platformRole).toBe(PlatformRole.PLATFORM_OWNER);
            expect(context?.status).toBe(PlatformAdminStatus.ACTIVE);
            expect(context?.metadata).toEqual({ department: "Engineering" });
        });

        it("supports all 6 platform roles correctly", async () => {
            const roles: PlatformRole[] = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of roles) {
                userFindUniqueMock.mockResolvedValueOnce({
                    id: `usr_${role.toLowerCase()}`,
                    name: `Operator ${role}`,
                    email: `${role.toLowerCase()}@aforden.com`,
                    avatarUrl: null,
        status: "ACTIVE",
                    platformRole: role,
                    platformAdminProfile: {
                        id: `prof_${role.toLowerCase()}`,
                        status: PlatformAdminStatus.ACTIVE,
                        lastActiveAt: new Date(),
                        lastLoginAt: null,
                        stepUpConfirmedAt: null,
                        metadata: null,
                    },
                });

                const context = await getPlatformAuthorizationContext(`usr_${role.toLowerCase()}`);
                expect(context?.platformRole).toBe(role);
            }
        });

        it("resolves from NextAuth session when userId parameter is omitted", async () => {
            authMock.mockResolvedValueOnce({
                user: { id: "usr_session_admin", email: "admin@aforden.com" },
            });

            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_session_admin",
                name: "Session Admin",
                email: "admin@aforden.com",
                avatarUrl: null,
        status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: {
                    id: "prof_session",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: new Date(),
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            const context = await getPlatformAuthorizationContext();
            expect(context).not.toBeNull();
            expect(context?.userId).toBe("usr_session_admin");
            expect(context?.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
        });

        it("returns null when NextAuth session is unauthenticated", async () => {
            authMock.mockResolvedValueOnce(null);

            const context = await getPlatformAuthorizationContext();
            expect(context).toBeNull();
        });
    });

    describe("2. Platform Profile Status & Missing Profile Invariants", () => {
        it("denies platform context when PlatformAdminProfile is INACTIVE even if platformRole is set", async () => {
            userFindUniqueMock.mockResolvedValue({
                id: "usr_inactive",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_ADMIN,
                platformAdminProfile: {
                    id: "prof_inactive",
                    status: PlatformAdminStatus.INACTIVE,
                    lastActiveAt: new Date(),
                },
            });

            const context = await getPlatformAuthorizationContext("usr_inactive");
            expect(context).toBeNull();

            authMock.mockResolvedValueOnce({ user: { id: "usr_inactive" } });
            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformAdminInactiveError);
        });

        it("denies platform context when PlatformAdminProfile is SUSPENDED", async () => {
            userFindUniqueMock.mockResolvedValue({
                id: "usr_suspended",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_SECURITY,
                platformAdminProfile: {
                    id: "prof_suspended",
                    status: PlatformAdminStatus.SUSPENDED,
                    lastActiveAt: new Date(),
                },
            });

            const context = await getPlatformAuthorizationContext("usr_suspended");
            expect(context).toBeNull();

            authMock.mockResolvedValueOnce({ user: { id: "usr_suspended" } });
            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformAdminInactiveError);
        });

        it("denies platform context when User.status is SUSPENDED or DEACTIVATED", async () => {
            userFindUniqueMock.mockResolvedValue({
                id: "usr_deactivated",
                status: "DEACTIVATED",
                platformRole: PlatformRole.PLATFORM_OWNER,
                platformAdminProfile: {
                    id: "prof_active",
                    status: PlatformAdminStatus.ACTIVE,
                },
            });

            const context = await getPlatformAuthorizationContext("usr_deactivated");
            expect(context).toBeNull();

            authMock.mockResolvedValueOnce({ user: { id: "usr_deactivated" } });
            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("denies platform context when PlatformAdminProfile record is missing", async () => {
            userFindUniqueMock.mockResolvedValue({
                id: "usr_missing_profile",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_SUPPORT,
                platformAdminProfile: null,
            });

            const context = await getPlatformAuthorizationContext("usr_missing_profile");
            expect(context).toBeNull();

            authMock.mockResolvedValueOnce({ user: { id: "usr_missing_profile" } });
            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("denies platform context when user has no platformRole on requirePlatformAuthorization", async () => {
            authMock.mockResolvedValueOnce({ user: { id: "usr_no_role" } });
            userFindUniqueMock.mockResolvedValueOnce({
                id: "usr_no_role",
                status: "ACTIVE",
                platformAdminProfile: null,
            });

            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformAccessDeniedError);
        });
    });

    describe("3. 30-Minute Idle Timeout & Step-Up Lifecycle", () => {
        it("rejects with PlatformSessionExpiredError when lastActiveAt exceeds 30 minutes", async () => {
            const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
            userFindUniqueMock.mockResolvedValue({
                id: "usr_idle",
                status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_OPERATIONS,
                platformAdminProfile: {
                    id: "prof_idle",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: fortyMinutesAgo,
                },
            });

            const context = await getPlatformAuthorizationContext("usr_idle");
            expect(context).toBeNull();

            authMock.mockResolvedValueOnce({ user: { id: "usr_idle" } });
            await expect(requirePlatformAuthorization()).rejects.toThrow(PlatformSessionExpiredError);
        });

        it("allows skipping idle check when skipIdleCheck option is specified", async () => {
            const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
            userFindUniqueMock.mockResolvedValue({
                id: "usr_idle_skip",
                name: "Skip Idle User",
                email: "skip@aforden.com",
                avatarUrl: null,
        status: "ACTIVE",
                platformRole: PlatformRole.PLATFORM_OPERATIONS,
                platformAdminProfile: {
                    id: "prof_idle_skip",
                    status: PlatformAdminStatus.ACTIVE,
                    lastActiveAt: fortyMinutesAgo,
                    lastLoginAt: null,
                    stepUpConfirmedAt: null,
                    metadata: null,
                },
            });

            const context = await getPlatformAuthorizationContext("usr_idle_skip", { skipIdleCheck: true });
            expect(context).not.toBeNull();
            expect(context?.platformRole).toBe(PlatformRole.PLATFORM_OPERATIONS);

            authMock.mockResolvedValueOnce({ user: { id: "usr_idle_skip" } });
            const requiredContext = await requirePlatformAuthorization({ skipIdleCheck: true });
            expect(requiredContext.platformRole).toBe(PlatformRole.PLATFORM_OPERATIONS);
        });

        it("updates lastActiveAt via touchPlatformAdminLastActive asynchronously", async () => {
            profileUpdateMock.mockResolvedValueOnce({ id: "prof_touch", lastActiveAt: new Date() });

            await touchPlatformAdminLastActive("prof_touch");

            expect(profileUpdateMock).toHaveBeenCalledWith({
                where: { id: "prof_touch" },
                data: expect.objectContaining({
                    lastActiveAt: expect.any(Date),
                }),
            });
        });
    });

    describe("4. Non-Leakage & Workspace Boundary Proofs", () => {
        it("proves platformRole and PlatformAdminProfile never appear in workspace membership queries", async () => {
            workspaceMemberFindFirstMock.mockResolvedValueOnce({
                id: "mem_1",
                role: "DISPATCHER",
                status: "ACTIVE",
                workspaceId: "ws_123",
                workspace: {
                    id: "ws_123",
                    name: "Acme Corp",
                    slug: "acme",
                    logoUrl: null,
                    timezone: "UTC",
                },
            });

            workspaceMemberFindManyMock.mockResolvedValueOnce([
                {
                    id: "mem_1",
                    role: "DISPATCHER",
                    status: "ACTIVE",
                    workspaceId: "ws_123",
                    workspace: {
                        id: "ws_123",
                        name: "Acme Corp",
                        slug: "acme",
                        logoUrl: null,
                        timezone: "UTC",
                    },
                },
            ]);

            // Test 1: getWorkspaceMembership
            const membership = await getWorkspaceMembership("usr_dual", "ws_123");
            expect(membership).not.toBeNull();
            expect((membership as any).platformRole).toBeUndefined();
            expect((membership as any).platformAdminProfile).toBeUndefined();

            // Test 2: getUserWorkspaces
            const userWorkspaces = await getUserWorkspaces("usr_dual");
            expect(userWorkspaces.length).toBe(1);
            expect((userWorkspaces[0] as any).platformRole).toBeUndefined();
            expect((userWorkspaces[0] as any).platformAdminProfile).toBeUndefined();
        });

        it("proves toScheduleAppointmentReadModel does NOT leak platformRole into dispatch projection", () => {
            const fakeAppointmentWithRelations: any = {
                id: "appt_123",
                workspaceId: "ws_123",
                appointmentNumber: "APT-001",
                workOrderId: "wo_123",
                workOrder: {
                    workOrderNumber: "WO-001",
                    title: "Test Job",
                    status: "READY",
                    priority: "NORMAL",
                    customerId: "cust_1",
                    customer: { name: "ACME Corp", customerNumber: "CUST-01" },
                    locationId: "loc_1",
                    location: {
                        name: "HQ",
                        addressLine1: "123 Main St",
                        addressLine2: null,
                        city: "Austin",
                        state: "TX",
                        postalCode: "78701",
                        country: "USA",
                        latitude: null,
                        longitude: null,
                    },
                    assetId: null,
                    asset: null,
                },
                technicianId: "tech_1",
                technician: {
                    employee: {
                        displayName: "John Technician",
                        employeeNumber: "EMP-01",
                    },
                },
                scheduledStart: new Date(),
                scheduledEnd: new Date(),
                durationMinutes: 60,
                timezone: "UTC",
                status: "SCHEDULED",
                dispatchStatus: "DISPATCHED",
                dispatchedAt: new Date(),
                dispatchedByMemberId: "mem_1",
                dispatchedByMember: {
                    id: "mem_1",
                    user: {
                        id: "usr_1",
                        name: "Super Dispatcher",
                        email: "admin@aforden.com",
                        avatarUrl: null,
                    },
                },
                undispatchedAt: null,
                undispatchedByMemberId: null,
                fieldExecutionStartedAt: null,
                cancellationReason: null,
                notes: null,
                metadata: null,
            };

            const projection = toScheduleAppointmentReadModel(fakeAppointmentWithRelations);
            expect(projection.dispatchedByName).toBe("Super Dispatcher");
            expect((projection as any).platformRole).toBeUndefined();
            expect((projection as any).platformAdminProfile).toBeUndefined();
        });
    });

    describe("5. Schema & Enum Integrity", () => {
        it("exports all 6 PlatformRole enum keys matching the architecture standard", () => {
            expect(PlatformRole.PLATFORM_OWNER).toBe("PLATFORM_OWNER");
            expect(PlatformRole.PLATFORM_ADMIN).toBe("PLATFORM_ADMIN");
            expect(PlatformRole.PLATFORM_SUPPORT).toBe("PLATFORM_SUPPORT");
            expect(PlatformRole.PLATFORM_OPERATIONS).toBe("PLATFORM_OPERATIONS");
            expect(PlatformRole.PLATFORM_SECURITY).toBe("PLATFORM_SECURITY");
            expect(PlatformRole.PLATFORM_BILLING).toBe("PLATFORM_BILLING");
        });

        it("exports PlatformAdminStatus enum matching active/inactive/suspended", () => {
            expect(PlatformAdminStatus.ACTIVE).toBe("ACTIVE");
            expect(PlatformAdminStatus.INACTIVE).toBe("INACTIVE");
            expect(PlatformAdminStatus.SUSPENDED).toBe("SUSPENDED");
        });
    });
});
