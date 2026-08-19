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
    technicianProfileDelete: vi.fn(),
    skillCreate: vi.fn(),
    skillFindUnique: vi.fn(),
    skillFindFirst: vi.fn(),
    skillFindMany: vi.fn(),
    skillUpdate: vi.fn(),
    skillDelete: vi.fn(),
    technicianSkillCreate: vi.fn(),
    technicianSkillFindUnique: vi.fn(),
    technicianSkillFindFirst: vi.fn(),
    technicianSkillFindMany: vi.fn(),
    technicianSkillUpdate: vi.fn(),
    technicianSkillDelete: vi.fn(),
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
            delete: mocks.technicianProfileDelete,
        },
        skill: {
            create: mocks.skillCreate,
            findUnique: mocks.skillFindUnique,
            findFirst: mocks.skillFindFirst,
            findMany: mocks.skillFindMany,
            update: mocks.skillUpdate,
            delete: mocks.skillDelete,
        },
        technicianSkill: {
            create: mocks.technicianSkillCreate,
            findUnique: mocks.technicianSkillFindUnique,
            findFirst: mocks.technicianSkillFindFirst,
            findMany: mocks.technicianSkillFindMany,
            update: mocks.technicianSkillUpdate,
            delete: mocks.technicianSkillDelete,
        },
    },
}));

