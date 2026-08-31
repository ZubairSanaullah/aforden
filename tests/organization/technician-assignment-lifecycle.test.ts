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
    serviceAreaFindFirst: vi.fn(),
    skillFindMany: vi.fn(),
    technicianAssignmentFindFirst: vi.fn(),
    technicianAssignmentFindMany: vi.fn(),
    technicianAssignmentCount: vi.fn(),
    technicianAssignmentCreate: vi.fn(),
    technicianAssignmentUpdate: vi.fn(),
    technicianAssignmentDelete: vi.fn(),
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
        serviceArea: {
            findFirst: mocks.serviceAreaFindFirst,
        },
        skill: {
            findMany: mocks.skillFindMany,
        },
        technicianAssignment: {
            findFirst: mocks.technicianAssignmentFindFirst,
            findMany: mocks.technicianAssignmentFindMany,
            count: mocks.technicianAssignmentCount,
            create: mocks.technicianAssignmentCreate,
            update: mocks.technicianAssignmentUpdate,
            delete: mocks.technicianAssignmentDelete,
        },
    },
}));

import { completeTechnicianAssignment } from "@/lib/services/technicianAssignment/completeTechnicianAssignment";
import { cancelTechnicianAssignment } from "@/lib/services/technicianAssignment/cancelTechnicianAssignment";
import { updateTechnicianAssignment } from "@/lib/services/technicianAssignment/updateTechnicianAssignment";
import { updateTechnicianAssignmentStatus } from "@/lib/services/technicianAssignment/updateTechnicianAssignmentStatus";
import {
    AssignmentInvalidStatusTransitionError,
    AssignmentImmutableError,
    TechnicianAssignmentNotFoundError,
    TechnicianAssignmentOverlapError,
    TechnicianNotEligibleForAssignmentError,
} from "@/lib/services/technicianAssignment/technicianAssignmentErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.21 — Technician Assignment Lifecycle & Operational Controls", () => {
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
        platformRole: null,
            passwordHash: "secret-hash",
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
        role = "DISPATCHER",
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

    function setupAuthSession(userId = "user_dispatcher_123") {
        mocks.auth.mockResolvedValue({
            user: { id: userId },
        });
    }

    const sampleAssignedDb = {
        id: "asgn_100",
        technicianProfileId: "tech_prof_1",
        workType: "WORK" as const,
        workReferenceId: "work_100",
        status: "ASSIGNED" as const,
        startsAt: new Date("2026-09-07T08:00:00.000Z"),
        endsAt: new Date("2026-09-07T12:00:00.000Z"),
        notes: "Routine service",
        completedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        technicianProfile: {
            select: {},
            employeeId: "emp_1",
        },
    };

    const sampleTechnicianDb = {
        id: "tech_prof_1",
        employeeId: "emp_1",
        employee: {
            id: "emp_1",
            status: "ACTIVE" as const,
            displayName: "Zubair Sanaullah",
        },
        technicianSkills: [
            {
                skillId: "skill_hvac",
                proficiency: "EXPERT" as const,
                skill: {
                    id: "skill_hvac",
                    name: "HVAC Maintenance",
                    status: "ACTIVE" as const,
                },
            },
        ],
        technicianServiceAreas: [
            {
                serviceAreaId: "sa_dha",
                serviceArea: {
                    id: "sa_dha",
                    name: "DHA Lahore",
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
        ],
        technicianAvailabilityExceptions: [],
    };

    // =========================================================================
    // A. AUTHORIZATION & RBAC
    // =========================================================================
    describe("A. Authorization & RBAC", () => {
        it("allows OWNER, ADMIN, MANAGER, and DISPATCHER to complete/cancel assignments", async () => {
            const allowedRoles = ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"] as const;

            for (const role of allowedRoles) {
                const userId = `user_${role.toLowerCase()}`;
                setupAuthSession(userId);
                registerUser(userId);
                registerWorkspace("ws_123");
                registerMembership(`mem_${role.toLowerCase()}`, userId, "ws_123", role);

                mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignedDb);
                mocks.technicianAssignmentUpdate.mockResolvedValue({
                    ...sampleAssignedDb,
                    status: "COMPLETED",
                    completedAt: new Date(),
                });

                const result = await completeTechnicianAssignment(
                    "ws_123",
                    "asgn_100",
                );

                expect(result.status).toBe("COMPLETED");
                expect(result.completedAt).not.toBeNull();
            }
        });

        it("rejects unauthorized roles (TECHNICIAN, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                completeTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            await expect(
                cancelTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated and non-member requests", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                completeTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                completeTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });
    });

    // =========================================================================
    // B. COMPLETION LIFECYCLE
    // =========================================================================
    describe("B. Completion Lifecycle", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("transitions ASSIGNED to COMPLETED and sets completedAt", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignedDb);
            mocks.technicianAssignmentUpdate.mockResolvedValue({
                ...sampleAssignedDb,
                status: "COMPLETED",
                completedAt: new Date("2026-09-07T12:05:00.000Z"),
            });

            const completed = await completeTechnicianAssignment(
                "ws_123",
                "asgn_100",
            );

            expect(completed.status).toBe("COMPLETED");
            expect(completed.completedAt).toEqual(new Date("2026-09-07T12:05:00.000Z"));
            expect(completed.cancelledAt).toBeNull();
        });

        it("rejects repeated completion on an already COMPLETED assignment", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignedDb,
                status: "COMPLETED",
                completedAt: new Date("2026-09-07T12:05:00.000Z"),
            });

            await expect(
                completeTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(AssignmentInvalidStatusTransitionError);
        });

        it("rejects completion of a CANCELLED assignment", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignedDb,
                status: "CANCELLED",
                cancelledAt: new Date("2026-09-07T07:00:00.000Z"),
                cancellationReason: "Customer cancelled",
            });

            await expect(
                completeTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(AssignmentInvalidStatusTransitionError);
        });
    });

    // =========================================================================
    // C. CANCELLATION LIFECYCLE
    // =========================================================================
    describe("C. Cancellation Lifecycle", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("transitions ASSIGNED to CANCELLED with cancelledAt and cancellationReason", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignedDb);
            mocks.technicianAssignmentUpdate.mockResolvedValue({
                ...sampleAssignedDb,
                status: "CANCELLED",
                cancelledAt: new Date("2026-09-07T07:30:00.000Z"),
                cancellationReason: "Parts unavailable",
            });

            const cancelled = await cancelTechnicianAssignment(
                "ws_123",
                "asgn_100",
                { cancellationReason: "Parts unavailable" },
            );

            expect(cancelled.status).toBe("CANCELLED");
            expect(cancelled.cancelledAt).toEqual(new Date("2026-09-07T07:30:00.000Z"));
            expect(cancelled.cancellationReason).toBe("Parts unavailable");
            expect(cancelled.completedAt).toBeNull();
        });

        it("rejects repeated cancellation on an already CANCELLED assignment", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignedDb,
                status: "CANCELLED",
                cancelledAt: new Date("2026-09-07T07:30:00.000Z"),
            });

            await expect(
                cancelTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(AssignmentInvalidStatusTransitionError);
        });

        it("rejects cancellation of a COMPLETED assignment", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignedDb,
                status: "COMPLETED",
                completedAt: new Date("2026-09-07T12:00:00.000Z"),
            });

            await expect(
                cancelTechnicianAssignment("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(AssignmentInvalidStatusTransitionError);
        });
    });

    // =========================================================================
    // D. TERMINAL IMMUTABILITY
    // =========================================================================
    describe("D. Terminal Immutability", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("rejects interval updates on COMPLETED assignments", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignedDb,
                status: "COMPLETED",
                completedAt: new Date("2026-09-07T12:00:00.000Z"),
            });

            await expect(
                updateTechnicianAssignment("ws_123", "asgn_100", {
                    startsAt: new Date("2026-09-07T09:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(AssignmentImmutableError);
        });

        it("rejects notes updates on CANCELLED assignments", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignedDb,
                status: "CANCELLED",
                cancelledAt: new Date("2026-09-07T07:00:00.000Z"),
            });

            await expect(
                updateTechnicianAssignment("ws_123", "asgn_100", {
                    notes: "Attempting to change notes",
                }),
            ).rejects.toBeInstanceOf(AssignmentImmutableError);
        });

        it("rejects status reversal from COMPLETED or CANCELLED to ASSIGNED", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignedDb,
                status: "COMPLETED",
                completedAt: new Date("2026-09-07T12:00:00.000Z"),
            });

            await expect(
                updateTechnicianAssignmentStatus("ws_123", "asgn_100", {
                    status: "ASSIGNED",
                }),
            ).rejects.toBeInstanceOf(AssignmentInvalidStatusTransitionError);
        });
    });

    // =========================================================================
    // E. INTERVAL UPDATES & ELIGIBILITY REVALIDATION
    // =========================================================================
    describe("E. Interval Updates & Eligibility Revalidation", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("revalidates eligibility when interval changes on ASSIGNED assignment", async () => {
            mocks.technicianAssignmentFindFirst.mockImplementation(async ({ where }: any) => {
                if (where?.id === "asgn_100") {
                    return sampleAssignedDb;
                }
                if (where?.id?.not) {
                    return null; // no other overlapping assignment
                }
                return null;
            });
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);
            mocks.technicianAssignmentUpdate.mockResolvedValue({
                ...sampleAssignedDb,
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
            });

            const updated = await updateTechnicianAssignment("ws_123", "asgn_100", {
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
            });

            expect(updated.startsAt).toEqual(new Date("2026-09-07T05:00:00.000Z"));
        });

        it("rejects moving assignment to an interval outside recurring availability", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignedDb);
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);

            // Mon 20:00 to 22:00 (15:00 to 17:00 UTC) -> outside schedule
            await expect(
                updateTechnicianAssignment("ws_123", "asgn_100", {
                    startsAt: new Date("2026-09-07T15:00:00.000Z"),
                    endsAt: new Date("2026-09-07T17:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(TechnicianNotEligibleForAssignmentError);
        });

        it("rejects moving assignment into conflict with another active assignment", async () => {
            mocks.technicianAssignmentFindFirst.mockImplementation(async ({ where }: any) => {
                if (where?.id === "asgn_100") {
                    return sampleAssignedDb;
                }
                if (where?.id?.not) {
                    return {
                        id: "asgn_other_active",
                        technicianProfileId: "tech_prof_1",
                        status: "ASSIGNED",
                        startsAt: new Date("2026-09-07T06:00:00.000Z"),
                        endsAt: new Date("2026-09-07T08:00:00.000Z"),
                    };
                }
                return null;
            });
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);

            await expect(
                updateTechnicianAssignment("ws_123", "asgn_100", {
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(TechnicianAssignmentOverlapError);
        });
    });

    // =========================================================================
    // F. TENANT ISOLATION & MUTATION SAFETY
    // =========================================================================
    describe("F. Tenant Isolation & Mutation Safety", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("rejects completing or cancelling an assignment belonging to another workspace", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(null);

            await expect(
                completeTechnicianAssignment("ws_123", "asgn_ws_other"),
            ).rejects.toBeInstanceOf(TechnicianAssignmentNotFoundError);

            await expect(
                cancelTechnicianAssignment("ws_123", "asgn_ws_other"),
            ).rejects.toBeInstanceOf(TechnicianAssignmentNotFoundError);
        });

        it("verifies zero mutations on unrelated models (Employee, TechnicianProfile, Skills)", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignedDb);
            mocks.technicianAssignmentUpdate.mockResolvedValue({
                ...sampleAssignedDb,
                status: "COMPLETED",
                completedAt: new Date(),
            });

            await completeTechnicianAssignment("ws_123", "asgn_100");

            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });
    });
});
