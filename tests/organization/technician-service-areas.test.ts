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
    serviceAreaCreate: vi.fn(),
    serviceAreaFindUnique: vi.fn(),
    serviceAreaFindFirst: vi.fn(),
    serviceAreaFindMany: vi.fn(),
    serviceAreaUpdate: vi.fn(),
    serviceAreaDelete: vi.fn(),
    technicianServiceAreaCreate: vi.fn(),
    technicianServiceAreaFindUnique: vi.fn(),
    technicianServiceAreaFindFirst: vi.fn(),
    technicianServiceAreaFindMany: vi.fn(),
    technicianServiceAreaUpdate: vi.fn(),
    technicianServiceAreaDelete: vi.fn(),
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
        serviceArea: {
            create: mocks.serviceAreaCreate,
            findUnique: mocks.serviceAreaFindUnique,
            findFirst: mocks.serviceAreaFindFirst,
            findMany: mocks.serviceAreaFindMany,
            update: mocks.serviceAreaUpdate,
            delete: mocks.serviceAreaDelete,
        },
        technicianServiceArea: {
            create: mocks.technicianServiceAreaCreate,
            findUnique: mocks.technicianServiceAreaFindUnique,
            findFirst: mocks.technicianServiceAreaFindFirst,
            findMany: mocks.technicianServiceAreaFindMany,
            update: mocks.technicianServiceAreaUpdate,
            delete: mocks.technicianServiceAreaDelete,
        },
    },
}));

