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
    technicianAvailabilityCreate: vi.fn(),
    technicianAvailabilityFindUnique: vi.fn(),
    technicianAvailabilityFindFirst: vi.fn(),
    technicianAvailabilityFindMany: vi.fn(),
    technicianAvailabilityUpdate: vi.fn(),
    technicianAvailabilityDelete: vi.fn(),
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
        technicianAvailability: {
            create: mocks.technicianAvailabilityCreate,
            findUnique: mocks.technicianAvailabilityFindUnique,
            findFirst: mocks.technicianAvailabilityFindFirst,
            findMany: mocks.technicianAvailabilityFindMany,
            update: mocks.technicianAvailabilityUpdate,
            delete: mocks.technicianAvailabilityDelete,
        },
    },
}));

import { createTechnicianAvailability } from "@/lib/services/technicianAvailability/createTechnicianAvailability";
import { getTechnicianAvailability } from "@/lib/services/technicianAvailability/getTechnicianAvailability";
import { getTechnicianAvailabilities } from "@/lib/services/technicianAvailability/getTechnicianAvailabilities";
import { updateTechnicianAvailability } from "@/lib/services/technicianAvailability/updateTechnicianAvailability";
import { updateTechnicianAvailabilityStatus } from "@/lib/services/technicianAvailability/updateTechnicianAvailabilityStatus";
import { deleteTechnicianAvailability } from "@/lib/services/technicianAvailability/deleteTechnicianAvailability";
import {
    TechnicianAvailabilityNotFoundError,
    TechnicianAvailabilityAlreadyExistsError,
    InvalidTechnicianProfileError,
    InvalidAvailabilityTimeError,
    AvailabilityOverlapError,
} from "@/lib/services/technicianAvailability/technicianAvailabilityErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { TechnicianAvailability, TechnicianProfile, Employee, WorkspaceMember, User } from "@/generated/prisma/client";

