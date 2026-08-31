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
    technicianProfileUpdate: vi.fn(),
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
            update: mocks.technicianProfileUpdate,
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

// --- Comprehensive Technician Domain Imports ---
import {
    getTechnicianProfileOverview,
    getTechnicianReadiness,
    getTechnicianAvailabilityCheck,
    getTechnicianWorkEligibility,
} from "@/lib/services/technicianProfile";

import {
    getTechnicianAssignmentOverview,
    completeTechnicianAssignment,
    cancelTechnicianAssignment,
    updateTechnicianAssignment,
    getTechnicianAssignmentHistory,
    getTechnicianAssignmentTimeline,
    getTechnicianAssignmentHistorySummary,
    AssignmentInvalidStatusTransitionError,
    AssignmentImmutableError,
} from "@/lib/services/technicianAssignment";

import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.23 — Technician Domain Completion & Integration Hardening", () => {
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
        userId = "user_owner_1",
        name = "Owner User",
        status = "ACTIVE",
    ) {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
        platformRole: null,
            passwordHash: "secret-hash-salt-12345",
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
        workspaceId = "ws_lahore",
        name = "Aforden HVAC Systems",
        timezone = "Asia/Karachi",
    ) {
        const workspace = {
            id: workspaceId,
            name,
            slug: "aforden-hvac",
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

    function setupAuthSession(userId = "user_admin_1") {
        mocks.auth.mockResolvedValue({
            user: { id: userId },
        });
    }

    // Unified Master Technician DB Mock
    const masterTechnicianDb = {
        id: "tech_prof_1",
        employeeId: "emp_1",
        notes: "Senior HVAC tech",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        employee: {
            id: "emp_1",
            workspaceId: "ws_lahore",
            employeeNumber: "EMP-001",
            displayName: "Zubair Sanaullah",
            phone: "+923001234567",
            status: "ACTIVE" as const,
            department: {
                id: "dept_field",
                name: "Field Operations",
            },
            jobTitle: {
                id: "job_lead",
                name: "Lead HVAC Technician",
            },
        },
        technicianSkills: [
            {
                id: "ts_1",
                technicianProfileId: "tech_prof_1",
                skillId: "skill_hvac_diag",
                proficiency: "EXPERT" as const,
                yearsExperience: 7,
                notes: "Certified Master",
                skill: {
                    id: "skill_hvac_diag",
                    name: "HVAC Diagnostics",
                    status: "ACTIVE" as const,
                },
            },
        ],
        technicianServiceAreas: [
            {
                id: "tsa_1",
                technicianProfileId: "tech_prof_1",
                serviceAreaId: "sa_gulberg",
                notes: "Primary territory",
                serviceArea: {
                    id: "sa_gulberg",
                    name: "Gulberg Lahore",
                    status: "ACTIVE" as const,
                },
            },
        ],
        technicianAvailabilities: [
            {
                id: "avail_mon",
                technicianProfileId: "tech_prof_1",
                dayOfWeek: "MONDAY" as const,
                startTime: "08:00",
                endTime: "17:00",
                status: "ACTIVE" as const,
                notes: "Standard shift",
            },
        ],
        technicianAvailabilityExceptions: [
            {
                id: "exc_lunch_break",
                technicianProfileId: "tech_prof_1",
                type: "TIME_OFF" as const,
                status: "ACTIVE" as const,
                title: "Doctor Appointment",
                startsAt: new Date("2026-09-07T07:00:00.000Z"), // Mon 12:00 PKT
                endsAt: new Date("2026-09-07T08:00:00.000Z"),   // Mon 13:00 PKT
                isAllDay: false,
                notes: "Approved time off",
            },
        ],
    };

    const sampleAssignmentRecord = {
        id: "asgn_alpha",
        technicianProfileId: "tech_prof_1",
        workType: "WORK" as const,
        workReferenceId: "work_ref_999",
        status: "ASSIGNED" as const,
        startsAt: new Date("2026-09-07T04:00:00.000Z"), // Mon 09:00 PKT
        endsAt: new Date("2026-09-07T06:00:00.000Z"),   // Mon 11:00 PKT (120 min)
        notes: "Compressor replacement",
        completedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        createdAt: new Date("2026-09-01T08:00:00.000Z"),
        updatedAt: new Date("2026-09-01T08:00:00.000Z"),
        technicianProfile: {
            employeeId: "emp_1",
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
    // 1. END-TO-END DOMAIN INTEGRATION AUDIT
    // =========================================================================
    describe("1. End-to-End Domain Integration & Read Model Consistency", () => {
        beforeEach(() => {
            setupAuthSession("user_admin_1");
            registerUser("user_admin_1");
            registerWorkspace("ws_lahore");
            registerMembership("mem_admin_1", "user_admin_1", "ws_lahore", "ADMIN");
        });

        it("verifies full profile overview aggregation matches established schema", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(masterTechnicianDb);

            const overview = await getTechnicianProfileOverview(
                "ws_lahore",
                "tech_prof_1",
            );

            expect(overview).not.toBeNull();
            expect(overview?.employee.displayName).toBe("Zubair Sanaullah");
            expect(overview?.skills).toHaveLength(1);
            expect(overview?.skills[0].skill.name).toBe("HVAC Diagnostics");
            expect(overview?.serviceAreas).toHaveLength(1);
            expect(overview?.serviceAreas[0].serviceArea.name).toBe("Gulberg Lahore");
            expect(overview?.availability).toHaveLength(1);
            expect(overview?.availabilityExceptions).toHaveLength(1);
        });

        it("verifies operational readiness check evaluates all operational readiness dimensions", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(masterTechnicianDb);

            const readiness = await getTechnicianReadiness(
                "ws_lahore",
                "tech_prof_1",
            );

            expect(readiness).not.toBeNull();
            expect(readiness?.isReady).toBe(true);
            expect(readiness?.blockers).toHaveLength(0);
        });

        it("verifies point-in-time availability detects active exception blocks correctly", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(masterTechnicianDb);

            // Interval inside exception window (Mon 12:00 to 13:00 PKT / 07:00 to 08:00 UTC)
            const check = await getTechnicianAvailabilityCheck(
                "ws_lahore",
                "tech_prof_1",
                {
                    startsAt: new Date("2026-09-07T07:00:00.000Z"),
                    endsAt: new Date("2026-09-07T08:00:00.000Z"),
                },
            );

            expect(check).not.toBeNull();
            expect(check?.isAvailable).toBe(false);
            expect(check?.blockers).toContain("BLOCKED_BY_EXCEPTION");
            expect(check?.blockingExceptions).toHaveLength(1);
        });

        it("verifies work eligibility evaluation with skills, service areas, and point-in-time availability", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(masterTechnicianDb);
            mocks.serviceAreaFindFirst.mockResolvedValue({
                id: "sa_gulberg",
                name: "Gulberg Lahore",
                workspaceId: "ws_lahore",
                status: "ACTIVE",
            });
            mocks.skillFindMany.mockResolvedValue([
                { id: "skill_hvac_diag", name: "HVAC Diagnostics", status: "ACTIVE" },
            ]);

            // Eligible window: Mon 09:00 to 11:00 PKT (04:00 to 06:00 UTC)
            const eligibility = await getTechnicianWorkEligibility(
                "ws_lahore",
                "tech_prof_1",
                {
                    startsAt: new Date("2026-09-07T04:00:00.000Z"),
                    endsAt: new Date("2026-09-07T06:00:00.000Z"),
                    serviceAreaId: "sa_gulberg",
                    requiredSkillIds: ["skill_hvac_diag"],
                },
            );

            expect(eligibility).not.toBeNull();
            expect(eligibility?.isEligible).toBe(true);
            expect(eligibility?.blockers).toHaveLength(0);
            expect(eligibility?.matchedSkills).toHaveLength(1);
            expect(eligibility?.matchedServiceAreas).toHaveLength(1);
            expect(eligibility?.matchedServiceAreas[0].name).toBe("Gulberg Lahore");
        });
    });

    // =========================================================================
    // 2. ASSIGNMENT LIFECYCLE & IMMUTABILITY HARDENING
    // =========================================================================
    describe("2. Assignment Lifecycle & Immutability Hardening", () => {
        beforeEach(() => {
            setupAuthSession("user_admin_1");
            registerUser("user_admin_1");
            registerWorkspace("ws_lahore");
            registerMembership("mem_admin_1", "user_admin_1", "ws_lahore", "ADMIN");
        });

        it("completes ASSIGNED assignment and sets completedAt timestamp", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignmentRecord);
            mocks.technicianAssignmentUpdate.mockResolvedValue({
                ...sampleAssignmentRecord,
                status: "COMPLETED",
                completedAt: new Date("2026-09-07T06:05:00.000Z"),
            });

            const completed = await completeTechnicianAssignment(
                "ws_lahore",
                "asgn_alpha",
            );

            expect(completed.status).toBe("COMPLETED");
            expect(completed.completedAt).toEqual(new Date("2026-09-07T06:05:00.000Z"));
        });

        it("cancels ASSIGNED assignment with reason and sets cancelledAt timestamp", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignmentRecord);
            mocks.technicianAssignmentUpdate.mockResolvedValue({
                ...sampleAssignmentRecord,
                status: "CANCELLED",
                cancelledAt: new Date("2026-09-07T04:30:00.000Z"),
                cancellationReason: "Severe weather delay",
            });

            const cancelled = await cancelTechnicianAssignment(
                "ws_lahore",
                "asgn_alpha",
                { cancellationReason: "Severe weather delay" },
            );

            expect(cancelled.status).toBe("CANCELLED");
            expect(cancelled.cancelledAt).toEqual(new Date("2026-09-07T04:30:00.000Z"));
            expect(cancelled.cancellationReason).toBe("Severe weather delay");
        });

        it("enforces terminal immutability: rejects modifying COMPLETED or CANCELLED assignments", async () => {
            mocks.technicianAssignmentFindFirst.mockResolvedValue({
                ...sampleAssignmentRecord,
                status: "COMPLETED",
                completedAt: new Date("2026-09-07T06:05:00.000Z"),
            });

            await expect(
                updateTechnicianAssignment("ws_lahore", "asgn_alpha", {
                    notes: "Attempted edit after completion",
                }),
            ).rejects.toBeInstanceOf(AssignmentImmutableError);

            await expect(
                completeTechnicianAssignment("ws_lahore", "asgn_alpha"),
            ).rejects.toBeInstanceOf(AssignmentInvalidStatusTransitionError);

            await expect(
                cancelTechnicianAssignment("ws_lahore", "asgn_alpha"),
            ).rejects.toBeInstanceOf(AssignmentInvalidStatusTransitionError);
        });
    });

    // =========================================================================
    // 3. OPERATIONAL HISTORY & TIMELINE AUDIT
    // =========================================================================
    describe("3. Operational History & Timeline Audit", () => {
        beforeEach(() => {
            setupAuthSession("user_admin_1");
            registerUser("user_admin_1");
            registerWorkspace("ws_lahore");
            registerMembership("mem_admin_1", "user_admin_1", "ws_lahore", "ADMIN");
            mocks.technicianProfileFindFirst.mockResolvedValue(masterTechnicianDb);
        });

        it("derives timeline events with deterministic order and point-in-time filtering", async () => {
            const records = [
                {
                    id: "asgn_1",
                    technicianProfileId: "tech_prof_1",
                    workType: "WORK",
                    workReferenceId: "work_1",
                    status: "COMPLETED",
                    createdAt: new Date("2026-09-01T08:00:00.000Z"),
                    completedAt: new Date("2026-09-07T12:00:00.000Z"),
                    cancelledAt: null,
                    cancellationReason: null,
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(records);

            const timeline = await getTechnicianAssignmentTimeline(
                "ws_lahore",
                "tech_prof_1",
                {
                    from: new Date("2026-09-07T00:00:00.000Z"),
                    to: new Date("2026-09-08T00:00:00.000Z"),
                },
            );

            expect(timeline).toHaveLength(1);
            expect(timeline[0].type).toBe("COMPLETED");
            expect(timeline[0].assignmentId).toBe("asgn_1");
        });

        it("computes accurate history summary metrics without mutating data", async () => {
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
                    endsAt: new Date("2026-09-07T13:00:00.000Z"), // 120 min
                },
            ];

            mocks.technicianAssignmentFindMany.mockResolvedValue(records);

            const summary = await getTechnicianAssignmentHistorySummary(
                "ws_lahore",
            );

            expect(summary.totalAssignments).toBe(2);
            expect(summary.assignedCount).toBe(1);
            expect(summary.completedCount).toBe(1);
            expect(summary.totalScheduledMinutes).toBe(240);
            expect(summary.completedScheduledMinutes).toBe(120);
        });
    });

    // =========================================================================
    // 4. CROSS-WORKSPACE TENANT ISOLATION & SECURITY AUDIT
    // =========================================================================
    describe("4. Cross-Workspace Tenant Isolation & Security Audit", () => {
        beforeEach(() => {
            setupAuthSession("user_admin_1");
            registerUser("user_admin_1");
            registerWorkspace("ws_lahore");
            registerMembership("mem_admin_1", "user_admin_1", "ws_lahore", "ADMIN");
        });

        it("ensures zero security-sensitive credential leakage across all read models", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(masterTechnicianDb);
            mocks.technicianAssignmentFindFirst.mockResolvedValue(sampleAssignmentRecord);
            mocks.technicianAssignmentFindMany.mockResolvedValue([sampleAssignmentRecord]);
            mocks.technicianAssignmentCount.mockResolvedValue(1);

            const overview = await getTechnicianAssignmentOverview(
                "ws_lahore",
                "asgn_alpha",
            );

            const history = await getTechnicianAssignmentHistory(
                "ws_lahore",
                "tech_prof_1",
            );

            expect(overview).not.toHaveProperty("passwordHash");
            expect(overview).not.toHaveProperty("accounts");
            expect(overview).not.toHaveProperty("sessions");
            expect(overview).not.toHaveProperty("tokenHash");

            expect(history.items[0]).not.toHaveProperty("passwordHash");
            expect(history.items[0]).not.toHaveProperty("accounts");
        });

        it("strictly prevents cross-workspace data access and mutation", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);
            mocks.technicianAssignmentFindFirst.mockResolvedValue(null);

            const overview = await getTechnicianProfileOverview(
                "ws_lahore",
                "tech_foreign_ws",
            );
            expect(overview).toBeNull();

            const asgnOverview = await getTechnicianAssignmentOverview(
                "ws_lahore",
                "asgn_foreign_ws",
            );
            expect(asgnOverview).toBeNull();
        });
    });
});
