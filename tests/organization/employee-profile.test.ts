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
    },
}));

import { getEmployee } from "@/lib/services/employee/getEmployee";
import { getEmployeeByWorkspaceMember } from "@/lib/services/employee/getEmployeeByWorkspaceMember";
import { createEmployee } from "@/lib/services/employee/createEmployee";
import { updateEmployee } from "@/lib/services/employee/updateEmployee";
import { deleteEmployee } from "@/lib/services/employee/deleteEmployee";
import {
    EmployeeNotFoundError,
    WorkspaceMemberNotFoundError,
    EmployeeAlreadyExistsError,
    InvalidWorkspaceMemberError,
    DuplicateEmployeeNumberError,
} from "@/lib/services/employee/employeeErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Employee, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.3.4 — Employee Profiles Service Layer", () => {
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
        const user = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            status,
            emailVerified: new Date(),
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
        const member = {
            id: memberId,
            userId,
            workspaceId,
            role,
            status,
            employee,
        };
        membersMap.set(memberId, member);
        membersMap.set(`${userId}_${workspaceId}`, member);
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
        displayName: "John Technician",
        phone: "+1-555-0155",
        hireDate: new Date("2026-01-01T00:00:00.000Z"),
        status: "ACTIVE",
        notes: "Experienced in residential heat pumps.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. RETRIEVAL TESTS
    // =========================================================================
    describe("Retrieval Operations", () => {
        it("allows an authorized member with MEMBERS_VIEW to retrieve an employee by ID", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr", "Manager User");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr_123", "user_mgr", "ws_123", "MANAGER");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);

            const result = await getEmployee("ws_123", "emp_123");

            expect(mocks.employeeFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "emp_123",
                    workspaceId: "ws_123",
                },
                include: expect.any(Object),
            });
            expect(result).toEqual(sampleEmployee);
        });

        it("allows an authorized member to retrieve an employee by workspaceMemberId", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);

            const result = await getEmployeeByWorkspaceMember("ws_123", "mem_tech_456");

            expect(mocks.employeeFindFirst).toHaveBeenCalledWith({
                where: {
                    workspaceMemberId: "mem_tech_456",
                    workspaceId: "ws_123",
                },
                include: expect.any(Object),
            });
            expect(result).toEqual(sampleEmployee);
        });

        it("returns null when an employee is not found in the workspace", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(null);

            const result = await getEmployee("ws_123", "emp_nonexistent");

            expect(result).toBeNull();
        });

        it("rejects unauthenticated requests", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(getEmployee("ws_123", "emp_123")).rejects.toBeInstanceOf(
                UnauthorizedError,
            );
            expect(mocks.employeeFindFirst).not.toHaveBeenCalled();
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");
            // No membership in ws_123

            await expect(getEmployee("ws_123", "emp_123")).rejects.toBeInstanceOf(
                WorkspaceAccessDeniedError,
            );
            expect(mocks.employeeFindFirst).not.toHaveBeenCalled();
        });

        it("rejects inactive or suspended users", async () => {
            setupAuthSession("user_suspended");
            registerUser("user_suspended", "Suspended", "SUSPENDED");
            registerWorkspace("ws_123");
            registerMembership("mem_susp", "user_suspended", "ws_123", "ADMIN");

            await expect(getEmployee("ws_123", "emp_123")).rejects.toBeInstanceOf(
                WorkspaceAccessDeniedError,
            );
            expect(mocks.employeeFindFirst).not.toHaveBeenCalled();
        });

        it("enforces tenant isolation — Workspace A member cannot retrieve Workspace B employee", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(getEmployee("ws_b", "emp_123")).rejects.toBeInstanceOf(
                WorkspaceAccessDeniedError,
            );
            expect(mocks.employeeFindFirst).not.toHaveBeenCalled();
        });

        it("rejects retrieval for roles lacking MEMBERS_VIEW (e.g. TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(getEmployee("ws_123", "emp_123")).rejects.toBeInstanceOf(
                ForbiddenError,
            );
            expect(mocks.employeeFindFirst).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. CREATION TESTS
    // =========================================================================
    describe("createEmployee()", () => {
        it("allows OWNER or ADMIN to create an employee profile", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            // Target member to be turned into employee
            registerUser("user_tech_789");
            registerMembership("mem_tech_456", "user_tech_789", "ws_123", "TECHNICIAN", "ACTIVE", null);

            mocks.employeeFindUnique.mockResolvedValue(null); // No duplicate number
            mocks.employeeCreate.mockResolvedValue(sampleEmployee);

            const result = await createEmployee("ws_123", "mem_tech_456", {
                employeeNumber: "EMP-001",
                displayName: "John Technician",
                phone: "+1-555-0155",
                hireDate: new Date("2026-01-01T00:00:00.000Z"),
                status: "ACTIVE",
                notes: "Experienced in residential heat pumps.",
            });

            expect(mocks.employeeCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_123",
                    workspaceMemberId: "mem_tech_456",
                    employeeNumber: "EMP-001",
                    displayName: "John Technician",
                    status: "ACTIVE",
                }),
            });
            expect(result.id).toBe("emp_123");
        });

        it("rejects unauthorized roles (e.g. MANAGER, TECHNICIAN) from creating employees", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr_123", "user_mgr", "ws_123", "MANAGER");

            await expect(
                createEmployee("ws_123", "mem_tech_456", {
                    displayName: "HVAC Tech",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });

        it("throws WorkspaceMemberNotFoundError when target member does not exist", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            await expect(
                createEmployee("ws_123", "mem_missing", {
                    displayName: "HVAC Tech",
                }),
            ).rejects.toBeInstanceOf(WorkspaceMemberNotFoundError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });

        it("throws InvalidWorkspaceMemberError when target member belongs to another workspace", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerWorkspace("ws_other");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            // Target member belongs to ws_other
            registerUser("user_other_tech");
            registerMembership("mem_other_tech", "user_other_tech", "ws_other", "TECHNICIAN", "ACTIVE", null);

            await expect(
                createEmployee("ws_123", "mem_other_tech", {
                    displayName: "HVAC Tech",
                }),
            ).rejects.toBeInstanceOf(InvalidWorkspaceMemberError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });

        it("throws EmployeeAlreadyExistsError when target member already has an employee profile", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            // Target member already has an employee profile
            registerUser("user_tech_789");
            registerMembership("mem_tech_456", "user_tech_789", "ws_123", "TECHNICIAN", "ACTIVE", sampleEmployee);

            await expect(
                createEmployee("ws_123", "mem_tech_456", {
                    displayName: "Second Employee Profile",
                }),
            ).rejects.toBeInstanceOf(EmployeeAlreadyExistsError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });

        it("throws DuplicateEmployeeNumberError when employee number already exists in the same workspace", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            registerUser("user_tech_789");
            registerMembership("mem_tech_456", "user_tech_789", "ws_123", "TECHNICIAN", "ACTIVE", null);

            mocks.employeeFindUnique.mockResolvedValue({
                id: "emp_existing_number",
                workspaceId: "ws_123",
                employeeNumber: "EMP-001",
            });

            await expect(
                createEmployee("ws_123", "mem_tech_456", {
                    employeeNumber: "EMP-001",
                }),
            ).rejects.toBeInstanceOf(DuplicateEmployeeNumberError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });

        it("allows creating an employee with null/omitted employeeNumber", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            registerUser("user_tech_789");
            registerMembership("mem_tech_456", "user_tech_789", "ws_123", "TECHNICIAN", "ACTIVE", null);

            mocks.employeeCreate.mockResolvedValue({
                ...sampleEmployee,
                employeeNumber: null,
            });
            const result = await createEmployee("ws_123", "mem_tech_456", {
                displayName: "Jane Tech",
                notes: "Dispatcher notes",
            });

            expect(mocks.employeeCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    employeeNumber: null,
                    displayName: "Jane Tech",
                    notes: "Dispatcher notes",
                }),
            });
            expect(result.employeeNumber).toBeNull();
        });
    });

    // =========================================================================
    // 3. UPDATE TESTS
    // =========================================================================
    describe("updateEmployee()", () => {
        it("allows OWNER or ADMIN to update employee details", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            const updated = {
                ...sampleEmployee,
                displayName: "Senior Master HVAC Tech",
                phone: "+1-555-9999",
            };
            mocks.employeeUpdate.mockResolvedValue(updated);

            const result = await updateEmployee("ws_123", "emp_123", {
                displayName: "Senior Master HVAC Tech",
                phone: "+1-555-9999",
            });

            expect(mocks.employeeUpdate).toHaveBeenCalledWith({
                where: { id: "emp_123" },
                data: {
                    displayName: "Senior Master HVAC Tech",
                    phone: "+1-555-9999",
                },
            });
            expect(result.displayName).toBe("Senior Master HVAC Tech");
        });

        it("preserves omitted fields (undefined) during partial update", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                displayName: "Updated Title",
            });

            await updateEmployee("ws_123", "emp_123", {
                displayName: "Updated Title",
            });

            const passedData = mocks.employeeUpdate.mock.calls[0][0].data;
            expect(passedData).toEqual({
                displayName: "Updated Title",
            });
            expect(passedData.phone).toBeUndefined();
            expect(passedData.employeeNumber).toBeUndefined();
            expect(passedData.notes).toBeUndefined();
        });

        it("clears nullable fields when explicitly passed as null", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                phone: null,
                notes: null,
            });

            await updateEmployee("ws_123", "emp_123", {
                phone: null,
                notes: null,
            });

            const passedData = mocks.employeeUpdate.mock.calls[0][0].data;
            expect(passedData.phone).toBeNull();
            expect(passedData.notes).toBeNull();
        });

        it("throws EmployeeNotFoundError when updating an employee not in the workspace (tenant-scoped)", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(null);

            await expect(
                updateEmployee("ws_123", "emp_other_tenant", {
                    displayName: "Hacked Title",
                }),
            ).rejects.toBeInstanceOf(EmployeeNotFoundError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("throws DuplicateEmployeeNumberError when updating employee number to an existing number in the workspace", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee); // has employeeNumber "EMP-001"
            mocks.employeeFindUnique.mockResolvedValue({
                id: "emp_other_existing",
                workspaceId: "ws_123",
                employeeNumber: "EMP-002",
            });

            await expect(
                updateEmployee("ws_123", "emp_123", {
                    employeeNumber: "EMP-002",
                }),
            ).rejects.toBeInstanceOf(DuplicateEmployeeNumberError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from updating employees", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                updateEmployee("ws_123", "emp_123", {
                    displayName: "Self Promotion",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects invalid status values during update", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            await expect(
                updateEmployee("ws_123", "emp_123", {
                    status: "INVALID_STATUS",
                }),
            ).rejects.toThrow();

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. DELETION TESTS
    // =========================================================================
    describe("deleteEmployee()", () => {
        it("allows OWNER or ADMIN to delete an employee profile", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeDelete.mockResolvedValue(sampleEmployee);

            const result = await deleteEmployee("ws_123", "emp_123");

            expect(mocks.employeeFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "emp_123",
                    workspaceId: "ws_123",
                },
            });
            expect(mocks.employeeDelete).toHaveBeenCalledWith({
                where: {
                    id: "emp_123",
                },
            });
            expect(result.id).toBe("emp_123");
        });

        it("does NOT delete User or WorkspaceMember when Employee profile is deleted", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeDelete.mockResolvedValue(sampleEmployee);

            await deleteEmployee("ws_123", "emp_123");

            // Verify User and WorkspaceMember were NOT deleted
            expect(mocks.userDelete).not.toHaveBeenCalled();
            expect(mocks.workspaceMemberDelete).not.toHaveBeenCalled();
        });

        it("throws EmployeeNotFoundError when deleting an employee that does not belong to the workspace", async () => {
            setupAuthSession("user_admin_123");
            registerUser("user_admin_123");
            registerWorkspace("ws_123");
            registerMembership("mem_admin_123", "user_admin_123", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(null);

            await expect(
                deleteEmployee("ws_123", "emp_cross_tenant"),
            ).rejects.toBeInstanceOf(EmployeeNotFoundError);

            expect(mocks.employeeDelete).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles (e.g. MANAGER, TECHNICIAN, DISPATCHER) from deleting employees", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr_123", "user_mgr", "ws_123", "MANAGER");

            await expect(
                deleteEmployee("ws_123", "emp_123"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.employeeDelete).not.toHaveBeenCalled();
        });
    });
});
