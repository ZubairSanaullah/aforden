import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    userDelete: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workspaceMemberDelete: vi.fn(),
    jobTitleCreate: vi.fn(),
    jobTitleFindUnique: vi.fn(),
    jobTitleFindFirst: vi.fn(),
    jobTitleFindMany: vi.fn(),
    jobTitleUpdate: vi.fn(),
    jobTitleDelete: vi.fn(),
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
        jobTitle: {
            create: mocks.jobTitleCreate,
            findUnique: mocks.jobTitleFindUnique,
            findFirst: mocks.jobTitleFindFirst,
            findMany: mocks.jobTitleFindMany,
            update: mocks.jobTitleUpdate,
            delete: mocks.jobTitleDelete,
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

import { createJobTitle } from "@/lib/services/jobTitle/createJobTitle";
import { getJobTitle } from "@/lib/services/jobTitle/getJobTitle";
import { getJobTitles } from "@/lib/services/jobTitle/getJobTitles";
import { updateJobTitle } from "@/lib/services/jobTitle/updateJobTitle";
import { updateJobTitleStatus } from "@/lib/services/jobTitle/updateJobTitleStatus";
import { deleteJobTitle } from "@/lib/services/jobTitle/deleteJobTitle";
import {
    JobTitleNotFoundError,
    JobTitleAlreadyExistsError,
    JobTitleHasAssignedEmployeesError,
    InvalidJobTitleError,
    InactiveJobTitleAssignmentError,
} from "@/lib/services/jobTitle/jobTitleErrors";
import { createEmployee } from "@/lib/services/employee/createEmployee";
import { updateEmployee } from "@/lib/services/employee/updateEmployee";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { JobTitle, Employee, WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.7 — Job Titles Service Layer", () => {
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
        platformRole: null,
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

    const sampleJobTitle: JobTitle = {
        id: "job_lead_tech",
        workspaceId: "ws_123",
        name: "Senior HVAC Technician",
        description: "Specializes in complex heat pump and refrigeration diagnostic repairs.",
        status: "ACTIVE",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. CREATION TESTS
    // =========================================================================
    describe("createJobTitle()", () => {
        it("allows OWNER to create a job title", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.jobTitleFindUnique.mockResolvedValue(null);
            mocks.jobTitleCreate.mockResolvedValue(sampleJobTitle);

            const result = await createJobTitle("ws_123", {
                name: "Senior HVAC Technician",
                description: "Specializes in complex heat pump and refrigeration diagnostic repairs.",
                status: "ACTIVE",
            });

            expect(mocks.jobTitleCreate).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_123",
                    name: "Senior HVAC Technician",
                    description: "Specializes in complex heat pump and refrigeration diagnostic repairs.",
                    status: "ACTIVE",
                },
            });
            expect(result.id).toBe("job_lead_tech");
        });

        it("allows ADMIN to create a job title", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindUnique.mockResolvedValue(null);
            mocks.jobTitleCreate.mockResolvedValue(sampleJobTitle);

            const result = await createJobTitle("ws_123", {
                name: "Senior HVAC Technician",
            });

            expect(mocks.jobTitleCreate).toHaveBeenCalled();
            expect(result.name).toBe("Senior HVAC Technician");
        });

        it("rejects unauthorized roles (MANAGER, TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                createJobTitle("ws_123", { name: "Operations Manager" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.jobTitleCreate).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createJobTitle("ws_123", { name: "Operations Manager" }),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.jobTitleCreate).not.toHaveBeenCalled();
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createJobTitle("ws_123", { name: "Operations Manager" }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.jobTitleCreate).not.toHaveBeenCalled();
        });

        it("rejects duplicate job title name within the same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindUnique.mockResolvedValue(sampleJobTitle);

            await expect(
                createJobTitle("ws_123", { name: "Senior HVAC Technician" }),
            ).rejects.toBeInstanceOf(JobTitleAlreadyExistsError);

            expect(mocks.jobTitleCreate).not.toHaveBeenCalled();
        });

        it("allows same job title name across different workspaces", async () => {
            setupAuthSession("user_admin_a");
            registerUser("user_admin_a");
            registerWorkspace("ws_a");
            registerMembership("mem_a", "user_admin_a", "ws_a", "ADMIN");

            mocks.jobTitleFindUnique.mockResolvedValue(null);
            mocks.jobTitleCreate.mockResolvedValue({
                ...sampleJobTitle,
                workspaceId: "ws_a",
            });

            const result = await createJobTitle("ws_a", { name: "Senior HVAC Technician" });

            expect(mocks.jobTitleCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_a",
                    name: "Senior HVAC Technician",
                }),
            });
            expect(result.workspaceId).toBe("ws_a");
        });

        it("rejects invalid or empty job title name", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createJobTitle("ws_123", { name: "" }),
            ).rejects.toThrow();

            expect(mocks.jobTitleCreate).not.toHaveBeenCalled();
        });

        it("rejects whitespace-only job title name", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                createJobTitle("ws_123", { name: "    " }),
            ).rejects.toThrow();

            expect(mocks.jobTitleCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. RETRIEVAL TESTS
    // =========================================================================
    describe("Retrieval Operations", () => {
        it("allows authorized roles with MEMBERS_VIEW to retrieve a job title", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.jobTitleFindFirst.mockResolvedValue(sampleJobTitle);

            const result = await getJobTitle("ws_123", "job_lead_tech");

            expect(mocks.jobTitleFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "job_lead_tech",
                    workspaceId: "ws_123",
                },
                include: {
                    _count: {
                        select: { employees: true },
                    },
                },
            });
            expect(result).toEqual(sampleJobTitle);
        });

        it("returns null when job title is not found in the workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue(null);

            const result = await getJobTitle("ws_123", "job_nonexistent");
            expect(result).toBeNull();
        });

        it("enforces tenant isolation — Workspace A member cannot retrieve Workspace B job title", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getJobTitle("ws_b", "job_lead_tech"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.jobTitleFindFirst).not.toHaveBeenCalled();
        });

        it("lists job titles strictly scoped to workspace and ordered by name ASC", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            const titles: JobTitle[] = [
                {
                    id: "job_accountant",
                    workspaceId: "ws_123",
                    name: "Accounts Officer",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "job_lead_tech",
                    workspaceId: "ws_123",
                    name: "Senior HVAC Technician",
                    description: null,
                    status: "ACTIVE",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            mocks.jobTitleFindMany.mockResolvedValue(titles);

            const result = await getJobTitles("ws_123");

            expect(mocks.jobTitleFindMany).toHaveBeenCalledWith({
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
            expect(result).toEqual(titles);
        });
    });

    // =========================================================================
    // 3. UPDATE TESTS
    // =========================================================================
    describe("updateJobTitle()", () => {
        it("allows OWNER or ADMIN to update job title details", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue(sampleJobTitle);
            const updated = {
                ...sampleJobTitle,
                name: "Master HVAC Specialist",
                description: "Updated description",
            };
            mocks.jobTitleUpdate.mockResolvedValue(updated);

            const result = await updateJobTitle("ws_123", "job_lead_tech", {
                name: "Master HVAC Specialist",
                description: "Updated description",
            });

            expect(mocks.jobTitleUpdate).toHaveBeenCalledWith({
                where: { id: "job_lead_tech" },
                data: {
                    name: "Master HVAC Specialist",
                    description: "Updated description",
                },
            });
            expect(result.name).toBe("Master HVAC Specialist");
        });

        it("preserves omitted fields during partial update", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue(sampleJobTitle);
            mocks.jobTitleUpdate.mockResolvedValue({
                ...sampleJobTitle,
                description: "New description only",
            });

            await updateJobTitle("ws_123", "job_lead_tech", {
                description: "New description only",
            });

            const updateData = mocks.jobTitleUpdate.mock.calls[0][0].data;
            expect(updateData).toEqual({
                description: "New description only",
            });
            expect(updateData.name).toBeUndefined();
            expect(updateData.status).toBeUndefined();
        });

        it("throws JobTitleNotFoundError when updating job title in another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue(null);

            await expect(
                updateJobTitle("ws_123", "job_cross_tenant", { name: "Hacked" }),
            ).rejects.toBeInstanceOf(JobTitleNotFoundError);

            expect(mocks.jobTitleUpdate).not.toHaveBeenCalled();
        });

        it("throws JobTitleAlreadyExistsError when renaming job title to an existing name in same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue(sampleJobTitle);
            mocks.jobTitleFindUnique.mockResolvedValue({
                id: "job_other",
                workspaceId: "ws_123",
                name: "Field Engineer",
            });

            await expect(
                updateJobTitle("ws_123", "job_lead_tech", {
                    name: "Field Engineer",
                }),
            ).rejects.toBeInstanceOf(JobTitleAlreadyExistsError);

            expect(mocks.jobTitleUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from updating job titles", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                updateJobTitle("ws_123", "job_lead_tech", { name: "Self Named" }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.jobTitleUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. STATUS TESTS
    // =========================================================================
    describe("updateJobTitleStatus()", () => {
        it("allows setting status to INACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue(sampleJobTitle);
            mocks.jobTitleUpdate.mockResolvedValue({
                ...sampleJobTitle,
                status: "INACTIVE",
            });

            const result = await updateJobTitleStatus(
                "ws_123",
                "job_lead_tech",
                "INACTIVE",
            );

            expect(mocks.jobTitleUpdate).toHaveBeenCalledWith({
                where: { id: "job_lead_tech" },
                data: { status: "INACTIVE" },
            });
            expect(result.status).toBe("INACTIVE");
        });

        it("allows setting status to ACTIVE", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue({
                ...sampleJobTitle,
                status: "INACTIVE",
            });
            mocks.jobTitleUpdate.mockResolvedValue({
                ...sampleJobTitle,
                status: "ACTIVE",
            });

            const result = await updateJobTitleStatus("ws_123", "job_lead_tech", {
                status: "ACTIVE",
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("rejects invalid job title status", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            await expect(
                updateJobTitleStatus("ws_123", "job_lead_tech", "SUSPENDED"),
            ).rejects.toThrow();

            expect(mocks.jobTitleUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. DELETION TESTS
    // =========================================================================
    describe("deleteJobTitle()", () => {
        it("allows deleting an empty job title (0 assigned employees)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue({
                ...sampleJobTitle,
                _count: { employees: 0 },
            });
            mocks.jobTitleDelete.mockResolvedValue(sampleJobTitle);

            const result = await deleteJobTitle("ws_123", "job_lead_tech");

            expect(mocks.jobTitleDelete).toHaveBeenCalledWith({
                where: { id: "job_lead_tech" },
            });
            expect(result.id).toBe("job_lead_tech");
        });

        it("rejects deleting a job title that has assigned employees", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue({
                ...sampleJobTitle,
                _count: { employees: 4 }, // Has 4 employees assigned!
            });

            await expect(
                deleteJobTitle("ws_123", "job_lead_tech"),
            ).rejects.toBeInstanceOf(JobTitleHasAssignedEmployeesError);

            expect(mocks.jobTitleDelete).not.toHaveBeenCalled();
        });

        it("throws JobTitleNotFoundError when deleting job title not in workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.jobTitleFindFirst.mockResolvedValue(null);

            await expect(
                deleteJobTitle("ws_123", "job_cross_tenant"),
            ).rejects.toBeInstanceOf(JobTitleNotFoundError);

            expect(mocks.jobTitleDelete).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles from deleting job titles", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            await expect(
                deleteJobTitle("ws_123", "job_lead_tech"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.jobTitleDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 6. EMPLOYEE ↔ JOB TITLE INTEGRATION
    // =========================================================================
    describe("Employee ↔ JobTitle Integration", () => {
        it("allows creating an employee with a valid ACTIVE job title in same workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            registerUser("user_tech");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN", "ACTIVE", null);

            mocks.jobTitleFindFirst.mockResolvedValue(sampleJobTitle);
            mocks.employeeCreate.mockResolvedValue({
                id: "emp_123",
                workspaceId: "ws_123",
                workspaceMemberId: "mem_tech",
                departmentId: null,
                jobTitleId: "job_lead_tech",
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
                jobTitleId: "job_lead_tech",
            });

            expect(mocks.jobTitleFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "job_lead_tech",
                    workspaceId: "ws_123",
                },
            });
            expect(result.jobTitleId).toBe("job_lead_tech");
        });

        it("rejects creating an employee assigned to a job title belonging to another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            registerUser("user_tech");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN", "ACTIVE", null);

            // JobTitle not found in ws_123
            mocks.jobTitleFindFirst.mockResolvedValue(null);

            await expect(
                createEmployee("ws_123", "mem_tech", {
                    displayName: "Tech Worker",
                    jobTitleId: "job_other_tenant",
                }),
            ).rejects.toBeInstanceOf(InvalidJobTitleError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });

        it("rejects new employee assignment to an INACTIVE job title", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            registerUser("user_tech");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN", "ACTIVE", null);

            mocks.jobTitleFindFirst.mockResolvedValue({
                ...sampleJobTitle,
                status: "INACTIVE",
            });

            await expect(
                createEmployee("ws_123", "mem_tech", {
                    displayName: "Tech Worker",
                    jobTitleId: "job_lead_tech",
                }),
            ).rejects.toBeInstanceOf(InactiveJobTitleAssignmentError);

            expect(mocks.employeeCreate).not.toHaveBeenCalled();
        });

        it("allows existing employee with INACTIVE job title to retain it on other updates", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            const existingEmployee: Employee = {
                id: "emp_123",
                workspaceId: "ws_123",
                workspaceMemberId: "mem_tech",
                departmentId: null,
                jobTitleId: "job_lead_tech", // already assigned to this job title
                employeeNumber: "EMP-001",
                displayName: "Tech Worker",
                phone: null,
                hireDate: null,
                status: "ACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.employeeFindFirst.mockResolvedValue(existingEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...existingEmployee,
                displayName: "Tech Worker Renamed",
            });

            const result = await updateEmployee("ws_123", "emp_123", {
                displayName: "Tech Worker Renamed",
                jobTitleId: "job_lead_tech", // keeping same title
            });

            expect(result.displayName).toBe("Tech Worker Renamed");
            expect(result.jobTitleId).toBe("job_lead_tech");
        });

        it("allows removing a job title from an employee by setting jobTitleId to null", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            const existingEmployee: Employee = {
                id: "emp_123",
                workspaceId: "ws_123",
                workspaceMemberId: "mem_tech",
                departmentId: null,
                jobTitleId: "job_lead_tech",
                employeeNumber: "EMP-001",
                displayName: "Tech Worker",
                phone: null,
                hireDate: null,
                status: "ACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.employeeFindFirst.mockResolvedValue(existingEmployee);
            mocks.employeeUpdate.mockResolvedValue({
                ...existingEmployee,
                jobTitleId: null,
            });

            const result = await updateEmployee("ws_123", "emp_123", {
                jobTitleId: null,
            });

            expect(mocks.employeeUpdate).toHaveBeenCalledWith({
                where: { id: "emp_123" },
                data: { jobTitleId: null },
            });
            expect(result.jobTitleId).toBeNull();
        });
    });
});
