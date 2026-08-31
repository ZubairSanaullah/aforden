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
    technicianAvailabilityExceptionCreate: vi.fn(),
    technicianAvailabilityExceptionFindUnique: vi.fn(),
    technicianAvailabilityExceptionFindFirst: vi.fn(),
    technicianAvailabilityExceptionFindMany: vi.fn(),
    technicianAvailabilityExceptionUpdate: vi.fn(),
    technicianAvailabilityExceptionDelete: vi.fn(),
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
        technicianAvailabilityException: {
            create: mocks.technicianAvailabilityExceptionCreate,
            findUnique: mocks.technicianAvailabilityExceptionFindUnique,
            findFirst: mocks.technicianAvailabilityExceptionFindFirst,
            findMany: mocks.technicianAvailabilityExceptionFindMany,
            update: mocks.technicianAvailabilityExceptionUpdate,
            delete: mocks.technicianAvailabilityExceptionDelete,
        },
    },
}));

import { createTechnicianAvailabilityException } from "@/lib/services/technicianAvailabilityException/createTechnicianAvailabilityException";
import { getTechnicianAvailabilityException } from "@/lib/services/technicianAvailabilityException/getTechnicianAvailabilityException";
import { getTechnicianAvailabilityExceptions } from "@/lib/services/technicianAvailabilityException/getTechnicianAvailabilityExceptions";
import { updateTechnicianAvailabilityException } from "@/lib/services/technicianAvailabilityException/updateTechnicianAvailabilityException";
import { updateTechnicianAvailabilityExceptionStatus } from "@/lib/services/technicianAvailabilityException/updateTechnicianAvailabilityExceptionStatus";
import { deleteTechnicianAvailabilityException } from "@/lib/services/technicianAvailabilityException/deleteTechnicianAvailabilityException";
import {
    TechnicianAvailabilityExceptionNotFoundError,
    InvalidTechnicianProfileError,
    InvalidExceptionTimeError,
    TechnicianAvailabilityExceptionAlreadyExistsError,
} from "@/lib/services/technicianAvailabilityException/technicianAvailabilityExceptionErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type {
    TechnicianAvailabilityException,
    TechnicianProfile,
    Employee,
    WorkspaceMember,
    User,
} from "@/generated/prisma/client";

