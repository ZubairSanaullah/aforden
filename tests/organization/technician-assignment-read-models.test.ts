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
    serviceAreaFindFirst: vi.fn(),
    skillFindMany: vi.fn(),
    technicianAssignmentFindFirst: vi.fn(),
    technicianAssignmentFindMany: vi.fn(),
    technicianAssignmentCount: vi.fn(),
    technicianAssignmentCreate: vi.fn(),
    technicianAssignmentUpdate: vi.fn(),
    technicianAssignmentDelete: vi.fn(),
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
        serviceArea: {
            findFirst: mocks.serviceAreaFindFirst,
        },
        skill: {
            findMany: mocks.skillFindMany,
        },
        technicianAssignment: {
            findFirst: mocks.technicianAssignmentFindFirst,
            findMany: mocks.technicianAssignmentFindMany,
            count: mocks.technicianAssignmentCount,
            create: mocks.technicianAssignmentCreate,
            update: mocks.technicianAssignmentUpdate,
            delete: mocks.technicianAssignmentDelete,
        },
    },
}));

import { getTechnicianAssignmentOverview } from "@/lib/services/technicianAssignment/getTechnicianAssignmentOverview";
import { getTechnicianAssignmentOverviews } from "@/lib/services/technicianAssignment/getTechnicianAssignmentOverviews";
import { getTechnicianSchedule } from "@/lib/services/technicianAssignment/getTechnicianSchedule";
import { getTechnicianWorkload } from "@/lib/services/technicianAssignment/getTechnicianWorkload";
import { getTechnicianAssignmentConflicts } from "@/lib/services/technicianAssignment/getTechnicianAssignmentConflicts";
import { getTechnicianAssignmentStats } from "@/lib/services/technicianAssignment/getTechnicianAssignmentStats";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.20 — Technician Assignment Read Models & Workload", () => {
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
            passwordHash: "secret-hash",
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
        timezone = "Asia/Karachi",
    ) {
        const workspace = {
            id: workspaceId,
            name,
            slug: "acme-hvac",
            logoUrl: null,
            timezone,
        };
        workspacesMap.set(workspaceId, workspace);
        return workspace;
    }

    function registerMembership(
        memberId: string,
        userId: string,
        workspaceId: string,
        role = "DISPATCHER",
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

    function setupAuthSession(userId = "user_dispatcher_123") {
        mocks.auth.mockResolvedValue({
            user: { id: userId },
        });
    }

    const sampleAssignmentRecord = {
        id: "asgn_100",
        technicianProfileId: "tech_prof_1",
        workType: "WORK" as const,
        workReferenceId: "work_order_123",
        status: "ASSIGNED" as const,
        startsAt: new Date("2026-09-07T08:00:00.000Z"),
        endsAt: new Date("2026-09-07T12:00:00.000Z"),
        notes: "Compressor diagnostic",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        technicianProfile: {
            select: {},
            employee: {
                id: "emp_1",
                employeeNumber: "EMP-001",
                displayName: "Zubair Sanaullah",
                phone: "+923001234567",
                status: "ACTIVE" as const,
            },
        },
    };

    // =========================================================================
    // A. AUTHORIZATION & RBAC
    // =========================================================================
    describe("A. Authorization & RBAC", () => {
        it("allows OWNER, ADMIN, MANAGER, and DISPATCHER to access read models", async () => {
            const allowedRoles = ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"] as const;

            for (const role of allowedRoles) {
                const userId = `user_${role.toLowerCase()}`;
                setupAuthSession(userId);
                registerUser(userId);
                registerWorkspace("ws_123");
                registerMembership(`mem_${role.toLowerCase()}`, userId, "ws_123", role);

                mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignmentRecord);

                const result = await getTechnicianAssignmentOverview(
                    "ws_123",
                    "asgn_100",
                );

                expect(result).not.toBeNull();
                expect(result?.id).toBe("asgn_100");
            }
        });

        it("rejects unauthorized roles (TECHNICIAN, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                getTechnicianAssignmentOverview("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                getTechnicianAssignmentOverview("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(UnauthorizedError);
        });

        it("rejects non-member request", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                getTechnicianAssignmentOverview("ws_123", "asgn_100"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });
    });

    // =========================================================================
    // B. SINGLE ASSIGNMENT OVERVIEW READ MODEL
    // =========================================================================
    describe("B. Single Assignment Overview Read Model", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("retrieves a complete assignment overview with employee summary", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignmentRecord);

            const overview = await getTechnicianAssignmentOverview(
                "ws_123",
                "asgn_100",
            );

            expect(overview).not.toBeNull();
            expect(overview?.id).toBe("asgn_100");
            expect(overview?.employeeId).toBe("emp_1");
            expect(overview?.employee.displayName).toBe("Zubair Sanaullah");
            expect(overview?.employee.employeeNumber).toBe("EMP-001");
            expect(overview?.workType).toBe("WORK");
            expect(overview?.workReferenceId).toBe("work_order_123");
            expect(overview?.status).toBe("ASSIGNED");
            expect(overview).not.toHaveProperty("passwordHash");
            expect(overview).not.toHaveProperty("accounts");
            expect(overview).not.toHaveProperty("sessions");
        });

        it("returns null for non-existent assignment", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(null);

            const overview = await getTechnicianAssignmentOverview(
                "ws_123",
                "asgn_missing",
            );

            expect(overview).toBeNull();
        });
    });

    // =========================================================================
    // C. ASSIGNMENT LISTING & FILTERING
    // =========================================================================
    describe("C. Assignment Listing & Filtering", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("retrieves filtered and paginated list of assignment overviews", async () => {
            mocks.technicianAssignmentCount.mockResolvedValue(1);
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                sampleAssignmentRecord,
            ]);

            const result = await getTechnicianAssignmentOverviews("ws_123", {
                page: 1,
                pageSize: 20,
                status: "ASSIGNED",
                workType: "WORK",
            });

            expect(result.items).toHaveLength(1);
            expect(result.items[0].id).toBe("asgn_100");
            expect(result.pagination.total).toBe(1);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.pageSize).toBe(20);
        });

        it("handles page beyond dataset gracefully", async () => {
            mocks.technicianAssignmentCount.mockResolvedValue(5);
            mocks.technicianAssignmentFindMany.mockResolvedValue([]);

            const result = await getTechnicianAssignmentOverviews("ws_123", {
                page: 10,
                pageSize: 20,
            });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.total).toBe(5);
            expect(result.pagination.totalPages).toBe(1);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(true);
        });
    });

    // =========================================================================
    // D. TECHNICIAN SCHEDULE READ MODEL
    // =========================================================================
    describe("D. Technician Schedule Read Model", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");

            mocks.technicianProfileFindFirst.mockResolvedValue({
                id: "tech_prof_1",
                employee: {
                    id: "emp_1",
                    employeeNumber: "EMP-001",
                    displayName: "Zubair Sanaullah",
                    phone: "+923001234567",
                    status: "ACTIVE",
                },
            });
        });

        it("categorizes assignments into CURRENT, UPCOMING, and HISTORICAL based on now", async () => {
            const now = new Date("2026-09-07T10:00:00.000Z");

            const records = [
                {
                    id: "asgn_hist",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T06:00:00.000Z"),
                    endsAt: new Date("2026-09-07T08:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "asgn_curr",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_2",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T09:00:00.000Z"),
                    endsAt: new Date("2026-09-07T12:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "asgn_up",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_3",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T14:00:00.000Z"),
                    endsAt: new Date("2026-09-07T16:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(records);

            const schedule = await getTechnicianSchedule(
                "ws_123",
                "tech_prof_1",
                { now },
            );

            expect(schedule).not.toBeNull();
            expect(schedule?.currentAssignments).toHaveLength(1);
            expect(schedule?.currentAssignments[0].id).toBe("asgn_curr");
            expect(schedule?.currentAssignments[0].temporalCategory).toBe("CURRENT");

            expect(schedule?.upcomingAssignments).toHaveLength(1);
            expect(schedule?.upcomingAssignments[0].id).toBe("asgn_up");
            expect(schedule?.upcomingAssignments[0].temporalCategory).toBe("UPCOMING");

            expect(schedule?.historicalAssignments).toHaveLength(1);
            expect(schedule?.historicalAssignments[0].id).toBe("asgn_hist");
            expect(schedule?.historicalAssignments[0].temporalCategory).toBe("HISTORICAL");
        });

        it("returns null for non-existent technician profile in schedule query", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const schedule = await getTechnicianSchedule(
                "ws_123",
                "tech_missing",
            );

            expect(schedule).toBeNull();
        });
    });

    // =========================================================================
    // E. TECHNICIAN WORKLOAD READ MODEL
    // =========================================================================
    describe("E. Technician Workload Read Model", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");

            mocks.technicianProfileFindFirst.mockResolvedValue({
                id: "tech_prof_1",
                employee: {
                    id: "emp_1",
                    employeeNumber: "EMP-001",
                    displayName: "Zubair Sanaullah",
                    phone: "+923001234567",
                    status: "ACTIVE",
                },
            });
        });

        it("computes workload metrics and scheduled minutes excluding cancelled/completed from active load", async () => {
            const now = new Date("2026-09-07T10:00:00.000Z");

            const records = [
                {
                    id: "asgn_curr",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T09:00:00.000Z"),
                    endsAt: new Date("2026-09-07T11:00:00.000Z"), // 120 minutes
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "asgn_up",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_2",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T14:00:00.000Z"),
                    endsAt: new Date("2026-09-07T15:30:00.000Z"), // 90 minutes
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "asgn_comp",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_3",
                    status: "COMPLETED",
                    startsAt: new Date("2026-09-07T06:00:00.000Z"),
                    endsAt: new Date("2026-09-07T08:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "asgn_canc",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_4",
                    status: "CANCELLED",
                    startsAt: new Date("2026-09-07T16:00:00.000Z"),
                    endsAt: new Date("2026-09-07T18:00:00.000Z"),
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(records);

            const workload = await getTechnicianWorkload(
                "ws_123",
                "tech_prof_1",
                { now },
            );

            expect(workload).not.toBeNull();
            expect(workload?.currentAssignmentCount).toBe(1);
            expect(workload?.upcomingAssignmentCount).toBe(1);
            expect(workload?.activeAssignmentCount).toBe(2);
            expect(workload?.completedAssignmentCount).toBe(1);
            expect(workload?.cancelledAssignmentCount).toBe(1);
            expect(workload?.scheduledAssignmentCount).toBe(2);
            expect(workload?.scheduledMinutes).toBe(210); // 120 + 90
            expect(workload?.currentAssignments).toHaveLength(1);
            expect(workload?.upcomingAssignments).toHaveLength(1);
        });
    });

    // =========================================================================
    // F. ASSIGNMENT CONFLICTS READ MODEL
    // =========================================================================
    describe("F. Assignment Conflicts Read Model", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("detects overlapping ASSIGNED assignments and ignores touching boundaries", async () => {
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                {
                    id: "asgn_blocking",
                    workType: "WORK",
                    workReferenceId: "work_block",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T08:00:00.000Z"),
                    endsAt: new Date("2026-09-07T12:00:00.000Z"),
                    notes: "Active blocking",
                },
            ]);

            const conflicts = await getTechnicianAssignmentConflicts(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: new Date("2026-09-07T10:00:00.000Z"),
                    endsAt: new Date("2026-09-07T14:00:00.000Z"),
                },
            );

            expect(conflicts).toHaveLength(1);
            expect(conflicts[0].id).toBe("asgn_blocking");
        });

        it("returns empty array when no conflicts exist or touching boundaries", async () => {
            mocks.technicianAssignmentFindMany.mockResolvedValue([]);

            const conflicts = await getTechnicianAssignmentConflicts(
                "ws_123",
                "tech_prof_1",
                {
                    startsAt: new Date("2026-09-07T12:00:00.000Z"),
                    endsAt: new Date("2026-09-07T16:00:00.000Z"),
                },
            );

            expect(conflicts).toHaveLength(0);
        });
    });

    // =========================================================================
    // G. ASSIGNMENT STATISTICS READ MODEL
    // =========================================================================
    describe("G. Assignment Statistics Read Model", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("computes workspace assignment statistics with byTechnician breakdown and scheduled minutes", async () => {
            const now = new Date("2026-09-07T10:00:00.000Z");

            const assignments = [
                {
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK" as const,
                    status: "ASSIGNED" as const,
                    startsAt: new Date("2026-09-07T09:00:00.000Z"),
                    endsAt: new Date("2026-09-07T11:00:00.000Z"), // 120 min, current
                },
                {
                    id: "asgn_2",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK" as const,
                    status: "ASSIGNED" as const,
                    startsAt: new Date("2026-09-07T14:00:00.000Z"),
                    endsAt: new Date("2026-09-07T16:00:00.000Z"), // 120 min, upcoming
                },
                {
                    id: "asgn_3",
                    technicianProfileId: "tech_prof_2",
                    workType: "WORK" as const,
                    status: "COMPLETED" as const,
                    startsAt: new Date("2026-09-07T06:00:00.000Z"),
                    endsAt: new Date("2026-09-07T08:00:00.000Z"),
                },
                {
                    id: "asgn_4",
                    technicianProfileId: "tech_prof_2",
                    workType: "WORK" as const,
                    status: "CANCELLED" as const,
                    startsAt: new Date("2026-09-07T16:00:00.000Z"),
                    endsAt: new Date("2026-09-07T18:00:00.000Z"),
                },
            ];

            const technicians = [
                {
                    id: "tech_prof_2",
                    employeeId: "emp_2",
                    employee: { displayName: "Ahmed Khan" },
                },
                {
                    id: "tech_prof_1",
                    employeeId: "emp_1",
                    employee: { displayName: "Zubair Sanaullah" },
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(assignments);
            mocks.technicianProfileFindMany.mockResolvedValue(technicians);

            const stats = await getTechnicianAssignmentStats("ws_123", {
                now,
            });

            expect(stats.total).toBe(4);
            expect(stats.assigned).toBe(2);
            expect(stats.completed).toBe(1);
            expect(stats.cancelled).toBe(1);
            expect(stats.current).toBe(1);
            expect(stats.upcoming).toBe(1);
            expect(stats.scheduledMinutes).toBe(240); // 120 + 120
            expect(stats.byWorkType.WORK).toBe(4);

            expect(stats.byTechnician).toHaveLength(2);
            // Deterministically sorted: Ahmed Khan then Zubair Sanaullah
            expect(stats.byTechnician[0].displayName).toBe("Ahmed Khan");
            expect(stats.byTechnician[0].count).toBe(2);
            expect(stats.byTechnician[1].displayName).toBe("Zubair Sanaullah");
            expect(stats.byTechnician[1].count).toBe(2);
        });
    });

    // =========================================================================
    // H. TENANT ISOLATION, MUTATION SAFETY, & SECURITY
    // =========================================================================
    describe("H. Tenant Isolation, Mutation Safety, & Security", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("strictly prevents cross-workspace data leakage", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(null);

            const result = await getTechnicianAssignmentOverview(
                "ws_123",
                "asgn_ws_other",
            );

            expect(result).toBeNull();
        });

        it("never invokes any database mutating methods during read operations", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignmentRecord);
            mocks.technicianAssignmentFindMany.mockResolvedValue([sampleAssignmentRecord]);
            mocks.technicianAssignmentCount.mockResolvedValue(1);

            await getTechnicianAssignmentOverview("ws_123", "asgn_100");
            await getTechnicianAssignmentOverviews("ws_123");
            await getTechnicianAssignmentConflicts("ws_123", "tech_prof_1", {
                startsAt: new Date("2026-09-07T10:00:00.000Z"),
                endsAt: new Date("2026-09-07T14:00:00.000Z"),
            });

            expect(mocks.technicianAssignmentCreate).not.toHaveBeenCalled();
            expect(mocks.technicianAssignmentUpdate).not.toHaveBeenCalled();
            expect(mocks.technicianAssignmentDelete).not.toHaveBeenCalled();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
        });
    });
});
