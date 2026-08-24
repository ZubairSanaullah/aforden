import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    userDelete: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workspaceMemberDelete: vi.fn(),
    departmentCreate: vi.fn(),
    departmentFindUnique: vi.fn(),
    departmentFindFirst: vi.fn(),
    departmentFindMany: vi.fn(),
    departmentUpdate: vi.fn(),
    departmentDelete: vi.fn(),
    employeeCreate: vi.fn(),
    employeeFindUnique: vi.fn(),
    employeeFindFirst: vi.fn(),
    employeeFindMany: vi.fn(),
    employeeUpdate: vi.fn(),
    employeeDelete: vi.fn(),
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
        department: {
            create: mocks.departmentCreate,
            findUnique: mocks.departmentFindUnique,
            findFirst: mocks.departmentFindFirst,
            findMany: mocks.departmentFindMany,
            update: mocks.departmentUpdate,
            delete: mocks.departmentDelete,
        },
        employee: {
            create: mocks.employeeCreate,
            findUnique: mocks.employeeFindUnique,
            findFirst: mocks.employeeFindFirst,
            findMany: mocks.employeeFindMany,
            update: mocks.employeeUpdate,
            delete: mocks.employeeDelete,
        },
    },
}));

import { createDepartment } from "@/lib/services/department/createDepartment";
import { getDepartment } from "@/lib/services/department/getDepartment";
import { getDepartments } from "@/lib/services/department/getDepartments";
import { updateDepartment } from "@/lib/services/department/updateDepartment";
import { updateDepartmentStatus } from "@/lib/services/department/updateDepartmentStatus";
import { deleteDepartment } from "@/lib/services/department/deleteDepartment";
import {
    DepartmentNotFoundError,
    DepartmentAlreadyExistsError,
    DepartmentHasAssignedEmployeesError,
    InvalidDepartmentError,
} from "@/lib/services/department/departmentErrors";
import { createEmployee } from "@/lib/services/employee/createEmployee";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Department, Employee, WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.6 — Departments Service Layer", () => {
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

    const sampleDepartment: Department = {
        id: "dept_field_service",
        workspaceId: "ws_123",
        name: "Field Service",
        description: "Residential and commercial HVAC installation and repairs.",
        status: "ACTIVE",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. CREATION TESTS
    // =========================================================================
    describe("createDepartment()", () => {
        it("allows OWNER to create a department", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.departmentFindUnique.mockResolvedValue(null);
            mocks.departmentCreate.mockResolvedValue(sampleDepartment);

            const result = await createDepartment("ws_123", {
                name: "Field Service",
                description: "Residential and commercial HVAC installation and repairs.",
                status: "ACTIVE",
            });

            expect(mocks.departmentCreate).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_123",
                    name: "Field Service",
                    description: "Residential and commercial HVAC installation and repairs.",
                    status: "ACTIVE",
                },
            });
            expect(result.id).toBe("dept_field_service");
        });

        it("allows ADMIN to create a department", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindUnique.mockResolvedValue(null);
            mocks.departmentCreate.mockResolvedValue(sampleDepartment);

            const result = await createDepartment("ws_123", {
                name: "Field Service",
            });

            expect(mocks.departmentCreate).toHaveBeenCalled();
            expect(result.name).toBe("Field Service");
        });

        it("rejects unauthorized roles (MANAGER, TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                createDepartment("ws_123", { name: "Operations" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.departmentCreate).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createDepartment("ws_123", { name: "Operations" }),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.departmentCreate).not.toHaveBeenCalled();
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createDepartment("ws_123", { name: "Operations" }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.departmentCreate).not.toHaveBeenCalled();
        });

        it("rejects duplicate department name within the same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindUnique.mockResolvedValue(sampleDepartment);

            await expect(
                createDepartment("ws_123", { name: "Field Service" }),
            ).rejects.toBeInstanceOf(DepartmentAlreadyExistsError);

            expect(mocks.departmentCreate).not.toHaveBeenCalled();
        });

        it("allows same department name across different workspaces", async () => {
            setupAuthSession("user_admin_a");
            registerUser("user_admin_a");
            registerWorkspace("ws_a");
            registerMembership("mem_a", "user_admin_a", "ws_a", "ADMIN");

            mocks.departmentFindUnique.mockResolvedValue(null);
            mocks.departmentCreate.mockResolvedValue({
                ...sampleDepartment,
                workspaceId: "ws_a",
            });

            const result = await createDepartment("ws_a", { name: "Field Service" });

            expect(mocks.departmentCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_a",
                    name: "Field Service",
                }),
            });
            expect(result.workspaceId).toBe("ws_a");
        });

        it("rejects invalid or empty department name", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createDepartment("ws_123", { name: "" }),
            ).rejects.toThrow();

            expect(mocks.departmentCreate).not.toHaveBeenCalled();
        });

        it("rejects whitespace-only department name", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createDepartment("ws_123", { name: "    " }),
            ).rejects.toThrow();

            expect(mocks.departmentCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. RETRIEVAL TESTS
    // =========================================================================
    describe("Retrieval Operations", () => {
        it("allows authorized roles with MEMBERS_VIEW (OWNER, ADMIN, MANAGER) to retrieve a department", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.departmentFindFirst.mockResolvedValue(sampleDepartment);

            const result = await getDepartment("ws_123", "dept_field_service");

            expect(mocks.departmentFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "dept_field_service",
                    workspaceId: "ws_123",
                },
                include: {
                    _count: {
                        select: { employees: true },
                    },
                },
            });
            expect(result).toEqual(sampleDepartment);
        });

        it("returns null when department is not found in the workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue(null);

            const result = await getDepartment("ws_123", "dept_nonexistent");
            expect(result).toBeNull();
        });

        it("enforces tenant isolation — Workspace A member cannot retrieve Workspace B department", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getDepartment("ws_b", "dept_field_service"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.departmentFindFirst).not.toHaveBeenCalled();
        });

        it("lists departments strictly scoped to workspace and ordered by name ASC", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            const depts: Department[] = [
                {
                    id: "dept_accounting",
                    workspaceId: "ws_123",
                    name: "Accounting",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "dept_field_service",
                    workspaceId: "ws_123",
                    name: "Field Service",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            mocks.departmentFindMany.mockResolvedValue(depts);

            const result = await getDepartments("ws_123");

            expect(mocks.departmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_123",
                },
                orderBy: {
                    name: "asc",
                },
                include: {
                    _count: {
                        select: { employees: true },
                    },
                },
            });
            expect(result).toEqual(depts);
        });
    });

    // =========================================================================
    // 3. UPDATE TESTS
    // =========================================================================
    describe("updateDepartment()", () => {
        it("allows OWNER or ADMIN to update department details", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue(sampleDepartment);
            const updated = {
                ...sampleDepartment,
                name: "Field Operations",
                description: "Updated description",
            };
            mocks.departmentUpdate.mockResolvedValue(updated);

            const result = await updateDepartment("ws_123", "dept_field_service", {
                name: "Field Operations",
                description: "Updated description",
            });

            expect(mocks.departmentUpdate).toHaveBeenCalledWith({
                where: { id: "dept_field_service" },
                data: {
                    name: "Field Operations",
                    description: "Updated description",
                },
            });
            expect(result.name).toBe("Field Operations");
        });

        it("preserves omitted fields during partial update", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue(sampleDepartment);
            mocks.departmentUpdate.mockResolvedValue({
                ...sampleDepartment,
                description: "New description only",
            });

            await updateDepartment("ws_123", "dept_field_service", {
                description: "New description only",
            });

            const updateData = mocks.departmentUpdate.mock.calls[0][0].data;
            expect(updateData).toEqual({
                description: "New description only",
            });
            expect(updateData.name).toBeUndefined();
            expect(updateData.status).toBeUndefined();
        });

        it("throws DepartmentNotFoundError when updating department in another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue(null);

            await expect(
                updateDepartment("ws_123", "dept_cross_tenant", { name: "Hacked" }),
            ).rejects.toBeInstanceOf(DepartmentNotFoundError);

            expect(mocks.departmentUpdate).not.toHaveBeenCalled();
        });

        it("throws DepartmentAlreadyExistsError when renaming department to an existing name in same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue(sampleDepartment);
            mocks.departmentFindUnique.mockResolvedValue({
                id: "dept_other",
                workspaceId: "ws_123",
                name: "Accounting",
            });

            await expect(
                updateDepartment("ws_123", "dept_field_service", {
                    name: "Accounting",
                }),
            ).rejects.toBeInstanceOf(DepartmentAlreadyExistsError);

            expect(mocks.departmentUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from updating departments", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                updateDepartment("ws_123", "dept_field_service", { name: "Self Named" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.departmentUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. STATUS TESTS
    // =========================================================================
    describe("updateDepartmentStatus()", () => {
        it("allows setting status to INACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue(sampleDepartment);
            mocks.departmentUpdate.mockResolvedValue({
                ...sampleDepartment,
                status: "INACTIVE",
            });

            const result = await updateDepartmentStatus(
                "ws_123",
                "dept_field_service",
                "INACTIVE",
            );

            expect(mocks.departmentUpdate).toHaveBeenCalledWith({
                where: { id: "dept_field_service" },
                data: { status: "INACTIVE" },
            });
            expect(result.status).toBe("INACTIVE");
        });

        it("allows setting status to ACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue({
                ...sampleDepartment,
                status: "INACTIVE",
            });
            mocks.departmentUpdate.mockResolvedValue({
                ...sampleDepartment,
                status: "ACTIVE",
            });

            const result = await updateDepartmentStatus("ws_123", "dept_field_service", {
                status: "ACTIVE",
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("rejects invalid department status", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateDepartmentStatus("ws_123", "dept_field_service", "SUSPENDED"),
            ).rejects.toThrow();

            expect(mocks.departmentUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. DELETION TESTS
    // =========================================================================
    describe("deleteDepartment()", () => {
        it("allows deleting an empty department (0 assigned employees)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue({
                ...sampleDepartment,
                _count: { employees: 0 },
            });
            mocks.departmentDelete.mockResolvedValue(sampleDepartment);

            const result = await deleteDepartment("ws_123", "dept_field_service");

            expect(mocks.departmentDelete).toHaveBeenCalledWith({
                where: { id: "dept_field_service" },
            });
            expect(result.id).toBe("dept_field_service");
        });

        it("rejects deleting a department that has assigned employees", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue({
                ...sampleDepartment,
                _count: { employees: 3 }, // Has 3 employees assigned!
            });

            await expect(
                deleteDepartment("ws_123", "dept_field_service"),
            ).rejects.toBeInstanceOf(DepartmentHasAssignedEmployeesError);

            expect(mocks.departmentDelete).not.toHaveBeenCalled();
        });

        it("throws DepartmentNotFoundError when deleting department not in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.departmentFindFirst.mockResolvedValue(null);

            await expect(
                deleteDepartment("ws_123", "dept_cross_tenant"),
            ).rejects.toBeInstanceOf(DepartmentNotFoundError);

            expect(mocks.departmentDelete).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from deleting departments", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                deleteDepartment("ws_123", "dept_field_service"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.departmentDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 6. EMPLOYEE ↔ DEPARTMENT INTEGRATION & TENANT ISOLATION
    // =========================================================================
    describe("Employee ↔ Department Integration", () => {
        it("allows creating an employee with a valid department in same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            registerUser("user_tech");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN", "ACTIVE", null);

            mocks.departmentFindFirst.mockResolvedValue(sampleDepartment);
            mocks.employeeCreate.mockResolvedValue({
                id: "emp_123",
                workspaceId: "ws_123",
                workspaceMemberId: "mem_tech",
                departmentId: "dept_field_service",
                jobTitleId: null,
                employeeNumber: "EMP-001",
                displayName: "Tech Worker",
                phone: null,
                hireDate: null,
                status: "ACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await createEmployee("ws_123", "mem_tech", {
                displayName: "Tech Worker",
                departmentId: "dept_field_service",
            });

            expect(mocks.departmentFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "dept_field_service",
                    workspaceId: "ws_123",
                },
            });
            expect(result.departmentId).toBe("dept_field_service");
        });

        it("rejects creating an employee assigned to a department belonging to another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            registerUser("user_tech");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN", "ACTIVE", null);

            // Department not found in ws_123
            mocks.departmentFindFirst.mockResolvedValue(null);

            await expect(
                createEmployee("ws_123", "mem_tech", {
                    displayName: "Tech Worker",
                    departmentId: "dept_other_tenant",
                }),
            ).rejects.toBeInstanceOf(InvalidDepartmentError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });
    });
});
