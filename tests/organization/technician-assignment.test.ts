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

import { createTechnicianAssignment } from "@/lib/services/technicianAssignment/createTechnicianAssignment";
import { getTechnicianAssignment } from "@/lib/services/technicianAssignment/getTechnicianAssignment";
import { getTechnicianAssignments } from "@/lib/services/technicianAssignment/getTechnicianAssignments";
import { getTechnicianAssignmentsByTechnician } from "@/lib/services/technicianAssignment/getTechnicianAssignmentsByTechnician";
import { getTechnicianAssignmentsByWork } from "@/lib/services/technicianAssignment/getTechnicianAssignmentsByWork";
import { updateTechnicianAssignment } from "@/lib/services/technicianAssignment/updateTechnicianAssignment";
import { updateTechnicianAssignmentStatus } from "@/lib/services/technicianAssignment/updateTechnicianAssignmentStatus";
import { cancelTechnicianAssignment } from "@/lib/services/technicianAssignment/cancelTechnicianAssignment";
import {
    InvalidTechnicianProfileError,
    TechnicianAssignmentAlreadyExistsError,
    TechnicianAssignmentOverlapError,
    TechnicianAssignmentNotFoundError,
    TechnicianNotEligibleForAssignmentError,
} from "@/lib/services/technicianAssignment/technicianAssignmentErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.19 — Technician Assignment Foundation", () => {
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

    const sampleActiveServiceArea = {
        id: "sa_dha",
        name: "DHA Lahore",
        status: "ACTIVE" as const,
    };

    const sampleHvacSkill = {
        id: "skill_hvac",
        name: "HVAC Maintenance",
        status: "ACTIVE" as const,
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
    // 1. AUTHORIZATION TESTS
    // =========================================================================
    describe("Authorization & RBAC", () => {
        it("allows OWNER, ADMIN, MANAGER, and DISPATCHER to create assignment", async () => {
            const allowedRoles = ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"] as const;

            for (const role of allowedRoles) {
                const userId = `user_${role.toLowerCase()}`;
                setupAuthSession(userId);
                registerUser(userId);
                registerWorkspace("ws_123");
                registerMembership(`mem_${role.toLowerCase()}`, userId, "ws_123", role);

                mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);
                mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
                mocks.skillFindMany.mockResolvedValue([sampleHvacSkill]);
                mocks.technicianAssignmentFindFirst.mockResolvedValue(null);
                mocks.technicianAssignmentCreate.mockResolvedValue({
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_ref_123",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                    notes: "Handle carefully",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                const result = await createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_ref_123",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                    serviceAreaId: "sa_dha",
                    requiredSkillIds: ["skill_hvac"],
                });

                expect(result.id).toBe("asgn_1");
            }
        });

        it("rejects unauthorized roles (TECHNICIAN, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_ref_123",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_ref_123",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(UnauthorizedError);
        });

        it("rejects non-member request", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_ref_123",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });
    });

    // =========================================================================
    // 2. CREATION & ELIGIBILITY INTEGRATION
    // =========================================================================
    describe("Creation & Eligibility Integration", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("rejects assignment when technician profile does not exist in workspace", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_nonexistent",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(InvalidTechnicianProfileError);
        });

        it("rejects assignment when technician is not eligible (missing required skill)", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);
            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
            mocks.skillFindMany.mockResolvedValue([
                sampleHvacSkill,
                { id: "skill_plumb", name: "Plumbing", status: "ACTIVE" },
            ]);

            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                    serviceAreaId: "sa_dha",
                    requiredSkillIds: ["skill_hvac", "skill_plumb"],
                }),
            ).rejects.toBeInstanceOf(TechnicianNotEligibleForAssignmentError);
        });

        it("rejects assignment when technician is unavailable (outside schedule)", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);

            // Mon 20:00 to 22:00 in Asia/Karachi (15:00 to 17:00 UTC)
            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    startsAt: new Date("2026-09-07T15:00:00.000Z"),
                    endsAt: new Date("2026-09-07T17:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(TechnicianNotEligibleForAssignmentError);
        });
    });

    // =========================================================================
    // 3. DUPLICATE & OVERLAP PROTECTION
    // =========================================================================
    describe("Duplicate & Overlap Protection", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);
        });

        it("rejects duplicate active assignment for the same technician and work item", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValueOnce({
                id: "asgn_existing",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_1",
                status: "ASSIGNED",
            });

            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(TechnicianAssignmentAlreadyExistsError);
        });

        it("rejects overlapping active assignments for the same technician", async () => {
            // First call: duplicate check -> null
            mocks.technicianAssignmentFindFirst.mockResolvedValueOnce(null);
            // Second call: overlap check -> returns overlapping assignment
            mocks.technicianAssignmentFindFirst.mockResolvedValueOnce({
                id: "asgn_overlap",
                technicianProfileId: "tech_prof_1",
                status: "ASSIGNED",
                startsAt: new Date("2026-09-07T06:00:00.000Z"),
                endsAt: new Date("2026-09-07T08:00:00.000Z"),
            });

            await expect(
                createTechnicianAssignment("ws_123", {
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_2",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                }),
            ).rejects.toBeInstanceOf(TechnicianAssignmentOverlapError);
        });

        it("allows touching intervals for the same technician", async () => {
            // Duplicate check -> null, Overlap check -> null
            mocks.technicianAssignmentFindFirst.mockResolvedValue(null);
            mocks.technicianAssignmentCreate.mockResolvedValue({
                id: "asgn_touching",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_touching",
                status: "ASSIGNED",
                startsAt: new Date("2026-09-07T07:00:00.000Z"),
                endsAt: new Date("2026-09-07T09:00:00.000Z"),
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await createTechnicianAssignment("ws_123", {
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_touching",
                startsAt: new Date("2026-09-07T07:00:00.000Z"),
                endsAt: new Date("2026-09-07T09:00:00.000Z"),
            });

            expect(result.id).toBe("asgn_touching");
        });
    });

    // =========================================================================
    // 4. RETRIEVAL TESTS
    // =========================================================================
    describe("Retrieval Services", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("retrieves a single assignment by ID", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                id: "asgn_1",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_123",
                status: "ASSIGNED",
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
                notes: "Check compressor",
                createdAt: new Date(),
                updatedAt: new Date(),
                technicianProfile: {
                    employeeId: "emp_1",
                },
            });

            const result = await getTechnicianAssignment("ws_123", "asgn_1");

            expect(result).not.toBeNull();
            expect(result?.id).toBe("asgn_1");
            expect(result?.employeeId).toBe("emp_1");
        });

        it("retrieves paginated list of assignments", async () => {
            mocks.technicianAssignmentCount.mockResolvedValue(1);
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                {
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    technicianProfile: {
                        employeeId: "emp_1",
                    },
                },
            ]);

            const results = await getTechnicianAssignments("ws_123", {
                page: 1,
                pageSize: 10,
            });

            expect(results.items).toHaveLength(1);
            expect(results.pagination.total).toBe(1);
        });

        it("retrieves assignments by technician profile ID", async () => {
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                {
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    technicianProfile: {
                        employeeId: "emp_1",
                    },
                },
            ]);

            const results = await getTechnicianAssignmentsByTechnician(
                "ws_123",
                "tech_prof_1",
            );

            expect(results).toHaveLength(1);
            expect(results[0].technicianProfileId).toBe("tech_prof_1");
        });

        it("retrieves assignments by work reference ID", async () => {
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                {
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_100",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T05:00:00.000Z"),
                    endsAt: new Date("2026-09-07T07:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    technicianProfile: {
                        employeeId: "emp_1",
                    },
                },
            ]);

            const results = await getTechnicianAssignmentsByWork("ws_123", {
                workType: "WORK",
                workReferenceId: "work_100",
            });

            expect(results).toHaveLength(1);
            expect(results[0].workReferenceId).toBe("work_100");
        });
    });

    // =========================================================================
    // 5. UPDATE & STATUS TRANSITIONS
    // =========================================================================
    describe("Update & Status Transitions", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("updates assignment notes", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                id: "asgn_1",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_1",
                status: "ASSIGNED",
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
                notes: "Initial note",
                technicianProfile: {
                    employeeId: "emp_1",
                },
            });

            mocks.technicianAssignmentUpdate.mockResolvedValue({
                id: "asgn_1",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_1",
                status: "ASSIGNED",
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
                notes: "Updated note",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await updateTechnicianAssignment("ws_123", "asgn_1", {
                notes: "Updated note",
            });

            expect(result.notes).toBe("Updated note");
        });

        it("updates status to COMPLETED", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                id: "asgn_1",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_1",
                status: "ASSIGNED",
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
                notes: "Initial note",
                technicianProfile: {
                    employeeId: "emp_1",
                },
            });

            mocks.technicianAssignmentUpdate.mockResolvedValue({
                id: "asgn_1",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_1",
                status: "COMPLETED",
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
                notes: "Updated note",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const statusResult = await updateTechnicianAssignmentStatus(
                "ws_123",
                "asgn_1",
                { status: "COMPLETED" },
            );

            expect(statusResult.status).toBe("COMPLETED");
        });

        it("cancels assignment setting status to CANCELLED", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                id: "asgn_1",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_1",
                status: "ASSIGNED",
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
                notes: null,
                technicianProfile: {
                    employeeId: "emp_1",
                },
            });

            mocks.technicianAssignmentUpdate.mockResolvedValue({
                id: "asgn_1",
                technicianProfileId: "tech_prof_1",
                workType: "WORK",
                workReferenceId: "work_1",
                status: "CANCELLED",
                startsAt: new Date("2026-09-07T05:00:00.000Z"),
                endsAt: new Date("2026-09-07T07:00:00.000Z"),
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const cancelResult = await cancelTechnicianAssignment(
                "ws_123",
                "asgn_1",
            );

            expect(cancelResult.status).toBe("CANCELLED");
        });
    });

    // =========================================================================
    // 6. TENANT ISOLATION & MUTATION SAFETY
    // =========================================================================
    describe("Tenant Isolation & Mutation Safety", () => {
        it("returns null when querying assignment in another workspace", async () => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");

            mocks.technicianAssignmentFindFirst.mockResolvedValue(null);

            const result = await getTechnicianAssignment(
                "ws_123",
                "asgn_other_ws",
            );

            expect(result).toBeNull();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
        });
    });
});
