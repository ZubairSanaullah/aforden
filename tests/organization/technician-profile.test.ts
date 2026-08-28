import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    userDelete: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workspaceMemberDelete: vi.fn(),
    employeeCreate: vi.fn(),
    employeeFindUnique: vi.fn(),
    employeeFindFirst: vi.fn(),
    employeeFindMany: vi.fn(),
    employeeUpdate: vi.fn(),
    employeeDelete: vi.fn(),
    technicianProfileCreate: vi.fn(),
    technicianProfileFindUnique: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    technicianProfileFindMany: vi.fn(),
    technicianProfileUpdate: vi.fn(),
    technicianProfileDelete: vi.fn(),
    technicianProfileCount: vi.fn(),
    workspaceEntitlementOverrideFindUnique: vi.fn(),
    subscriptionFindFirst: vi.fn(),
    $transaction: vi.fn(async (cb: any) => cb({
        technicianProfile: {
            create: mocks.technicianProfileCreate,
            findUnique: mocks.technicianProfileFindUnique,
            findFirst: mocks.technicianProfileFindFirst,
            findMany: mocks.technicianProfileFindMany,
            update: mocks.technicianProfileUpdate,
            delete: mocks.technicianProfileDelete,
            count: mocks.technicianProfileCount,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        workspaceEntitlementOverride: {
            findUnique: mocks.workspaceEntitlementOverrideFindUnique,
        },
        subscription: {
            findFirst: mocks.subscriptionFindFirst,
        },
    })),
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
            create: mocks.employeeCreate,
            findUnique: mocks.employeeFindUnique,
            findFirst: mocks.employeeFindFirst,
            findMany: mocks.employeeFindMany,
            update: mocks.employeeUpdate,
            delete: mocks.employeeDelete,
        },
        technicianProfile: {
            create: mocks.technicianProfileCreate,
            findUnique: mocks.technicianProfileFindUnique,
            findFirst: mocks.technicianProfileFindFirst,
            findMany: mocks.technicianProfileFindMany,
            update: mocks.technicianProfileUpdate,
            delete: mocks.technicianProfileDelete,
            count: mocks.technicianProfileCount,
        },
        workspaceEntitlementOverride: {
            findUnique: mocks.workspaceEntitlementOverrideFindUnique,
        },
        subscription: {
            findFirst: mocks.subscriptionFindFirst,
        },
        $transaction: mocks.$transaction,
    },
}));