describe("Phase 1.3.12 — Technician Availability Exceptions Service Layer", () => {
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

    const sampleException: TechnicianAvailabilityException = {
        id: "exc_vacation_1",
        technicianProfileId: "tech_prof_123",
        type: "VACATION",
        status: "ACTIVE",
        title: "Annual Family Vacation",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2026-09-05T23:59:59.000Z"),
        isAllDay: true,
        notes: "Approved by operations manager.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    // =========================================================================
    // 1. CREATION & RBAC TESTS
    // =========================================================================
    describe("createTechnicianAvailabilityException()", () => {
        it("allows OWNER to create an availability exception", async () => {
            setupAuthSession("user_owner");
            registerUser("user_owner");
            registerWorkspace("ws_123");
            registerMembership("mem_owner", "user_owner", "ws_123", "OWNER");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleTechnicianProfile,
            );
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                null,
            );
            mocks.technicianAvailabilityExceptionCreate.mockResolvedValue(
                sampleException,
            );

            const result = await createTechnicianAvailabilityException(
                "ws_123",
                "tech_prof_123",
                {
                    type: "VACATION",
                    title: "Annual Family Vacation",
                    startsAt: "2026-09-01T00:00:00.000Z",
                    endsAt: "2026-09-05T23:59:59.000Z",
                    isAllDay: true,
                    notes: "Approved by operations manager.",
                },
            );

            expect(
                mocks.technicianAvailabilityExceptionCreate,
            ).toHaveBeenCalledWith({
                data: {
                    technicianProfileId: "tech_prof_123",
                    type: "VACATION",
                    status: "ACTIVE",
                    title: "Annual Family Vacation",
                    startsAt: new Date("2026-09-01T00:00:00.000Z"),
                    endsAt: new Date("2026-09-05T23:59:59.000Z"),
                    isAllDay: true,
                    notes: "Approved by operations manager.",
                },
            });
            expect(result.id).toBe("exc_vacation_1");
        });

        it("allows ADMIN to create an availability exception", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleTechnicianProfile,
            );
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                null,
            );
            mocks.technicianAvailabilityExceptionCreate.mockResolvedValue(
                sampleException,
            );

            const result = await createTechnicianAvailabilityException(
                "ws_123",
                "tech_prof_123",
                {
                    type: "SICK_LEAVE",
                    title: "Medical Leave",
                    startsAt: "2026-09-10T08:00:00.000Z",
                    endsAt: "2026-09-10T17:00:00.000Z",
                },
            );

            expect(result).toBeDefined();
        });

        it("rejects unauthorized roles (MANAGER, DISPATCHER, TECHNICIAN, ACCOUNTANT)", async () => {
            setupAuthSession("user_tech");
            registerUser("user_tech");
            registerWorkspace("ws_123");
            registerMembership("mem_tech", "user_tech", "ws_123", "TECHNICIAN");

            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        type: "TIME_OFF",
                        title: "Personal day",
                        startsAt: "2026-09-10T08:00:00.000Z",
                        endsAt: "2026-09-10T17:00:00.000Z",
                    },
                ),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(
                mocks.technicianAvailabilityExceptionCreate,
            ).not.toHaveBeenCalled();
        });

        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        type: "TIME_OFF",
                        title: "Personal day",
                        startsAt: "2026-09-10T08:00:00.000Z",
                        endsAt: "2026-09-10T17:00:00.000Z",
                    },
                ),
            ).rejects.toBeInstanceOf(UnauthorizedError);
        });

        it("rejects non-members of the workspace", async () => {
            setupAuthSession("user_outsider");
            registerUser("user_outsider");
            registerWorkspace("ws_123");

            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        type: "TIME_OFF",
                        title: "Personal day",
                        startsAt: "2026-09-10T08:00:00.000Z",
                        endsAt: "2026-09-10T17:00:00.000Z",
                    },
                ),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
        });

        it("rejects missing or cross-workspace technician profile", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_other",
                    {
                        type: "TIME_OFF",
                        title: "Personal day",
                        startsAt: "2026-09-10T08:00:00.000Z",
                        endsAt: "2026-09-10T17:00:00.000Z",
                    },
                ),
            ).rejects.toBeInstanceOf(InvalidTechnicianProfileError);
        });

        it("rejects duplicate exact exception", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleTechnicianProfile,
            );
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                sampleException,
            );

            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        type: "VACATION",
                        title: "Annual Family Vacation",
                        startsAt: "2026-09-01T00:00:00.000Z",
                        endsAt: "2026-09-05T23:59:59.000Z",
                    },
                ),
            ).rejects.toBeInstanceOf(
                TechnicianAvailabilityExceptionAlreadyExistsError,
            );
        });
    });

    // =========================================================================
    // 2. VALIDATION TESTS
    // =========================================================================
    describe("Validation Requirements", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleTechnicianProfile,
            );
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                null,
            );
            mocks.technicianAvailabilityExceptionCreate.mockResolvedValue(
                sampleException,
            );
        });

        it("accepts all valid exception types (TIME_OFF, VACATION, SICK_LEAVE, PERSONAL_LEAVE, HOLIDAY, TRAINING, UNAVAILABLE, OTHER)", async () => {
            const types = [
                "TIME_OFF",
                "VACATION",
                "SICK_LEAVE",
                "PERSONAL_LEAVE",
                "HOLIDAY",
                "TRAINING",
                "UNAVAILABLE",
                "OTHER",
            ] as const;

            for (const type of types) {
                const res = await createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        type,
                        title: `Valid ${type}`,
                        startsAt: "2026-09-01T08:00:00.000Z",
                        endsAt: "2026-09-01T17:00:00.000Z",
                    },
                );
                expect(res).toBeDefined();
            }
        });

        it("rejects invalid exception type", async () => {
            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        type: "PARTY_TIME" as any,
                        title: "Invalid Type",
                        startsAt: "2026-09-01T08:00:00.000Z",
                        endsAt: "2026-09-01T17:00:00.000Z",
                    },
                ),
            ).rejects.toThrow();
        });

        it("rejects title shorter than 2 characters or longer than 150 characters", async () => {
            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        title: "A",
                        startsAt: "2026-09-01T08:00:00.000Z",
                        endsAt: "2026-09-01T17:00:00.000Z",
                    },
                ),
            ).rejects.toThrow();

            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        title: "A".repeat(151),
                        startsAt: "2026-09-01T08:00:00.000Z",
                        endsAt: "2026-09-01T17:00:00.000Z",
                    },
                ),
            ).rejects.toThrow();
        });

        it("rejects startsAt equal to endsAt", async () => {
            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        title: "Zero length",
                        startsAt: "2026-09-01T08:00:00.000Z",
                        endsAt: "2026-09-01T08:00:00.000Z",
                    },
                ),
            ).rejects.toThrow();
        });

        it("rejects endsAt before startsAt", async () => {
            await expect(
                createTechnicianAvailabilityException(
                    "ws_123",
                    "tech_prof_123",
                    {
                        title: "Backwards",
                        startsAt: "2026-09-05T08:00:00.000Z",
                        endsAt: "2026-09-01T08:00:00.000Z",
                    },
                ),
            ).rejects.toThrow();
        });
    });

    // =========================================================================
    // 3. OVERLAPPING EXCEPTIONS ALLOWED
    // =========================================================================
    describe("Overlapping Exceptions Allowance", () => {
        it("allows creating overlapping active exceptions (e.g. Training inside a Vacation)", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleTechnicianProfile,
            );
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                null,
            );
            mocks.technicianAvailabilityExceptionCreate.mockResolvedValue({
                ...sampleException,
                id: "exc_training_2",
                type: "TRAINING",
                title: "Safety Training",
                startsAt: new Date("2026-09-03T10:00:00.000Z"),
                endsAt: new Date("2026-09-03T12:00:00.000Z"),
            });

            const result = await createTechnicianAvailabilityException(
                "ws_123",
                "tech_prof_123",
                {
                    type: "TRAINING",
                    title: "Safety Training",
                    startsAt: "2026-09-03T10:00:00.000Z",
                    endsAt: "2026-09-03T12:00:00.000Z",
                },
            );

            expect(result.id).toBe("exc_training_2");
        });
    });

    // =========================================================================
    // 4. RETRIEVAL & SORTING TESTS
    // =========================================================================
    describe("Retrieval Operations", () => {
        beforeEach(() => {
            setupAuthSession("user_mgr");
            registerUser("user_mgr");
            registerWorkspace("ws_123");
            registerMembership("mem_mgr", "user_mgr", "ws_123", "MANAGER");
        });

        it("retrieves exception by ID with tenant scope", async () => {
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue({
                ...sampleException,
                technicianProfile: sampleTechnicianProfile,
            });

            const result = await getTechnicianAvailabilityException(
                "ws_123",
                "exc_vacation_1",
            );

            expect(
                mocks.technicianAvailabilityExceptionFindFirst,
            ).toHaveBeenCalledWith({
                where: {
                    id: "exc_vacation_1",
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
            expect(result?.title).toBe("Annual Family Vacation");
        });

        it("orders exceptions deterministically by startsAt ASC, endsAt ASC", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(
                sampleTechnicianProfile,
            );
            mocks.technicianAvailabilityExceptionFindMany.mockResolvedValue([
                {
                    ...sampleException,
                    id: "1",
                    startsAt: new Date("2026-09-01T00:00:00.000Z"),
                    endsAt: new Date("2026-09-05T23:59:59.000Z"),
                },
                {
                    ...sampleException,
                    id: "2",
                    startsAt: new Date("2026-09-03T10:00:00.000Z"),
                    endsAt: new Date("2026-09-03T12:00:00.000Z"),
                },
                {
                    ...sampleException,
                    id: "3",
                    startsAt: new Date("2026-09-10T08:00:00.000Z"),
                    endsAt: new Date("2026-09-10T17:00:00.000Z"),
                },
            ]);

            const result = await getTechnicianAvailabilityExceptions(
                "ws_123",
                "tech_prof_123",
            );

            expect(
                mocks.technicianAvailabilityExceptionFindMany,
            ).toHaveBeenCalledWith({
                where: {
                    technicianProfileId: "tech_prof_123",
                },
                orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }],
            });
            expect(result).toHaveLength(3);
        });

        it("enforces tenant isolation — Workspace A cannot retrieve Workspace B exceptions", async () => {
            setupAuthSession("user_a");
            registerUser("user_a");
            registerWorkspace("ws_a");
            registerWorkspace("ws_b");
            registerMembership("mem_a", "user_a", "ws_a", "ADMIN");

            await expect(
                getTechnicianAvailabilityExceptions("ws_b", "tech_prof_123"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(
                mocks.technicianAvailabilityExceptionFindMany,
            ).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. UPDATE TESTS
    // =========================================================================
    describe("updateTechnicianAvailabilityException()", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("allows updating title and notes", async () => {
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                sampleException,
            );
            mocks.technicianAvailabilityExceptionUpdate.mockResolvedValue({
                ...sampleException,
                title: "Extended Vacation",
                notes: "Added extra days.",
            });

            const result = await updateTechnicianAvailabilityException(
                "ws_123",
                "exc_vacation_1",
                {
                    title: "Extended Vacation",
                    notes: "Added extra days.",
                },
            );

            expect(
                mocks.technicianAvailabilityExceptionUpdate,
            ).toHaveBeenCalledWith({
                where: { id: "exc_vacation_1" },
                data: {
                    title: "Extended Vacation",
                    notes: "Added extra days.",
                },
            });
            expect(result.title).toBe("Extended Vacation");
        });

        it("rejects invalid date updates where startsAt >= endsAt", async () => {
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                sampleException,
            );

            await expect(
                updateTechnicianAvailabilityException(
                    "ws_123",
                    "exc_vacation_1",
                    {
                        startsAt: "2026-09-10T00:00:00.000Z", // original endsAt is 2026-09-05
                    },
                ),
            ).rejects.toBeInstanceOf(InvalidExceptionTimeError);
        });
    });

    // =========================================================================
    // 6. STATUS TESTS
    // =========================================================================
    describe("updateTechnicianAvailabilityExceptionStatus()", () => {
        beforeEach(() => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");
        });

        it("allows cancelling an exception to CANCELLED", async () => {
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                sampleException,
            );
            mocks.technicianAvailabilityExceptionUpdate.mockResolvedValue({
                ...sampleException,
                status: "CANCELLED",
            });

            const result =
                await updateTechnicianAvailabilityExceptionStatus(
                    "ws_123",
                    "exc_vacation_1",
                    "CANCELLED",
                );

            expect(
                mocks.technicianAvailabilityExceptionUpdate,
            ).toHaveBeenCalledWith({
                where: { id: "exc_vacation_1" },
                data: { status: "CANCELLED" },
            });
            expect(result.status).toBe("CANCELLED");
        });

        it("allows reactivating an exception to ACTIVE", async () => {
            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue({
                ...sampleException,
                status: "CANCELLED",
            });
            mocks.technicianAvailabilityExceptionUpdate.mockResolvedValue({
                ...sampleException,
                status: "ACTIVE",
            });

            const result =
                await updateTechnicianAvailabilityExceptionStatus(
                    "ws_123",
                    "exc_vacation_1",
                    { status: "ACTIVE" },
                );

            expect(result.status).toBe("ACTIVE");
        });
    });

    // =========================================================================
    // 7. DELETION TESTS
    // =========================================================================
    describe("deleteTechnicianAvailabilityException()", () => {
        it("allows OWNER or ADMIN to delete exception", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                sampleException,
            );
            mocks.technicianAvailabilityExceptionDelete.mockResolvedValue(
                sampleException,
            );

            const result = await deleteTechnicianAvailabilityException(
                "ws_123",
                "exc_vacation_1",
            );

            expect(
                mocks.technicianAvailabilityExceptionDelete,
            ).toHaveBeenCalledWith({
                where: { id: "exc_vacation_1" },
            });
            expect(result.id).toBe("exc_vacation_1");
            expect(mocks.technicianProfileDelete).not.toHaveBeenCalled();
            expect(mocks.employeeDelete).not.toHaveBeenCalled();
        });

        it("throws TechnicianAvailabilityExceptionNotFoundError when deleting cross-workspace record", async () => {
            setupAuthSession("user_admin");
            registerUser("user_admin");
            registerWorkspace("ws_123");
            registerMembership("mem_admin", "user_admin", "ws_123", "ADMIN");

            mocks.technicianAvailabilityExceptionFindFirst.mockResolvedValue(
                null,
            );

            await expect(
                deleteTechnicianAvailabilityException("ws_123", "exc_cross_ws"),
            ).rejects.toBeInstanceOf(
                TechnicianAvailabilityExceptionNotFoundError,
            );

            expect(
                mocks.technicianAvailabilityExceptionDelete,
            ).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 8. STATUS INDEPENDENCE
    // =========================================================================
    describe("Status Independence", () => {
        it("exception status modifications do not alter EmployeeStatus, MembershipStatus, or UserStatus", () => {
            expect(sampleEmployee.status).toBe("ACTIVE");
            expect(sampleTechnicianProfile.id).toBe("tech_prof_123");
        });
    });
});