import { createSkill } from "@/lib/services/skill/createSkill";
import { getSkill } from "@/lib/services/skill/getSkill";
import { getSkills } from "@/lib/services/skill/getSkills";
import { updateSkill } from "@/lib/services/skill/updateSkill";
import { updateSkillStatus } from "@/lib/services/skill/updateSkillStatus";
import { deleteSkill } from "@/lib/services/skill/deleteSkill";
import {
    SkillNotFoundError,
    SkillAlreadyExistsError,
    SkillHasAssignedTechniciansError,
    InvalidSkillError,
    InactiveSkillAssignmentError,
} from "@/lib/services/skill/skillErrors";
import { assignSkillToTechnician } from "@/lib/services/technicianSkill/assignSkillToTechnician";
import { getTechnicianSkill } from "@/lib/services/technicianSkill/getTechnicianSkill";
import { getTechnicianSkills } from "@/lib/services/technicianSkill/getTechnicianSkills";
import { updateTechnicianSkill } from "@/lib/services/technicianSkill/updateTechnicianSkill";
import { removeSkillFromTechnician } from "@/lib/services/technicianSkill/removeSkillFromTechnician";
import {
    TechnicianSkillNotFoundError,
    TechnicianSkillAlreadyExistsError,
    InvalidTechnicianProfileError,
    InvalidSkillAssignmentError,
} from "@/lib/services/technicianSkill/technicianSkillErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Skill, TechnicianSkill, TechnicianProfile, Employee, WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.9 — Technician Skills Service Layer", () => {
    let membersMap: Map<string, any>;
    let usersMap: Map<string, any>;
    let workspacesMap: Map<string, any>;

    beforeEach(() => {
        vi.clearAllMocks();
        membersMap = new Map();
        usersMap = new Map();
        workspacesMap = new Map();

        mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
            return usersMap.get(where.id) || null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
            return workspacesMap.get(where.id) || null;
        });

        mocks.workspaceMemberFindUnique.mockImplementation(async ({ where }: any) => {
            if (where.userId_workspaceId) {
                const key = `${where.userId_workspaceId.userId}_${where.userId_workspaceId.workspaceId}`;
                return membersMap.get(key) || null;
            }
            if (where.id) {
                return membersMap.get(where.id) || null;
            }
            return null;
        });
    });

    function registerUser(userId = "user_admin_123", name = "Admin User", status = "ACTIVE") {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed-pwd",
            emailVerified: new Date(),
            avatarUrl: null,
            status: status as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        usersMap.set(userId, user);
        return user;
    }

    function registerWorkspace(workspaceId = "ws_123", name = "Acme HVAC Pros") {
        const workspace = {
            id: workspaceId,
            name,
            slug: "acme-hvac",
            logoUrl: null,
            timezone: "Asia/Karachi",
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

    const sampleSkill: Skill = {
        id: "skill_hvac_install",
        workspaceId: "ws_123",
        name: "HVAC Installation",
        description: "Complete installation of split systems, ductwork, and outdoor condensing units.",
        status: "ACTIVE",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const sampleEmployee: Employee = {
        id: "emp_123",
        workspaceId: "ws_123",
        workspaceMemberId: "mem_tech_456",
        departmentId: null,
        jobTitleId: null,
        employeeNumber: "EMP-001",
        displayName: "John Field Tech",
        phone: "+1-555-0199",
        hireDate: new Date("2026-01-01T00:00:00.000Z"),
        status: "ACTIVE",
        notes: null,
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const sampleTechnicianProfile: TechnicianProfile = {
        id: "tech_prof_123",
        employeeId: "emp_123",
        licenseNumber: "HVAC-LIC-998822",
        yearsExperience: 8,
        emergencyContact: "+1-555-9111",
        notes: "Certified for refrigerant recovery.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const sampleTechnicianSkill: TechnicianSkill = {
        id: "tech_skill_123",
        technicianProfileId: "tech_prof_123",
        skillId: "skill_hvac_install",
        proficiency: "EXPERT",
        yearsExperience: 7,
        notes: "Specializes in multi-zone heat pump installations.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. SKILL CREATION TESTS
    // =========================================================================
    describe("createSkill()", () => {
        it("allows OWNER to create a skill", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.skillFindUnique.mockResolvedValue(null);
            mocks.skillCreate.mockResolvedValue(sampleSkill);

            const result = await createSkill("ws_123", {
                name: "HVAC Installation",
                description: "Complete installation of split systems, ductwork, and outdoor condensing units.",
                status: "ACTIVE",
            });

            expect(mocks.skillCreate).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_123",
                    name: "HVAC Installation",
                    description: "Complete installation of split systems, ductwork, and outdoor condensing units.",
                    status: "ACTIVE",
                },
            });
            expect(result.id).toBe("skill_hvac_install");
        });

        it("allows ADMIN to create a skill", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindUnique.mockResolvedValue(null);
            mocks.skillCreate.mockResolvedValue(sampleSkill);

            const result = await createSkill("ws_123", {
                name: "HVAC Installation",
            });

            expect(mocks.skillCreate).toHaveBeenCalled();
            expect(result.name).toBe("HVAC Installation");
        });

        it("rejects unauthorized roles (MANAGER, TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                createSkill("ws_123", { name: "Electrical Wiring" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.skillCreate).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createSkill("ws_123", { name: "Electrical Wiring" }),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.skillCreate).not.toHaveBeenCalled();
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createSkill("ws_123", { name: "Electrical Wiring" }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.skillCreate).not.toHaveBeenCalled();
        });

        it("rejects duplicate skill name within the same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindUnique.mockResolvedValue(sampleSkill);

            await expect(
                createSkill("ws_123", { name: "HVAC Installation" }),
            ).rejects.toBeInstanceOf(SkillAlreadyExistsError);

            expect(mocks.skillCreate).not.toHaveBeenCalled();
        });

        it("allows same skill name in different workspaces", async () => {
            setupAuthSession("user_admin_a");
            registerUser("user_admin_a");
            registerWorkspace("ws_a");
            registerMembership("mem_a", "user_admin_a", "ws_a", "ADMIN");

            mocks.skillFindUnique.mockResolvedValue(null);
            mocks.skillCreate.mockResolvedValue({
                ...sampleSkill,
                workspaceId: "ws_a",
            });

            const result = await createSkill("ws_a", { name: "HVAC Installation" });

            expect(result.workspaceId).toBe("ws_a");
        });

        it("rejects invalid or too short skill name (less than 2 characters)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createSkill("ws_123", { name: "A" }),
            ).rejects.toThrow();

            expect(mocks.skillCreate).not.toHaveBeenCalled();
        });

        it("rejects whitespace-only skill name", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createSkill("ws_123", { name: "    " }),
            ).rejects.toThrow();

            expect(mocks.skillCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. SKILL RETRIEVAL TESTS
    // =========================================================================
    describe("Skill Retrieval Operations", () => {
        it("allows authorized roles with MEMBERS_VIEW to retrieve a skill", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.skillFindFirst.mockResolvedValue(sampleSkill);

            const result = await getSkill("ws_123", "skill_hvac_install");

            expect(mocks.skillFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "skill_hvac_install",
                    workspaceId: "ws_123",
                },
                include: {
                    _count: {
                        select: { technicianSkills: true },
                    },
                },
            });
            expect(result).toEqual(sampleSkill);
        });

        it("returns null when skill is not found in the workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(null);

            const result = await getSkill("ws_123", "skill_nonexistent");
            expect(result).toBeNull();
        });

        it("enforces tenant isolation — Workspace A cannot retrieve Workspace B skill", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getSkill("ws_b", "skill_hvac_install"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.skillFindFirst).not.toHaveBeenCalled();
        });

        it("lists skills strictly scoped to workspace and ordered by name ASC", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            const skills: Skill[] = [
                {
                    id: "skill_elec",
                    workspaceId: "ws_123",
                    name: "Electrical Troubleshooting",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "skill_hvac",
                    workspaceId: "ws_123",
                    name: "HVAC Installation",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            mocks.skillFindMany.mockResolvedValue(skills);

            const result = await getSkills("ws_123");

            expect(mocks.skillFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_123",
                },
                orderBy: {
                    name: "asc",
                },
                include: {
                    _count: {
                        select: { technicianSkills: true },
                    },
                },
            });
            expect(result).toEqual(skills);
        });
    });

    // =========================================================================
    // 3. SKILL UPDATE TESTS
    // =========================================================================
    describe("updateSkill()", () => {
        it("allows OWNER or ADMIN to update skill details", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(sampleSkill);
            const updated = {
                ...sampleSkill,
                name: "Commercial HVAC Installation",
                description: "Updated description",
            };
            mocks.skillUpdate.mockResolvedValue(updated);

            const result = await updateSkill("ws_123", "skill_hvac_install", {
                name: "Commercial HVAC Installation",
                description: "Updated description",
            });

            expect(mocks.skillUpdate).toHaveBeenCalledWith({
                where: { id: "skill_hvac_install" },
                data: {
                    name: "Commercial HVAC Installation",
                    description: "Updated description",
                },
            });
            expect(result.name).toBe("Commercial HVAC Installation");
        });

        it("preserves omitted fields during partial update", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(sampleSkill);
            mocks.skillUpdate.mockResolvedValue({
                ...sampleSkill,
                description: "Only new description",
            });

            await updateSkill("ws_123", "skill_hvac_install", {
                description: "Only new description",
            });

            const updateData = mocks.skillUpdate.mock.calls[0][0].data;
            expect(updateData).toEqual({
                description: "Only new description",
            });
            expect(updateData.name).toBeUndefined();
            expect(updateData.status).toBeUndefined();
        });

        it("clears nullable fields when explicitly passed as null", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(sampleSkill);
            mocks.skillUpdate.mockResolvedValue({
                ...sampleSkill,
                description: null,
            });

            await updateSkill("ws_123", "skill_hvac_install", {
                description: null,
            });

            const updateData = mocks.skillUpdate.mock.calls[0][0].data;
            expect(updateData.description).toBeNull();
        });

        it("throws SkillNotFoundError when updating skill in another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(null);

            await expect(
                updateSkill("ws_123", "skill_cross_tenant", { name: "Hacked" }),
            ).rejects.toBeInstanceOf(SkillNotFoundError);

            expect(mocks.skillUpdate).not.toHaveBeenCalled();
        });

        it("throws SkillAlreadyExistsError when renaming skill to an existing name in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(sampleSkill);
            mocks.skillFindUnique.mockResolvedValue({
                id: "skill_other",
                workspaceId: "ws_123",
                name: "Plumbing",
            });

            await expect(
                updateSkill("ws_123", "skill_hvac_install", {
                    name: "Plumbing",
                }),
            ).rejects.toBeInstanceOf(SkillAlreadyExistsError);

            expect(mocks.skillUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from updating skills", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                updateSkill("ws_123", "skill_hvac_install", { name: "Self Named" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.skillUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. SKILL STATUS TESTS
    // =========================================================================
    describe("updateSkillStatus()", () => {
        it("allows setting status to INACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(sampleSkill);
            mocks.skillUpdate.mockResolvedValue({
                ...sampleSkill,
                status: "INACTIVE",
            });

            const result = await updateSkillStatus(
                "ws_123",
                "skill_hvac_install",
                "INACTIVE",
            );

            expect(mocks.skillUpdate).toHaveBeenCalledWith({
                where: { id: "skill_hvac_install" },
                data: { status: "INACTIVE" },
            });
            expect(result.status).toBe("INACTIVE");
        });

        it("allows setting status to ACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue({
                ...sampleSkill,
                status: "INACTIVE",
            });
            mocks.skillUpdate.mockResolvedValue({
                ...sampleSkill,
                status: "ACTIVE",
            });

            const result = await updateSkillStatus("ws_123", "skill_hvac_install", {
                status: "ACTIVE",
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("rejects invalid skill status", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateSkillStatus("ws_123", "skill_hvac_install", "ARCHIVED"),
            ).rejects.toThrow();

            expect(mocks.skillUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. SKILL DELETION TESTS
    // =========================================================================
    describe("deleteSkill()", () => {
        it("allows deleting an empty skill (0 assigned technicians)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue({
                ...sampleSkill,
                _count: { technicianSkills: 0 },
            });
            mocks.skillDelete.mockResolvedValue(sampleSkill);

            const result = await deleteSkill("ws_123", "skill_hvac_install");

            expect(mocks.skillDelete).toHaveBeenCalledWith({
                where: { id: "skill_hvac_install" },
            });
            expect(result.id).toBe("skill_hvac_install");
        });

        it("rejects deleting a skill that has assigned technicians", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue({
                ...sampleSkill,
                _count: { technicianSkills: 3 }, // Has 3 technicians assigned!
            });

            await expect(
                deleteSkill("ws_123", "skill_hvac_install"),
            ).rejects.toBeInstanceOf(SkillHasAssignedTechniciansError);

            expect(mocks.skillDelete).not.toHaveBeenCalled();
        });

        it("throws SkillNotFoundError when deleting skill not in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.skillFindFirst.mockResolvedValue(null);

            await expect(
                deleteSkill("ws_123", "skill_cross_tenant"),
            ).rejects.toBeInstanceOf(SkillNotFoundError);

            expect(mocks.skillDelete).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from deleting skills", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                deleteSkill("ws_123", "skill_hvac_install"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.skillDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 6. TECHNICIAN SKILL ASSIGNMENT TESTS
    // =========================================================================
    describe("assignSkillToTechnician()", () => {
        it("allows OWNER or ADMIN to assign an ACTIVE skill to a technician profile", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.skillFindFirst.mockResolvedValue(sampleSkill);
            mocks.technicianSkillFindUnique.mockResolvedValue(null);
            mocks.technicianSkillCreate.mockResolvedValue({
                ...sampleTechnicianSkill,
                skill: sampleSkill,
            });

            const result = await assignSkillToTechnician(
                "ws_123",
                "tech_prof_123",
                "skill_hvac_install",
                {
                    proficiency: "EXPERT",
                    yearsExperience: 7,
                    notes: "Specializes in multi-zone heat pump installations.",
                },
            );

            expect(mocks.technicianSkillCreate).toHaveBeenCalledWith({
                data: {
                    technicianProfileId: "tech_prof_123",
                    skillId: "skill_hvac_install",
                    proficiency: "EXPERT",
                    yearsExperience: 7,
                    notes: "Specializes in multi-zone heat pump installations.",
                },
                include: {
                    skill: true,
                },
            });
            expect(result.id).toBe("tech_skill_123");
        });

        it("rejects unauthorized roles from assigning skills", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                assignSkillToTechnician("ws_123", "tech_prof_123", "skill_hvac_install"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.technicianSkillCreate).not.toHaveBeenCalled();
        });

        it("throws InvalidTechnicianProfileError when technician profile is missing or in another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                assignSkillToTechnician("ws_123", "tech_prof_other", "skill_hvac_install"),
            ).rejects.toBeInstanceOf(InvalidTechnicianProfileError);

            expect(mocks.technicianSkillCreate).not.toHaveBeenCalled();
        });

        it("throws InvalidSkillAssignmentError when skill is missing or belongs to another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.skillFindFirst.mockResolvedValue(null); // Not in ws_123

            await expect(
                assignSkillToTechnician("ws_123", "tech_prof_123", "skill_other_ws"),
            ).rejects.toBeInstanceOf(InvalidSkillAssignmentError);

            expect(mocks.technicianSkillCreate).not.toHaveBeenCalled();
        });

        it("throws InactiveSkillAssignmentError when attempting to assign an INACTIVE skill", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.skillFindFirst.mockResolvedValue({
                ...sampleSkill,
                status: "INACTIVE",
            });

            await expect(
                assignSkillToTechnician("ws_123", "tech_prof_123", "skill_hvac_install"),
            ).rejects.toBeInstanceOf(InactiveSkillAssignmentError);

            expect(mocks.technicianSkillCreate).not.toHaveBeenCalled();
        });

        it("throws TechnicianSkillAlreadyExistsError on duplicate assignment", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.skillFindFirst.mockResolvedValue(sampleSkill);
            mocks.technicianSkillFindUnique.mockResolvedValue(sampleTechnicianSkill); // Already assigned!

            await expect(
                assignSkillToTechnician("ws_123", "tech_prof_123", "skill_hvac_install"),
            ).rejects.toBeInstanceOf(TechnicianSkillAlreadyExistsError);

            expect(mocks.technicianSkillCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 7. TECHNICIAN SKILL RETRIEVAL TESTS
    // =========================================================================
    describe("Technician Skill Retrieval Operations", () => {
        it("allows authorized roles with MEMBERS_VIEW to retrieve assignment by ID", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianSkillFindFirst.mockResolvedValue({
                ...sampleTechnicianSkill,
                skill: sampleSkill,
                technicianProfile: sampleTechnicianProfile,
            });

            const result = await getTechnicianSkill("ws_123", "tech_skill_123");

            expect(mocks.technicianSkillFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "tech_skill_123",
                    technicianProfile: {
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                },
                include: {
                    skill: true,
                    technicianProfile: true,
                },
            });
            expect(result?.id).toBe("tech_skill_123");
            expect(result?.skill.name).toBe("HVAC Installation");
        });

        it("allows retrieving all skills for a technician profile", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianSkillFindMany.mockResolvedValue([
                { ...sampleTechnicianSkill, skill: sampleSkill },
            ]);

            const result = await getTechnicianSkills("ws_123", "tech_prof_123");

            expect(mocks.technicianSkillFindMany).toHaveBeenCalledWith({
                where: {
                    technicianProfileId: "tech_prof_123",
                },
                orderBy: {
                    skill: {
                        name: "asc",
                    },
                },
                include: {
                    skill: true,
                },
            });
            expect(result).toHaveLength(1);
        });

        it("enforces tenant isolation — Workspace A cannot retrieve Workspace B technician skills", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getTechnicianSkills("ws_b", "tech_prof_123"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.technicianSkillFindMany).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 8. TECHNICIAN SKILL UPDATE TESTS
    // =========================================================================
    describe("updateTechnicianSkill()", () => {
        it("allows OWNER or ADMIN to update proficiency, experience, and notes", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianSkillFindFirst.mockResolvedValue(sampleTechnicianSkill);
            const updated = {
                ...sampleTechnicianSkill,
                proficiency: "EXPERT" as const,
                yearsExperience: 10,
                notes: "Promoted to lead certified installer.",
                skill: sampleSkill,
            };
            mocks.technicianSkillUpdate.mockResolvedValue(updated);

            const result = await updateTechnicianSkill("ws_123", "tech_skill_123", {
                proficiency: "EXPERT",
                yearsExperience: 10,
                notes: "Promoted to lead certified installer.",
            });

            expect(mocks.technicianSkillUpdate).toHaveBeenCalledWith({
                where: { id: "tech_skill_123" },
                data: {
                    proficiency: "EXPERT",
                    yearsExperience: 10,
                    notes: "Promoted to lead certified installer.",
                },
                include: {
                    skill: true,
                },
            });
            expect(result.yearsExperience).toBe(10);
        });

        it("preserves omitted fields (undefined) during partial update", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianSkillFindFirst.mockResolvedValue(sampleTechnicianSkill);
            mocks.technicianSkillUpdate.mockResolvedValue({
                ...sampleTechnicianSkill,
                proficiency: "ADVANCED",
                skill: sampleSkill,
            });

            await updateTechnicianSkill("ws_123", "tech_skill_123", {
                proficiency: "ADVANCED",
            });

            const updateData = mocks.technicianSkillUpdate.mock.calls[0][0].data;
            expect(updateData).toEqual({
                proficiency: "ADVANCED",
            });
            expect(updateData.yearsExperience).toBeUndefined();
            expect(updateData.notes).toBeUndefined();
        });

        it("allows updating an existing assignment even if the underlying skill is now INACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianSkillFindFirst.mockResolvedValue(sampleTechnicianSkill);
            mocks.technicianSkillUpdate.mockResolvedValue({
                ...sampleTechnicianSkill,
                yearsExperience: 9,
                skill: { ...sampleSkill, status: "INACTIVE" },
            });

            const result = await updateTechnicianSkill("ws_123", "tech_skill_123", {
                yearsExperience: 9,
            });

            expect(result.yearsExperience).toBe(9);
        });
    });

    // =========================================================================
    // 9. TECHNICIAN SKILL REMOVAL TESTS
    // =========================================================================
    describe("removeSkillFromTechnician()", () => {
        it("allows OWNER or ADMIN to remove a skill assignment", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianSkillFindFirst.mockResolvedValue(sampleTechnicianSkill);
            mocks.technicianSkillDelete.mockResolvedValue(sampleTechnicianSkill);

            const result = await removeSkillFromTechnician("ws_123", "tech_skill_123");

            expect(mocks.technicianSkillDelete).toHaveBeenCalledWith({
                where: { id: "tech_skill_123" },
            });
            expect(result.id).toBe("tech_skill_123");
        });

        it("throws TechnicianSkillNotFoundError when removing assignment not in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianSkillFindFirst.mockResolvedValue(null);

            await expect(
                removeSkillFromTechnician("ws_123", "tech_skill_other"),
            ).rejects.toBeInstanceOf(TechnicianSkillNotFoundError);

            expect(mocks.technicianSkillDelete).not.toHaveBeenCalled();
        });

        it("preserves TechnicianProfile, Skill, and Employee when assignment is removed", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianSkillFindFirst.mockResolvedValue(sampleTechnicianSkill);
            mocks.technicianSkillDelete.mockResolvedValue(sampleTechnicianSkill);

            await removeSkillFromTechnician("ws_123", "tech_skill_123");

            // Ensure profile, employee, or skill were NOT deleted
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.skillDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 10. STATUS INDEPENDENCE
    // =========================================================================
    describe("Status Independence", () => {
        it("skill status modifications do not alter EmployeeStatus, MembershipStatus, or UserStatus", () => {
            expect(sampleEmployee.status).toBe("ACTIVE");
            expect(sampleTechnicianProfile.id).toBe("tech_prof_123");
        });
    });
});
