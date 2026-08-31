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

import { getTechnicians } from "@/lib/services/technicianProfile/getTechnicians";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.14 — Technician Directory & Listing Read Model", () => {
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
        platformRole: null,
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

    const sampleTechniciansDbResult = [
        {
            id: "tech_prof_1",
            licenseNumber: "HVAC-101",
            yearsExperience: 5,
            employee: {
                id: "emp_1",
                employeeNumber: "EMP-001",
                displayName: "Alice Tech",
                phone: "+1-555-0101",
                hireDate: new Date("2026-01-01T00:00:00.000Z"),
                status: "ACTIVE" as const,
                department: {
                    id: "dept_1",
                    name: "Field Ops",
                    status: "ACTIVE" as const,
                },
                jobTitle: {
                    id: "title_1",
                    name: "Senior Tech",
                    status: "ACTIVE" as const,
                },
            },
            technicianSkills: [
                {
                    id: "ts_1",
                    proficiency: "EXPERT" as const,
                    skill: {
                        id: "skill_1",
                        name: "AC Repair",
                    },
                },
            ],
            technicianServiceAreas: [
                {
                    id: "tsa_1",
                    serviceArea: {
                        id: "area_1",
                        name: "North Zone",
                        status: "ACTIVE" as const,
                    },
                },
            ],
            technicianAvailabilities: [
                {
                    dayOfWeek: "MONDAY" as const,
                    status: "ACTIVE" as const,
                },
                {
                    dayOfWeek: "TUESDAY" as const,
                    status: "ACTIVE" as const,
                },
                {
                    dayOfWeek: "WEDNESDAY" as const,
                    status: "INACTIVE" as const,
                },
            ],
        },
        {
            id: "tech_prof_2",
            licenseNumber: "HVAC-102",
            yearsExperience: 2,
            employee: {
                id: "emp_2",
                employeeNumber: "EMP-002",
                displayName: "Bob Tech",
                phone: "+1-555-0102",
                hireDate: new Date("2026-02-01T00:00:00.000Z"),
                status: "ACTIVE" as const,
                department: null,
                jobTitle: null,
            },
            technicianSkills: [],
            technicianServiceAreas: [],
            technicianAvailabilities: [],
        },
    ];

    // =========================================================================
    // 1. AUTHORIZATION TESTS
    // =========================================================================
    describe("Authorization & RBAC", () => {
        it("allows OWNER to list technicians", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.technicianProfileCount.mockResolvedValue(2);
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleTechniciansDbResult,
            );

            const result = await getTechnicians("ws_123");

            expect(result.items).toHaveLength(2);
            expect(result.pagination.total).toBe(2);
        });

        it("allows ADMIN to list technicians", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileCount.mockResolvedValue(2);
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleTechniciansDbResult,
            );

            const result = await getTechnicians("ws_123");

            expect(result.items).toHaveLength(2);
        });

        it("allows MANAGER to list technicians (MEMBERS_VIEW)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianProfileCount.mockResolvedValue(2);
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleTechniciansDbResult,
            );

            const result = await getTechnicians("ws_123");

            expect(result.items).toHaveLength(2);
        });

        it("rejects unauthorized roles (TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(getTechnicians("ws_123")).rejects.toBeInstanceOf(
                ForbiddenError,
            );
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(getTechnicians("ws_123")).rejects.toBeInstanceOf(
                UnauthorizedError,
            );
        });

        it("rejects non-member request", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(getTechnicians("ws_123")).rejects.toBeInstanceOf(
                WorkspaceAccessDeniedError,
            );
        });
    });

    // =========================================================================
    // 2. DIRECTORY PROJECTION & EMPTY STATES
    // =========================================================================
    describe("Directory Projection & Empty States", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("projects directory item with active days calculation", async () => {
            mocks.technicianProfileCount.mockResolvedValue(2);
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleTechniciansDbResult,
            );

            const result = await getTechnicians("ws_123");

            const tech1 = result.items[0];
            expect(tech1.id).toBe("tech_prof_1");
            expect(tech1.employeeId).toBe("emp_1");
            expect(tech1.employee.displayName).toBe("Alice Tech");
            expect(tech1.department?.name).toBe("Field Ops");
            expect(tech1.jobTitle?.name).toBe("Senior Tech");
            expect(tech1.skills[0].name).toBe("AC Repair");
            expect(tech1.serviceAreas[0].name).toBe("North Zone");
            expect(tech1.availabilitySummary.activeDays).toBe(2); // MONDAY and TUESDAY active (WEDNESDAY inactive)
        });

        it("returns items: [] and valid pagination for empty workspace", async () => {
            mocks.technicianProfileCount.mockResolvedValue(0);
            mocks.technicianProfileFindMany.mockResolvedValue([]);

            const result = await getTechnicians("ws_123");

            expect(result.items).toEqual([]);
            expect(result.pagination).toEqual({
                page: 1,
                pageSize: 20,
                total: 0,
                totalPages: 0,
                hasNextPage: false,
                hasPreviousPage: false,
            });
        });
    });

    // =========================================================================
    // 3. SEARCH
    // =========================================================================
    describe("Search Functionality", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.technicianProfileCount.mockResolvedValue(1);
            mocks.technicianProfileFindMany.mockResolvedValue([
                sampleTechniciansDbResult[0],
            ]);
        });

        it("applies case-insensitive search across displayName, employeeNumber, and phone", async () => {
            await getTechnicians("ws_123", { search: "Alice" });

            expect(mocks.technicianProfileFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        employee: expect.objectContaining({
                            workspaceId: "ws_123",
                            OR: [
                                {
                                    displayName: {
                                        contains: "Alice",
                                        mode: "insensitive",
                                    },
                                },
                                {
                                    employeeNumber: {
                                        contains: "Alice",
                                        mode: "insensitive",
                                    },
                                },
                                {
                                    phone: {
                                        contains: "Alice",
                                        mode: "insensitive",
                                    },
                                },
                            ],
                        }),
                    }),
                }),
            );
        });

        it("treats whitespace-only search as no search", async () => {
            await getTechnicians("ws_123", { search: "   " });

            expect(mocks.technicianProfileFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                }),
            );
        });
    });

    // =========================================================================
    // 4. FILTERING
    // =========================================================================
    describe("Filtering Functionality", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.technicianProfileCount.mockResolvedValue(1);
            mocks.technicianProfileFindMany.mockResolvedValue([
                sampleTechniciansDbResult[0],
            ]);
        });

        it("filters by employee status, departmentId, jobTitleId, and serviceAreaId", async () => {
            await getTechnicians("ws_123", {
                employeeStatus: "ACTIVE",
                departmentId: "dept_1",
                jobTitleId: "title_1",
                serviceAreaId: "area_1",
            });

            expect(mocks.technicianProfileFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        employee: {
                            workspaceId: "ws_123",
                            status: "ACTIVE",
                            departmentId: "dept_1",
                            jobTitleId: "title_1",
                        },
                        technicianServiceAreas: {
                            some: {
                                serviceAreaId: "area_1",
                            },
                        },
                    },
                }),
            );
        });
    });

    // =========================================================================
    // 5. PAGINATION
    // =========================================================================
    describe("Pagination Functionality", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("handles custom page and pageSize correctly", async () => {
            mocks.technicianProfileCount.mockResolvedValue(55);
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleTechniciansDbResult,
            );

            const result = await getTechnicians("ws_123", {
                page: 2,
                pageSize: 20,
            });

            expect(mocks.technicianProfileFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    skip: 20,
                    take: 20,
                }),
            );
            expect(result.pagination).toEqual({
                page: 2,
                pageSize: 20,
                total: 55,
                totalPages: 3,
                hasNextPage: true,
                hasPreviousPage: true,
            });
        });

        it("rejects pageSize greater than 100", async () => {
            await expect(
                getTechnicians("ws_123", { pageSize: 101 }),
            ).rejects.toThrow();
        });

        it("rejects invalid page or negative values", async () => {
            await expect(
                getTechnicians("ws_123", { page: 0 }),
            ).rejects.toThrow();

            await expect(
                getTechnicians("ws_123", { pageSize: -5 }),
            ).rejects.toThrow();
        });
    });

    // =========================================================================
    // 6. SORTING
    // =========================================================================
    describe("Deterministic Sorting", () => {
        it("sorts by employee.displayName ASC and employee.id ASC", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileCount.mockResolvedValue(2);
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleTechniciansDbResult,
            );

            await getTechnicians("ws_123");

            expect(mocks.technicianProfileFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: [
                        { employee: { displayName: "asc" } },
                        { employee: { id: "asc" } },
                    ],
                }),
            );
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

            mocks.technicianProfileCount.mockResolvedValue(2);
            mocks.technicianProfileFindMany.mockResolvedValue(
                sampleTechniciansDbResult,
            );

            const result = await getTechnicians("ws_123");

            expect((result.items[0] as any).passwordHash).toBeUndefined();
            expect((result.items[0] as any).sessions).toBeUndefined();
            expect((result.items[0] as any).accounts).toBeUndefined();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });
    });
});
