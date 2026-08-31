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
    technicianProfileDelete: vi.fn(),
    skillCreate: vi.fn(),
    serviceAreaCreate: vi.fn(),
    technicianAvailabilityCreate: vi.fn(),
    technicianAvailabilityExceptionCreate: vi.fn(),
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
            delete: mocks.technicianProfileDelete,
        },
        skill: {
            create: mocks.skillCreate,
        },
        serviceArea: {
            create: mocks.serviceAreaCreate,
        },
        technicianAvailability: {
            create: mocks.technicianAvailabilityCreate,
        },
        technicianAvailabilityException: {
            create: mocks.technicianAvailabilityExceptionCreate,
        },
    },
}));

import { getTechnicianProfileOverview } from "@/lib/services/technicianProfile/getTechnicianProfileOverview";
import { getTechnicianProfileOverviewByEmployee } from "@/lib/services/technicianProfile/getTechnicianProfileOverviewByEmployee";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.13 — Technician Profile Aggregation & Read Model", () => {
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

    const sampleAggregateDbResult = {
        id: "tech_prof_123",
        licenseNumber: "HVAC-LIC-998822",
        yearsExperience: 8,
        emergencyContact: "+1-555-9111",
        notes: "Lead certified commercial technician.",
        employee: {
            id: "emp_123",
            employeeNumber: "EMP-001",
            displayName: "John Field Tech",
            phone: "+1-555-0199",
            hireDate: new Date("2026-01-01T00:00:00.000Z"),
            status: "ACTIVE" as const,
            notes: "Outstanding performance.",
            department: {
                id: "dept_field_ops",
                name: "Field Operations",
                description: "On-site installation and maintenance unit.",
                status: "ACTIVE" as const,
            },
            jobTitle: {
                id: "title_lead_tech",
                name: "Lead HVAC Technician",
                description: "Senior field installation specialist.",
                status: "ACTIVE" as const,
            },
        },
        technicianSkills: [
            {
                id: "tech_skill_1",
                proficiency: "EXPERT" as const,
                yearsExperience: 8,
                notes: "Primary specialty.",
                skill: {
                    id: "skill_1",
                    name: "Commercial HVAC Installation",
                    description: "Installation of rooftop packaged units.",
                    status: "ACTIVE" as const,
                },
            },
            {
                id: "tech_skill_2",
                proficiency: "ADVANCED" as const,
                yearsExperience: 4,
                notes: "Secondary certification.",
                skill: {
                    id: "skill_2",
                    name: "Refrigerant Recovery",
                    description: "EPA Section 608 certified.",
                    status: "INACTIVE" as const, // Inactive skill remains visible in read model
                },
            },
        ],
        technicianServiceAreas: [
            {
                id: "tech_area_1",
                notes: "Primary dispatch corridor.",
                serviceArea: {
                    id: "area_1",
                    name: "DHA Lahore",
                    description: "Residential & commercial zone.",
                    status: "ACTIVE" as const,
                },
            },
            {
                id: "tech_area_2",
                notes: "Backup emergency zone.",
                serviceArea: {
                    id: "area_2",
                    name: "Gulberg Central",
                    description: "Commercial business hub.",
                    status: "INACTIVE" as const, // Inactive service area remains visible in read model
                },
            },
        ],
        technicianAvailabilities: [
            {
                id: "avail_2",
                dayOfWeek: "TUESDAY" as const,
                startTime: "08:00",
                endTime: "17:00",
                status: "ACTIVE" as const,
                notes: "Regular shift.",
            },
            {
                id: "avail_1",
                dayOfWeek: "MONDAY" as const,
                startTime: "08:00",
                endTime: "12:00",
                status: "ACTIVE" as const,
                notes: "Morning shift.",
            },
            {
                id: "avail_3",
                dayOfWeek: "MONDAY" as const,
                startTime: "13:00",
                endTime: "17:00",
                status: "INACTIVE" as const, // Inactive availability remains visible
                notes: "Afternoon shift (suspended).",
            },
        ],
        technicianAvailabilityExceptions: [
            {
                id: "exc_1",
                type: "VACATION" as const,
                status: "ACTIVE" as const,
                title: "Summer Vacation",
                startsAt: new Date("2026-09-01T00:00:00.000Z"),
                endsAt: new Date("2026-09-05T23:59:59.000Z"),
                isAllDay: true,
                notes: "Annual leave.",
            },
            {
                id: "exc_2",
                type: "TRAINING" as const,
                status: "CANCELLED" as const, // Cancelled exception remains visible
                title: "Safety Seminar",
                startsAt: new Date("2026-09-10T09:00:00.000Z"),
                endsAt: new Date("2026-09-10T12:00:00.000Z"),
                isAllDay: false,
                notes: "Rescheduled by provider.",
            },
        ],
    };

    // =========================================================================
    // A. AUTHORIZATION TESTS
    // =========================================================================
    describe("Authorization & RBAC", () => {
        it("allows OWNER to retrieve overview", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(result).not.toBeNull();
            expect(result?.technicianProfile.id).toBe("tech_prof_123");
        });

        it("allows ADMIN to retrieve overview", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(result).not.toBeNull();
        });

        it("allows MANAGER to retrieve overview (under MEMBERS_VIEW)", async () => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(result).not.toBeNull();
        });

        it("rejects unauthorized roles (TECHNICIAN, DISPATCHER, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                getTechnicianProfileOverview("ws_123", "tech_prof_123"),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.technicianProfileFindFirst).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated request", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                getTechnicianProfileOverview("ws_123", "tech_prof_123"),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.technicianProfileFindFirst).not.toHaveBeenCalled();
        });

        it("rejects non-member request", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                getTechnicianProfileOverview("ws_123", "tech_prof_123"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.technicianProfileFindFirst).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // B. TENANT ISOLATION TESTS
    // =========================================================================
    describe("Tenant Isolation", () => {
        it("returns null when searching for a technician in another workspace", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_workspace_b",
            );

            expect(result).toBeNull();
            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: "tech_prof_workspace_b",
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                }),
            );
        });

        it("enforces tenant boundary on getTechnicianProfileOverviewByEmployee", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const result = await getTechnicianProfileOverviewByEmployee(
                "ws_123",
                "emp_workspace_b",
            );

            expect(result).toBeNull();
            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        employeeId: "emp_workspace_b",
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                }),
            );
        });
    });

    // =========================================================================
    // C. COMPLETE AGGREGATION TESTS
    // =========================================================================
    describe("Complete Aggregation", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAggregateDbResult,
            );
        });

        it("aggregates all domains into a clean, strongly typed read model", async () => {
            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(result).not.toBeNull();

            // Employee fields
            expect(result?.employee.id).toBe("emp_123");
            expect(result?.employee.employeeNumber).toBe("EMP-001");
            expect(result?.employee.displayName).toBe("John Field Tech");
            expect(result?.employee.phone).toBe("+1-555-0199");
            expect(result?.employee.status).toBe("ACTIVE");
            expect(result?.employee.hireDate).toEqual(
                new Date("2026-01-01T00:00:00.000Z"),
            );

            // Department
            expect(result?.department?.id).toBe("dept_field_ops");
            expect(result?.department?.name).toBe("Field Operations");

            // Job Title
            expect(result?.jobTitle?.id).toBe("title_lead_tech");
            expect(result?.jobTitle?.name).toBe("Lead HVAC Technician");

            // Technician Profile
            expect(result?.technicianProfile.id).toBe("tech_prof_123");
            expect(result?.technicianProfile.licenseNumber).toBe(
                "HVAC-LIC-998822",
            );
            expect(result?.technicianProfile.yearsExperience).toBe(8);

            // Skills
            expect(result?.skills).toHaveLength(2);
            expect(result?.skills[0].skill.name).toBe(
                "Commercial HVAC Installation",
            );

            // Service Areas
            expect(result?.serviceAreas).toHaveLength(2);
            expect(result?.serviceAreas[0].serviceArea.name).toBe("DHA Lahore");

            // Availability
            expect(result?.availability).toHaveLength(3);

            // Exceptions
            expect(result?.availabilityExceptions).toHaveLength(2);
        });

        it("can also be retrieved via employeeId using getTechnicianProfileOverviewByEmployee", async () => {
            const result = await getTechnicianProfileOverviewByEmployee(
                "ws_123",
                "emp_123",
            );

            expect(result).not.toBeNull();
            expect(result?.employee.id).toBe("emp_123");
            expect(result?.technicianProfile.id).toBe("tech_prof_123");
        });
    });

    // =========================================================================
    // D. OPTIONAL RELATIONS & EMPTY COLLECTIONS
    // =========================================================================
    describe("Optional Relations & Empty Collection Normalization", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("normalizes missing department and job title to null", async () => {
            const bareProfile = {
                ...sampleAggregateDbResult,
                employee: {
                    ...sampleAggregateDbResult.employee,
                    department: null,
                    jobTitle: null,
                },
            };
            mocks.technicianProfileFindFirst.mockResolvedValue(bareProfile);

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(result?.department).toBeNull();
            expect(result?.jobTitle).toBeNull();
        });

        it("normalizes empty collections to [] (never null)", async () => {
            const emptyCollectionsProfile = {
                ...sampleAggregateDbResult,
                technicianSkills: [],
                technicianServiceAreas: [],
                technicianAvailabilities: [],
                technicianAvailabilityExceptions: [],
            };
            mocks.technicianProfileFindFirst.mockResolvedValue(
                emptyCollectionsProfile,
            );

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(result?.skills).toEqual([]);
            expect(result?.serviceAreas).toEqual([]);
            expect(result?.availability).toEqual([]);
            expect(result?.availabilityExceptions).toEqual([]);
        });
    });

    // =========================================================================
    // E. EMPLOYEE WITHOUT TECHNICIAN PROFILE
    // =========================================================================
    describe("Employee without TechnicianProfile", () => {
        it("returns null when employee has no technician profile (no auto-creation)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            const result = await getTechnicianProfileOverviewByEmployee(
                "ws_123",
                "emp_pure_accountant",
            );

            expect(result).toBeNull();
        });
    });

    // =========================================================================
    // F. DETERMINISTIC ORDERING
    // =========================================================================
    describe("Deterministic Ordering", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("orders availability Monday -> Sunday, then startTime ASC", async () => {
            const unorderedAvailabilityProfile = {
                ...sampleAggregateDbResult,
                technicianAvailabilities: [
                    {
                        id: "3",
                        dayOfWeek: "FRIDAY" as const,
                        startTime: "09:00",
                        endTime: "17:00",
                        status: "ACTIVE" as const,
                        notes: null,
                    },
                    {
                        id: "1",
                        dayOfWeek: "MONDAY" as const,
                        startTime: "13:00",
                        endTime: "17:00",
                        status: "ACTIVE" as const,
                        notes: null,
                    },
                    {
                        id: "2",
                        dayOfWeek: "MONDAY" as const,
                        startTime: "08:00",
                        endTime: "12:00",
                        status: "ACTIVE" as const,
                        notes: null,
                    },
                    {
                        id: "4",
                        dayOfWeek: "SUNDAY" as const,
                        startTime: "10:00",
                        endTime: "14:00",
                        status: "ACTIVE" as const,
                        notes: null,
                    },
                ],
            };
            mocks.technicianProfileFindFirst.mockResolvedValue(
                unorderedAvailabilityProfile,
            );

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(
                result?.availability.map((a) => `${a.dayOfWeek}_${a.startTime}`),
            ).toEqual([
                "MONDAY_08:00",
                "MONDAY_13:00",
                "FRIDAY_09:00",
                "SUNDAY_10:00",
            ]);
        });
    });

    // =========================================================================
    // G. STATUS REPRESENTATION
    // =========================================================================
    describe("Status Representation", () => {
        it("preserves actual statuses for inactive skills, service areas, and cancelled exceptions", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect(result?.skills[1].skill.status).toBe("INACTIVE");
            expect(result?.serviceAreas[1].serviceArea.status).toBe("INACTIVE");
            expect(result?.availabilityExceptions[1].status).toBe("CANCELLED");
        });
    });

    // =========================================================================
    // H. SECURITY & CLEAN PROJECTION
    // =========================================================================
    describe("Security & Clean Projection", () => {
        it("never leaks User passwords, session tokens, or account credentials in the read model", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAggregateDbResult,
            );

            const result = await getTechnicianProfileOverview(
                "ws_123",
                "tech_prof_123",
            );

            expect((result as any).user).toBeUndefined();
            expect((result as any).passwordHash).toBeUndefined();
            expect((result as any).accounts).toBeUndefined();
            expect((result as any).sessions).toBeUndefined();
            expect((result?.employee as any).passwordHash).toBeUndefined();
        });
    });

    // =========================================================================
    // I. READ-ONLY DATA INTEGRITY
    // =========================================================================
    describe("Read-Only Data Integrity", () => {
        it("performs zero database mutation operations", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleAggregateDbResult,
            );

            await getTechnicianProfileOverview("ws_123", "tech_prof_123");

            expect(mocks.employeeDelete).not.toHaveBeenCalled();
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.skillCreate).not.toHaveBeenCalled();
            expect(mocks.serviceAreaCreate).not.toHaveBeenCalled();
            expect(mocks.technicianAvailabilityCreate).not.toHaveBeenCalled();
            expect(
                mocks.technicianAvailabilityExceptionCreate,
            ).not.toHaveBeenCalled();
        });
    });
});
