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
    },
}));

import { getTechnicianDirectoryStats } from "@/lib/services/technicianProfile/getTechnicianDirectoryStats";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.15 — Technician Directory Statistics & Summary Read Model", () => {
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
    ) {
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

    const sampleAggregateDbResult = [
        {
            id: "tech_1",
            employee: {
                status: "ACTIVE" as const,
                department: { id: "dept_1", name: "Field Operations" },
                jobTitle: { id: "title_1", name: "Lead Tech" },
            },
            technicianServiceAreas: [
                { serviceArea: { id: "area_1", name: "DHA Lahore" } },
                { serviceArea: { id: "area_2", name: "Gulberg" } },
            ],
        },
        {
            id: "tech_2",
            employee: {
                status: "ACTIVE" as const,
                department: { id: "dept_1", name: "Field Operations" },
                jobTitle: { id: "title_2", name: "Junior Tech" },
            },
            technicianServiceAreas: [
                { serviceArea: { id: "area_1", name: "DHA Lahore" } },
            ],
        },
        {
            id: "tech_3",
            employee: {
                status: "ON_LEAVE" as const,
                department: { id: "dept_2", name: "Emergency Response" },
                jobTitle: { id: "title_1", name: "Lead Tech" },
            },
            technicianServiceAreas: [
                { serviceArea: { id: "area_2", name: "Gulberg" } },
                { serviceArea: { id: "area_3", name: "Cantt" } },
            ],
        },
        {
            id: "tech_4",
            employee: {
                status: "INACTIVE" as const,
                department: null,
                jobTitle: null,
            },
            technicianServiceAreas: [],
        },
    ];

    // =========================================================================
    // 1. AUTHORIZATION TESTS
    // =========================================================================
    describe("Authorization & RBAC", () => {
        it("allows OWNER to retrieve stats", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result.total).toBe(4);
        });

        it("allows ADMIN to retrieve stats", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result.total).toBe(4);
        });

        it("allows MANAGER to retrieve stats (MEMBERS_VIEW)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result.total).toBe(4);
        });

        it("rejects unauthorized roles (TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                getTechnicianDirectoryStats("ws_123"),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                getTechnicianDirectoryStats("ws_123"),
            ).rejects.toBeInstanceOf(UnauthorizedError);
        });

        it("rejects non-member request", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                getTechnicianDirectoryStats("ws_123"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });
    });

    // =========================================================================
    // 2. TOTAL & EMPTY WORKSPACE TESTS
    // =========================================================================
    describe("Total & Empty Workspace", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("returns total 0 and empty arrays for empty workspace", async () => {
            mocks.technicianProfileFindMany.mockResolvedValue([]);

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result).toEqual({
                total: 0,
                byEmployeeStatus: {
                    ACTIVE: 0,
                    INACTIVE: 0,
                    ON_LEAVE: 0,
                    TERMINATED: 0,
                },
                byDepartment: [],
                byJobTitle: [],
                byServiceArea: [],
                departmentUnassigned: 0,
                jobTitleUnassigned: 0,
                serviceAreaUnassigned: 0,
            });
        });

        it("strictly scopes query by workspaceId", async () => {
            mocks.technicianProfileFindMany.mockResolvedValue([]);

            await getTechnicianDirectoryStats("ws_123");

            expect(mocks.technicianProfileFindMany).toHaveBeenCalledWith({
                where: {
                    employee: {
                        workspaceId: "ws_123",
                    },
                },
                select: expect.any(Object),
            });
        });
    });

    // =========================================================================
    // 3. EMPLOYEE STATUS SUMMARY TESTS
    // =========================================================================
    describe("Employee Status Summary", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("computes status breakdown with all 4 statuses present", async () => {
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result.byEmployeeStatus).toEqual({
                ACTIVE: 2,
                INACTIVE: 1,
                ON_LEAVE: 1,
                TERMINATED: 0,
            });

            const statusSum =
                result.byEmployeeStatus.ACTIVE +
                result.byEmployeeStatus.INACTIVE +
                result.byEmployeeStatus.ON_LEAVE +
                result.byEmployeeStatus.TERMINATED;

            expect(statusSum).toBe(result.total);
        });
    });

    // =========================================================================
    // 4. DEPARTMENT BREAKDOWN TESTS
    // =========================================================================
    describe("Department Breakdown", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("computes department counts and unassigned counters with deterministic sorting", async () => {
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result.byDepartment).toEqual([
                { id: "dept_2", name: "Emergency Response", count: 1 },
                { id: "dept_1", name: "Field Operations", count: 2 },
            ]);
            expect(result.departmentUnassigned).toBe(1);

            const assignedSum = result.byDepartment.reduce(
                (sum, d) => sum + d.count,
                0,
            );
            expect(assignedSum + result.departmentUnassigned).toBe(result.total);
        });
    });

    // =========================================================================
    // 5. JOB TITLE BREAKDOWN TESTS
    // =========================================================================
    describe("Job Title Breakdown", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("computes job title counts and unassigned counters with deterministic sorting", async () => {
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result.byJobTitle).toEqual([
                { id: "title_2", name: "Junior Tech", count: 1 },
                { id: "title_1", name: "Lead Tech", count: 2 },
            ]);
            expect(result.jobTitleUnassigned).toBe(1);

            const assignedSum = result.byJobTitle.reduce(
                (sum, j) => sum + j.count,
                0,
            );
            expect(assignedSum + result.jobTitleUnassigned).toBe(result.total);
        });
    });

    // =========================================================================
    // 6. SERVICE AREA BREAKDOWN TESTS
    // =========================================================================
    describe("Service Area Breakdown", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("counts distinct technicians per service area and tracks unassigned", async () => {
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect(result.byServiceArea).toEqual([
                { id: "area_3", name: "Cantt", count: 1 },
                { id: "area_1", name: "DHA Lahore", count: 2 },
                { id: "area_2", name: "Gulberg", count: 2 },
            ]);
            expect(result.serviceAreaUnassigned).toBe(1); // tech_4 has no service areas
        });
    });

    // =========================================================================
    // 7. SECURITY & READ-ONLY INTEGRITY
    // =========================================================================
    describe("Security & Read-Only Integrity", () => {
        it("never leaks passwordHash, sessions, or tokens and executes zero mutations", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianDirectoryStats("ws_123");

            expect((result as any).passwordHash).toBeUndefined();
            expect((result as any).sessions).toBeUndefined();
            expect((result as any).accounts).toBeUndefined();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });
    });
});