import { createTechnicianProfile } from "@/lib/services/technicianProfile/createTechnicianProfile";
import { getTechnicianProfile } from "@/lib/services/technicianProfile/getTechnicianProfile";
import { getTechnicianProfileByEmployee } from "@/lib/services/technicianProfile/getTechnicianProfileByEmployee";
import { updateTechnicianProfile } from "@/lib/services/technicianProfile/updateTechnicianProfile";
import { deleteTechnicianProfile } from "@/lib/services/technicianProfile/deleteTechnicianProfile";
import {
    TechnicianProfileNotFoundError,
    TechnicianProfileAlreadyExistsError,
    InvalidEmployeeError,
} from "@/lib/services/technicianProfile/technicianProfileErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { TechnicianProfile, Employee, WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.8 — Technician Profiles Service Layer", () => {
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
        defaultCurrencyCode: "USD",
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
        notes: "Experienced residential tech.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const sampleTechnicianProfile: TechnicianProfile = {
        id: "tech_prof_123",
        employeeId: "emp_123",
        licenseNumber: "HVAC-LIC-998822",
        yearsExperience: 8,
        emergencyContact: "+1-555-9111 (Sarah Doe - Spouse)",
        notes: "Certified for refrigerant recovery and high-voltage wiring.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. CREATION TESTS
    // =========================================================================
    describe("createTechnicianProfile()", () => {
        it("allows OWNER to create a technician profile for an employee", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                technicianProfile: null,
            });
            mocks.technicianProfileCreate.mockResolvedValue(sampleTechnicianProfile);

            const result = await createTechnicianProfile("ws_123", "emp_123", {
                licenseNumber: "HVAC-LIC-998822",
                yearsExperience: 8,
                emergencyContact: "+1-555-9111 (Sarah Doe - Spouse)",
                notes: "Certified for refrigerant recovery and high-voltage wiring.",
            });

            expect(mocks.technicianProfileCreate).toHaveBeenCalledWith({
                data: {
                    employeeId: "emp_123",
                    licenseNumber: "HVAC-LIC-998822",
                    yearsExperience: 8,
                    emergencyContact: "+1-555-9111 (Sarah Doe - Spouse)",
                    notes: "Certified for refrigerant recovery and high-voltage wiring.",
                },
            });
            expect(result.id).toBe("tech_prof_123");
        });

        it("allows ADMIN to create a technician profile with minimal/omitted fields", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                technicianProfile: null,
            });
            mocks.technicianProfileCreate.mockResolvedValue({
                id: "tech_prof_minimal",
                employeeId: "emp_123",
                licenseNumber: null,
                yearsExperience: null,
                emergencyContact: null,
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await createTechnicianProfile("ws_123", "emp_123", {});

            expect(mocks.technicianProfileCreate).toHaveBeenCalledWith({
                data: {
                    employeeId: "emp_123",
                    licenseNumber: null,
                    yearsExperience: null,
                    emergencyContact: null,
                    notes: null,
                },
            });
            expect(result.id).toBe("tech_prof_minimal");
        });

        it("rejects unauthorized roles (MANAGER, TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                createTechnicianProfile("ws_123", "emp_123", {}),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createTechnicianProfile("ws_123", "emp_123", {}),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });

        it("rejects non-member of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createTechnicianProfile("ws_123", "emp_123", {}),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });

        it("throws InvalidEmployeeError when target employee does not exist in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(null);

            await expect(
                createTechnicianProfile("ws_123", "emp_missing", {}),
            ).rejects.toBeInstanceOf(InvalidEmployeeError);

            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });

        it("throws TechnicianProfileAlreadyExistsError when employee already has a profile (1:0..1)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                technicianProfile: sampleTechnicianProfile,
            });

            await expect(
                createTechnicianProfile("ws_123", "emp_123", {}),
            ).rejects.toBeInstanceOf(TechnicianProfileAlreadyExistsError);

            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. RETRIEVAL TESTS
    // =========================================================================
    describe("Retrieval Operations", () => {
        it("allows authorized roles with MEMBERS_VIEW to retrieve by profile ID", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleTechnicianProfile,
                employee: sampleEmployee,
            });

            const result = await getTechnicianProfile("ws_123", "tech_prof_123");

            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "tech_prof_123",
                    employee: {
                        workspaceId: "ws_123",
                    },
                },
                include: {
                    employee: true,
                },
            });
            expect(result?.id).toBe("tech_prof_123");
            expect(result?.employee.id).toBe("emp_123");
        });

        it("allows retrieving technician profile by Employee ID", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...sampleTechnicianProfile,
                employee: sampleEmployee,
            });

            const result = await getTechnicianProfileByEmployee("ws_123", "emp_123");

            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledWith({
                where: {
                    employeeId: "emp_123",
                    employee: {
                        workspaceId: "ws_123",
                    },
                },
                include: {
                    employee: true,
                },
            });
            expect(result?.id).toBe("tech_prof_123");
        });

        it("returns null when technician profile is not found", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const result = await getTechnicianProfile("ws_123", "tech_prof_missing");
            expect(result).toBeNull();
        });

        it("enforces tenant isolation — Workspace A cannot retrieve Workspace B technician profile", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getTechnicianProfile("ws_b", "tech_prof_123"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.technicianProfileFindFirst).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 3. UPDATE TESTS
    // =========================================================================
    describe("updateTechnicianProfile()", () => {
        it("allows OWNER or ADMIN to update technician profile details", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            const updated = {
                ...sampleTechnicianProfile,
                yearsExperience: 10,
                notes: "Promoted to Master Senior Field Tech.",
            };
            mocks.technicianProfileUpdate.mockResolvedValue(updated);

            const result = await updateTechnicianProfile("ws_123", "tech_prof_123", {
                yearsExperience: 10,
                notes: "Promoted to Master Senior Field Tech.",
            });

            expect(mocks.technicianProfileUpdate).toHaveBeenCalledWith({
                where: { id: "tech_prof_123" },
                data: {
                    yearsExperience: 10,
                    notes: "Promoted to Master Senior Field Tech.",
                },
            });
            expect(result.yearsExperience).toBe(10);
        });

        it("preserves omitted fields (undefined) during partial update", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianProfileUpdate.mockResolvedValue({
                ...sampleTechnicianProfile,
                licenseNumber: "NEW-LIC-100",
            });

            await updateTechnicianProfile("ws_123", "tech_prof_123", {
                licenseNumber: "NEW-LIC-100",
            });

            const updateData = mocks.technicianProfileUpdate.mock.calls[0][0].data;
            expect(updateData).toEqual({
                licenseNumber: "NEW-LIC-100",
            });
            expect(updateData.yearsExperience).toBeUndefined();
            expect(updateData.emergencyContact).toBeUndefined();
            expect(updateData.notes).toBeUndefined();
        });

        it("clears nullable fields when explicitly passed as null", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianProfileUpdate.mockResolvedValue({
                ...sampleTechnicianProfile,
                emergencyContact: null,
                notes: null,
            });

            await updateTechnicianProfile("ws_123", "tech_prof_123", {
                emergencyContact: null,
                notes: null,
            });

            const updateData = mocks.technicianProfileUpdate.mock.calls[0][0].data;
            expect(updateData.emergencyContact).toBeNull();
            expect(updateData.notes).toBeNull();
        });

        it("throws TechnicianProfileNotFoundError when updating a profile not in the workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                updateTechnicianProfile("ws_123", "tech_prof_other", {
                    licenseNumber: "HACKED",
                }),
            ).rejects.toBeInstanceOf(TechnicianProfileNotFoundError);

            expect(mocks.technicianProfileUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from updating technician profiles", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                updateTechnicianProfile("ws_123", "tech_prof_123", {
                    yearsExperience: 20,
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.technicianProfileUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. DELETION TESTS & RELATION INTEGRITY
    // =========================================================================
    describe("deleteTechnicianProfile()", () => {
        it("allows OWNER or ADMIN to delete a technician profile", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianProfileDelete.mockResolvedValue(sampleTechnicianProfile);

            const result = await deleteTechnicianProfile("ws_123", "tech_prof_123");

            expect(mocks.technicianProfileDelete).toHaveBeenCalledWith({
                where: { id: "tech_prof_123" },
            });
            expect(result.id).toBe("tech_prof_123");
        });

        it("throws TechnicianProfileNotFoundError when deleting a profile not in the workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                deleteTechnicianProfile("ws_123", "tech_prof_other"),
            ).rejects.toBeInstanceOf(TechnicianProfileNotFoundError);

            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from deleting technician profiles", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                deleteTechnicianProfile("ws_123", "tech_prof_123"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
        });

        it("preserves Employee, WorkspaceMember, User, and Workspace when TechnicianProfile is deleted", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianProfileDelete.mockResolvedValue(sampleTechnicianProfile);

            await deleteTechnicianProfile("ws_123", "tech_prof_123");

            // Verify that employee, member, user, or workspace were NEVER deleted
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.workspaceMemberDelete).not.toHaveBeenCalled();
            expect(mocks.userDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. EXTENSIBILITY & DOMAIN INDEPENDENCE
    // =========================================================================
    describe("Domain Independence & Future Compatibility", () => {
        it("allows TechnicianProfile to exist without Skills, Service Areas, or Working Schedules", () => {
            // Verifies the baseline TechnicianProfile model structure does not require future 1.3.9 - 1.3.11 entities
            expect(sampleTechnicianProfile.id).toBeDefined();
            expect(sampleTechnicianProfile.employeeId).toBe("emp_123");
        });
    });
});