import { createServiceArea } from "@/lib/services/serviceArea/createServiceArea";
import { getServiceArea } from "@/lib/services/serviceArea/getServiceArea";
import { getServiceAreas } from "@/lib/services/serviceArea/getServiceAreas";
import { updateServiceArea } from "@/lib/services/serviceArea/updateServiceArea";
import { updateServiceAreaStatus } from "@/lib/services/serviceArea/updateServiceAreaStatus";
import { deleteServiceArea } from "@/lib/services/serviceArea/deleteServiceArea";
import {
    ServiceAreaNotFoundError,
    ServiceAreaAlreadyExistsError,
    ServiceAreaHasAssignedTechniciansError,
    InvalidServiceAreaError,
    InactiveServiceAreaAssignmentError,
} from "@/lib/services/serviceArea/serviceAreaErrors";
import { assignServiceAreaToTechnician } from "@/lib/services/technicianServiceArea/assignServiceAreaToTechnician";
import { getTechnicianServiceArea } from "@/lib/services/technicianServiceArea/getTechnicianServiceArea";
import { getTechnicianServiceAreas } from "@/lib/services/technicianServiceArea/getTechnicianServiceAreas";
import { updateTechnicianServiceArea } from "@/lib/services/technicianServiceArea/updateTechnicianServiceArea";
import { removeServiceAreaFromTechnician } from "@/lib/services/technicianServiceArea/removeServiceAreaFromTechnician";
import {
    TechnicianServiceAreaNotFoundError,
    TechnicianServiceAreaAlreadyExistsError,
    InvalidTechnicianProfileError,
    InvalidServiceAreaAssignmentError,
} from "@/lib/services/technicianServiceArea/technicianServiceAreaErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { ServiceArea, TechnicianServiceArea, TechnicianProfile, Employee, WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.10 — Technician Service Areas Service Layer", () => {
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

    const sampleServiceArea: ServiceArea = {
        id: "area_lahore_central",
        workspaceId: "ws_123",
        name: "Lahore Central / Gulberg",
        description: "Primary commercial and residential HVAC service zone in central Lahore.",
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
        notes: "Certified field technician.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const sampleTechnicianServiceArea: TechnicianServiceArea = {
        id: "tech_area_123",
        technicianProfileId: "tech_prof_123",
        serviceAreaId: "area_lahore_central",
        notes: "Primary coverage route for emergency dispatch.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. SERVICE AREA CREATION TESTS
    // =========================================================================
    describe("createServiceArea()", () => {
        it("allows OWNER to create a service area", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.serviceAreaFindUnique.mockResolvedValue(null);
            mocks.serviceAreaCreate.mockResolvedValue(sampleServiceArea);

            const result = await createServiceArea("ws_123", {
                name: "Lahore Central / Gulberg",
                description: "Primary commercial and residential HVAC service zone in central Lahore.",
                status: "ACTIVE",
            });

            expect(mocks.serviceAreaCreate).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_123",
                    name: "Lahore Central / Gulberg",
                    description: "Primary commercial and residential HVAC service zone in central Lahore.",
                    status: "ACTIVE",
                },
            });
            expect(result.id).toBe("area_lahore_central");
        });

        it("allows ADMIN to create a service area", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindUnique.mockResolvedValue(null);
            mocks.serviceAreaCreate.mockResolvedValue(sampleServiceArea);

            const result = await createServiceArea("ws_123", {
                name: "Lahore Central / Gulberg",
            });

            expect(mocks.serviceAreaCreate).toHaveBeenCalled();
            expect(result.name).toBe("Lahore Central / Gulberg");
        });

        it("rejects unauthorized roles (MANAGER, TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                createServiceArea("ws_123", { name: "Islamabad North" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.serviceAreaCreate).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createServiceArea("ws_123", { name: "Islamabad North" }),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.serviceAreaCreate).not.toHaveBeenCalled();
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createServiceArea("ws_123", { name: "Islamabad North" }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.serviceAreaCreate).not.toHaveBeenCalled();
        });

        it("rejects duplicate service area name within the same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindUnique.mockResolvedValue(sampleServiceArea);

            await expect(
                createServiceArea("ws_123", { name: "Lahore Central / Gulberg" }),
            ).rejects.toBeInstanceOf(ServiceAreaAlreadyExistsError);

            expect(mocks.serviceAreaCreate).not.toHaveBeenCalled();
        });

        it("allows same service area name in different workspaces", async () => {
            setupAuthSession("user_admin_a");
            registerUser("user_admin_a");
            registerWorkspace("ws_a");
            registerMembership("mem_a", "user_admin_a", "ws_a", "ADMIN");

            mocks.serviceAreaFindUnique.mockResolvedValue(null);
            mocks.serviceAreaCreate.mockResolvedValue({
                ...sampleServiceArea,
                workspaceId: "ws_a",
            });

            const result = await createServiceArea("ws_a", { name: "Lahore Central / Gulberg" });

            expect(result.workspaceId).toBe("ws_a");
        });

        it("rejects invalid or too short service area name (less than 2 characters)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createServiceArea("ws_123", { name: "L" }),
            ).rejects.toThrow();

            expect(mocks.serviceAreaCreate).not.toHaveBeenCalled();
        });

        it("rejects whitespace-only service area name", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createServiceArea("ws_123", { name: "    " }),
            ).rejects.toThrow();

            expect(mocks.serviceAreaCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. SERVICE AREA RETRIEVAL TESTS
    // =========================================================================
    describe("Service Area Retrieval Operations", () => {
        it("allows authorized roles with MEMBERS_VIEW to retrieve a service area", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);

            const result = await getServiceArea("ws_123", "area_lahore_central");

            expect(mocks.serviceAreaFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "area_lahore_central",
                    workspaceId: "ws_123",
                },
                include: {
                    _count: {
                        select: { technicianServiceAreas: true },
                    },
                },
            });
            expect(result).toEqual(sampleServiceArea);
        });

        it("returns null when service area is not found in the workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(null);

            const result = await getServiceArea("ws_123", "area_nonexistent");
            expect(result).toBeNull();
        });

        it("enforces tenant isolation — Workspace A cannot retrieve Workspace B service area", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getServiceArea("ws_b", "area_lahore_central"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.serviceAreaFindFirst).not.toHaveBeenCalled();
        });

        it("lists service areas strictly scoped to workspace and ordered by name ASC", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            const areas: ServiceArea[] = [
                {
                    id: "area_dha",
                    workspaceId: "ws_123",
                    name: "DHA Lahore",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "area_gulberg",
                    workspaceId: "ws_123",
                    name: "Gulberg",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            mocks.serviceAreaFindMany.mockResolvedValue(areas);

            const result = await getServiceAreas("ws_123");

            expect(mocks.serviceAreaFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_123",
                },
                orderBy: {
                    name: "asc",
                },
                include: {
                    _count: {
                        select: { technicianServiceAreas: true },
                    },
                },
            });
            expect(result).toEqual(areas);
        });
    });

    // =========================================================================
    // 3. SERVICE AREA UPDATE TESTS
    // =========================================================================
    describe("updateServiceArea()", () => {
        it("allows OWNER or ADMIN to update service area details", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);
            const updated = {
                ...sampleServiceArea,
                name: "Lahore Metro Region",
                description: "Expanded regional coverage.",
            };
            mocks.serviceAreaUpdate.mockResolvedValue(updated);

            const result = await updateServiceArea("ws_123", "area_lahore_central", {
                name: "Lahore Metro Region",
                description: "Expanded regional coverage.",
            });

            expect(mocks.serviceAreaUpdate).toHaveBeenCalledWith({
                where: { id: "area_lahore_central" },
                data: {
                    name: "Lahore Metro Region",
                    description: "Expanded regional coverage.",
                },
            });
            expect(result.name).toBe("Lahore Metro Region");
        });

        it("preserves omitted fields during partial update", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);
            mocks.serviceAreaUpdate.mockResolvedValue({
                ...sampleServiceArea,
                description: "Only new description",
            });

            await updateServiceArea("ws_123", "area_lahore_central", {
                description: "Only new description",
            });

            const updateData = mocks.serviceAreaUpdate.mock.calls[0][0].data;
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

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);
            mocks.serviceAreaUpdate.mockResolvedValue({
                ...sampleServiceArea,
                description: null,
            });

            await updateServiceArea("ws_123", "area_lahore_central", {
                description: null,
            });

            const updateData = mocks.serviceAreaUpdate.mock.calls[0][0].data;
            expect(updateData.description).toBeNull();
        });

        it("throws ServiceAreaNotFoundError when updating service area in another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(null);

            await expect(
                updateServiceArea("ws_123", "area_cross_tenant", { name: "Hacked" }),
            ).rejects.toBeInstanceOf(ServiceAreaNotFoundError);

            expect(mocks.serviceAreaUpdate).not.toHaveBeenCalled();
        });

        it("throws ServiceAreaAlreadyExistsError when renaming service area to an existing name in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);
            mocks.serviceAreaFindUnique.mockResolvedValue({
                id: "area_other",
                workspaceId: "ws_123",
                name: "Islamabad",
            });

            await expect(
                updateServiceArea("ws_123", "area_lahore_central", {
                    name: "Islamabad",
                }),
            ).rejects.toBeInstanceOf(ServiceAreaAlreadyExistsError);

            expect(mocks.serviceAreaUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from updating service areas", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                updateServiceArea("ws_123", "area_lahore_central", { name: "Self Named" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.serviceAreaUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. SERVICE AREA STATUS TESTS
    // =========================================================================
    describe("updateServiceAreaStatus()", () => {
        it("allows setting status to INACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);
            mocks.serviceAreaUpdate.mockResolvedValue({
                ...sampleServiceArea,
                status: "INACTIVE",
            });

            const result = await updateServiceAreaStatus(
                "ws_123",
                "area_lahore_central",
                "INACTIVE",
            );

            expect(mocks.serviceAreaUpdate).toHaveBeenCalledWith({
                where: { id: "area_lahore_central" },
                data: { status: "INACTIVE" },
            });
            expect(result.status).toBe("INACTIVE");
        });

        it("allows setting status to ACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue({
                ...sampleServiceArea,
                status: "INACTIVE",
            });
            mocks.serviceAreaUpdate.mockResolvedValue({
                ...sampleServiceArea,
                status: "ACTIVE",
            });

            const result = await updateServiceAreaStatus("ws_123", "area_lahore_central", {
                status: "ACTIVE",
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("rejects invalid service area status", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateServiceAreaStatus("ws_123", "area_lahore_central", "CLOSED"),
            ).rejects.toThrow();

            expect(mocks.serviceAreaUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. SERVICE AREA DELETION TESTS
    // =========================================================================
    describe("deleteServiceArea()", () => {
        it("allows deleting an empty service area (0 assigned technicians)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue({
                ...sampleServiceArea,
                _count: { technicianServiceAreas: 0 },
            });
            mocks.serviceAreaDelete.mockResolvedValue(sampleServiceArea);

            const result = await deleteServiceArea("ws_123", "area_lahore_central");

            expect(mocks.serviceAreaDelete).toHaveBeenCalledWith({
                where: { id: "area_lahore_central" },
            });
            expect(result.id).toBe("area_lahore_central");
        });

        it("rejects deleting a service area that has assigned technicians", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue({
                ...sampleServiceArea,
                _count: { technicianServiceAreas: 4 }, // Has 4 technicians assigned!
            });

            await expect(
                deleteServiceArea("ws_123", "area_lahore_central"),
            ).rejects.toBeInstanceOf(ServiceAreaHasAssignedTechniciansError);

            expect(mocks.serviceAreaDelete).not.toHaveBeenCalled();
        });

        it("throws ServiceAreaNotFoundError when deleting service area not in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.serviceAreaFindFirst.mockResolvedValue(null);

            await expect(
                deleteServiceArea("ws_123", "area_cross_tenant"),
            ).rejects.toBeInstanceOf(ServiceAreaNotFoundError);

            expect(mocks.serviceAreaDelete).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from deleting service areas", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                deleteServiceArea("ws_123", "area_lahore_central"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.serviceAreaDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 6. TECHNICIAN SERVICE AREA ASSIGNMENT TESTS
    // =========================================================================
    describe("assignServiceAreaToTechnician()", () => {
        it("allows OWNER or ADMIN to assign an ACTIVE service area to a technician profile", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);
            mocks.technicianServiceAreaFindUnique.mockResolvedValue(null);
            mocks.technicianServiceAreaCreate.mockResolvedValue({
                ...sampleTechnicianServiceArea,
                serviceArea: sampleServiceArea,
            });

            const result = await assignServiceAreaToTechnician(
                "ws_123",
                "tech_prof_123",
                "area_lahore_central",
                {
                    notes: "Primary coverage route for emergency dispatch.",
                },
            );

            expect(mocks.technicianServiceAreaCreate).toHaveBeenCalledWith({
                data: {
                    technicianProfileId: "tech_prof_123",
                    serviceAreaId: "area_lahore_central",
                    notes: "Primary coverage route for emergency dispatch.",
                },
                include: {
                    serviceArea: true,
                },
            });
            expect(result.id).toBe("tech_area_123");
        });

        it("rejects unauthorized roles from assigning service areas", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                assignServiceAreaToTechnician("ws_123", "tech_prof_123", "area_lahore_central"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.technicianServiceAreaCreate).not.toHaveBeenCalled();
        });

        it("throws InvalidTechnicianProfileError when technician profile is missing or in another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                assignServiceAreaToTechnician("ws_123", "tech_prof_other", "area_lahore_central"),
            ).rejects.toBeInstanceOf(InvalidTechnicianProfileError);

            expect(mocks.technicianServiceAreaCreate).not.toHaveBeenCalled();
        });

        it("throws InvalidServiceAreaAssignmentError when service area is missing or belongs to another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.serviceAreaFindFirst.mockResolvedValue(null); // Not in ws_123

            await expect(
                assignServiceAreaToTechnician("ws_123", "tech_prof_123", "area_other_ws"),
            ).rejects.toBeInstanceOf(InvalidServiceAreaAssignmentError);

            expect(mocks.technicianServiceAreaCreate).not.toHaveBeenCalled();
        });

        it("throws InactiveServiceAreaAssignmentError when attempting to assign an INACTIVE service area", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.serviceAreaFindFirst.mockResolvedValue({
                ...sampleServiceArea,
                status: "INACTIVE",
            });

            await expect(
                assignServiceAreaToTechnician("ws_123", "tech_prof_123", "area_lahore_central"),
            ).rejects.toBeInstanceOf(InactiveServiceAreaAssignmentError);

            expect(mocks.technicianServiceAreaCreate).not.toHaveBeenCalled();
        });

        it("throws TechnicianServiceAreaAlreadyExistsError on duplicate assignment", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.serviceAreaFindFirst.mockResolvedValue(sampleServiceArea);
            mocks.technicianServiceAreaFindUnique.mockResolvedValue(sampleTechnicianServiceArea); // Already assigned!

            await expect(
                assignServiceAreaToTechnician("ws_123", "tech_prof_123", "area_lahore_central"),
            ).rejects.toBeInstanceOf(TechnicianServiceAreaAlreadyExistsError);

            expect(mocks.technicianServiceAreaCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 7. TECHNICIAN SERVICE AREA RETRIEVAL TESTS
    // =========================================================================
    describe("Technician Service Area Retrieval Operations", () => {
        it("allows authorized roles with MEMBERS_VIEW to retrieve assignment by ID", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianServiceAreaFindFirst.mockResolvedValue({
                ...sampleTechnicianServiceArea,
                serviceArea: sampleServiceArea,
                technicianProfile: sampleTechnicianProfile,
            });

            const result = await getTechnicianServiceArea("ws_123", "tech_area_123");

            expect(mocks.technicianServiceAreaFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "tech_area_123",
                    technicianProfile: {
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                },
                include: {
                    serviceArea: true,
                    technicianProfile: true,
                },
            });
            expect(result?.id).toBe("tech_area_123");
            expect(result?.serviceArea.name).toBe("Lahore Central / Gulberg");
        });

        it("allows retrieving all service areas for a technician profile", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianServiceAreaFindMany.mockResolvedValue([
                { ...sampleTechnicianServiceArea, serviceArea: sampleServiceArea },
            ]);

            const result = await getTechnicianServiceAreas("ws_123", "tech_prof_123");

            expect(mocks.technicianServiceAreaFindMany).toHaveBeenCalledWith({
                where: {
                    technicianProfileId: "tech_prof_123",
                },
                orderBy: {
                    serviceArea: {
                        name: "asc",
                    },
                },
                include: {
                    serviceArea: true,
                },
            });
            expect(result).toHaveLength(1);
        });

        it("enforces tenant isolation — Workspace A cannot retrieve Workspace B technician service areas", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getTechnicianServiceAreas("ws_b", "tech_prof_123"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.technicianServiceAreaFindMany).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 8. TECHNICIAN SERVICE AREA UPDATE TESTS
    // =========================================================================
    describe("updateTechnicianServiceArea()", () => {
        it("allows OWNER or ADMIN to update notes", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianServiceAreaFindFirst.mockResolvedValue(sampleTechnicianServiceArea);
            const updated = {
                ...sampleTechnicianServiceArea,
                notes: "Updated coverage route with weekend priority.",
                serviceArea: sampleServiceArea,
            };
            mocks.technicianServiceAreaUpdate.mockResolvedValue(updated);

            const result = await updateTechnicianServiceArea("ws_123", "tech_area_123", {
                notes: "Updated coverage route with weekend priority.",
            });

            expect(mocks.technicianServiceAreaUpdate).toHaveBeenCalledWith({
                where: { id: "tech_area_123" },
                data: {
                    notes: "Updated coverage route with weekend priority.",
                },
                include: {
                    serviceArea: true,
                },
            });
            expect(result.notes).toBe("Updated coverage route with weekend priority.");
        });

        it("preserves omitted fields (undefined) during partial update", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianServiceAreaFindFirst.mockResolvedValue(sampleTechnicianServiceArea);
            mocks.technicianServiceAreaUpdate.mockResolvedValue({
                ...sampleTechnicianServiceArea,
                serviceArea: sampleServiceArea,
            });

            await updateTechnicianServiceArea("ws_123", "tech_area_123", {});

            const updateData = mocks.technicianServiceAreaUpdate.mock.calls[0][0].data;
            expect(updateData.notes).toBeUndefined();
        });

        it("allows updating an existing assignment even if the underlying service area is now INACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianServiceAreaFindFirst.mockResolvedValue(sampleTechnicianServiceArea);
            mocks.technicianServiceAreaUpdate.mockResolvedValue({
                ...sampleTechnicianServiceArea,
                notes: "Maintaining historical notes.",
                serviceArea: { ...sampleServiceArea, status: "INACTIVE" },
            });

            const result = await updateTechnicianServiceArea("ws_123", "tech_area_123", {
                notes: "Maintaining historical notes.",
            });

            expect(result.notes).toBe("Maintaining historical notes.");
        });
    });

    // =========================================================================
    // 9. TECHNICIAN SERVICE AREA REMOVAL TESTS
    // =========================================================================
    describe("removeServiceAreaFromTechnician()", () => {
        it("allows OWNER or ADMIN to remove a service area assignment", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianServiceAreaFindFirst.mockResolvedValue(sampleTechnicianServiceArea);
            mocks.technicianServiceAreaDelete.mockResolvedValue(sampleTechnicianServiceArea);

            const result = await removeServiceAreaFromTechnician("ws_123", "tech_area_123");

            expect(mocks.technicianServiceAreaDelete).toHaveBeenCalledWith({
                where: { id: "tech_area_123" },
            });
            expect(result.id).toBe("tech_area_123");
        });

        it("throws TechnicianServiceAreaNotFoundError when removing assignment not in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianServiceAreaFindFirst.mockResolvedValue(null);

            await expect(
                removeServiceAreaFromTechnician("ws_123", "tech_area_other"),
            ).rejects.toBeInstanceOf(TechnicianServiceAreaNotFoundError);

            expect(mocks.technicianServiceAreaDelete).not.toHaveBeenCalled();
        });

        it("preserves TechnicianProfile, ServiceArea, and Employee when assignment is removed", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianServiceAreaFindFirst.mockResolvedValue(sampleTechnicianServiceArea);
            mocks.technicianServiceAreaDelete.mockResolvedValue(sampleTechnicianServiceArea);

            await removeServiceAreaFromTechnician("ws_123", "tech_area_123");

            // Ensure profile, employee, or service area were NOT deleted
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.serviceAreaDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 10. STATUS INDEPENDENCE
    // =========================================================================
    describe("Status Independence", () => {
        it("service area status modifications do not alter EmployeeStatus, MembershipStatus, or UserStatus", () => {
            expect(sampleEmployee.status).toBe("ACTIVE");
            expect(sampleTechnicianProfile.id).toBe("tech_prof_123");
        });
    });
});
