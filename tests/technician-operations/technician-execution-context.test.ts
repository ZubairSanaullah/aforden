import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveTechnicianContext } from "@/lib/services/technicianOperations/resolveTechnicianContext";
import { TechnicianProfileNotFoundError } from "@/lib/services/technicianOperations/technicianOperationsErrors";
import {
    UnauthorizedError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    employeeFindFirst: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
        },
        employee: {
            findFirst: mocks.employeeFindFirst,
        },
    },
}));

describe("Phase 1.9.3 — Technician Execution Context Resolution (resolveTechnicianContext)", () => {
    const WS_ID_A = "ws_tenant_alpha";
    const WS_ID_B = "ws_tenant_beta";
    const USER_ID = "usr_tech_001";
    const MEMBER_ID_A = "mem_alpha_001";
    const EMPLOYEE_ID = "emp_001";
    const TECH_PROFILE_ID = "tech_prof_001";

    beforeEach(() => {
        vi.clearAllMocks();

        // Default valid session
        mocks.auth.mockResolvedValue({
            user: { id: USER_ID },
        });

        // Default active user
        mocks.userFindUnique.mockResolvedValue({
            id: USER_ID,
            name: "John Doe",
            email: "john.doe@example.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        // Default active workspace
        mocks.workspaceFindUnique.mockResolvedValue({
            id: WS_ID_A,
            name: "Alpha Corp",
            slug: "alpha-corp",
            logoUrl: null,
            timezone: "America/New_York",
        });

        // Default active membership in Workspace A
        mocks.workspaceMemberFindUnique.mockResolvedValue({
            id: MEMBER_ID_A,
            userId: USER_ID,
            workspaceId: WS_ID_A,
            role: "TECHNICIAN",
            status: "ACTIVE",
        });

        // Default active employee with linked technician profile
        mocks.employeeFindFirst.mockResolvedValue({
            id: EMPLOYEE_ID,
            workspaceId: WS_ID_A,
            workspaceMemberId: MEMBER_ID_A,
            displayName: "Johnny D (Lead Tech)",
            status: "ACTIVE",
            technicianProfile: {
                id: TECH_PROFILE_ID,
                employeeId: EMPLOYEE_ID,
                licenseNumber: "LIC-9988",
            },
        });
    });

    describe("1. Valid Context Resolution", () => {
        it("successfully resolves TechnicianExecutionContext with employee displayName", async () => {
            const context = await resolveTechnicianContext(WS_ID_A);

            expect(context).toEqual({
                userId: USER_ID,
                workspaceId: WS_ID_A,
                membershipId: MEMBER_ID_A,
                role: "TECHNICIAN",
                employeeId: EMPLOYEE_ID,
                technicianProfileId: TECH_PROFILE_ID,
                technicianName: "Johnny D (Lead Tech)",
            });

            expect(mocks.employeeFindFirst).toHaveBeenCalledWith({
                where: {
                    workspaceMemberId: MEMBER_ID_A,
                    workspaceId: WS_ID_A,
                },
                include: {
                    technicianProfile: true,
                },
            });
        });

        it("falls back to user.name when employee displayName is null", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: EMPLOYEE_ID,
                workspaceId: WS_ID_A,
                workspaceMemberId: MEMBER_ID_A,
                displayName: null,
                status: "ACTIVE",
                technicianProfile: {
                    id: TECH_PROFILE_ID,
                    employeeId: EMPLOYEE_ID,
                },
            });

            const context = await resolveTechnicianContext(WS_ID_A);
            expect(context.technicianName).toBe("John Doe");
        });

        it("falls back to 'Technician' when both employee displayName and user.name are absent", async () => {
            mocks.userFindUnique.mockResolvedValue({
                id: USER_ID,
                name: null,
                email: "tech@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            });

            mocks.employeeFindFirst.mockResolvedValue({
                id: EMPLOYEE_ID,
                workspaceId: WS_ID_A,
                workspaceMemberId: MEMBER_ID_A,
                displayName: "   ",
                status: "ACTIVE",
                technicianProfile: {
                    id: TECH_PROFILE_ID,
                    employeeId: EMPLOYEE_ID,
                },
            });

            const context = await resolveTechnicianContext(WS_ID_A);
            expect(context.technicianName).toBe("Technician");
        });
    });

    describe("2. Missing or Inactive Employee Profile", () => {
        it("throws TechnicianProfileNotFoundError when Employee record does not exist", async () => {
            mocks.employeeFindFirst.mockResolvedValue(null);

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                TechnicianProfileNotFoundError
            );
        });

        it("throws TechnicianProfileNotFoundError when Employee status is INACTIVE", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: EMPLOYEE_ID,
                workspaceId: WS_ID_A,
                workspaceMemberId: MEMBER_ID_A,
                displayName: "Johnny D",
                status: "INACTIVE",
                technicianProfile: {
                    id: TECH_PROFILE_ID,
                    employeeId: EMPLOYEE_ID,
                },
            });

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                TechnicianProfileNotFoundError
            );
        });

        it("throws TechnicianProfileNotFoundError when Employee status is TERMINATED", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: EMPLOYEE_ID,
                workspaceId: WS_ID_A,
                workspaceMemberId: MEMBER_ID_A,
                displayName: "Johnny D",
                status: "TERMINATED",
                technicianProfile: {
                    id: TECH_PROFILE_ID,
                    employeeId: EMPLOYEE_ID,
                },
            });

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                TechnicianProfileNotFoundError
            );
        });

        it("throws TechnicianProfileNotFoundError when Employee status is ON_LEAVE", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: EMPLOYEE_ID,
                workspaceId: WS_ID_A,
                workspaceMemberId: MEMBER_ID_A,
                displayName: "Johnny D",
                status: "ON_LEAVE",
                technicianProfile: {
                    id: TECH_PROFILE_ID,
                    employeeId: EMPLOYEE_ID,
                },
            });

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                TechnicianProfileNotFoundError
            );
        });

        it("throws TechnicianProfileNotFoundError when active Employee has no linked TechnicianProfile", async () => {
            mocks.employeeFindFirst.mockResolvedValue({
                id: EMPLOYEE_ID,
                workspaceId: WS_ID_A,
                workspaceMemberId: MEMBER_ID_A,
                displayName: "Johnny D",
                status: "ACTIVE",
                technicianProfile: null,
            });

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                TechnicianProfileNotFoundError
            );
        });
    });

    describe("3. Tenant & Session Isolation (Invariant 2 & 3)", () => {
        it("denies access when caller attempts to resolve context against Workspace B without membership", async () => {
            // Workspace B exists
            mocks.workspaceFindUnique.mockResolvedValue({
                id: WS_ID_B,
                name: "Beta Corp",
                slug: "beta-corp",
                logoUrl: null,
                timezone: "America/New_York",
            });

            // No membership in Workspace B
            mocks.workspaceMemberFindUnique.mockResolvedValue(null);

            await expect(resolveTechnicianContext(WS_ID_B)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("throws UnauthorizedError when session is missing", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("throws WorkspaceNotFoundError when workspace does not exist", async () => {
            mocks.workspaceFindUnique.mockResolvedValue(null);

            await expect(resolveTechnicianContext("non_existent_ws")).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });

        it("throws WorkspaceAccessDeniedError when user account is inactive", async () => {
            mocks.userFindUnique.mockResolvedValue({
                id: USER_ID,
                name: "John Doe",
                email: "john.doe@example.com",
                status: "SUSPENDED",
                emailVerified: new Date(),
            });

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("throws WorkspaceAccessDeniedError when membership status is INVITED", async () => {
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                id: MEMBER_ID_A,
                userId: USER_ID,
                workspaceId: WS_ID_A,
                role: "TECHNICIAN",
                status: "INVITED",
            });

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("throws WorkspaceAccessDeniedError when membership status is DEACTIVATED", async () => {
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                id: MEMBER_ID_A,
                userId: USER_ID,
                workspaceId: WS_ID_A,
                role: "TECHNICIAN",
                status: "DEACTIVATED",
            });

            await expect(resolveTechnicianContext(WS_ID_A)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("strictly enforces tenant scoping in the employee query", async () => {
            await resolveTechnicianContext(WS_ID_A);

            expect(mocks.employeeFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceMemberId: MEMBER_ID_A,
                        workspaceId: WS_ID_A,
                    },
                })
            );
        });
    });
});
