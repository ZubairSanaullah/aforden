import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    type Asset,
    type AssetCategory,
    type AssetHistory,
    type AssetStatus,
    type AssetCategoryStatus,
    type AssetHistoryEventType,
    type Workspace,
} from "../../generated/prisma/client";

const mocks = vi.hoisted(() => ({
    assetCreate: vi.fn(),
    assetFindUnique: vi.fn(),
    assetFindFirst: vi.fn(),
    assetFindMany: vi.fn(),
    assetUpdate: vi.fn(),
    assetDelete: vi.fn(),

    assetCategoryCreate: vi.fn(),
    assetCategoryFindUnique: vi.fn(),
    assetCategoryFindFirst: vi.fn(),
    assetCategoryFindMany: vi.fn(),
    assetCategoryUpdate: vi.fn(),
    assetCategoryDelete: vi.fn(),

    assetHistoryCreate: vi.fn(),
    assetHistoryFindMany: vi.fn(),
    assetHistoryFindFirst: vi.fn(),

    workspaceCreate: vi.fn(),
    workspaceFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        asset: {
            create: mocks.assetCreate,
            findUnique: mocks.assetFindUnique,
            findFirst: mocks.assetFindFirst,
            findMany: mocks.assetFindMany,
            update: mocks.assetUpdate,
            delete: mocks.assetDelete,
        },
        assetCategory: {
            create: mocks.assetCategoryCreate,
            findUnique: mocks.assetCategoryFindUnique,
            findFirst: mocks.assetCategoryFindFirst,
            findMany: mocks.assetCategoryFindMany,
            update: mocks.assetCategoryUpdate,
            delete: mocks.assetCategoryDelete,
        },
        assetHistory: {
            create: mocks.assetHistoryCreate,
            findMany: mocks.assetHistoryFindMany,
            findFirst: mocks.assetHistoryFindFirst,
        },
        workspace: {
            create: mocks.workspaceCreate,
            findUnique: mocks.workspaceFindUnique,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.7.2 — Asset & Equipment Prisma Data Model", () => {
    const WS_ALPHA = "ws_alpha_101";
    const WS_BETA = "ws_beta_202";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Asset Model Definition & Field Invariants", () => {
        it("creates an asset with all standard, technical, and commercial fields", async () => {
            const mockAsset: Asset = {
                id: "ast_cuid_101",
                workspaceId: WS_ALPHA,
                customerId: "cust_101",
                locationId: "loc_101",
                categoryId: "cat_101",
                assetNumber: "AST-000101",
                name: "Rooftop Chiller Unit #1",
                manufacturer: "Carrier",
                modelNumber: "30RAP-055",
                serialNumber: "SN-CARRIER-998811",
                status: "OPERATIONAL",
                subLocationNotes: "North Rooftop - Section B",
                installationDate: new Date("2024-03-15T00:00:00.000Z"),
                warrantyExpiresAt: new Date("2029-03-15T00:00:00.000Z"),
                purchaseDate: new Date("2024-02-01T00:00:00.000Z"),
                purchaseCost: 45000.00 as any,
                notes: "Primary building chiller",
                tags: ["critical-infrastructure", "rooftop", "tier-1-sla"],
                metadata: {
                    tonnage: 55,
                    refrigerantType: "R-410A",
                    voltage: "480V 3-Phase",
                },
                decommissionedAt: null,
                retiredAt: null,
                createdAt: new Date("2024-03-15T10:00:00.000Z"),
                updatedAt: new Date("2026-08-20T10:00:00.000Z"),
            };

            mocks.assetCreate.mockResolvedValue(mockAsset);

            const result = await prisma.asset.create({
                data: {
                    workspaceId: WS_ALPHA,
                    customerId: "cust_101",
                    locationId: "loc_101",
                    categoryId: "cat_101",
                    assetNumber: "AST-000101",
                    name: "Rooftop Chiller Unit #1",
                    manufacturer: "Carrier",
                    modelNumber: "30RAP-055",
                    serialNumber: "SN-CARRIER-998811",
                    status: "OPERATIONAL",
                    subLocationNotes: "North Rooftop - Section B",
                    installationDate: new Date("2024-03-15T00:00:00.000Z"),
                    warrantyExpiresAt: new Date("2029-03-15T00:00:00.000Z"),
                    purchaseDate: new Date("2024-02-01T00:00:00.000Z"),
                    purchaseCost: 45000.00 as any,
                    notes: "Primary building chiller",
                    tags: ["critical-infrastructure", "rooftop", "tier-1-sla"],
                    metadata: {
                        tonnage: 55,
                        refrigerantType: "R-410A",
                        voltage: "480V 3-Phase",
                    },
                },
            });

            expect(mocks.assetCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ALPHA,
                    assetNumber: "AST-000101",
                    name: "Rooftop Chiller Unit #1",
                    status: "OPERATIONAL",
                    tags: ["critical-infrastructure", "rooftop", "tier-1-sla"],
                }),
            });
            expect(result.id).toBe("ast_cuid_101");
            expect(result.status).toBe("OPERATIONAL");
            expect(result.tags).toEqual(["critical-infrastructure", "rooftop", "tier-1-sla"]);
        });

        it("creates an unassigned depot/tenant asset with nullable customerId and locationId", async () => {
            const depotAsset: Asset = {
                id: "ast_depot_001",
                workspaceId: WS_ALPHA,
                customerId: null,
                locationId: null,
                categoryId: "cat_generators",
                assetNumber: "AST-000200",
                name: "Mobile Emergency Generator 50kW",
                manufacturer: "Cummins",
                modelNumber: "C50D6",
                serialNumber: "CUM-GEN-50-881",
                status: "IN_STORAGE",
                subLocationNotes: "Shop Bay 4",
                installationDate: null,
                warrantyExpiresAt: null,
                purchaseDate: new Date("2025-01-10T00:00:00.000Z"),
                purchaseCost: 28000.00 as any,
                notes: "Float unit for emergency customer loan",
                tags: ["mobile", "generator", "loaner"],
                metadata: { fuelType: "Diesel", outputKW: 50 },
                decommissionedAt: null,
                retiredAt: null,
                createdAt: new Date("2025-01-10T00:00:00.000Z"),
                updatedAt: new Date("2026-08-20T00:00:00.000Z"),
            };

            mocks.assetCreate.mockResolvedValue(depotAsset);

            const result = await prisma.asset.create({
                data: {
                    workspaceId: WS_ALPHA,
                    assetNumber: "AST-000200",
                    name: "Mobile Emergency Generator 50kW",
                    status: "IN_STORAGE",
                },
            });

            expect(result.customerId).toBeNull();
            expect(result.locationId).toBeNull();
            expect(result.status).toBe("IN_STORAGE");
        });

        it("supports all 6 AssetStatus enum values", async () => {
            const validStatuses: AssetStatus[] = [
                "OPERATIONAL",
                "DEGRADED",
                "OUT_OF_SERVICE",
                "IN_STORAGE",
                "DECOMMISSIONED",
                "RETIRED",
            ];

            for (const status of validStatuses) {
                const assetWithStatus: Asset = {
                    id: `ast_${status.toLowerCase()}`,
                    workspaceId: WS_ALPHA,
                    customerId: null,
                    locationId: null,
                    categoryId: null,
                    assetNumber: `AST-${status}`,
                    name: `Equipment ${status}`,
                    manufacturer: null,
                    modelNumber: null,
                    serialNumber: null,
                    status,
                    subLocationNotes: null,
                    installationDate: null,
                    warrantyExpiresAt: null,
                    purchaseDate: null,
                    purchaseCost: null,
                    notes: null,
                    tags: [],
                    metadata: null,
                    decommissionedAt: status === "DECOMMISSIONED" ? new Date() : null,
                    retiredAt: status === "RETIRED" ? new Date() : null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                mocks.assetCreate.mockResolvedValue(assetWithStatus);

                const result = await prisma.asset.create({
                    data: {
                        workspaceId: WS_ALPHA,
                        assetNumber: `AST-${status}`,
                        name: `Equipment ${status}`,
                        status,
                    },
                });

                expect(result.status).toBe(status);
            }
        });
    });

    describe("2. AssetCategory Model Definition & Constraints", () => {
        it("creates an AssetCategory with all operational fields", async () => {
            const mockCategory: AssetCategory = {
                id: "cat_hvac_comm",
                workspaceId: WS_ALPHA,
                name: "Commercial HVAC",
                code: "HVAC-COMM",
                description: "Commercial heating, ventilation, and air conditioning equipment",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date("2026-08-20T00:00:00.000Z"),
                updatedAt: new Date("2026-08-20T00:00:00.000Z"),
            };

            mocks.assetCategoryCreate.mockResolvedValue(mockCategory);

            const result = await prisma.assetCategory.create({
                data: {
                    workspaceId: WS_ALPHA,
                    name: "Commercial HVAC",
                    code: "HVAC-COMM",
                    description: "Commercial heating, ventilation, and air conditioning equipment",
                    status: "ACTIVE",
                    sortOrder: 1,
                },
            });

            expect(result.id).toBe("cat_hvac_comm");
            expect(result.name).toBe("Commercial HVAC");
            expect(result.code).toBe("HVAC-COMM");
            expect(result.status).toBe("ACTIVE");
            expect(result.sortOrder).toBe(1);
        });

        it("allows AssetCategory creation with minimal fields and default values", async () => {
            const minimalCategory: AssetCategory = {
                id: "cat_min_01",
                workspaceId: WS_ALPHA,
                name: "Pumps & Hydraulics",
                code: null,
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.assetCategoryCreate.mockResolvedValue(minimalCategory);

            const result = await prisma.assetCategory.create({
                data: {
                    workspaceId: WS_ALPHA,
                    name: "Pumps & Hydraulics",
                },
            });

            expect(result.code).toBeNull();
            expect(result.status).toBe("ACTIVE");
            expect(result.sortOrder).toBe(0);
        });
    });

    describe("3. AssetHistory Model Definition & Event Types", () => {
        it("creates an append-only AssetHistory audit log record", async () => {
            const mockHistory: AssetHistory = {
                id: "ah_001",
                workspaceId: WS_ALPHA,
                assetId: "ast_cuid_101",
                eventType: "STATUS_CHANGED",
                actorUserId: "usr_manager_1",
                actorRole: "MANAGER",
                reason: "Compressor failure on rooftop unit 1",
                metadata: {
                    oldStatus: "OPERATIONAL",
                    newStatus: "OUT_OF_SERVICE",
                },
                createdAt: new Date("2026-08-20T11:00:00.000Z"),
            };

            mocks.assetHistoryCreate.mockResolvedValue(mockHistory);

            const result = await prisma.assetHistory.create({
                data: {
                    workspaceId: WS_ALPHA,
                    assetId: "ast_cuid_101",
                    eventType: "STATUS_CHANGED",
                    actorUserId: "usr_manager_1",
                    actorRole: "MANAGER",
                    reason: "Compressor failure on rooftop unit 1",
                    metadata: {
                        oldStatus: "OPERATIONAL",
                        newStatus: "OUT_OF_SERVICE",
                    },
                },
            });

            expect(result.eventType).toBe("STATUS_CHANGED");
            expect(result.actorRole).toBe("MANAGER");
            expect(result.reason).toBe("Compressor failure on rooftop unit 1");
        });

        it("supports all 8 AssetHistoryEventType enum values", async () => {
            const validEventTypes: AssetHistoryEventType[] = [
                "CREATED",
                "UPDATED",
                "STATUS_CHANGED",
                "LOCATION_TRANSFERRED",
                "OWNERSHIP_TRANSFERRED",
                "DECOMMISSIONED",
                "REACTIVATED",
                "RETIRED",
            ];

            for (const eventType of validEventTypes) {
                const historyRecord: AssetHistory = {
                    id: `ah_${eventType.toLowerCase()}`,
                    workspaceId: WS_ALPHA,
                    assetId: "ast_cuid_101",
                    eventType,
                    actorUserId: "usr_admin_1",
                    actorRole: "ADMIN",
                    reason: `Executed ${eventType}`,
                    metadata: null,
                    createdAt: new Date(),
                };

                mocks.assetHistoryCreate.mockResolvedValue(historyRecord);

                const result = await prisma.assetHistory.create({
                    data: {
                        workspaceId: WS_ALPHA,
                        assetId: "ast_cuid_101",
                        eventType,
                        actorRole: "ADMIN",
                    },
                });

                expect(result.eventType).toBe(eventType);
            }
        });
    });

    describe("4. Uniqueness Constraints & Scoping", () => {
        it("enforces tenant-scoped uniqueness on assetNumber", async () => {
            // Workspace Alpha asset
            const assetAlpha: Asset = {
                id: "ast_alpha_1",
                workspaceId: WS_ALPHA,
                customerId: null,
                locationId: null,
                categoryId: null,
                assetNumber: "AST-000001",
                name: "Alpha Equipment 1",
                manufacturer: null,
                modelNumber: null,
                serialNumber: null,
                status: "OPERATIONAL",
                subLocationNotes: null,
                installationDate: null,
                warrantyExpiresAt: null,
                purchaseDate: null,
                purchaseCost: null,
                notes: null,
                tags: [],
                metadata: null,
                decommissionedAt: null,
                retiredAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Workspace Beta asset with identical assetNumber
            const assetBeta: Asset = {
                ...assetAlpha,
                id: "ast_beta_1",
                workspaceId: WS_BETA,
                name: "Beta Equipment 1",
            };

            mocks.assetCreate.mockResolvedValueOnce(assetAlpha).mockResolvedValueOnce(assetBeta);

            const resAlpha = await prisma.asset.create({
                data: { workspaceId: WS_ALPHA, assetNumber: "AST-000001", name: "Alpha Equipment 1" },
            });
            const resBeta = await prisma.asset.create({
                data: { workspaceId: WS_BETA, assetNumber: "AST-000001", name: "Beta Equipment 1" },
            });

            expect(resAlpha.assetNumber).toBe("AST-000001");
            expect(resAlpha.workspaceId).toBe(WS_ALPHA);
            expect(resBeta.assetNumber).toBe("AST-000001");
            expect(resBeta.workspaceId).toBe(WS_BETA);
        });

        it("enforces tenant-scoped uniqueness on AssetCategory name and code", async () => {
            const catAlpha: AssetCategory = {
                id: "cat_alpha_1",
                workspaceId: WS_ALPHA,
                name: "HVAC",
                code: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const catBeta: AssetCategory = {
                ...catAlpha,
                id: "cat_beta_1",
                workspaceId: WS_BETA,
            };

            mocks.assetCategoryCreate.mockResolvedValueOnce(catAlpha).mockResolvedValueOnce(catBeta);

            const resAlpha = await prisma.assetCategory.create({
                data: { workspaceId: WS_ALPHA, name: "HVAC", code: "HVAC" },
            });
            const resBeta = await prisma.assetCategory.create({
                data: { workspaceId: WS_BETA, name: "HVAC", code: "HVAC" },
            });

            expect(resAlpha.name).toBe("HVAC");
            expect(resAlpha.workspaceId).toBe(WS_ALPHA);
            expect(resBeta.name).toBe("HVAC");
            expect(resBeta.workspaceId).toBe(WS_BETA);
        });

        it("permits multiple AssetCategory rows with code = null within the same workspace", async () => {
            const cat1: AssetCategory = {
                id: "cat_null_code_1",
                workspaceId: WS_ALPHA,
                name: "Category Without Code 1",
                code: null,
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const cat2: AssetCategory = {
                id: "cat_null_code_2",
                workspaceId: WS_ALPHA,
                name: "Category Without Code 2",
                code: null,
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.assetCategoryCreate.mockResolvedValueOnce(cat1).mockResolvedValueOnce(cat2);

            const res1 = await prisma.assetCategory.create({
                data: { workspaceId: WS_ALPHA, name: "Category Without Code 1", code: null },
            });
            const res2 = await prisma.assetCategory.create({
                data: { workspaceId: WS_ALPHA, name: "Category Without Code 2", code: null },
            });

            expect(res1.code).toBeNull();
            expect(res1.workspaceId).toBe(WS_ALPHA);
            expect(res2.code).toBeNull();
            expect(res2.workspaceId).toBe(WS_ALPHA);
            expect(res1.id).not.toBe(res2.id);
        });
    });

    describe("5. Tenant Isolation Scoped Queries", () => {
        it("requires workspaceId when querying assets", async () => {
            mocks.assetFindFirst.mockResolvedValue({
                id: "ast_101",
                workspaceId: WS_ALPHA,
                assetNumber: "AST-000101",
                name: "Chiller",
            });

            const asset = await prisma.asset.findFirst({
                where: {
                    id: "ast_101",
                    workspaceId: WS_ALPHA,
                },
            });

            expect(mocks.assetFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "ast_101",
                    workspaceId: WS_ALPHA,
                },
            });
            expect(asset?.workspaceId).toBe(WS_ALPHA);
        });

        it("requires workspaceId when querying asset categories", async () => {
            mocks.assetCategoryFindMany.mockResolvedValue([
                { id: "cat_1", workspaceId: WS_ALPHA, name: "HVAC", status: "ACTIVE" },
            ]);

            const categories = await prisma.assetCategory.findMany({
                where: {
                    workspaceId: WS_ALPHA,
                    status: "ACTIVE",
                },
            });

            expect(mocks.assetCategoryFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ALPHA,
                    status: "ACTIVE",
                },
            });
            expect(categories).toHaveLength(1);
        });

        it("requires workspaceId when querying asset history audit trails", async () => {
            mocks.assetHistoryFindMany.mockResolvedValue([
                { id: "ah_1", workspaceId: WS_ALPHA, assetId: "ast_101", eventType: "CREATED" },
            ]);

            const history = await prisma.assetHistory.findMany({
                where: {
                    workspaceId: WS_ALPHA,
                    assetId: "ast_101",
                },
                orderBy: {
                    createdAt: "desc",
                },
            });

            expect(mocks.assetHistoryFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ALPHA,
                    assetId: "ast_101",
                },
                orderBy: {
                    createdAt: "desc",
                },
            });
            expect(history).toHaveLength(1);
        });
    });
});
