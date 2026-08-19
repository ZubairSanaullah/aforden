import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    organizationFindUnique: vi.fn(),
    organizationUpdate: vi.fn(),
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
        organization: {
            findUnique: mocks.organizationFindUnique,
            update: mocks.organizationUpdate,
        },
    },
}));

import { getOrganization } from "@/lib/services/organization/getOrganization";
import { updateOrganization } from "@/lib/services/organization/updateOrganization";
import { OrganizationNotFoundError } from "@/lib/services/organization/organizationErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Organization } from "@/generated/prisma/client";

describe("Phase 1.3.2 — Organization Profile Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Helper functions for standard test setup
    function setupAuthSession(userId = "user_123") {
        mocks.auth.mockResolvedValue({
            user: { id: userId },
        });
        mocks.userFindUnique.mockResolvedValue({
            id: userId,
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });
    }

    function setupWorkspace(workspaceId = "ws_123") {
        mocks.workspaceFindUnique.mockResolvedValue({
            id: workspaceId,
            name: "Acme Corp",
            slug: "acme-corp",
            logoUrl: null,
            timezone: "Asia/Karachi",
        });
    }

    function setupMembership(
        userId = "user_123",
        workspaceId = "ws_123",
        role = "OWNER",
        status = "ACTIVE",
    ) {
        mocks.workspaceMemberFindUnique.mockResolvedValue({
            id: "mem_123",
            userId,
            workspaceId,
            role,
            status,
        });
    }

    const sampleOrganization: Organization = {
        id: "org_123",
        workspaceId: "ws_123",
        businessName: "Acme Services",
        legalName: "Acme Services LLC",
        logoUrl: "https://example.com/logo.png",
        email: "contact@acme.com",
        phone: "+1-555-0100",
        website: "https://acme.com",
        description: "Professional HVAC and plumbing solutions.",
        addressLine1: "100 Main St",
        addressLine2: "Suite 200",
        city: "Austin",
        state: "TX",
        country: "US",
        postalCode: "78701",
        taxId: "12-3456789",
        registrationNumber: "REG-12345",
        status: "ACTIVE",
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    };

    describe("getOrganization()", () => {
        it("allows an authenticated, authorized workspace user to retrieve the organization", async () => {
            setupAuthSession("user_123");
            setupWorkspace("ws_123");
            setupMembership("user_123", "ws_123", "TECHNICIAN");

            mocks.organizationFindUnique.mockResolvedValue(sampleOrganization);

            const result = await getOrganization("ws_123");

            expect(mocks.organizationFindUnique).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_123",
                },
            });
            expect(result).toEqual(sampleOrganization);
        });

        it("returns null when no organization profile exists for the workspace", async () => {
            setupAuthSession("user_123");
            setupWorkspace("ws_123");
            setupMembership("user_123", "ws_123", "OWNER");

            mocks.organizationFindUnique.mockResolvedValue(null);

            const result = await getOrganization("ws_123");

            expect(result).toBeNull();
        });

        it("rejects unauthenticated access", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(getOrganization("ws_123")).rejects.toBeInstanceOf(
                UnauthorizedError,
            );
            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
        });

        it("rejects unauthorized workspace access when user is not a member", async () => {
            setupAuthSession("user_123");
            setupWorkspace("ws_unauthorized");
            mocks.workspaceMemberFindUnique.mockResolvedValue(null);

            await expect(
                getOrganization("ws_unauthorized"),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
        });

        it("rejects access if user account is suspended or inactive", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: "user_suspended" },
            });
            mocks.userFindUnique.mockResolvedValue({
                id: "user_suspended",
                name: "Suspended User",
                email: "suspended@example.com",
                status: "SUSPENDED",
                emailVerified: new Date(),
            });

            await expect(getOrganization("ws_123")).rejects.toBeInstanceOf(
                WorkspaceAccessDeniedError,
            );
            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
        });

        it("rejects access if workspace does not exist", async () => {
            setupAuthSession("user_123");
            mocks.workspaceFindUnique.mockResolvedValue(null);

            await expect(getOrganization("ws_nonexistent")).rejects.toBeInstanceOf(
                WorkspaceNotFoundError,
            );
            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
        });

        it("enforces tenant isolation — Workspace A member cannot read Workspace B organization", async () => {
            setupAuthSession("user_a");
            setupWorkspace("ws_b");
            // User A only has membership in ws_a, not ws_b
            mocks.workspaceMemberFindUnique.mockResolvedValue(null);

            await expect(getOrganization("ws_b")).rejects.toBeInstanceOf(
                WorkspaceAccessDeniedError,
            );
            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
        });
    });

    describe("updateOrganization()", () => {
        it("allows OWNER to update the business name", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            mocks.organizationFindUnique.mockResolvedValue(sampleOrganization);
            const updatedOrg = {
                ...sampleOrganization,
                businessName: "Acme Global Solutions",
            };
            mocks.organizationUpdate.mockResolvedValue(updatedOrg);

            const result = await updateOrganization("ws_123", {
                businessName: "Acme Global Solutions",
            });

            expect(mocks.organizationUpdate).toHaveBeenCalledWith({
                where: { workspaceId: "ws_123" },
                data: { businessName: "Acme Global Solutions" },
            });
            expect(result.businessName).toBe("Acme Global Solutions");
        });

        it("allows ADMIN to update multiple business profile fields", async () => {
            setupAuthSession("user_admin");
            setupWorkspace("ws_123");
            setupMembership("user_admin", "ws_123", "ADMIN");

            mocks.organizationFindUnique.mockResolvedValue(sampleOrganization);
            const updatedOrg = {
                ...sampleOrganization,
                businessName: "Acme Pro HVAC",
                legalName: "Acme Pro Enterprises Inc",
                email: "info@acmepro.com",
                phone: "+1-555-9999",
                website: "https://acmepro.com",
                description: "Commercial HVAC services nationwide.",
                city: "Dallas",
                state: "TX",
                postalCode: "75001",
                taxId: "99-8887776",
                registrationNumber: "REG-55555",
                status: "ACTIVE" as const,
            };
            mocks.organizationUpdate.mockResolvedValue(updatedOrg);

            const result = await updateOrganization("ws_123", {
                businessName: "Acme Pro HVAC",
                legalName: "Acme Pro Enterprises Inc",
                email: "info@acmepro.com",
                phone: "+1-555-9999",
                website: "https://acmepro.com",
                description: "Commercial HVAC services nationwide.",
                city: "Dallas",
                state: "TX",
                postalCode: "75001",
                taxId: "99-8887776",
                registrationNumber: "REG-55555",
                status: "ACTIVE",
            });

            expect(mocks.organizationUpdate).toHaveBeenCalledWith({
                where: { workspaceId: "ws_123" },
                data: {
                    businessName: "Acme Pro HVAC",
                    legalName: "Acme Pro Enterprises Inc",
                    email: "info@acmepro.com",
                    phone: "+1-555-9999",
                    website: "https://acmepro.com",
                    description: "Commercial HVAC services nationwide.",
                    city: "Dallas",
                    state: "TX",
                    postalCode: "75001",
                    taxId: "99-8887776",
                    registrationNumber: "REG-55555",
                    status: "ACTIVE",
                },
            });
            expect(result.businessName).toBe("Acme Pro HVAC");
            expect(result.email).toBe("info@acmepro.com");
        });

        it("clears optional fields when explicitly set to null", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            mocks.organizationFindUnique.mockResolvedValue(sampleOrganization);
            const updatedOrg = {
                ...sampleOrganization,
                legalName: null,
                phone: null,
                website: null,
                description: null,
            };
            mocks.organizationUpdate.mockResolvedValue(updatedOrg);

            const result = await updateOrganization("ws_123", {
                legalName: null,
                phone: null,
                website: null,
                description: null,
            });

            expect(mocks.organizationUpdate).toHaveBeenCalledWith({
                where: { workspaceId: "ws_123" },
                data: {
                    legalName: null,
                    phone: null,
                    website: null,
                    description: null,
                },
            });
            expect(result.legalName).toBeNull();
            expect(result.phone).toBeNull();
            expect(result.website).toBeNull();
            expect(result.description).toBeNull();
        });

        it("preserves omitted fields without overwriting them", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            mocks.organizationFindUnique.mockResolvedValue(sampleOrganization);
            mocks.organizationUpdate.mockResolvedValue({
                ...sampleOrganization,
                businessName: "Renamed Business",
            });

            await updateOrganization("ws_123", {
                businessName: "Renamed Business",
            });

            const updateCallData = mocks.organizationUpdate.mock.calls[0][0].data;
            expect(updateCallData).toEqual({
                businessName: "Renamed Business",
            });
            expect(updateCallData.phone).toBeUndefined();
            expect(updateCallData.email).toBeUndefined();
            expect(updateCallData.website).toBeUndefined();
        });

        it("rejects an invalid/empty business name", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            await expect(
                updateOrganization("ws_123", {
                    businessName: "   ",
                }),
            ).rejects.toThrow();

            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects an invalid email format", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            await expect(
                updateOrganization("ws_123", {
                    email: "not-a-valid-email",
                }),
            ).rejects.toThrow();

            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects an invalid logo URL format", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            await expect(
                updateOrganization("ws_123", {
                    logoUrl: "htp:/invalid-url",
                }),
            ).rejects.toThrow();

            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects an invalid website URL format", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            await expect(
                updateOrganization("ws_123", {
                    website: "javascript:alert(1)",
                }),
            ).rejects.toThrow();

            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects an invalid organization status", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            await expect(
                updateOrganization("ws_123", {
                    status: "ARCHIVED",
                }),
            ).rejects.toThrow();

            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("throws OrganizationNotFoundError when updating a nonexistent organization", async () => {
            setupAuthSession("user_owner");
            setupWorkspace("ws_123");
            setupMembership("user_owner", "ws_123", "OWNER");

            mocks.organizationFindUnique.mockResolvedValue(null);

            await expect(
                updateOrganization("ws_123", {
                    businessName: "New Name",
                }),
            ).rejects.toBeInstanceOf(OrganizationNotFoundError);

            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles lacking SETTINGS_UPDATE permission (e.g. MANAGER)", async () => {
            setupAuthSession("user_mgr");
            setupWorkspace("ws_123");
            setupMembership("user_mgr", "ws_123", "MANAGER");

            await expect(
                updateOrganization("ws_123", {
                    businessName: "Manager Update",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles lacking SETTINGS_UPDATE permission (e.g. TECHNICIAN)", async () => {
            setupAuthSession("user_tech");
            setupWorkspace("ws_123");
            setupMembership("user_tech", "ws_123", "TECHNICIAN");

            await expect(
                updateOrganization("ws_123", {
                    businessName: "Tech Update",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles lacking SETTINGS_UPDATE permission (e.g. DISPATCHER)", async () => {
            setupAuthSession("user_disp");
            setupWorkspace("ws_123");
            setupMembership("user_disp", "ws_123", "DISPATCHER");

            await expect(
                updateOrganization("ws_123", {
                    businessName: "Dispatcher Update",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("rejects unauthorized roles lacking SETTINGS_UPDATE permission (e.g. ACCOUNTANT)", async () => {
            setupAuthSession("user_acct");
            setupWorkspace("ws_123");
            setupMembership("user_acct", "ws_123", "ACCOUNTANT");

            await expect(
                updateOrganization("ws_123", {
                    businessName: "Accountant Update",
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);

            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });

        it("enforces tenant isolation during updates — cross workspace updates rejected", async () => {
            setupAuthSession("user_a");
            setupWorkspace("ws_b");
            mocks.workspaceMemberFindUnique.mockResolvedValue(null);

            await expect(
                updateOrganization("ws_b", {
                    businessName: "Cross-Tenant Attack",
                }),
            ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

            expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
            expect(mocks.organizationUpdate).not.toHaveBeenCalled();
        });
    });
});
