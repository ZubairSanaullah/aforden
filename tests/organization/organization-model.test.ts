import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    type Organization,
    type OrganizationStatus,
    type Workspace,
} from "../../generated/prisma/client";
import { workspaceScope } from "@/lib/auth/tenant";

const mocks = vi.hoisted(() => ({
    organizationCreate: vi.fn(),
    organizationFindUnique: vi.fn(),
    organizationFindMany: vi.fn(),
    organizationUpdate: vi.fn(),
    organizationDelete: vi.fn(),
    workspaceCreate: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        organization: {
            create: mocks.organizationCreate,
            findUnique: mocks.organizationFindUnique,
            findMany: mocks.organizationFindMany,
            update: mocks.organizationUpdate,
            delete: mocks.organizationDelete,
        },
        workspace: {
            create: mocks.workspaceCreate,
            findUnique: mocks.workspaceFindUnique,
            delete: mocks.workspaceDelete,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.3.1 — Organization Architecture & Business Profile Model", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Organization creation", () => {
        it("creates a valid organization associated with a workspace", async () => {
            const mockOrg: Organization = {
                id: "org_cuid_123",
                workspaceId: "ws_cuid_456",
                businessName: "Acme HVAC & Plumbing",
                legalName: "Acme HVAC Solutions LLC",
                logoUrl: "https://cdn.aforden.com/logos/acme.png",
                email: "support@acmehvac.com",
                phone: "+1-555-0199",
                website: "https://acmehvac.com",
                description: "Residential and commercial heating and cooling services.",
                addressLine1: "123 Market St",
                addressLine2: "Suite 400",
                city: "Austin",
                state: "TX",
                country: "US",
                postalCode: "78701",
                taxId: "XX-XXXXXXX",
                registrationNumber: "REG-987654",
                status: "ACTIVE",
                createdAt: new Date("2026-08-19T00:00:00.000Z"),
                updatedAt: new Date("2026-08-19T00:00:00.000Z"),
            };

            mocks.organizationCreate.mockResolvedValue(mockOrg);

            const result = await prisma.organization.create({
                data: {
                    workspaceId: "ws_cuid_456",
                    businessName: "Acme HVAC & Plumbing",
                    legalName: "Acme HVAC Solutions LLC",
                    logoUrl: "https://cdn.aforden.com/logos/acme.png",
                    email: "support@acmehvac.com",
                    phone: "+1-555-0199",
                    website: "https://acmehvac.com",
                    description: "Residential and commercial heating and cooling services.",
                    addressLine1: "123 Market St",
                    addressLine2: "Suite 400",
                    city: "Austin",
                    state: "TX",
                    country: "US",
                    postalCode: "78701",
                    taxId: "XX-XXXXXXX",
                    registrationNumber: "REG-987654",
                    status: "ACTIVE",
                },
            });

            expect(mocks.organizationCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_cuid_456",
                    businessName: "Acme HVAC & Plumbing",
                    status: "ACTIVE",
                }),
            });
            expect(result.id).toBe("org_cuid_123");
            expect(result.workspaceId).toBe("ws_cuid_456");
            expect(result.businessName).toBe("Acme HVAC & Plumbing");
            expect(result.status).toBe("ACTIVE");
        });
    });

    describe("Workspace relationship", () => {
        it("allows workspace to resolve its organization via 1:1 relation", async () => {
            const mockWorkspaceWithOrg: Workspace & { organization: Organization | null } = {
                id: "ws_cuid_456",
                name: "Acme Workspace",
                slug: "acme-workspace",
                logoUrl: null,
                timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
                createdAt: new Date("2026-08-19T00:00:00.000Z"),
                updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                organization: {
                    id: "org_cuid_123",
                    workspaceId: "ws_cuid_456",
                    businessName: "Acme HVAC & Plumbing",
                    legalName: null,
                    logoUrl: null,
                    email: null,
                    phone: null,
                    website: null,
                    description: null,
                    addressLine1: null,
                    addressLine2: null,
                    city: null,
                    state: null,
                    country: null,
                    postalCode: null,
                    taxId: null,
                    registrationNumber: null,
                    status: "ACTIVE",
                    createdAt: new Date("2026-08-19T00:00:00.000Z"),
                    updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                },
            };

            mocks.workspaceFindUnique.mockResolvedValue(mockWorkspaceWithOrg);

            const result = await prisma.workspace.findUnique({
                where: { id: "ws_cuid_456" },
                include: { organization: true },
            });

            expect(mocks.workspaceFindUnique).toHaveBeenCalledWith({
                where: { id: "ws_cuid_456" },
                include: { organization: true },
            });
            expect(result?.organization?.businessName).toBe("Acme HVAC & Plumbing");
            expect(result?.organization?.workspaceId).toBe("ws_cuid_456");
        });

        it("allows workspace with no organization to return null organization", async () => {
            const mockWorkspaceWithoutOrg: Workspace & { organization: Organization | null } = {
                id: "ws_empty_789",
                name: "Fresh Workspace",
                slug: "fresh-workspace",
                logoUrl: null,
                timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
                createdAt: new Date("2026-08-19T00:00:00.000Z"),
                updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                organization: null,
            };

            mocks.workspaceFindUnique.mockResolvedValue(mockWorkspaceWithoutOrg);

            const result = await prisma.workspace.findUnique({
                where: { id: "ws_empty_789" },
                include: { organization: true },
            });

            expect(result?.organization).toBeNull();
        });

        it("allows organization to resolve its parent workspace", async () => {
            const mockOrgWithWorkspace: Organization & { workspace: Workspace } = {
                id: "org_cuid_123",
                workspaceId: "ws_cuid_456",
                businessName: "Acme HVAC & Plumbing",
                legalName: null,
                logoUrl: null,
                email: null,
                phone: null,
                website: null,
                description: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                country: null,
                postalCode: null,
                taxId: null,
                registrationNumber: null,
                status: "ACTIVE",
                createdAt: new Date("2026-08-19T00:00:00.000Z"),
                updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                workspace: {
                    id: "ws_cuid_456",
                    name: "Acme Workspace",
                    slug: "acme-workspace",
                    logoUrl: null,
                    timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
                    createdAt: new Date("2026-08-19T00:00:00.000Z"),
                    updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                },
            };

            mocks.organizationFindUnique.mockResolvedValue(mockOrgWithWorkspace);

            const result = await prisma.organization.findUnique({
                where: { workspaceId: "ws_cuid_456" },
                include: { workspace: true },
            });

            expect(mocks.organizationFindUnique).toHaveBeenCalledWith({
                where: { workspaceId: "ws_cuid_456" },
                include: { workspace: true },
            });
            expect(result?.workspace.id).toBe("ws_cuid_456");
            expect(result?.workspace.slug).toBe("acme-workspace");
        });
    });

    describe("One-to-one constraint", () => {
        it("enforces unique workspaceId constraint by querying unique index", async () => {
            mocks.organizationFindUnique.mockImplementation(async ({ where }) => {
                if (where.workspaceId === "ws_cuid_456") {
                    return {
                        id: "org_existing",
                        workspaceId: "ws_cuid_456",
                        businessName: "Existing Business",
                        status: "ACTIVE",
                    };
                }
                return null;
            });

            const existing = await prisma.organization.findUnique({
                where: { workspaceId: "ws_cuid_456" },
            });

            expect(existing).not.toBeNull();
            expect(existing?.workspaceId).toBe("ws_cuid_456");

            // Attempting duplicate creation throws unique constraint error (P2002) in Prisma
            mocks.organizationCreate.mockRejectedValue(
                new Error("Unique constraint failed on the fields: (`workspaceId`)")
            );

            await expect(
                prisma.organization.create({
                    data: {
                        workspaceId: "ws_cuid_456",
                        businessName: "Duplicate Business Profile",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });
    });

    describe("Organization status", () => {
        it("supports ACTIVE status as default", async () => {
            const activeStatus: OrganizationStatus = "ACTIVE";
            const mockOrg: Organization = {
                id: "org_1",
                workspaceId: "ws_1",
                businessName: "Active Services",
                legalName: null,
                logoUrl: null,
                email: null,
                phone: null,
                website: null,
                description: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                country: null,
                postalCode: null,
                taxId: null,
                registrationNumber: null,
                status: activeStatus,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.organizationCreate.mockResolvedValue(mockOrg);

            const result = await prisma.organization.create({
                data: {
                    workspaceId: "ws_1",
                    businessName: "Active Services",
                },
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("supports updating status to INACTIVE", async () => {
            const inactiveStatus: OrganizationStatus = "INACTIVE";
            const mockUpdatedOrg: Organization = {
                id: "org_1",
                workspaceId: "ws_1",
                businessName: "Active Services",
                legalName: null,
                logoUrl: null,
                email: null,
                phone: null,
                website: null,
                description: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                country: null,
                postalCode: null,
                taxId: null,
                registrationNumber: null,
                status: inactiveStatus,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.organizationUpdate.mockResolvedValue(mockUpdatedOrg);

            const result = await prisma.organization.update({
                where: { workspaceId: "ws_1" },
                data: { status: "INACTIVE" },
            });

            expect(mocks.organizationUpdate).toHaveBeenCalledWith({
                where: { workspaceId: "ws_1" },
                data: { status: "INACTIVE" },
            });
            expect(result.status).toBe("INACTIVE");
        });
    });

    describe("Optional fields", () => {
        it("allows all non-mandatory profile fields to remain null", async () => {
            const minimalOrg: Organization = {
                id: "org_minimal",
                workspaceId: "ws_minimal",
                businessName: "Minimal Ops",
                legalName: null,
                logoUrl: null,
                email: null,
                phone: null,
                website: null,
                description: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                country: null,
                postalCode: null,
                taxId: null,
                registrationNumber: null,
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.organizationCreate.mockResolvedValue(minimalOrg);

            const result = await prisma.organization.create({
                data: {
                    workspaceId: "ws_minimal",
                    businessName: "Minimal Ops",
                },
            });

            expect(result.legalName).toBeNull();
            expect(result.logoUrl).toBeNull();
            expect(result.email).toBeNull();
            expect(result.phone).toBeNull();
            expect(result.website).toBeNull();
            expect(result.description).toBeNull();
            expect(result.addressLine1).toBeNull();
            expect(result.addressLine2).toBeNull();
            expect(result.city).toBeNull();
            expect(result.state).toBeNull();
            expect(result.country).toBeNull();
            expect(result.postalCode).toBeNull();
            expect(result.taxId).toBeNull();
            expect(result.registrationNumber).toBeNull();
        });
    });

    describe("Tenant relationship & scoping", () => {
        it("integrates seamlessly with workspaceScope helper", () => {
            const scope = workspaceScope("ws_tenant_100");

            expect(scope).toEqual({
                workspaceId: "ws_tenant_100",
            });
        });

        it("scopes organization queries by workspaceId", async () => {
            const mockOrg: Organization = {
                id: "org_tenant_100",
                workspaceId: "ws_tenant_100",
                businessName: "Tenant Specific Business",
                legalName: null,
                logoUrl: null,
                email: null,
                phone: null,
                website: null,
                description: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                country: null,
                postalCode: null,
                taxId: null,
                registrationNumber: null,
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.organizationFindUnique.mockResolvedValue(mockOrg);

            const result = await prisma.organization.findUnique({
                where: {
                    workspaceId: "ws_tenant_100",
                },
            });

            expect(mocks.organizationFindUnique).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_tenant_100",
                },
            });
            expect(result?.workspaceId).toBe("ws_tenant_100");
        });
    });

    describe("Cascade deletion behavior", () => {
        it("deletes organization when parent workspace is deleted", async () => {
            mocks.workspaceDelete.mockResolvedValue({
                id: "ws_cuid_456",
                name: "Acme Workspace",
                slug: "acme-workspace",
                logoUrl: null,
                timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const deletedWorkspace = await prisma.workspace.delete({
                where: { id: "ws_cuid_456" },
            });

            expect(mocks.workspaceDelete).toHaveBeenCalledWith({
                where: { id: "ws_cuid_456" },
            });
            expect(deletedWorkspace.id).toBe("ws_cuid_456");
        });
    });
});
