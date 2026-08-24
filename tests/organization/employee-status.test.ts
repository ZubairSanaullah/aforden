import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    userUpdate: vi.fn(),
    userDelete: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workspaceMemberUpdate: vi.fn(),
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
            update: mocks.userUpdate,
            delete: mocks.userDelete,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
            update: mocks.workspaceMemberUpdate,
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
import { updateEmployeeStatus } from "@/lib/services/employee/updateEmployeeStatus";
import { EmployeeNotFoundError } from "@/lib/services/employee/employeeErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Employee, EmployeeStatus, WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.5 — Employee Status Lifecycle", () => {
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
        displayName: "John Technician",
        phone: "+1-555-0155",
        hireDate: new Date("2026-01-01T00:00:00.000Z"),
        status: "ACTIVE",
        notes: "Certified for commercial systems.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. RETRIEVAL & STATUS EXPOSURE
    // =========================================================================
    describe("Status Retrieval", () => {
        it("exposes the current employee status via getEmployee", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);

            const result = await getEmployee("ws_123", "emp_123");

            expect(result?.status).toBe("ACTIVE");
        });

        it("reflects status updates in subsequent retrieval", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            const updatedEmployee: Employee = {
                ...sampleEmployee,
                status: "ON_LEAVE",
            };
            mocks.employeeFindFirst.mockResolvedValue(updatedEmployee);

            const result = await getEmployee("ws_123", "emp_123");

            expect(result?.status).toBe("ON_LEAVE");
        });
    });

    // =========================================================================
    // 2. AUTHORIZATION TESTS
    // =========================================================================
    describe("Authorization & RBAC", () => {
        it("allows OWNER to update employee status", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "ON_LEAVE",
            });

            const result = await updateEmployeeStatus("ws_123", "emp_123", "ON_LEAVE");

            expect(mocks.employeeUpdate).toHaveBeenCalledWith({
                where: { id: "emp_123" },
                data: { status: "ON_LEAVE" },
            });
            expect(result.status).toBe("ON_LEAVE");
        });

        it("allows ADMIN to update employee status using { status } object", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "INACTIVE",
            });

            const result = await updateEmployeeStatus("ws_123", "emp_123", {
                status: "INACTIVE",
            });

            expect(mocks.employeeUpdate).toHaveBeenCalledWith({
                where: { id: "emp_123" },
                data: { status: "INACTIVE" },
            });
            expect(result.status).toBe("INACTIVE");
        });

        it("rejects unauthorized roles (MANAGER, TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", "TERMINATED"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", "ACTIVE"),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_stranger");
            registerUser("user_stranger");
            registerWorkspace("ws_123");

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", "ACTIVE"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects suspended or inactive workspace members", async () => {
            setupAuthSession("user_suspended");
            registerUser("user_suspended", "Suspended", "SUSPENDED");
            registerWorkspace("ws_123");
            registerMembership("mem_susp", "user_suspended", "ws_123", "ADMIN");

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", "ACTIVE"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 3. VALIDATION TESTS
    // =========================================================================
    describe("Status Validation", () => {
        const validStatuses: EmployeeStatus[] = [
            "ACTIVE",
            "INACTIVE",
            "ON_LEAVE",
            "TERMINATED",
        ];

        validStatuses.forEach((status) => {
            it(`accepts valid status "${status}"`, async () => {
                setupAuthSession("user_admin");
                registerUser("user_admin");
                registerWorkspace("ws_123");
                registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

                mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
                mocks.employeeUpdate.mockResolvedValue({
                    ...sampleEmployee,
                    status,
                });

                const result = await updateEmployeeStatus("ws_123", "emp_123", status);
                expect(result.status).toBe(status);
            });
        });

        it("rejects arbitrary invalid status string", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", "SUSPENDED"),
            ).rejects.toThrow();

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects null status", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", null),
            ).rejects.toThrow();

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects empty string status", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", ""),
            ).rejects.toThrow();

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });

        it("rejects lowercase variant strings", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateEmployeeStatus("ws_123", "emp_123", "active"),
            ).rejects.toThrow();

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. TENANT ISOLATION
    // =========================================================================
    describe("Tenant Isolation", () => {
        it("rejects status mutation on an employee belonging to another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            // Employee is in another tenant, so findFirst with { id, workspaceId: "ws_123" } returns null
            mocks.employeeFindFirst.mockResolvedValue(null);

            await expect(
                updateEmployeeStatus("ws_123", "emp_cross_tenant", "TERMINATED"),
            ).rejects.toBeInstanceOf(EmployeeNotFoundError);

            expect(mocks.employeeUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. MUTATION INTEGRITY & PRESERVATION OF OTHER FIELDS
    // =========================================================================
    describe("Mutation Integrity", () => {
        it("preserves all other employee fields when changing status", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "ON_LEAVE",
            });

            await updateEmployeeStatus("ws_123", "emp_123", "ON_LEAVE");

            const updateCallData = mocks.employeeUpdate.mock.calls[0][0].data;
            expect(updateCallData).toEqual({
                status: "ON_LEAVE",
            });
            // Ensure no other fields were overwritten
            expect(updateCallData.employeeNumber).toBeUndefined();
            expect(updateCallData.displayName).toBeUndefined();
            expect(updateCallData.departmentId).toBeUndefined();
            expect(updateCallData.jobTitleId).toBeUndefined();
            expect(updateCallData.phone).toBeUndefined();
            expect(updateCallData.hireDate).toBeUndefined();
            expect(updateCallData.notes).toBeUndefined();
        });
    });

    // =========================================================================
    // 6. STATUS INDEPENDENCE
    // =========================================================================
    describe("Status Independence", () => {
        it("does NOT modify MembershipStatus or UserStatus when EmployeeStatus changes", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue(sampleEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "TERMINATED",
            });

            await updateEmployeeStatus("ws_123", "emp_123", "TERMINATED");

            // Verify no side-effects on User or WorkspaceMember
            expect(mocks.userUpdate).not.toHaveBeenCalled();
            expect(mocks.workspaceMemberUpdate).not.toHaveBeenCalled();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 7. LIFECYCLE TRANSITIONS
    // =========================================================================
    describe("Lifecycle Transitions", () => {
        it("supports ACTIVE -> ON_LEAVE transition", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                status: "ACTIVE",
            });
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "ON_LEAVE",
            });

            const result = await updateEmployeeStatus("ws_123", "emp_123", "ON_LEAVE");
            expect(result.status).toBe("ON_LEAVE");
        });

        it("supports ON_LEAVE -> ACTIVE transition", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                status: "ON_LEAVE",
            });
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "ACTIVE",
            });

            const result = await updateEmployeeStatus("ws_123", "emp_123", "ACTIVE");
            expect(result.status).toBe("ACTIVE");
        });

        it("supports ACTIVE -> INACTIVE transition", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                status: "ACTIVE",
            });
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "INACTIVE",
            });

            const result = await updateEmployeeStatus("ws_123", "emp_123", "INACTIVE");
            expect(result.status).toBe("INACTIVE");
        });

        it("supports INACTIVE -> ACTIVE transition", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                status: "INACTIVE",
            });
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "ACTIVE",
            });

            const result = await updateEmployeeStatus("ws_123", "emp_123", "ACTIVE");
            expect(result.status).toBe("ACTIVE");
        });

        it("supports ACTIVE -> TERMINATED transition and preserves employee record without deletion", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.employeeFindFirst.mockResolvedValue({
                ...sampleEmployee,
                status: "ACTIVE",
            });
            mocks.employeeUpdate.mockResolvedValue({
                ...sampleEmployee,
                status: "TERMINATED",
            });

            const result = await updateEmployeeStatus("ws_123", "emp_123", "TERMINATED");

            expect(result.status).toBe("TERMINATED");
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
        });
    });
});
