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

import { getTechnicianAssignmentHistory } from "@/lib/services/technicianAssignment/getTechnicianAssignmentHistory";
import { getTechnicianAssignmentHistoryForWorkspace } from "@/lib/services/technicianAssignment/getTechnicianAssignmentHistoryForWorkspace";
import { getTechnicianAssignmentTimeline } from "@/lib/services/technicianAssignment/getTechnicianAssignmentTimeline";
import { getTechnicianAssignmentHistorySummary } from "@/lib/services/technicianAssignment/getTechnicianAssignmentHistorySummary";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.22 — Technician Assignment Operational History & Audit Read Model", () => {
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

    const sampleProfileDb = {
        id: "tech_prof_1",
        employeeId: "emp_1",
        employee: {
            id: "emp_1",
            employeeNumber: "EMP-001",
            displayName: "Zubair Sanaullah",
            phone: "+923001234567",
            status: "ACTIVE" as const,
        },
    };

    const sampleHistoryRecord = {
        id: "asgn_100",
        technicianProfileId: "tech_prof_1",
        workType: "WORK" as const,
        workReferenceId: "work_100",
        status: "COMPLETED" as const,
        startsAt: new Date("2026-09-07T08:00:00.000Z"),
        endsAt: new Date("2026-09-07T12:00:00.000Z"),
        notes: "Routine maintenance completed",
        completedAt: new Date("2026-09-07T12:05:00.000Z"),
        cancelledAt: null,
        cancellationReason: null,
        createdAt: new Date("2026-09-01T08:00:00.000Z"),
        technicianProfile: {
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
        it("allows OWNER, ADMIN, MANAGER, and DISPATCHER to access history services", async () => {
            const allowedRoles = ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"] as const;

            for (const role of allowedRoles) {
                const userId = `user_${role.toLowerCase()}`;
                setupAuthSession(userId);
                registerUser(userId);
                registerWorkspace("ws_123");
                registerMembership(`mem_${role.toLowerCase()}`, userId, "ws_123", role);

                mocks.technicianProfileFindFirst.mockResolvedValue(sampleProfileDb);
                mocks.technicianAssignmentCount.mockResolvedValue(1);
                mocks.technicianAssignmentFindMany.mockResolvedValue([
                    sampleHistoryRecord,
                ]);

                const history = await getTechnicianAssignmentHistory(
                    "ws_123",
                    "tech_prof_1",
                );

                expect(history.items).toHaveLength(1);
                expect(history.items[0].id).toBe("asgn_100");
            }
        });

        it("rejects unauthorized roles (TECHNICIAN, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                getTechnicianAssignmentHistory("ws_123", "tech_prof_1"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            await expect(
                getTechnicianAssignmentHistoryForWorkspace("ws_123"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            await expect(
                getTechnicianAssignmentTimeline("ws_123", "tech_prof_1"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            await expect(
                getTechnicianAssignmentHistorySummary("ws_123"),
            ).rejects.toBeInstanceOf(ForbiddenError);
        });

        it("rejects unauthenticated and non-member requests", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                getTechnicianAssignmentHistory("ws_123", "tech_prof_1"),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                getTechnicianAssignmentHistory("ws_123", "tech_prof_1"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });
    });

    // =========================================================================
    // B. TECHNICIAN ASSIGNMENT HISTORY
    // =========================================================================
    describe("B. Technician Assignment History", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("returns paginated history with exact scheduledMinutes and clean projections", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleProfileDb);
            mocks.technicianAssignmentCount.mockResolvedValue(1);
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                sampleHistoryRecord,
            ]);

            const result = await getTechnicianAssignmentHistory(
                "ws_123",
                "tech_prof_1",
                { page: 1, pageSize: 20 },
            );

            expect(result.items).toHaveLength(1);
            const item = result.items[0];
            expect(item.id).toBe("asgn_100");
            expect(item.technicianProfileId).toBe("tech_prof_1");
            expect(item.employee.displayName).toBe("Zubair Sanaullah");
            expect(item.status).toBe("COMPLETED");
            expect(item.scheduledMinutes).toBe(240); // 4 hours
            expect(item.completedAt).toEqual(new Date("2026-09-07T12:05:00.000Z"));
            expect(item).not.toHaveProperty("passwordHash");
            expect(item).not.toHaveProperty("accounts");
        });

        it("returns empty pagination when technician profile is not found", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const result = await getTechnicianAssignmentHistory(
                "ws_123",
                "tech_missing",
            );

            expect(result.items).toHaveLength(0);
            expect(result.pagination.total).toBe(0);
        });
    });

    // =========================================================================
    // C. WORKSPACE ASSIGNMENT HISTORY
    // =========================================================================
    describe("C. Workspace Assignment History", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("retrieves workspace history across technicians with employee and status filters", async () => {
            mocks.technicianAssignmentCount.mockResolvedValue(1);
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                sampleHistoryRecord,
            ]);

            const result = await getTechnicianAssignmentHistoryForWorkspace(
                "ws_123",
                {
                    employeeId: "emp_1",
                    status: "COMPLETED",
                    workType: "WORK",
                    workReferenceId: "work_100",
                },
            );

            expect(result.items).toHaveLength(1);
            expect(result.items[0].id).toBe("asgn_100");
            expect(result.pagination.total).toBe(1);
        });
    });

    // =========================================================================
    // D. DATE RANGE INTERVAL FILTERING ([from, to) HALF-OPEN OVERLAP)
    // =========================================================================
    describe("D. Date Range Interval Filtering", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleProfileDb);
        });

        it("constructs half-open interval overlap where query: startsAt < to && endsAt > from", async () => {
            mocks.technicianAssignmentCount.mockResolvedValue(1);
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                sampleHistoryRecord,
            ]);

            const from = new Date("2026-09-07T09:00:00.000Z");
            const to = new Date("2026-09-07T11:00:00.000Z");

            await getTechnicianAssignmentHistory("ws_123", "tech_prof_1", {
                from,
                to,
            });

            expect(mocks.technicianAssignmentFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        startsAt: { lt: to },
                        endsAt: { gt: from },
                    }),
                }),
            );
        });
    });

    // =========================================================================
    // E. TIMELINE EVENT PROJECTION
    // =========================================================================
    describe("E. Timeline Event Projection", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleProfileDb);
        });

        it("derives CREATED, COMPLETED, and CANCELLED events sorted deterministically", async () => {
            const records = [
                {
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    status: "ASSIGNED",
                    createdAt: new Date("2026-09-01T08:00:00.000Z"),
                    completedAt: null,
                    cancelledAt: null,
                    cancellationReason: null,
                },
                {
                    id: "asgn_2",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_2",
                    status: "COMPLETED",
                    createdAt: new Date("2026-09-01T09:00:00.000Z"),
                    completedAt: new Date("2026-09-02T12:00:00.000Z"),
                    cancelledAt: null,
                    cancellationReason: null,
                },
                {
                    id: "asgn_3",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_3",
                    status: "CANCELLED",
                    createdAt: new Date("2026-09-01T10:00:00.000Z"),
                    completedAt: null,
                    cancelledAt: new Date("2026-09-03T15:00:00.000Z"),
                    cancellationReason: "Parts not in stock",
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(records);

            const timeline = await getTechnicianAssignmentTimeline(
                "ws_123",
                "tech_prof_1",
            );

            expect(timeline).toHaveLength(5); // 1 + 2 + 2

            expect(timeline[0].type).toBe("CREATED");
            expect(timeline[0].assignmentId).toBe("asgn_1");

            expect(timeline[1].type).toBe("CREATED");
            expect(timeline[1].assignmentId).toBe("asgn_2");

            expect(timeline[2].type).toBe("CREATED");
            expect(timeline[2].assignmentId).toBe("asgn_3");

            expect(timeline[3].type).toBe("COMPLETED");
            expect(timeline[3].assignmentId).toBe("asgn_2");

            expect(timeline[4].type).toBe("CANCELLED");
            expect(timeline[4].assignmentId).toBe("asgn_3");
            expect(timeline[4].cancellationReason).toBe("Parts not in stock");
        });

        it("filters timeline events by point-in-time occurrence window [from, to)", async () => {
            const records = [
                {
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    status: "COMPLETED",
                    createdAt: new Date("2026-09-01T08:00:00.000Z"),
                    completedAt: new Date("2026-09-05T12:00:00.000Z"),
                    cancelledAt: null,
                    cancellationReason: null,
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(records);

            const timeline = await getTechnicianAssignmentTimeline(
                "ws_123",
                "tech_prof_1",
                {
                    from: new Date("2026-09-04T00:00:00.000Z"),
                    to: new Date("2026-09-06T00:00:00.000Z"),
                },
            );

            // CREATED on 2026-09-01 excluded; COMPLETED on 2026-09-05 included
            expect(timeline).toHaveLength(1);
            expect(timeline[0].type).toBe("COMPLETED");
            expect(timeline[0].assignmentId).toBe("asgn_1");
        });
    });

    // =========================================================================
    // F. ASSIGNMENT HISTORY SUMMARY
    // =========================================================================
    describe("F. Assignment History Summary", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("computes counts and scheduled minutes per status correctly", async () => {
            const records = [
                {
                    id: "asgn_1",
                    status: "ASSIGNED",
                    startsAt: new Date("2026-09-07T08:00:00.000Z"),
                    endsAt: new Date("2026-09-07T10:00:00.000Z"), // 120 min
                },
                {
                    id: "asgn_2",
                    status: "COMPLETED",
                    startsAt: new Date("2026-09-07T11:00:00.000Z"),
                    endsAt: new Date("2026-09-07T14:00:00.000Z"), // 180 min
                },
                {
                    id: "asgn_3",
                    status: "CANCELLED",
                    startsAt: new Date("2026-09-07T15:00:00.000Z"),
                    endsAt: new Date("2026-09-07T16:00:00.000Z"), // 60 min
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(records);

            const summary = await getTechnicianAssignmentHistorySummary("ws_123");

            expect(summary.totalAssignments).toBe(3);
            expect(summary.assignedCount).toBe(1);
            expect(summary.completedCount).toBe(1);
            expect(summary.cancelledCount).toBe(1);
            expect(summary.totalScheduledMinutes).toBe(360); // 120 + 180 + 60
            expect(summary.completedScheduledMinutes).toBe(180);
            expect(summary.cancelledScheduledMinutes).toBe(60);
        });
    });

    // =========================================================================
    // G. TENANT ISOLATION & MUTATION SAFETY
    // =========================================================================
    describe("G. Tenant Isolation & Mutation Safety", () => {
        beforeEach(() => {
            setupAuthSession("user_disp");
            registerUser("user_disp");
            registerWorkspace("ws_123");
            registerMembership("mem_disp", "user_disp", "ws_123", "DISPATCHER");
        });

        it("strictly prevents cross-workspace history access", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const history = await getTechnicianAssignmentHistory(
                "ws_123",
                "tech_ws_other",
            );

            expect(history.items).toHaveLength(0);
        });

        it("verifies zero database mutation calls during history reads", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleProfileDb);
            mocks.technicianAssignmentCount.mockResolvedValue(1);
            mocks.technicianAssignmentFindMany.mockResolvedValue([
                sampleHistoryRecord,
            ]);

            await getTechnicianAssignmentHistory("ws_123", "tech_prof_1");
            await getTechnicianAssignmentHistoryForWorkspace("ws_123");
            await getTechnicianAssignmentTimeline("ws_123", "tech_prof_1");
            await getTechnicianAssignmentHistorySummary("ws_123");

            expect(mocks.technicianAssignmentCreate).not.toHaveBeenCalled();
            expect(mocks.technicianAssignmentUpdate).not.toHaveBeenCalled();
            expect(mocks.technicianAssignmentDelete).not.toHaveBeenCalled();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
        });
    });
});
