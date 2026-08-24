import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    type WorkType,
    type WorkTypeStatus,
    type ServiceCatalog,
    type Workspace,
} from "../../generated/prisma/client";
import { workspaceScope } from "@/lib/auth/tenant";

const mocks = vi.hoisted(() => ({
    workTypeCreate: vi.fn(),
    workTypeFindUnique: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeUpdate: vi.fn(),
    workTypeDelete: vi.fn(),
    serviceCatalogDelete: vi.fn(),
    workspaceDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        workType: {
            create: mocks.workTypeCreate,
            findUnique: mocks.workTypeFindUnique,
            findMany: mocks.workTypeFindMany,
            update: mocks.workTypeUpdate,
            delete: mocks.workTypeDelete,
        },
        serviceCatalog: {
            delete: mocks.serviceCatalogDelete,
        },
        workspace: {
            delete: mocks.workspaceDelete,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.5.2 — WorkType Prisma Model & Schema Integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("WorkType model existence & creation", () => {
        it("creates a valid work type entity with all operational fields", async () => {
            const mockWorkType: WorkType = {
                id: "wt_cuid_101",
                workspaceId: "ws_cuid_456",
                catalogId: "sc_cuid_789",
                name: "AC Diagnostic & Inspection",
                code: "HVAC-DIAG-01",
                description: "Full system electrical, refrigerant, and airflow diagnostic.",
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date("2026-08-20T10:00:00.000Z"),
                updatedAt: new Date("2026-08-20T10:00:00.000Z"),
            };

            mocks.workTypeCreate.mockResolvedValue(mockWorkType);

            const result = await prisma.workType.create({
                data: {
                    workspaceId: "ws_cuid_456",
                    catalogId: "sc_cuid_789",
                    name: "AC Diagnostic & Inspection",
                    code: "HVAC-DIAG-01",
                    description: "Full system electrical, refrigerant, and airflow diagnostic.",
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 1,
                },
            });

            expect(mocks.workTypeCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_cuid_456",
                    catalogId: "sc_cuid_789",
                    name: "AC Diagnostic & Inspection",
                    code: "HVAC-DIAG-01",
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 1,
                }),
            });
            expect(result.id).toBe("wt_cuid_101");
            expect(result.workspaceId).toBe("ws_cuid_456");
            expect(result.catalogId).toBe("sc_cuid_789");
            expect(result.name).toBe("AC Diagnostic & Inspection");
            expect(result.code).toBe("HVAC-DIAG-01");
            expect(result.estimatedDuration).toBe(60);
            expect(result.status).toBe("ACTIVE");
            expect(result.sortOrder).toBe(1);
        });

        it("creates a work type with minimal required fields and nullables", async () => {
            const minimalWorkType: WorkType = {
                id: "wt_min_001",
                workspaceId: "ws_cuid_456",
                catalogId: "sc_cuid_789",
                name: "Basic Filter Replacement",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date("2026-08-20T10:00:00.000Z"),
                updatedAt: new Date("2026-08-20T10:00:00.000Z"),
            };

            mocks.workTypeCreate.mockResolvedValue(minimalWorkType);

            const result = await prisma.workType.create({
                data: {
                    workspaceId: "ws_cuid_456",
                    catalogId: "sc_cuid_789",
                    name: "Basic Filter Replacement",
                },
            });

            expect(mocks.workTypeCreate).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_cuid_456",
                    catalogId: "sc_cuid_789",
                    name: "Basic Filter Replacement",
                },
            });
            expect(result.id).toBe("wt_min_001");
            expect(result.code).toBeNull();
            expect(result.description).toBeNull();
            expect(result.estimatedDuration).toBeNull();
            expect(result.status).toBe("ACTIVE");
            expect(result.sortOrder).toBe(0);
        });
    });

    describe("WorkType status lifecycle & defaults", () => {
        it("defaults status to ACTIVE upon creation", async () => {
            const activeWorkType: WorkType = {
                id: "wt_act_1",
                workspaceId: "ws_1",
                catalogId: "sc_1",
                name: "Emergency Repair",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.workTypeCreate.mockResolvedValue(activeWorkType);

            const result = await prisma.workType.create({
                data: {
                    workspaceId: "ws_1",
                    catalogId: "sc_1",
                    name: "Emergency Repair",
                },
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("supports updating status to INACTIVE for deactivation", async () => {
            const inactiveStatus: WorkTypeStatus = "INACTIVE";
            const deactivatedWorkType: WorkType = {
                id: "wt_act_1",
                workspaceId: "ws_1",
                catalogId: "sc_1",
                name: "Discontinued Service",
                code: null,
                description: null,
                estimatedDuration: null,
                status: inactiveStatus,
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.workTypeUpdate.mockResolvedValue(deactivatedWorkType);

            const result = await prisma.workType.update({
                where: { id: "wt_act_1" },
                data: {
                    status: "INACTIVE",
                },
            });

            expect(mocks.workTypeUpdate).toHaveBeenCalledWith({
                where: { id: "wt_act_1" },
                data: {
                    status: "INACTIVE",
                },
            });
            expect(result.status).toBe("INACTIVE");
        });
    });

    describe("Relationships & Tenant Scoping", () => {
        it("allows workType to resolve its parent workspace", async () => {
            const mockWorkTypeWithWorkspace: WorkType & { workspace: Workspace } = {
                id: "wt_1",
                workspaceId: "ws_cuid_456",
                catalogId: "sc_1",
                name: "AC Repair",
                code: "HVAC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                workspace: {
                    id: "ws_cuid_456",
                    name: "Acme HVAC",
                    slug: "acme-hvac",
                    logoUrl: null,
                    timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            };

            mocks.workTypeFindUnique.mockResolvedValue(mockWorkTypeWithWorkspace);

            const result = await prisma.workType.findUnique({
                where: { id: "wt_1" },
                include: { workspace: true },
            });

            expect(result?.workspace.id).toBe("ws_cuid_456");
            expect(result?.workspace.slug).toBe("acme-hvac");
        });

        it("allows workType to resolve its parent serviceCatalog", async () => {
            const mockWorkTypeWithCatalog: WorkType & { catalog: ServiceCatalog } = {
                id: "wt_1",
                workspaceId: "ws_cuid_456",
                catalogId: "sc_1",
                name: "AC Repair",
                code: "HVAC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                catalog: {
                    id: "sc_1",
                    workspaceId: "ws_cuid_456",
                    name: "Residential HVAC",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            };

            mocks.workTypeFindUnique.mockResolvedValue(mockWorkTypeWithCatalog);

            const result = await prisma.workType.findUnique({
                where: { id: "wt_1" },
                include: { catalog: true },
            });

            expect(result?.catalog.id).toBe("sc_1");
            expect(result?.catalog.name).toBe("Residential HVAC");
            expect(result?.catalog.status).toBe("ACTIVE");
        });

        it("scopes workType queries using workspaceScope helper", async () => {
            const scope = workspaceScope("ws_tenant_777");
            expect(scope).toEqual({ workspaceId: "ws_tenant_777" });

            mocks.workTypeFindMany.mockResolvedValue([
                {
                    id: "wt_77",
                    workspaceId: "ws_tenant_777",
                    catalogId: "sc_77",
                    name: "Tenant Work Type",
                    code: null,
                    description: null,
                    estimatedDuration: 45,
                    status: "ACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            const result = await prisma.workType.findMany({
                where: {
                    ...workspaceScope("ws_tenant_777"),
                    status: "ACTIVE",
                },
            });

            expect(mocks.workTypeFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_tenant_777",
                    status: "ACTIVE",
                },
            });
            expect(result).toHaveLength(1);
            expect(result[0]?.workspaceId).toBe("ws_tenant_777");
        });
    });

    describe("Name uniqueness within catalog constraint @@unique([catalogId, name])", () => {
        it("enforces catalog-scoped name uniqueness via composite unique key", async () => {
            mocks.workTypeCreate.mockRejectedValue(
                new Error("Unique constraint failed on the fields: (`catalogId`,`name`)")
            );

            await expect(
                prisma.workType.create({
                    data: {
                        workspaceId: "ws_cuid_456",
                        catalogId: "sc_1",
                        name: "AC Repair",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });

        it("permits same work type name in different catalogs", async () => {
            const wtCat1: WorkType = {
                id: "wt_1",
                workspaceId: "ws_1",
                catalogId: "sc_1",
                name: "Diagnostic",
                code: "HVAC-DIAG",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const wtCat2: WorkType = {
                id: "wt_2",
                workspaceId: "ws_1",
                catalogId: "sc_2",
                name: "Diagnostic",
                code: "PLUMB-DIAG",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.workTypeFindUnique.mockImplementation(async ({ where }) => {
                if (where.catalogId_name) {
                    const { catalogId, name } = where.catalogId_name;
                    if (catalogId === "sc_1" && name === "Diagnostic") return wtCat1;
                    if (catalogId === "sc_2" && name === "Diagnostic") return wtCat2;
                }
                return null;
            });

            const res1 = await prisma.workType.findUnique({
                where: {
                    catalogId_name: {
                        catalogId: "sc_1",
                        name: "Diagnostic",
                    },
                },
            });

            const res2 = await prisma.workType.findUnique({
                where: {
                    catalogId_name: {
                        catalogId: "sc_2",
                        name: "Diagnostic",
                    },
                },
            });

            expect(res1?.catalogId).toBe("sc_1");
            expect(res1?.name).toBe("Diagnostic");
            expect(res2?.catalogId).toBe("sc_2");
            expect(res2?.name).toBe("Diagnostic");
        });
    });

    describe("Code uniqueness within workspace constraint @@unique([workspaceId, code])", () => {
        it("enforces workspace-scoped code uniqueness via composite unique key", async () => {
            mocks.workTypeCreate.mockRejectedValue(
                new Error("Unique constraint failed on the fields: (`workspaceId`,`code`)")
            );

            await expect(
                prisma.workType.create({
                    data: {
                        workspaceId: "ws_cuid_456",
                        catalogId: "sc_1",
                        name: "AC Maintenance",
                        code: "DUPLICATE-CODE",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });

        it("permits same code in different workspaces", async () => {
            const wtWs1: WorkType = {
                id: "wt_ws1",
                workspaceId: "ws_1",
                catalogId: "sc_1",
                name: "AC Repair",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const wtWs2: WorkType = {
                id: "wt_ws2",
                workspaceId: "ws_2",
                catalogId: "sc_2",
                name: "AC Repair",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.workTypeFindUnique.mockImplementation(async ({ where }) => {
                if (where.workspaceId_code) {
                    const { workspaceId, code } = where.workspaceId_code;
                    if (workspaceId === "ws_1" && code === "AC-01") return wtWs1;
                    if (workspaceId === "ws_2" && code === "AC-01") return wtWs2;
                }
                return null;
            });

            const res1 = await prisma.workType.findUnique({
                where: {
                    workspaceId_code: {
                        workspaceId: "ws_1",
                        code: "AC-01",
                    },
                },
            });

            const res2 = await prisma.workType.findUnique({
                where: {
                    workspaceId_code: {
                        workspaceId: "ws_2",
                        code: "AC-01",
                    },
                },
            });

            expect(res1?.workspaceId).toBe("ws_1");
            expect(res1?.code).toBe("AC-01");
            expect(res2?.workspaceId).toBe("ws_2");
            expect(res2?.code).toBe("AC-01");
        });

        it("allows multiple work types with null code in the same workspace (PostgreSQL nullable unique semantics)", async () => {
            const wtNull1: WorkType = {
                id: "wt_null_1",
                workspaceId: "ws_1",
                catalogId: "sc_1",
                name: "General Service 1",
                code: null,
                description: null,
                estimatedDuration: 30,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const wtNull2: WorkType = {
                id: "wt_null_2",
                workspaceId: "ws_1",
                catalogId: "sc_1",
                name: "General Service 2",
                code: null,
                description: null,
                estimatedDuration: 45,
                status: "ACTIVE",
                sortOrder: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.workTypeFindMany.mockResolvedValue([wtNull1, wtNull2]);

            const results = await prisma.workType.findMany({
                where: {
                    workspaceId: "ws_1",
                    code: null,
                },
            });

            expect(results).toHaveLength(2);
            expect(results[0]?.code).toBeNull();
            expect(results[1]?.code).toBeNull();
            expect(results[0]?.id).not.toBe(results[1]?.id);
        });
    });

    describe("Referential integrity & deletion behaviors", () => {
        it("cascades deletion when parent workspace is deleted", async () => {
            mocks.workspaceDelete.mockResolvedValue({
                id: "ws_cuid_456",
                name: "Acme Services",
                slug: "acme-services",
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

        it("rejects catalog deletion if restricted child workTypes exist", async () => {
            mocks.serviceCatalogDelete.mockRejectedValue(
                new Error("Foreign key constraint failed on the field: (`catalogId`)")
            );

            await expect(
                prisma.serviceCatalog.delete({
                    where: { id: "sc_with_children" },
                })
            ).rejects.toThrow("Foreign key constraint failed");
        });
    });
});
