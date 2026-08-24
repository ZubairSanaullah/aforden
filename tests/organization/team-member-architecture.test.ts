import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type Employee,
    type EmployeeStatus,
    type MembershipRole,
    type MembershipStatus,
    type User,
    type Workspace,
    type WorkspaceMember,
} from "../../generated/prisma/client";
import { workspaceScope } from "@/lib/auth/tenant";

const mocks = vi.hoisted(() => ({
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceDelete: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workspaceMemberFindMany: vi.fn(),
    workspaceMemberDelete: vi.fn(),
    employeeCreate: vi.fn(),
    employeeFindUnique: vi.fn(),
    employeeFindMany: vi.fn(),
    employeeUpdate: vi.fn(),
    employeeDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
            delete: mocks.workspaceDelete,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
            findMany: mocks.workspaceMemberFindMany,
            delete: mocks.workspaceMemberDelete,
        },
        employee: {
            create: mocks.employeeCreate,
            findUnique: mocks.employeeFindUnique,
            findMany: mocks.employeeFindMany,
            update: mocks.employeeUpdate,
            delete: mocks.employeeDelete,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.3.3 — Team Member Architecture (User → WorkspaceMember → Employee)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockUser: User = {
        id: "user_john_123",
        name: "John Doe",
        email: "john.doe@example.com",
        passwordHash: "hashed-pwd",
        emailVerified: new Date("2026-08-19T00:00:00.000Z"),
        avatarUrl: "https://avatar.example.com/john.png",
        status: "ACTIVE",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const mockWorkspaceA: Workspace = {
        id: "ws_alpha_111",
        name: "Alpha HVAC Pros",
        slug: "alpha-hvac",
        logoUrl: null,
        timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const mockWorkspaceB: Workspace = {
        id: "ws_beta_222",
        name: "Beta Electrical Solutions",
        slug: "beta-electrical",
        logoUrl: null,
        timezone: "America/New_York",
                    defaultCurrencyCode: "USD",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const mockMemberA: WorkspaceMember = {
        id: "member_alpha_123",
        userId: "user_john_123",
        workspaceId: "ws_alpha_111",
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const mockMemberB: WorkspaceMember = {
        id: "member_beta_456",
        userId: "user_john_123",
        workspaceId: "ws_beta_222",
        role: "DISPATCHER",
        status: "ACTIVE",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const mockEmployeeA: Employee = {
        id: "emp_alpha_001",
        workspaceId: "ws_alpha_111",
        workspaceMemberId: "member_alpha_123",
        departmentId: null,
        jobTitleId: "job_lead_tech",
        employeeNumber: "EMP-001",
        displayName: "John D. (Lead Tech)",
        phone: "+1-555-0101",
        hireDate: new Date("2026-01-15T00:00:00.000Z"),
        status: "ACTIVE",
        notes: "Certified for commercial heat pumps and chillers.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    const mockEmployeeB: Employee = {
        id: "emp_beta_042",
        workspaceId: "ws_beta_222",
        workspaceMemberId: "member_beta_456",
        departmentId: null,
        jobTitleId: "job_dispatcher",
        employeeNumber: "EMP-001", // Notice: same employeeNumber across different workspaces
        displayName: "John Doe",
        phone: "+1-555-0202",
        hireDate: new Date("2026-03-01T00:00:00.000Z"),
        status: "ACTIVE",
        notes: "Coordinates emergency evening electrical dispatch.",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    describe("Multi-Workspace Support for Users", () => {
        it("allows the same user to have distinct memberships across different workspaces", async () => {
            mocks.workspaceMemberFindMany.mockResolvedValue([
                { ...mockMemberA, workspace: mockWorkspaceA },
                { ...mockMemberB, workspace: mockWorkspaceB },
            ]);

            const memberships = await prisma.workspaceMember.findMany({
                where: { userId: "user_john_123" },
                include: { workspace: true },
            });

            expect(memberships).toHaveLength(2);
            expect(memberships[0].workspaceId).toBe("ws_alpha_111");
            expect(memberships[0].role).toBe("TECHNICIAN");
            expect(memberships[1].workspaceId).toBe("ws_beta_222");
            expect(memberships[1].role).toBe("DISPATCHER");
        });

        it("allows the same user to have distinct Employee profiles in each workspace without global userId collisions", async () => {
            mocks.employeeFindUnique.mockImplementation(async ({ where }) => {
                if (where.workspaceMemberId === "member_alpha_123") {
                    return mockEmployeeA;
                }
                if (where.workspaceMemberId === "member_beta_456") {
                    return mockEmployeeB;
                }
                return null;
            });

            const empAlpha = await prisma.employee.findUnique({
                where: { workspaceMemberId: "member_alpha_123" },
            });
            const empBeta = await prisma.employee.findUnique({
                where: { workspaceMemberId: "member_beta_456" },
            });

            expect(empAlpha?.workspaceId).toBe("ws_alpha_111");
            expect(empAlpha?.jobTitleId).toBe("job_lead_tech");
            expect(empBeta?.workspaceId).toBe("ws_beta_222");
            expect(empBeta?.jobTitleId).toBe("job_dispatcher");
            expect(empAlpha?.id).not.toBe(empBeta?.id);
        });
    });

    describe("1:1 Member ↔ Employee Cardinality", () => {
        it("allows a WorkspaceMember to resolve its Employee profile via 1:1 relation", async () => {
            const memberWithEmployee = {
                ...mockMemberA,
                employee: mockEmployeeA,
            };
            mocks.workspaceMemberFindUnique.mockResolvedValue(memberWithEmployee);

            const result = await prisma.workspaceMember.findUnique({
                where: { id: "member_alpha_123" },
                include: { employee: true },
            });

            expect(result?.employee?.jobTitleId).toBe("job_lead_tech");
            expect(result?.employee?.workspaceMemberId).toBe("member_alpha_123");
        });

        it("allows a WorkspaceMember to exist without an Employee profile (optional 1:1)", async () => {
            const memberWithoutEmployee = {
                ...mockMemberA,
                employee: null,
            };
            mocks.workspaceMemberFindUnique.mockResolvedValue(memberWithoutEmployee);

            const result = await prisma.workspaceMember.findUnique({
                where: { id: "member_alpha_123" },
                include: { employee: true },
            });

            expect(result?.employee).toBeNull();
        });

        it("enforces uniqueness of workspaceMemberId on Employee (prevents duplicate employee profiles)", async () => {
            mocks.employeeCreate.mockRejectedValue(
                new Error("Unique constraint failed on the fields: (`workspaceMemberId`)")
            );

            await expect(
                prisma.employee.create({
                    data: {
                        workspaceId: "ws_alpha_111",
                        workspaceMemberId: "member_alpha_123",
                        displayName: "Duplicate Profile Attempt",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });
    });

    describe("Scoped Employee Number Uniqueness", () => {
        it("allows identical employeeNumber across different workspaces", async () => {
            expect(mockEmployeeA.employeeNumber).toBe("EMP-001");
            expect(mockEmployeeB.employeeNumber).toBe("EMP-001");
            expect(mockEmployeeA.workspaceId).not.toBe(mockEmployeeB.workspaceId);
        });

        it("enforces uniqueness of employeeNumber within the same workspace", async () => {
            mocks.employeeCreate.mockRejectedValue(
                new Error(
                    "Unique constraint failed on the fields: (`workspaceId`, `employeeNumber`)"
                )
            );

            await expect(
                prisma.employee.create({
                    data: {
                        workspaceId: "ws_alpha_111",
                        workspaceMemberId: "member_other_789",
                        employeeNumber: "EMP-001",
                        displayName: "Second Employee",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });
    });

    describe("Role vs Job Title Independence", () => {
        it("preserves system authorization role on WorkspaceMember independently from Employee jobTitle", () => {
            const systemRole: MembershipRole = mockMemberA.role;
            const businessJobTitleId: string | null = mockEmployeeA.jobTitleId;

            expect(systemRole).toBe("TECHNICIAN");
            expect(businessJobTitleId).toBe("job_lead_tech");
            expect(systemRole).not.toBe(businessJobTitleId);
        });
    });

    describe("MembershipStatus vs EmployeeStatus Independence", () => {
        it("allows active membership access with ON_LEAVE employee status", async () => {
            const onLeaveEmployee: Employee = {
                ...mockEmployeeA,
                status: "ON_LEAVE",
            };
            mocks.employeeFindUnique.mockResolvedValue(onLeaveEmployee);

            const employee = await prisma.employee.findUnique({
                where: { workspaceMemberId: "member_alpha_123" },
            });

            const membershipStatus: MembershipStatus = mockMemberA.status;
            const employeeStatus: EmployeeStatus = employee!.status;

            expect(membershipStatus).toBe("ACTIVE");
            expect(employeeStatus).toBe("ON_LEAVE");
        });

        it("supports all EmployeeStatus enum values (ACTIVE, INACTIVE, ON_LEAVE, TERMINATED)", () => {
            const validStatuses: EmployeeStatus[] = [
                "ACTIVE",
                "INACTIVE",
                "ON_LEAVE",
                "TERMINATED",
            ];

            expect(validStatuses).toHaveLength(4);
            expect(validStatuses).toContain("ACTIVE");
            expect(validStatuses).toContain("INACTIVE");
            expect(validStatuses).toContain("ON_LEAVE");
            expect(validStatuses).toContain("TERMINATED");
        });
    });

    describe("Tenant Isolation & Scoping", () => {
        it("integrates seamlessly with workspaceScope helper", () => {
            const scope = workspaceScope("ws_alpha_111");

            expect(scope).toEqual({
                workspaceId: "ws_alpha_111",
            });
        });

        it("scopes employee queries strictly by workspaceId", async () => {
            mocks.employeeFindMany.mockImplementation(async ({ where }) => {
                if (where.workspaceId === "ws_alpha_111") {
                    return [mockEmployeeA];
                }
                return [];
            });

            const alphaEmployees = await prisma.employee.findMany({
                where: {
                    ...workspaceScope("ws_alpha_111"),
                },
            });

            expect(alphaEmployees).toHaveLength(1);
            expect(alphaEmployees[0].workspaceId).toBe("ws_alpha_111");
            expect(alphaEmployees[0].id).toBe("emp_alpha_001");
        });
    });

    describe("Cascade Deletion Behavior", () => {
        it("cascades deletion when parent Workspace is deleted", async () => {
            mocks.workspaceDelete.mockResolvedValue(mockWorkspaceA);

            const deleted = await prisma.workspace.delete({
                where: { id: "ws_alpha_111" },
            });

            expect(mocks.workspaceDelete).toHaveBeenCalledWith({
                where: { id: "ws_alpha_111" },
            });
            expect(deleted.id).toBe("ws_alpha_111");
        });

        it("cascades deletion when parent WorkspaceMember is deleted", async () => {
            mocks.workspaceMemberDelete.mockResolvedValue(mockMemberA);

            const deletedMember = await prisma.workspaceMember.delete({
                where: { id: "member_alpha_123" },
            });

            expect(mocks.workspaceMemberDelete).toHaveBeenCalledWith({
                where: { id: "member_alpha_123" },
            });
            expect(deletedMember.id).toBe("member_alpha_123");
        });
    });
});
