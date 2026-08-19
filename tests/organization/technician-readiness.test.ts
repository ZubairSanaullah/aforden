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

import { getTechnicianReadiness } from "@/lib/services/technicianProfile/getTechnicianReadiness";
import { getTechnicianReadinessByEmployee } from "@/lib/services/technicianProfile/getTechnicianReadinessByEmployee";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.16 — Technician Operational Readiness & Validation", () => {
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

    const fullyReadyTechnicianDb = {
        id: "tech_prof_1",
        employeeId: "emp_1",
        employee: {
            id: "emp_1",
            status: "ACTIVE" as const,
        },
        technicianSkills: [
            {
                skill: {
                    status: "ACTIVE" as const,
                },
            },
        ],
        technicianServiceAreas: [
            {
                serviceArea: {
                    status: "ACTIVE" as const,
                },
            },
        ],
        technicianAvailabilities: [
            {
                status: "ACTIVE" as const,
            },
        ],
    };

    // =========================================================================
    // 1. AUTHORIZATION TESTS
    // =========================================================================
    describe("Authorization & RBAC", () => {
        it("allows OWNER to check readiness", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                fullyReadyTechnicianDb,
            );

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result).not.toBeNull();
            expect(result?.isReady).toBe(true);
        });

        it("allows ADMIN to check readiness", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                fullyReadyTechnicianDb,
            );

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result).not.toBeNull();
        });

        it("allows MANAGER to check readiness (MEMBERS_VIEW)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                fullyReadyTechnicianDb,
            );

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result).not.toBeNull();
        });

        it("rejects unauthorized roles (TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                getTechnicianReadiness("ws_123", "tech_prof_1"),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                getTechnicianReadiness("ws_123", "tech_prof_1"),
            ).rejects.toBeInstanceOf(UnauthorizedError);
        });

        it("rejects non-member request", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                getTechnicianReadiness("ws_123", "tech_prof_1"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });
    });

    // =========================================================================
    // 2. FULL READINESS TESTS
    // =========================================================================
    describe("Full Readiness Evaluation", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("evaluates a fully configured active technician as isReady: true with no blockers", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(
                fullyReadyTechnicianDb,
            );

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result).toEqual({
                technicianProfileId: "tech_prof_1",
                employeeId: "emp_1",
                isReady: true,
                employeeStatus: "ACTIVE",
                hasTechnicianProfile: true,
                hasActiveSkills: true,
                hasActiveServiceAreas: true,
                hasActiveAvailability: true,
                blockers: [],
            });
        });

        it("evaluates via employee ID using getTechnicianReadinessByEmployee", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: "emp_1",
                status: "ACTIVE" as const,
                technicianProfile: {
                    id: "tech_prof_1",
                    technicianSkills: [{ skill: { status: "ACTIVE" as const } }],
                    technicianServiceAreas: [
                        { serviceArea: { status: "ACTIVE" as const } },
                    ],
                    technicianAvailabilities: [{ status: "ACTIVE" as const }],
                },
            });

            const result = await getTechnicianReadinessByEmployee(
                "ws_123",
                "emp_1",
            );

            expect(result).not.toBeNull();
            expect(result?.isReady).toBe(true);
            expect(result?.blockers).toEqual([]);
        });
    });

    // =========================================================================
    // 3. EMPLOYEE STATUS RULE TESTS
    // =========================================================================
    describe("Employee Status Rule", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        const nonActiveStatuses = ["INACTIVE", "ON_LEAVE", "TERMINATED"] as const;

        for (const status of nonActiveStatuses) {
            it(`fails readiness with EMPLOYEE_NOT_ACTIVE when status is ${status}`, async () => {
                mocks.technicianProfileFindFirst.mockResolvedValue({
                    ...fullyReadyTechnicianDb,
                    employee: {
                        id: "emp_1",
                        status,
                    },
                });

                const result = await getTechnicianReadiness(
                    "ws_123",
                    "tech_prof_1",
                );

                expect(result?.isReady).toBe(false);
                expect(result?.employeeStatus).toBe(status);
                expect(result?.blockers).toContain("EMPLOYEE_NOT_ACTIVE");
            });
        }
    });

    // =========================================================================
    // 4. TECHNICIAN PROFILE MISSING RULE
    // =========================================================================
    describe("Technician Profile Missing Rule", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("fails readiness when employee has no technician profile", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: "emp_accountant",
                status: "ACTIVE" as const,
                technicianProfile: null,
            });

            const result = await getTechnicianReadinessByEmployee(
                "ws_123",
                "emp_accountant",
            );

            expect(result?.isReady).toBe(false);
            expect(result?.hasTechnicianProfile).toBe(false);
            expect(result?.blockers).toContain("TECHNICIAN_PROFILE_MISSING");
            expect(mocks.technicianProfileCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. SKILL RULE TESTS
    // =========================================================================
    describe("Skill Rule", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("fails with NO_ACTIVE_SKILLS when technician has no skills", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianSkills: [],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.isReady).toBe(false);
            expect(result?.hasActiveSkills).toBe(false);
            expect(result?.blockers).toEqual(["NO_ACTIVE_SKILLS"]);
        });

        it("fails with NO_ACTIVE_SKILLS when all assigned skills are INACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianSkills: [
                    { skill: { status: "INACTIVE" as const } },
                    { skill: { status: "INACTIVE" as const } },
                ],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.isReady).toBe(false);
            expect(result?.hasActiveSkills).toBe(false);
            expect(result?.blockers).toEqual(["NO_ACTIVE_SKILLS"]);
        });

        it("passes skill requirement when at least one skill is ACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianSkills: [
                    { skill: { status: "INACTIVE" as const } },
                    { skill: { status: "ACTIVE" as const } },
                ],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.hasActiveSkills).toBe(true);
            expect(result?.isReady).toBe(true);
            expect(result?.blockers).toEqual([]);
        });
    });

    // =========================================================================
    // 6. SERVICE AREA RULE TESTS
    // =========================================================================
    describe("Service Area Rule", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("fails with NO_ACTIVE_SERVICE_AREAS when technician has no service areas", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianServiceAreas: [],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.isReady).toBe(false);
            expect(result?.hasActiveServiceAreas).toBe(false);
            expect(result?.blockers).toEqual(["NO_ACTIVE_SERVICE_AREAS"]);
        });

        it("fails with NO_ACTIVE_SERVICE_AREAS when all assigned service areas are INACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianServiceAreas: [
                    { serviceArea: { status: "INACTIVE" as const } },
                ],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.isReady).toBe(false);
            expect(result?.hasActiveServiceAreas).toBe(false);
            expect(result?.blockers).toEqual(["NO_ACTIVE_SERVICE_AREAS"]);
        });

        it("passes service area requirement when at least one area is ACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianServiceAreas: [
                    { serviceArea: { status: "INACTIVE" as const } },
                    { serviceArea: { status: "ACTIVE" as const } },
                ],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.hasActiveServiceAreas).toBe(true);
            expect(result?.isReady).toBe(true);
        });
    });

    // =========================================================================
    // 7. AVAILABILITY RULE TESTS
    // =========================================================================
    describe("Availability Rule", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("fails with NO_ACTIVE_AVAILABILITY when technician has no availability records", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianAvailabilities: [],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.isReady).toBe(false);
            expect(result?.hasActiveAvailability).toBe(false);
            expect(result?.blockers).toEqual(["NO_ACTIVE_AVAILABILITY"]);
        });

        it("fails with NO_ACTIVE_AVAILABILITY when all availability records are INACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianAvailabilities: [{ status: "INACTIVE" as const }],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.isReady).toBe(false);
            expect(result?.hasActiveAvailability).toBe(false);
            expect(result?.blockers).toEqual(["NO_ACTIVE_AVAILABILITY"]);
        });

        it("passes availability requirement when at least one availability record is ACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianAvailabilities: [
                    { status: "INACTIVE" as const },
                    { status: "ACTIVE" as const },
                ],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.hasActiveAvailability).toBe(true);
            expect(result?.isReady).toBe(true);
        });
    });

    // =========================================================================
    // 8. MULTIPLE BLOCKERS & DETERMINISTIC ORDERING
    // =========================================================================
    describe("Multiple Blockers & Deterministic Ordering", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("returns blockers in exact order: NO_ACTIVE_SKILLS, NO_ACTIVE_SERVICE_AREAS, NO_ACTIVE_AVAILABILITY", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                technicianSkills: [],
                technicianServiceAreas: [],
                technicianAvailabilities: [],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.blockers).toEqual([
                "NO_ACTIVE_SKILLS",
                "NO_ACTIVE_SERVICE_AREAS",
                "NO_ACTIVE_AVAILABILITY",
            ]);
        });

        it("returns all 4 blockers when ON_LEAVE with no skills, service areas, or availability", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...fullyReadyTechnicianDb,
                employee: {
                    id: "emp_1",
                    status: "ON_LEAVE" as const,
                },
                technicianSkills: [],
                technicianServiceAreas: [],
                technicianAvailabilities: [],
            });

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
            );

            expect(result?.blockers).toEqual([
                "EMPLOYEE_NOT_ACTIVE",
                "NO_ACTIVE_SKILLS",
                "NO_ACTIVE_SERVICE_AREAS",
                "NO_ACTIVE_AVAILABILITY",
            ]);
        });

        it("returns all 5 blockers when non-active employee has no technician profile", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: "emp_terminated",
                status: "TERMINATED" as const,
                technicianProfile: null,
            });

            const result = await getTechnicianReadinessByEmployee(
                "ws_123",
                "emp_terminated",
            );

            expect(result?.blockers).toEqual([
                "EMPLOYEE_NOT_ACTIVE",
                "TECHNICIAN_PROFILE_MISSING",
                "NO_ACTIVE_SKILLS",
                "NO_ACTIVE_SERVICE_AREAS",
                "NO_ACTIVE_AVAILABILITY",
            ]);
        });
    });

    // =========================================================================
    // 9. TENANT ISOLATION TESTS
    // =========================================================================
    describe("Tenant Isolation", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("returns null when querying a technician belonging to another workspace", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_ws_b",
            );

            expect(result).toBeNull();
            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: "tech_prof_ws_b",
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                }),
            );
        });

        it("returns null when querying employee readiness belonging to another workspace", async () => {
            mocks.employeeFindFirst.mockResolvedValue(null);

            const result = await getTechnicianReadinessByEmployee(
                "ws_123",
                "emp_ws_b",
            );

            expect(result).toBeNull();
            expect(mocks.employeeFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: "emp_ws_b",
                        workspaceId: "ws_123",
                    },
                }),
            );
        });
    });

    // =========================================================================
    // 10. SECURITY & READ-ONLY INTEGRITY
    // =========================================================================
    describe("Security & Read-Only Integrity", () => {
        it("never leaks passwords, sessions, or tokens and executes zero mutations", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                fullyReadyTechnicianDb,
            );

            const result = await getTechnicianReadiness(
                "ws_123",
                "tech_prof_1",
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
