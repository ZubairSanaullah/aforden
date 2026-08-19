import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    userDelete: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workspaceMemberDelete: vi.fn(),
    employeeFindUnique: vi.fn(),
    employeeFindFirst: vi.fn(),
    employeeDelete: vi.fn(),
    technicianProfileFindUnique: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    technicianProfileFindMany: vi.fn(),
    technicianProfileCount: vi.fn(),
    technicianProfileCreate: vi.fn(),
    technicianProfileDelete: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
            delete: mocks.userDelete,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
            delete: mocks.workspaceMemberDelete,
        },
        employee: {
            findUnique: mocks.employeeFindUnique,
            findFirst: mocks.employeeFindFirst,
            delete: mocks.employeeDelete,
        },
        technicianProfile: {
            findUnique: mocks.technicianProfileFindUnique,
            findFirst: mocks.technicianProfileFindFirst,
            findMany: mocks.technicianProfileFindMany,
            count: mocks.technicianProfileCount,
            create: mocks.technicianProfileCreate,
            delete: mocks.technicianProfileDelete,
        },
    },
}));

import { getTechnicianAvailabilityCheck } from "@/lib/services/technicianProfile/getTechnicianAvailabilityCheck";
import { getTechnicianAvailabilityCheckByEmployee } from "@/lib/services/technicianProfile/getTechnicianAvailabilityCheckByEmployee";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.17 — Technician Point-in-Time Availability & Scheduling Eligibility", () => {
    let membersMap: Map<string, any>;
    let usersMap: Map<string, any>;
    let workspacesMap: Map<string, any>;

    beforeEach(() => {
        vi.clearAllMocks();
        membersMap = new Map();
        usersMap = new Map();
        workspacesMap = new Map();

        mocks.userFindUnique.mockImplementation(
            async ({ where }: { where: { id: string } }) => {
                return usersMap.get(where.id) || null;
            },
        );

        mocks.workspaceFindUnique.mockImplementation(
            async ({ where }: { where: { id: string } }) => {
                return workspacesMap.get(where.id) || null;
            },
        );

        mocks.workspaceMemberFindUnique.mockImplementation(
            async ({ where }: any) => {
                if (where.userId_workspaceId) {
                    const key = `${where.userId_workspaceId.userId}_${where.userId_workspaceId.workspaceId}`;
                    return membersMap.get(key) || null;
                }
                if (where.id) {
                    return membersMap.get(where.id) || null;
                }
                return null;
            },
        );
    });

    function registerUser(
        userId = "user_admin_123",
        name = "Admin User",
        status = "ACTIVE",
    ) {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed-pwd-secret",
            emailVerified: new Date(),
            avatarUrl: null,
            status: status as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        usersMap.set(userId, user);
        return user;
    }

    function registerWorkspace(
        workspaceId = "ws_123",
        name = "Acme HVAC Pros",
        timezone = "Asia/Karachi",
    ) {
        const workspace = {
            id: workspaceId,
            name,
            slug: "acme-hvac",
            logoUrl: null,
            timezone,
        };
        workspacesMap.set(workspaceId, workspace);
        return workspace;
    }

    function registerMembership(
        memberId: string,
        userId: string,
        workspaceId: string,
        role = "ADMIN",
        status = "ACTIVE",
        employee: any = null,
    ) {
        const member: WorkspaceMember = {
            id: memberId,
            userId,
            workspaceId,
            role: role as any,
            status: status as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        membersMap.set(memberId, { ...member, employee });
        membersMap.set(`${userId}_${workspaceId}`, { ...member, employee });
        return member;
    }

    function setupAuthSession(userId = "user_admin_123") {
        mocks.auth.mockResolvedValue({
            user: { id: userId },
        });
    }

    // 2026-09-07 is a MONDAY.
    // In UTC: 2026-09-07T05:00:00.000Z is 10:00 AM in Asia/Karachi (UTC+5).
    // In UTC: 2026-09-07T07:00:00.000Z is 12:00 PM in Asia/Karachi (UTC+5).
    const sampleAvailableTechnicianDb = {
        id: "tech_prof_1",
        employeeId: "emp_1",
        employee: {
            id: "emp_1",
            status: "ACTIVE" as const,
        },
        technicianSkills: [
            {
                skill: {
                    status: "ACTIVE" as const,
                },
            },
        ],
        technicianServiceAreas: [
            {
                serviceArea: {
                    status: "ACTIVE" as const,
                },
            },
        ],
        technicianAvailabilities: [
            {
                id: "avail_mon",
                dayOfWeek: "MONDAY" as const,
                startTime: "08:00",
                endTime: "17:00",
                status: "ACTIVE" as const,
            },
            {
                id: "avail_tue",
                dayOfWeek: "TUESDAY" as const,
                startTime: "08:00",
                endTime: "17:00",
                status: "ACTIVE" as const,
            },
        ],
        technicianAvailabilityExceptions: [],
    };

    // =========================================================================
    // 1. AUTHORIZATION TESTS
    // =========================================================================
    describe("Authorization & RBAC", () => {
        it("allows OWNER to perform availability check", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAvailableTechnicianDb,
            );

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z", // Mon 10:00 Karachi
                    endsAt: "2026-09-07T07:00:00.000Z", // Mon 12:00 Karachi
                },
            );

            expect(result).not.toBeNull();
            expect(result?.isAvailable).toBe(true);
        });

        it("allows ADMIN to perform availability check", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAvailableTechnicianDb,
            );

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(true);
        });

        it("allows MANAGER to perform availability check (MEMBERS_VIEW)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAvailableTechnicianDb,
            );

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(true);
        });

        it("rejects unauthorized roles (TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                getTechnicianAvailabilityCheck("ws_123", "tech_prof_1", {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                getTechnicianAvailabilityCheck("ws_123", "tech_prof_1", {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                }),
            ).rejects.toBeInstanceOf(UnauthorizedError);
        });

        it("rejects non-member request", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                getTechnicianAvailabilityCheck("ws_123", "tech_prof_1", {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });
    });

    // =========================================================================
    // 2. INPUT VALIDATION TESTS
    // =========================================================================
    describe("Input Validation", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAvailableTechnicianDb,
            );
        });

        it("flags INVALID_REQUESTED_INTERVAL when startsAt === endsAt", async () => {
            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T05:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("INVALID_REQUESTED_INTERVAL");
        });

        it("flags INVALID_REQUESTED_INTERVAL when startsAt > endsAt", async () => {
            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T07:00:00.000Z",
                    endsAt: "2026-09-07T05:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("INVALID_REQUESTED_INTERVAL");
        });
    });

    // =========================================================================
    // 3. EMPLOYEE STATUS & PROFILE PREREQUISITES
    // =========================================================================
    describe("Employee Status & Profile Prerequisites", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("flags EMPLOYEE_NOT_ACTIVE when employee status is ON_LEAVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleAvailableTechnicianDb,
                employee: {
                    id: "emp_1",
                    status: "ON_LEAVE" as const,
                },
            });

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("EMPLOYEE_NOT_ACTIVE");
        });

        it("flags TECHNICIAN_PROFILE_MISSING when checking by employee with no profile", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: "emp_no_profile",
                status: "ACTIVE" as const,
                technicianProfile: null,
            });

            const result = await getTechnicianAvailabilityCheckByEmployee(
                "ws_123",
                "emp_no_profile",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.hasTechnicianProfile).toBe(false);
            expect(result?.blockers).toContain("TECHNICIAN_PROFILE_MISSING");
        });
    });

    // =========================================================================
    // 4. RECURRING AVAILABILITY EVALUATION
    // =========================================================================
    describe("Recurring Schedule Evaluation", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123", "Acme HVAC", "Asia/Karachi");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("evaluates request inside schedule as available", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAvailableTechnicianDb,
            );

            // Mon 10:00 to 12:00 in Asia/Karachi (inside Mon 08:00-17:00)
            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(true);
            expect(result?.matchingAvailability).toHaveLength(1);
            expect(result?.matchingAvailability[0].id).toBe("avail_mon");
            expect(result?.blockers).toEqual([]);
        });

        it("flags OUTSIDE_RECURRING_AVAILABILITY for request outside schedule hours", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAvailableTechnicianDb,
            );

            // Mon 20:00 to 22:00 in Asia/Karachi (15:00 to 17:00 UTC)
            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T15:00:00.000Z",
                    endsAt: "2026-09-07T17:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("OUTSIDE_RECURRING_AVAILABILITY");
        });

        it("evaluates multiple touching windows (08:00-12:00 and 12:00-17:00) as continuous coverage", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleAvailableTechnicianDb,
                technicianAvailabilities: [
                    {
                        id: "w1",
                        dayOfWeek: "MONDAY" as const,
                        startTime: "08:00",
                        endTime: "12:00",
                        status: "ACTIVE" as const,
                    },
                    {
                        id: "w2",
                        dayOfWeek: "MONDAY" as const,
                        startTime: "12:00",
                        endTime: "17:00",
                        status: "ACTIVE" as const,
                    },
                ],
            });

            // Mon 11:00 to 14:00 Karachi (06:00 to 09:00 UTC) - spans both touching windows
            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T06:00:00.000Z",
                    endsAt: "2026-09-07T09:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(true);
            expect(result?.matchingAvailability).toHaveLength(2);
            expect(result?.blockers).toEqual([]);
        });

        it("flags OUTSIDE_RECURRING_AVAILABILITY when a gap exists between windows (08:00-12:00 and 13:00-17:00)", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleAvailableTechnicianDb,
                technicianAvailabilities: [
                    {
                        id: "w1",
                        dayOfWeek: "MONDAY" as const,
                        startTime: "08:00",
                        endTime: "12:00",
                        status: "ACTIVE" as const,
                    },
                    {
                        id: "w2",
                        dayOfWeek: "MONDAY" as const,
                        startTime: "13:00",
                        endTime: "17:00",
                        status: "ACTIVE" as const,
                    },
                ],
            });

            // Mon 11:00 to 14:00 Karachi (06:00 to 09:00 UTC) - covers the 12:00-13:00 gap
            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T06:00:00.000Z",
                    endsAt: "2026-09-07T09:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("OUTSIDE_RECURRING_AVAILABILITY");
        });
    });

    // =========================================================================
    // 5. EXCEPTION EVALUATION & OVERRIDE
    // =========================================================================
    describe("Exception Evaluation & Override", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123", "Acme HVAC", "Asia/Karachi");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("blocks availability when an active exception overlaps the requested interval", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleAvailableTechnicianDb,
                technicianAvailabilityExceptions: [
                    {
                        id: "exc_doctor",
                        type: "TIME_OFF" as const,
                        title: "Doctor Appointment",
                        startsAt: new Date("2026-09-07T06:00:00.000Z"), // 11:00 Karachi
                        endsAt: new Date("2026-09-07T08:00:00.000Z"), // 13:00 Karachi
                        isAllDay: false,
                        status: "ACTIVE" as const,
                    },
                ],
            });

            // Mon 10:00 to 12:00 Karachi (05:00 to 07:00 UTC) overlaps doctor appointment
            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("BLOCKED_BY_EXCEPTION");
            expect(result?.blockingExceptions).toHaveLength(1);
            expect(result?.blockingExceptions[0].id).toBe("exc_doctor");
        });

        it("does NOT block availability if the exception is CANCELLED", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleAvailableTechnicianDb,
                technicianAvailabilityExceptions: [
                    {
                        id: "exc_cancelled",
                        type: "TIME_OFF" as const,
                        title: "Cancelled Vacation",
                        startsAt: new Date("2026-09-07T00:00:00.000Z"),
                        endsAt: new Date("2026-09-07T23:59:59.000Z"),
                        isAllDay: true,
                        status: "CANCELLED" as const,
                    },
                ],
            });

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(true);
            expect(result?.blockingExceptions).toHaveLength(0);
            expect(result?.blockers).toEqual([]);
        });

        it("blocks full day when an active all-day exception exists", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleAvailableTechnicianDb,
                technicianAvailabilityExceptions: [
                    {
                        id: "exc_holiday",
                        type: "HOLIDAY" as const,
                        title: "Public Holiday",
                        startsAt: new Date("2026-09-06T19:00:00.000Z"), // 00:00 Karachi on Sep 7
                        endsAt: new Date("2026-09-07T19:00:00.000Z"), // 00:00 Karachi on Sep 8
                        isAllDay: true,
                        status: "ACTIVE" as const,
                    },
                ],
            });

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("BLOCKED_BY_EXCEPTION");
        });
    });

    // =========================================================================
    // 6. MULTIPLE BLOCKERS & DETERMINISTIC ORDERING
    // =========================================================================
    describe("Multiple Blockers & Deterministic Ordering", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("returns blockers in exact deterministic order", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                id: "tech_prof_1",
                employeeId: "emp_1",
                employee: {
                    id: "emp_1",
                    status: "TERMINATED" as const, // EMPLOYEE_NOT_ACTIVE
                },
                technicianSkills: [], // NO_ACTIVE_SKILLS
                technicianServiceAreas: [], // NO_ACTIVE_SERVICE_AREAS
                technicianAvailabilities: [], // NO_RECURRING_AVAILABILITY & OUTSIDE_RECURRING_AVAILABILITY
                technicianAvailabilityExceptions: [
                    {
                        id: "exc_1",
                        type: "UNAVAILABLE" as const,
                        title: "Block",
                        startsAt: new Date("2026-09-07T00:00:00.000Z"),
                        endsAt: new Date("2026-09-07T23:59:59.000Z"),
                        isAllDay: true,
                        status: "ACTIVE" as const,
                    },
                ], // BLOCKED_BY_EXCEPTION
            });

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.blockers).toEqual([
                "EMPLOYEE_NOT_ACTIVE",
                "NO_ACTIVE_SKILLS",
                "NO_ACTIVE_SERVICE_AREAS",
                "NO_RECURRING_AVAILABILITY",
                "OUTSIDE_RECURRING_AVAILABILITY",
                "BLOCKED_BY_EXCEPTION",
            ]);
        });
    });

    // =========================================================================
    // 7. TENANT ISOLATION TESTS
    // =========================================================================
    describe("Tenant Isolation", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("returns null when querying availability for a technician in another workspace", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_other_ws",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result).toBeNull();
            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: "tech_prof_other_ws",
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                }),
            );
        });
    });

    // =========================================================================
    // 8. SECURITY & MUTATION SAFETY
    // =========================================================================
    describe("Security & Mutation Safety", () => {
        it("never leaks passwords, tokens, or sessions and executes zero database mutations", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAvailableTechnicianDb,
            );

            const result = await getTechnicianAvailabilityCheck(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect((result as any).passwordHash).toBeUndefined();
            expect((result as any).sessions).toBeUndefined();
            expect((result as any).accounts).toBeUndefined();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });
    });
});
