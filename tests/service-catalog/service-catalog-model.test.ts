import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    type ServiceCatalog,
    type ServiceCatalogStatus,
    type WorkType,
    type Workspace,
} from "../../generated/prisma/client";
import { workspaceScope } from "@/lib/auth/tenant";

const mocks = vi.hoisted(() => ({
    serviceCatalogCreate: vi.fn(),
    serviceCatalogFindUnique: vi.fn(),
    serviceCatalogFindMany: vi.fn(),
    serviceCatalogUpdate: vi.fn(),
    serviceCatalogDelete: vi.fn(),
    workspaceCreate: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        serviceCatalog: {
            create: mocks.serviceCatalogCreate,
            findUnique: mocks.serviceCatalogFindUnique,
            findMany: mocks.serviceCatalogFindMany,
            update: mocks.serviceCatalogUpdate,
            delete: mocks.serviceCatalogDelete,
        },
        workspace: {
            create: mocks.workspaceCreate,
            findUnique: mocks.workspaceFindUnique,
            delete: mocks.workspaceDelete,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.5.2 — ServiceCatalog Prisma Model & Schema Integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("ServiceCatalog model existence & creation", () => {
        it("creates a valid service catalog entity with all operational fields", async () => {
            const mockCatalog: ServiceCatalog = {
                id: "sc_cuid_101",
                workspaceId: "ws_cuid_456",
                name: "Residential HVAC",
                description: "Complete residential heating and air conditioning services.",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date("2026-08-20T10:00:00.000Z"),
                updatedAt: new Date("2026-08-20T10:00:00.000Z"),
            };

            mocks.serviceCatalogCreate.mockResolvedValue(mockCatalog);

            const result = await prisma.serviceCatalog.create({
                data: {
                    workspaceId: "ws_cuid_456",
                    name: "Residential HVAC",
                    description: "Complete residential heating and air conditioning services.",
                    status: "ACTIVE",
                    sortOrder: 1,
                },
            });

            expect(mocks.serviceCatalogCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_cuid_456",
                    name: "Residential HVAC",
                    description: "Complete residential heating and air conditioning services.",
                    status: "ACTIVE",
                    sortOrder: 1,
                }),
            });
            expect(result.id).toBe("sc_cuid_101");
            expect(result.workspaceId).toBe("ws_cuid_456");
            expect(result.name).toBe("Residential HVAC");
            expect(result.status).toBe("ACTIVE");
            expect(result.sortOrder).toBe(1);
        });

        it("creates a service catalog with minimal required fields and defaults", async () => {
            const minimalCatalog: ServiceCatalog = {
                id: "sc_min_001",
                workspaceId: "ws_cuid_456",
                name: "Plumbing",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date("2026-08-20T10:00:00.000Z"),
                updatedAt: new Date("2026-08-20T10:00:00.000Z"),
            };

            mocks.serviceCatalogCreate.mockResolvedValue(minimalCatalog);

            const result = await prisma.serviceCatalog.create({
                data: {
                    workspaceId: "ws_cuid_456",
                    name: "Plumbing",
                },
            });

            expect(mocks.serviceCatalogCreate).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_cuid_456",
                    name: "Plumbing",
                },
            });
            expect(result.id).toBe("sc_min_001");
            expect(result.description).toBeNull();
            expect(result.status).toBe("ACTIVE");
            expect(result.sortOrder).toBe(0);
        });
    });

    describe("ServiceCatalog status lifecycle & defaults", () => {
        it("defaults status to ACTIVE upon creation", async () => {
            const activeCatalog: ServiceCatalog = {
                id: "sc_act_1",
                workspaceId: "ws_1",
                name: "Electrical Services",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.serviceCatalogCreate.mockResolvedValue(activeCatalog);

            const result = await prisma.serviceCatalog.create({
                data: {
                    workspaceId: "ws_1",
                    name: "Electrical Services",
                },
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("supports updating status to INACTIVE for category deactivation", async () => {
            const inactiveStatus: ServiceCatalogStatus = "INACTIVE";
            const deactivatedCatalog: ServiceCatalog = {
                id: "sc_act_1",
                workspaceId: "ws_1",
                name: "Seasonal Services",
                description: null,
                status: inactiveStatus,
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.serviceCatalogUpdate.mockResolvedValue(deactivatedCatalog);

            const result = await prisma.serviceCatalog.update({
                where: { id: "sc_act_1" },
                data: {
                    status: "INACTIVE",
                },
            });

            expect(mocks.serviceCatalogUpdate).toHaveBeenCalledWith({
                where: { id: "sc_act_1" },
                data: {
                    status: "INACTIVE",
                },
            });
            expect(result.status).toBe("INACTIVE");
        });
    });

    describe("Workspace 1:N relationship & tenant scoping", () => {
        it("allows workspace to query its associated serviceCatalogs collection (1:N)", async () => {
            const mockWorkspaceWithCatalogs: Workspace & { serviceCatalogs: ServiceCatalog[] } = {
                id: "ws_cuid_456",
                name: "Acme HVAC & Plumbing",
                slug: "acme-hvac-plumbing",
                logoUrl: null,
                timezone: "Asia/Karachi",
                createdAt: new Date("2026-08-20T00:00:00.000Z"),
                updatedAt: new Date("2026-08-20T00:00:00.000Z"),
                serviceCatalogs: [
                    {
                        id: "sc_1",
                        workspaceId: "ws_cuid_456",
                        name: "HVAC Services",
                        description: null,
                        status: "ACTIVE",
                        sortOrder: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                    {
                        id: "sc_2",
                        workspaceId: "ws_cuid_456",
                        name: "Plumbing Services",
                        description: null,
                        status: "ACTIVE",
                        sortOrder: 2,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
            };

            mocks.workspaceFindUnique.mockResolvedValue(mockWorkspaceWithCatalogs);

            const result = await prisma.workspace.findUnique({
                where: { id: "ws_cuid_456" },
                include: { serviceCatalogs: true },
            });

            expect(mocks.workspaceFindUnique).toHaveBeenCalledWith({
                where: { id: "ws_cuid_456" },
                include: { serviceCatalogs: true },
            });
            expect(result?.serviceCatalogs).toHaveLength(2);
            expect(result?.serviceCatalogs[0]?.name).toBe("HVAC Services");
            expect(result?.serviceCatalogs[1]?.name).toBe("Plumbing Services");
        });

        it("allows serviceCatalog to resolve its parent workspace", async () => {
            const mockCatalogWithWorkspace: ServiceCatalog & { workspace: Workspace } = {
                id: "sc_1",
                workspaceId: "ws_cuid_456",
                name: "HVAC Services",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                workspace: {
                    id: "ws_cuid_456",
                    name: "Acme Services",
                    slug: "acme-services",
                    logoUrl: null,
                    timezone: "Asia/Karachi",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            };

            mocks.serviceCatalogFindUnique.mockResolvedValue(mockCatalogWithWorkspace);

            const result = await prisma.serviceCatalog.findUnique({
                where: { id: "sc_1" },
                include: { workspace: true },
            });

            expect(mocks.serviceCatalogFindUnique).toHaveBeenCalledWith({
                where: { id: "sc_1" },
                include: { workspace: true },
            });
            expect(result?.workspace.id).toBe("ws_cuid_456");
            expect(result?.workspace.slug).toBe("acme-services");
        });

        it("allows serviceCatalog to include its child workTypes (1:N)", async () => {
            const mockCatalogWithWorkTypes: ServiceCatalog & { workTypes: WorkType[] } = {
                id: "sc_1",
                workspaceId: "ws_cuid_456",
                name: "HVAC Services",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                workTypes: [
                    {
                        id: "wt_1",
                        workspaceId: "ws_cuid_456",
                        catalogId: "sc_1",
                        name: "AC Repair",
                        code: "HVAC-AC-01",
                        description: "Diagnostic and repair of AC units.",
                        estimatedDuration: 90,
                        status: "ACTIVE",
                        sortOrder: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
            };

            mocks.serviceCatalogFindUnique.mockResolvedValue(mockCatalogWithWorkTypes);

            const result = await prisma.serviceCatalog.findUnique({
                where: { id: "sc_1" },
                include: { workTypes: true },
            });

            expect(result?.workTypes).toHaveLength(1);
            expect(result?.workTypes[0]?.name).toBe("AC Repair");
            expect(result?.workTypes[0]?.catalogId).toBe("sc_1");
        });

        it("scopes serviceCatalog queries using workspaceScope helper", async () => {
            const scope = workspaceScope("ws_tenant_888");
            expect(scope).toEqual({ workspaceId: "ws_tenant_888" });

            mocks.serviceCatalogFindMany.mockResolvedValue([
                {
                    id: "sc_88",
                    workspaceId: "ws_tenant_888",
                    name: "Tenant Services",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            const result = await prisma.serviceCatalog.findMany({
                where: {
                    ...workspaceScope("ws_tenant_888"),
                    status: "ACTIVE",
                },
            });

            expect(mocks.serviceCatalogFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_tenant_888",
                    status: "ACTIVE",
                },
            });
            expect(result).toHaveLength(1);
            expect(result[0]?.workspaceId).toBe("ws_tenant_888");
        });
    });

    describe("Name uniqueness within workspace constraint", () => {
        it("enforces workspace-scoped name uniqueness via composite unique key @@unique([workspaceId, name])", async () => {
            mocks.serviceCatalogCreate.mockRejectedValue(
                new Error("Unique constraint failed on the fields: (`workspaceId`,`name`)")
            );

            await expect(
                prisma.serviceCatalog.create({
                    data: {
                        workspaceId: "ws_cuid_456",
                        name: "HVAC Services",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });

        it("permits same catalog name in different workspaces", async () => {
            const scWs1: ServiceCatalog = {
                id: "sc_ws1",
                workspaceId: "ws_1",
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const scWs2: ServiceCatalog = {
                id: "sc_ws2",
                workspaceId: "ws_2",
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.serviceCatalogFindUnique.mockImplementation(async ({ where }) => {
                if (where.workspaceId_name) {
                    const { workspaceId, name } = where.workspaceId_name;
                    if (workspaceId === "ws_1" && name === "HVAC") return scWs1;
                    if (workspaceId === "ws_2" && name === "HVAC") return scWs2;
                }
                return null;
            });

            const res1 = await prisma.serviceCatalog.findUnique({
                where: {
                    workspaceId_name: {
                        workspaceId: "ws_1",
                        name: "HVAC",
                    },
                },
            });

            const res2 = await prisma.serviceCatalog.findUnique({
                where: {
                    workspaceId_name: {
                        workspaceId: "ws_2",
                        name: "HVAC",
                    },
                },
            });

            expect(res1?.workspaceId).toBe("ws_1");
            expect(res1?.name).toBe("HVAC");
            expect(res2?.workspaceId).toBe("ws_2");
            expect(res2?.name).toBe("HVAC");
        });
    });

    describe("Cascade deletion behavior", () => {
        it("cascades deletion when parent workspace is deleted", async () => {
            mocks.workspaceDelete.mockResolvedValue({
                id: "ws_cuid_456",
                name: "Acme Services",
                slug: "acme-services",
                logoUrl: null,
                timezone: "Asia/Karachi",
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
