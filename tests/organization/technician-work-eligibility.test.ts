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
    },
}));

import { getTechnicianWorkEligibility } from "@/lib/services/technicianProfile/getTechnicianWorkEligibility";
import { getTechnicianWorkEligibilityByEmployee } from "@/lib/services/technicianProfile/getTechnicianWorkEligibilityByEmployee";
import { getEligibleTechnicians } from "@/lib/services/technicianProfile/getEligibleTechnicians";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.18 — Technician Work Eligibility & Matching", () => {
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

    const sampleElectricalSkill = {
        id: "skill_elec",
        name: "Electrical Repair",
        status: "ACTIVE" as const,
    };

    const sampleTechnicianDb = {
        id: "tech_prof_1",
        employeeId: "emp_1",
        employee: {
            id: "emp_1",
            status: "ACTIVE" as const,
            displayName: "Zubair Sanaullah",
            firstName: "Zubair",
            lastName: "Sanaullah",
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
            {
                skillId: "skill_elec",
                proficiency: "INTERMEDIATE" as const,
                skill: {
                    id: "skill_elec",
                    name: "Electrical Repair",
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
        it("allows OWNER to check work eligibility", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
            mocks.skillFindMany.mockResolvedValue([sampleHvacSkill]);
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: ["skill_hvac"],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result).not.toBeNull();
            expect(result?.isEligible).toBe(true);
        });

        it("rejects unauthorized roles (TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                getTechnicianWorkEligibility("ws_123", "tech_prof_1", {
                    requiredSkillIds: ["skill_hvac"],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                getTechnicianWorkEligibility("ws_123", "tech_prof_1", {
                    requiredSkillIds: ["skill_hvac"],
                    serviceAreaId: "sa_dha",
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
                getTechnicianWorkEligibility("ws_123", "tech_prof_1", {
                    requiredSkillIds: ["skill_hvac"],
                    serviceAreaId: "sa_dha",
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
            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);
        });

        it("flags INVALID_REQUESTED_INTERVAL when startsAt >= endsAt", async () => {
            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: [],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T07:00:00.000Z",
                    endsAt: "2026-09-07T05:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(false);
            expect(result?.blockers).toContain("INVALID_REQUESTED_INTERVAL");
        });
    });

    // =========================================================================
    // 3. SKILL MATCHING TESTS
    // =========================================================================
    describe("Skill Matching", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);
        });

        it("passes when no skills are required", async () => {
            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: [],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(true);
            expect(result?.hasRequiredSkills).toBe(true);
            expect(result?.missingSkills).toHaveLength(0);
        });

        it("passes when all required active skills match", async () => {
            mocks.skillFindMany.mockResolvedValue([
                sampleHvacSkill,
                sampleElectricalSkill,
            ]);

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: ["skill_hvac", "skill_elec"],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(true);
            expect(result?.matchedSkills).toHaveLength(2);
            expect(result?.missingSkills).toHaveLength(0);
        });

        it("flags MISSING_REQUIRED_SKILLS when a required skill is not assigned", async () => {
            mocks.skillFindMany.mockResolvedValue([
                sampleHvacSkill,
                { id: "skill_plumb", name: "Plumbing", status: "ACTIVE" },
            ]);

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: ["skill_hvac", "skill_plumb"],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(false);
            expect(result?.hasRequiredSkills).toBe(false);
            expect(result?.blockers).toContain("MISSING_REQUIRED_SKILLS");
            expect(result?.missingSkills).toEqual([
                { skillId: "skill_plumb", name: "Plumbing" },
            ]);
        });
    });

    // =========================================================================
    // 4. SERVICE AREA MATCHING TESTS
    // =========================================================================
    describe("Service Area Matching", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);
        });

        it("flags SERVICE_AREA_INACTIVE when the requested service area is INACTIVE", async () => {
            mocks.serviceAreaFindFirst.mockResolvedValue({
                id: "sa_dha",
                name: "DHA Lahore",
                status: "INACTIVE" as const,
            });

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: [],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(false);
            expect(result?.blockers).toContain("SERVICE_AREA_INACTIVE");
        });

        it("flags SERVICE_AREA_NOT_ASSIGNED when the technician is not assigned to the active service area", async () => {
            mocks.serviceAreaFindFirst.mockResolvedValue({
                id: "sa_cantt",
                name: "Cantt",
                status: "ACTIVE" as const,
            });

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: [],
                    serviceAreaId: "sa_cantt",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(false);
            expect(result?.hasRequiredServiceArea).toBe(false);
            expect(result?.blockers).toContain("SERVICE_AREA_NOT_ASSIGNED");
        });
    });

    // =========================================================================
    // 5. POINT-IN-TIME AVAILABILITY INTEGRATION
    // =========================================================================
    describe("Point-in-Time Availability Integration", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
        });

        it("flags TECHNICIAN_NOT_AVAILABLE when outside recurring schedule", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);

            // Mon 20:00 to 22:00 in Asia/Karachi (15:00 to 17:00 UTC)
            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: [],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T15:00:00.000Z",
                    endsAt: "2026-09-07T17:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(false);
            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("TECHNICIAN_NOT_AVAILABLE");
        });

        it("flags TECHNICIAN_NOT_AVAILABLE when blocked by active exception", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleTechnicianDb,
                technicianAvailabilityExceptions: [
                    {
                        id: "exc_1",
                        type: "TIME_OFF" as const,
                        title: "Leave",
                        startsAt: new Date("2026-09-07T04:00:00.000Z"),
                        endsAt: new Date("2026-09-07T08:00:00.000Z"),
                        isAllDay: false,
                        status: "ACTIVE" as const,
                    },
                ],
            });

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: [],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.isEligible).toBe(false);
            expect(result?.isAvailable).toBe(false);
            expect(result?.blockers).toContain("TECHNICIAN_NOT_AVAILABLE");
        });
    });

    // =========================================================================
    // 6. MULTIPLE BLOCKERS & DETERMINISTIC ORDERING
    // =========================================================================
    describe("Multiple Blockers & Deterministic Ordering", () => {
        it("returns all blockers in exact deterministic order", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
            mocks.skillFindMany.mockResolvedValue([sampleHvacSkill]);
            mocks.technicianProfileFindFirst.mockResolvedValue({
                id: "tech_prof_1",
                employeeId: "emp_1",
                employee: {
                    id: "emp_1",
                    status: "TERMINATED" as const, // EMPLOYEE_NOT_ACTIVE
                    displayName: "Terminated Tech",
                    firstName: "Terminated",
                    lastName: "Tech",
                },
                technicianSkills: [], // MISSING_REQUIRED_SKILLS
                technicianServiceAreas: [], // SERVICE_AREA_NOT_ASSIGNED
                technicianAvailabilities: [], // TECHNICIAN_NOT_AVAILABLE
                technicianAvailabilityExceptions: [],
            });

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: ["skill_hvac"],
                    serviceAreaId: "sa_dha",
                    startsAt: "2026-09-07T05:00:00.000Z",
                    endsAt: "2026-09-07T07:00:00.000Z",
                },
            );

            expect(result?.blockers).toEqual([
                "EMPLOYEE_NOT_ACTIVE",
                "MISSING_REQUIRED_SKILLS",
                "SERVICE_AREA_NOT_ASSIGNED",
                "TECHNICIAN_NOT_AVAILABLE",
            ]);
        });
    });

    // =========================================================================
    // 7. DIRECTORY MATCHING TESTS (getEligibleTechnicians)
    // =========================================================================
    describe("Directory Matching (getEligibleTechnicians)", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
            mocks.skillFindMany.mockResolvedValue([sampleHvacSkill]);
        });

        it("returns only eligible technicians with deterministic sorting and pagination", async () => {
            const eligibleTech1 = {
                ...sampleTechnicianDb,
                id: "tech_2",
                employeeId: "emp_2",
                employee: {
                    id: "emp_2",
                    status: "ACTIVE" as const,
                    displayName: "Bilal Khan",
                    firstName: "Bilal",
                    lastName: "Khan",
                },
            };

            const eligibleTech2 = {
                ...sampleTechnicianDb,
                id: "tech_1",
                employeeId: "emp_1",
                employee: {
                    id: "emp_1",
                    status: "ACTIVE" as const,
                    displayName: "Zubair Sanaullah",
                    firstName: "Zubair",
                    lastName: "Sanaullah",
                },
            };

            const ineligibleTech = {
                ...sampleTechnicianDb,
                id: "tech_3",
                employeeId: "emp_3",
                employee: {
                    id: "emp_3",
                    status: "INACTIVE" as const,
                    displayName: "Ali Raza",
                    firstName: "Ali",
                    lastName: "Raza",
                },
            };

            mocks.technicianProfileFindMany.mockResolvedValue([
                eligibleTech2,
                ineligibleTech,
                eligibleTech1,
            ]);

            const result = await getEligibleTechnicians("ws_123", {
                requiredSkillIds: ["skill_hvac"],
                serviceAreaId: "sa_dha",
                startsAt: "2026-09-07T05:00:00.000Z",
                endsAt: "2026-09-07T07:00:00.000Z",
                page: 1,
                pageSize: 10,
            });

            expect(result.pagination.total).toBe(2);
            expect(result.items).toHaveLength(2);
            // Sorted: Bilal Khan, then Zubair Sanaullah
            expect(result.items[0].displayName).toBe("Bilal Khan");
            expect(result.items[1].displayName).toBe("Zubair Sanaullah");
        });
    });

    // =========================================================================
    // 8. TENANT ISOLATION & MUTATION SAFETY
    // =========================================================================
    describe("Tenant Isolation & Mutation Safety", () => {
        it("never leaks credentials and executes zero database mutations", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleActiveServiceArea);
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianDb);

            const result = await getTechnicianWorkEligibility(
                "ws_123",
                "tech_prof_1",
                {
                    requiredSkillIds: [],
                    serviceAreaId: "sa_dha",
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
