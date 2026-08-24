import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const {
    authMock,
    userFindUniqueMock,
    workspaceFindUniqueMock,
    membershipFindUniqueMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    workspaceFindUniqueMock: vi.fn(),
    membershipFindUniqueMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: userFindUniqueMock,
        },
        workspace: {
            findUnique: workspaceFindUniqueMock,
        },
        workspaceMember: {
            findUnique: membershipFindUniqueMock,
        },
    },
}));

import {
    requireWorkspaceAuthorization,
} from "@/lib/services/authorization/workspaceAuthorization";

import {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
} from "@/lib/services/authorization/requirePermission";

import {
    PERMISSIONS,
} from "@/lib/services/authorization/permissions";

import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";

describe("Aforden workspace authorization integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function mockAuthenticatedUser() {
        authMock.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });
    }

    function mockActiveUser() {
        userFindUniqueMock.mockResolvedValue({
            id: "user-1",
            name: "Test User",
            email: "user@example.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });
    }

    function mockWorkspace() {
        workspaceFindUniqueMock.mockResolvedValue({
            id: "workspace-1",
            name: "Test Workspace",
            slug: "test-workspace",
            logoUrl: null,
            timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
        });
    }

    function mockActiveMembership(
        role = "OWNER",
    ) {
        membershipFindUniqueMock.mockResolvedValue({
            id: "membership-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            role,
            status: "ACTIVE",
        });
    }

    it("rejects an unauthenticated request", async () => {
        authMock.mockResolvedValue(null);

        await expect(
            requireWorkspaceAuthorization(
                "workspace-1",
            ),
        ).rejects.toBeInstanceOf(
            UnauthorizedError,
        );

        expect(
            userFindUniqueMock,
        ).not.toHaveBeenCalled();
    });

    it("rejects a session without a user ID", async () => {
        authMock.mockResolvedValue({
            user: {},
        });

        await expect(
            requireWorkspaceAuthorization(
                "workspace-1",
            ),
        ).rejects.toBeInstanceOf(
            UnauthorizedError,
        );

        expect(
            userFindUniqueMock,
        ).not.toHaveBeenCalled();
    });

    it("rejects a user that does not exist", async () => {
        mockAuthenticatedUser();

        userFindUniqueMock.mockResolvedValue(
            null,
        );

        await expect(
            requireWorkspaceAuthorization(
                "workspace-1",
            ),
        ).rejects.toBeInstanceOf(
            UnauthorizedError,
        );

        expect(
            workspaceFindUniqueMock,
        ).not.toHaveBeenCalled();
    });

    it("rejects an inactive user", async () => {
        mockAuthenticatedUser();

        userFindUniqueMock.mockResolvedValue({
            id: "user-1",
            name: "Inactive User",
            email: "inactive@example.com",
            status: "SUSPENDED",
            emailVerified: new Date(),
        });

        await expect(
            requireWorkspaceAuthorization(
                "workspace-1",
            ),
        ).rejects.toBeInstanceOf(
            WorkspaceAccessDeniedError,
        );

        expect(
            workspaceFindUniqueMock,
        ).not.toHaveBeenCalled();
    });

    it("rejects a workspace that does not exist", async () => {
        mockAuthenticatedUser();
        mockActiveUser();

        workspaceFindUniqueMock.mockResolvedValue(
            null,
        );

        await expect(
            requireWorkspaceAuthorization(
                "workspace-1",
            ),
        ).rejects.toBeInstanceOf(
            WorkspaceNotFoundError,
        );

        expect(
            membershipFindUniqueMock,
        ).not.toHaveBeenCalled();
    });

    it("rejects a user without workspace membership", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();

        membershipFindUniqueMock.mockResolvedValue(
            null,
        );

        await expect(
            requireWorkspaceAuthorization(
                "workspace-1",
            ),
        ).rejects.toBeInstanceOf(
            WorkspaceAccessDeniedError,
        );
    });

    it("rejects inactive workspace membership", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();

        mockActiveMembership();

        membershipFindUniqueMock.mockResolvedValue({
            id: "membership-1",
            userId: "user-1",
            workspaceId: "workspace-1",
            role: "OWNER",
            status: "REMOVED",
        });

        await expect(
            requireWorkspaceAuthorization(
                "workspace-1",
            ),
        ).rejects.toBeInstanceOf(
            WorkspaceAccessDeniedError,
        );
    });

    it("returns the complete authorization context for an active member", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership("OWNER");

        const result =
            await requireWorkspaceAuthorization(
                "workspace-1",
            );

        expect(result).toEqual({
            user: {
                id: "user-1",
                name: "Test User",
                email: "user@example.com",
                status: "ACTIVE",
                emailVerified:
                    expect.any(Date),
            },
            workspace: {
                id: "workspace-1",
                name: "Test Workspace",
                slug: "test-workspace",
                logoUrl: null,
                timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
            },
            membership: {
                id: "membership-1",
                userId: "user-1",
                workspaceId: "workspace-1",
                role: "OWNER",
                status: "ACTIVE",
            },
        });
    });

    it("uses the authenticated session user ID for authorization", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership();

        await requireWorkspaceAuthorization(
            "workspace-1",
        );

        expect(
            userFindUniqueMock,
        ).toHaveBeenCalledWith({
            where: {
                id: "user-1",
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
                emailVerified: true,
            },
        });
    });

    it("does not authorize a different workspace without membership", async () => {
        mockAuthenticatedUser();
        mockActiveUser();

        workspaceFindUniqueMock.mockResolvedValue({
            id: "workspace-2",
            name: "Other Workspace",
            slug: "other-workspace",
            logoUrl: null,
            timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
        });

        membershipFindUniqueMock.mockResolvedValue(
            null,
        );

        await expect(
            requireWorkspaceAuthorization(
                "workspace-2",
            ),
        ).rejects.toBeInstanceOf(
            WorkspaceAccessDeniedError,
        );
    });

    it("enforces a required permission after workspace authorization", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership("OWNER");

        const result =
            await requirePermission(
                "workspace-1",
                PERMISSIONS.CUSTOMERS_VIEW,
            );

        expect(
            result.membership.role,
        ).toBe("OWNER");
    });

    it("rejects a required permission when the role lacks it", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership("TECHNICIAN");

        await expect(
            requirePermission(
                "workspace-1",
                PERMISSIONS.CUSTOMERS_DELETE,
            ),
        ).rejects.toBeInstanceOf(
            ForbiddenError,
        );
    });

    it("allows access when any supplied permission is available", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership("OWNER");

        const result =
            await requireAnyPermission(
                "workspace-1",
                [
                    PERMISSIONS.CUSTOMERS_DELETE,
                    PERMISSIONS.CUSTOMERS_VIEW,
                ],
            );

        expect(
            result.membership.role,
        ).toBe("OWNER");
    });

    it("rejects when none of the supplied permissions are available", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership("TECHNICIAN");

        await expect(
            requireAnyPermission(
                "workspace-1",
                [
                    PERMISSIONS.CUSTOMERS_DELETE,
                    PERMISSIONS.BILLING_MANAGE,
                ],
            ),
        ).rejects.toBeInstanceOf(
            ForbiddenError,
        );
    });

    it("allows access when all supplied permissions are available", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership("OWNER");

        const result =
            await requireAllPermissions(
                "workspace-1",
                [
                    PERMISSIONS.CUSTOMERS_VIEW,
                    PERMISSIONS.WORK_ORDERS_VIEW,
                ],
            );

        expect(
            result.membership.role,
        ).toBe("OWNER");
    });

    it("rejects when one of the required permissions is missing", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership("TECHNICIAN");

        await expect(
            requireAllPermissions(
                "workspace-1",
                [
                    PERMISSIONS.CUSTOMERS_VIEW,
                    PERMISSIONS.CUSTOMERS_DELETE,
                ],
            ),
        ).rejects.toBeInstanceOf(
            ForbiddenError,
        );
    });

    it("never trusts a client-provided user ID", async () => {
        mockAuthenticatedUser();
        mockActiveUser();
        mockWorkspace();
        mockActiveMembership();

        const clientUserId = "attacker-user";

        await requireWorkspaceAuthorization(
            "workspace-1",
        );

        expect(
            userFindUniqueMock,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: "user-1",
                },
            }),
        );

        expect(
            userFindUniqueMock,
        ).not.toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: clientUserId,
                },
            }),
        );
    });
});