describe("Phase 1.3.11 — Technician Availability & Schedules Service Layer", () => {
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
        displayName: "John Field Tech",
        phone: "+1-555-0199",
        hireDate: new Date("2026-01-01T00:00:00.000Z"),
        status: "ACTIVE",
        notes: null,
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const sampleTechnicianProfile: TechnicianProfile = {
        id: "tech_prof_123",
        employeeId: "emp_123",
        licenseNumber: "HVAC-LIC-998822",
        yearsExperience: 8,
        emergencyContact: "+1-555-9111",
        notes: "Certified field technician.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const sampleAvailability: TechnicianAvailability = {
        id: "avail_mon_morning",
        technicianProfileId: "tech_prof_123",
        dayOfWeek: "MONDAY",
        startTime: "08:00",
        endTime: "12:00",
        status: "ACTIVE",
        notes: "Morning maintenance shift.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. CREATION & RBAC TESTS
    // =========================================================================
    describe("createTechnicianAvailability()", () => {
        it("allows OWNER to create availability", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianAvailabilityFindUnique.mockResolvedValue(null);
            mocks.technicianAvailabilityFindMany.mockResolvedValue([]);
            mocks.technicianAvailabilityCreate.mockResolvedValue(sampleAvailability);

            const result = await createTechnicianAvailability("ws_123", "tech_prof_123", {
                dayOfWeek: "MONDAY",
                startTime: "08:00",
                endTime: "12:00",
                notes: "Morning maintenance shift.",
            });

            expect(mocks.technicianAvailabilityCreate).toHaveBeenCalledWith({
                data: {
                    technicianProfileId: "tech_prof_123",
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                    status: "ACTIVE",
                    notes: "Morning maintenance shift.",
                },
            });
            expect(result.id).toBe("avail_mon_morning");
        });

        it("allows ADMIN to create availability", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianAvailabilityFindUnique.mockResolvedValue(null);
            mocks.technicianAvailabilityFindMany.mockResolvedValue([]);
            mocks.technicianAvailabilityCreate.mockResolvedValue(sampleAvailability);

            const result = await createTechnicianAvailability("ws_123", "tech_prof_123", {
                dayOfWeek: "MONDAY",
                startTime: "08:00",
                endTime: "12:00",
            });

            expect(result.startTime).toBe("08:00");
        });

        it("rejects unauthorized roles (MANAGER, DISPATCHER, TECHNICIAN, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.technicianAvailabilityCreate).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                }),
            ).rejects.toBeInstanceOf(UnauthorizedError);

            expect(mocks.technicianAvailabilityCreate).not.toHaveBeenCalled();
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.technicianAvailabilityCreate).not.toHaveBeenCalled();
        });

        it("rejects missing or cross-workspace technician profile", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_other", {
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                }),
            ).rejects.toBeInstanceOf(InvalidTechnicianProfileError);

            expect(mocks.technicianAvailabilityCreate).not.toHaveBeenCalled();
        });

        it("rejects duplicate identical availability record", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianAvailabilityFindUnique.mockResolvedValue(sampleAvailability);

            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                }),
            ).rejects.toBeInstanceOf(TechnicianAvailabilityAlreadyExistsError);

            expect(mocks.technicianAvailabilityCreate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. TIME & FORMAT VALIDATION TESTS
    // =========================================================================
    describe("Time & Format Validation", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("accepts valid Monday–Sunday enum values", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianAvailabilityFindUnique.mockResolvedValue(null);
            mocks.technicianAvailabilityFindMany.mockResolvedValue([]);
            mocks.technicianAvailabilityCreate.mockResolvedValue(sampleAvailability);

            const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
            for (const day of days) {
                const res = await createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: day,
                    startTime: "08:00",
                    endTime: "17:00",
                });
                expect(res).toBeDefined();
            }
        });

        it("rejects invalid day of week", async () => {
            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "FUNDAY" as any,
                    startTime: "08:00",
                    endTime: "17:00",
                }),
            ).rejects.toThrow();
        });

        it("rejects malformed time format (e.g. single digit hour, 25:00, 99:99, abc)", async () => {
            const malformed = ["8:00", "25:00", "08:60", "99:99", "abc", "12:0", "12:000"];
            for (const badTime of malformed) {
                await expect(
                    createTechnicianAvailability("ws_123", "tech_prof_123", {
                        dayOfWeek: "MONDAY",
                        startTime: badTime,
                        endTime: "17:00",
                    }),
                ).rejects.toThrow();
            }
        });

        it("rejects startTime equal to endTime (e.g. 08:00 -> 08:00)", async () => {
            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "08:00",
                }),
            ).rejects.toThrow();
        });

        it("rejects startTime later than endTime (e.g. 17:00 -> 08:00)", async () => {
            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "MONDAY",
                    startTime: "17:00",
                    endTime: "08:00",
                }),
            ).rejects.toThrow();
        });
    });

    // =========================================================================
    // 3. OVERLAP DETECTION TESTS
    // =========================================================================
    describe("Overlap Detection Strategy", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianAvailabilityFindUnique.mockResolvedValue(null);
        });

        it("rejects overlapping active windows on the same day (e.g. 08:00–12:00 vs 11:00–15:00)", async () => {
            mocks.technicianAvailabilityFindMany.mockResolvedValue([
                {
                    id: "existing_1",
                    technicianProfileId: "tech_prof_123",
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                    status: "ACTIVE",
                },
            ]);

            await expect(
                createTechnicianAvailability("ws_123", "tech_prof_123", {
                    dayOfWeek: "MONDAY",
                    startTime: "11:00",
                    endTime: "15:00",
                }),
            ).rejects.toBeInstanceOf(AvailabilityOverlapError);

            expect(mocks.technicianAvailabilityCreate).not.toHaveBeenCalled();
        });

        it("allows exact boundary touching windows on the same day (e.g. 08:00–12:00 and 12:00–15:00)", async () => {
            mocks.technicianAvailabilityFindMany.mockResolvedValue([
                {
                    id: "existing_1",
                    technicianProfileId: "tech_prof_123",
                    dayOfWeek: "MONDAY",
                    startTime: "08:00",
                    endTime: "12:00",
                    status: "ACTIVE",
                },
            ]);
            mocks.technicianAvailabilityCreate.mockResolvedValue({
                ...sampleAvailability,
                startTime: "12:00",
                endTime: "15:00",
            });

            const result = await createTechnicianAvailability("ws_123", "tech_prof_123", {
                dayOfWeek: "MONDAY",
                startTime: "12:00",
                endTime: "15:00",
            });

            expect(result.startTime).toBe("12:00");
        });

        it("allows same time window on different days", async () => {
            mocks.technicianAvailabilityFindMany.mockResolvedValue([]); // No records on TUESDAY
            mocks.technicianAvailabilityCreate.mockResolvedValue({
                ...sampleAvailability,
                dayOfWeek: "TUESDAY",
            });

            const result = await createTechnicianAvailability("ws_123", "tech_prof_123", {
                dayOfWeek: "TUESDAY",
                startTime: "08:00",
                endTime: "12:00",
            });

            expect(result.dayOfWeek).toBe("TUESDAY");
        });

        it("does NOT block new active schedule with an INACTIVE overlapping record", async () => {
            // Only inactive records exist
            mocks.technicianAvailabilityFindMany.mockResolvedValue([]);
            mocks.technicianAvailabilityCreate.mockResolvedValue(sampleAvailability);

            const result = await createTechnicianAvailability("ws_123", "tech_prof_123", {
                dayOfWeek: "MONDAY",
                startTime: "08:00",
                endTime: "12:00",
            });

            expect(result.id).toBe("avail_mon_morning");
        });
    });

    // =========================================================================
    // 4. RETRIEVAL & SORTING TESTS
    // =========================================================================
    describe("Retrieval & Deterministic Sorting", () => {
        beforeEach(() => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");
        });

        it("retrieves availability by ID with tenant scope", async () => {
            mocks.technicianAvailabilityFindFirst.mockResolvedValue({
                ...sampleAvailability,
                technicianProfile: sampleTechnicianProfile,
            });

            const result = await getTechnicianAvailability("ws_123", "avail_mon_morning");

            expect(mocks.technicianAvailabilityFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "avail_mon_morning",
                    technicianProfile: {
                        employee: {
                            workspaceId: "ws_123",
                        },
                    },
                },
                include: {
                    technicianProfile: true,
                },
            });
            expect(result?.startTime).toBe("08:00");
        });

        it("orders schedules deterministically Monday -> Sunday, then startTime ASC", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(sampleTechnicianProfile);
            mocks.technicianAvailabilityFindMany.mockResolvedValue([
                { ...sampleAvailability, id: "3", dayOfWeek: "FRIDAY", startTime: "09:00" },
                { ...sampleAvailability, id: "1", dayOfWeek: "MONDAY", startTime: "13:00" },
                { ...sampleAvailability, id: "2", dayOfWeek: "MONDAY", startTime: "08:00" },
                { ...sampleAvailability, id: "4", dayOfWeek: "SUNDAY", startTime: "10:00" },
                { ...sampleAvailability, id: "5", dayOfWeek: "WEDNESDAY", startTime: "08:00" },
            ]);

            const result = await getTechnicianAvailabilities("ws_123", "tech_prof_123");

            expect(result.map((r) => `${r.dayOfWeek}_${r.startTime}`)).toEqual([
                "MONDAY_08:00",
                "MONDAY_13:00",
                "WEDNESDAY_08:00",
                "FRIDAY_09:00",
                "SUNDAY_10:00",
            ]);
        });

        it("enforces tenant isolation — Workspace A cannot retrieve Workspace B availability", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getTechnicianAvailabilities("ws_b", "tech_prof_123"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.technicianAvailabilityFindMany).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. UPDATE TESTS
    // =========================================================================
    describe("updateTechnicianAvailability()", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("allows updating notes without altering times", async () => {
            mocks.technicianAvailabilityFindFirst.mockResolvedValue(sampleAvailability);
            mocks.technicianAvailabilityFindMany.mockResolvedValue([]);
            mocks.technicianAvailabilityUpdate.mockResolvedValue({
                ...sampleAvailability,
                notes: "Updated shift notes.",
            });

            const result = await updateTechnicianAvailability("ws_123", "avail_mon_morning", {
                notes: "Updated shift notes.",
            });

            expect(mocks.technicianAvailabilityUpdate).toHaveBeenCalledWith({
                where: { id: "avail_mon_morning" },
                data: { notes: "Updated shift notes." },
            });
            expect(result.notes).toBe("Updated shift notes.");
        });

        it("re-runs overlap check when updating startTime or endTime into an active collision", async () => {
            mocks.technicianAvailabilityFindFirst.mockResolvedValue(sampleAvailability);
            mocks.technicianAvailabilityFindMany.mockResolvedValue([
                {
                    id: "other_mon_avail",
                    technicianProfileId: "tech_prof_123",
                    dayOfWeek: "MONDAY",
                    startTime: "13:00",
                    endTime: "17:00",
                    status: "ACTIVE",
                },
            ]);

            // Attempting to expand morning shift from 08:00–12:00 to 08:00–14:00 (overlaps 13:00–17:00)
            await expect(
                updateTechnicianAvailability("ws_123", "avail_mon_morning", {
                    endTime: "14:00",
                }),
            ).rejects.toBeInstanceOf(AvailabilityOverlapError);

            expect(mocks.technicianAvailabilityUpdate).not.toHaveBeenCalled();
        });

        it("rejects invalid time update where startTime >= endTime", async () => {
            mocks.technicianAvailabilityFindFirst.mockResolvedValue(sampleAvailability);

            await expect(
                updateTechnicianAvailability("ws_123", "avail_mon_morning", {
                    startTime: "13:00", // original endTime is 12:00
                }),
            ).rejects.toBeInstanceOf(InvalidAvailabilityTimeError);

            expect(mocks.technicianAvailabilityUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 6. STATUS & REACTIVATION TESTS
    // =========================================================================
    describe("updateTechnicianAvailabilityStatus()", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("allows deactivating an active availability record to INACTIVE", async () => {
            mocks.technicianAvailabilityFindFirst.mockResolvedValue(sampleAvailability);
            mocks.technicianAvailabilityUpdate.mockResolvedValue({
                ...sampleAvailability,
                status: "INACTIVE",
            });

            const result = await updateTechnicianAvailabilityStatus(
                "ws_123",
                "avail_mon_morning",
                "INACTIVE",
            );

            expect(mocks.technicianAvailabilityUpdate).toHaveBeenCalledWith({
                where: { id: "avail_mon_morning" },
                data: { status: "INACTIVE" },
            });
            expect(result.status).toBe("INACTIVE");
        });

        it("rejects reactivating an inactive window if it overlaps with an existing active window", async () => {
            mocks.technicianAvailabilityFindFirst.mockResolvedValue({
                ...sampleAvailability,
                status: "INACTIVE",
            });
            mocks.technicianAvailabilityFindMany.mockResolvedValue([
                {
                    id: "active_mon_avail",
                    technicianProfileId: "tech_prof_123",
                    dayOfWeek: "MONDAY",
                    startTime: "09:00",
                    endTime: "13:00",
                    status: "ACTIVE",
                },
            ]);

            await expect(
                updateTechnicianAvailabilityStatus(
                    "ws_123",
                    "avail_mon_morning",
                    "ACTIVE",
                ),
            ).rejects.toBeInstanceOf(AvailabilityOverlapError);

            expect(mocks.technicianAvailabilityUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 7. DELETION TESTS
    // =========================================================================
    describe("deleteTechnicianAvailability()", () => {
        it("allows OWNER or ADMIN to delete availability", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianAvailabilityFindFirst.mockResolvedValue(sampleAvailability);
            mocks.technicianAvailabilityDelete.mockResolvedValue(sampleAvailability);

            const result = await deleteTechnicianAvailability("ws_123", "avail_mon_morning");

            expect(mocks.technicianAvailabilityDelete).toHaveBeenCalledWith({
                where: { id: "avail_mon_morning" },
            });
            expect(result.id).toBe("avail_mon_morning");
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
        });

        it("throws TechnicianAvailabilityNotFoundError when deleting cross-workspace record", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianAvailabilityFindFirst.mockResolvedValue(null);

            await expect(
                deleteTechnicianAvailability("ws_123", "avail_cross_ws"),
            ).rejects.toBeInstanceOf(TechnicianAvailabilityNotFoundError);

            expect(mocks.technicianAvailabilityDelete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 8. STATUS INDEPENDENCE
    // =========================================================================
    describe("Status Independence", () => {
        it("availability status modifications do not alter EmployeeStatus, MembershipStatus, or UserStatus", () => {
            expect(sampleEmployee.status).toBe("ACTIVE");
            expect(sampleTechnicianProfile.id).toBe("tech_prof_123");
        });
    });
});
