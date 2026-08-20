import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

describe("Phase 1.7.2 — Live PostgreSQL Database Referential Integrity Integration Tests", () => {
    let prisma: PrismaClient;
    const testRunId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const wsId = `ws_${testRunId}`;
    const userId = `usr_${testRunId}`;
    const custId = `cust_${testRunId}`;
    const locId = `loc_${testRunId}`;
    const catId = `cat_${testRunId}`;
    const catId2 = `cat2_${testRunId}`;
    const assetId = `ast_${testRunId}`;
    const woId = `wo_${testRunId}`;
    const workTypeId = `wt_${testRunId}`;
    const catalogId = `sc_${testRunId}`;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database integration testing");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // Seed base workspace & user for isolated test execution
        await prisma.workspace.create({
            data: {
                id: wsId,
                name: `Test Workspace ${testRunId}`,
                slug: `test-ws-${testRunId}`,
            },
        });

        await prisma.user.create({
            data: {
                id: userId,
                name: "Integration Test User",
                email: `${testRunId}@example.com`,
            },
        });
    });

    afterAll(async () => {
        // Cleanup seeded test workspace & user (cascades all related data)
        try {
            await prisma.workspace.deleteMany({ where: { id: wsId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        } catch {
            // ignore cleanup errors
        }
        await prisma.$disconnect();
    });

    it("1. REAL DB: blocks deleting a Customer referenced by an Asset (onDelete: Restrict) with real Postgres P2003", async () => {
        // Create Customer & ServiceLocation
        await prisma.customer.create({
            data: {
                id: custId,
                workspaceId: wsId,
                name: "Acme Industrial Corp",
            },
        });

        await prisma.serviceLocation.create({
            data: {
                id: locId,
                customerId: custId,
                name: "Plant A",
                addressLine1: "100 Industrial Parkway",
                city: "Detroit",
                country: "USA",
            },
        });

        // Create Asset referencing Customer
        await prisma.asset.create({
            data: {
                id: assetId,
                workspaceId: wsId,
                customerId: custId,
                locationId: locId,
                assetNumber: `AST-${testRunId}-01`,
                name: "Air Compressor #1",
                status: "OPERATIONAL",
            },
        });

        // Attempt to delete Customer — Postgres foreign key constraint must reject with P2003
        let threwPrismaError: any = null;
        try {
            await prisma.customer.delete({
                where: { id: custId },
            });
        } catch (err: any) {
            threwPrismaError = err;
        }

        expect(threwPrismaError).not.toBeNull();
        expect(threwPrismaError.code).toBe("P2003");
        expect(threwPrismaError.message).toContain("Foreign key constraint violated");
    });

    it("2. REAL DB: blocks deleting a ServiceLocation referenced by an Asset (onDelete: Restrict) with real Postgres P2003", async () => {
        let threwPrismaError: any = null;
        try {
            await prisma.serviceLocation.delete({
                where: { id: locId },
            });
        } catch (err: any) {
            threwPrismaError = err;
        }

        expect(threwPrismaError).not.toBeNull();
        expect(threwPrismaError.code).toBe("P2003");
        expect(threwPrismaError.message).toContain("Foreign key constraint violated");
    });

    it("3. REAL DB: blocks deleting an AssetCategory referenced by an Asset (onDelete: Restrict) with real Postgres P2003", async () => {
        // Create Category & link to asset
        await prisma.assetCategory.create({
            data: {
                id: catId,
                workspaceId: wsId,
                name: "Heavy Machinery",
                code: `HEAVY-${testRunId}`,
            },
        });

        await prisma.asset.update({
            where: { id: assetId },
            data: { categoryId: catId },
        });

        let threwPrismaError: any = null;
        try {
            await prisma.assetCategory.delete({
                where: { id: catId },
            });
        } catch (err: any) {
            threwPrismaError = err;
        }

        expect(threwPrismaError).not.toBeNull();
        expect(threwPrismaError.code).toBe("P2003");
        expect(threwPrismaError.message).toContain("Foreign key constraint violated");
    });

    it("4. REAL DB: blocks deleting an Asset referenced by a WorkOrder (onDelete: Restrict) with real Postgres P2003", async () => {
        // Create ServiceCatalog & WorkType
        await prisma.serviceCatalog.create({
            data: {
                id: catalogId,
                workspaceId: wsId,
                name: "Maintenance Services",
            },
        });

        await prisma.workType.create({
            data: {
                id: workTypeId,
                workspaceId: wsId,
                catalogId,
                name: "Compressor Maintenance",
            },
        });

        // Create WorkOrder referencing the Asset
        await prisma.workOrder.create({
            data: {
                id: woId,
                workspaceId: wsId,
                workOrderNumber: `WO-${testRunId}-01`,
                customerId: custId,
                locationId: locId,
                workTypeId,
                assetId,
                workTypeName: "Compressor Maintenance",
                title: "Fix Compressor Leak",
            },
        });

        let threwPrismaError: any = null;
        try {
            await prisma.asset.delete({
                where: { id: assetId },
            });
        } catch (err: any) {
            threwPrismaError = err;
        }

        expect(threwPrismaError).not.toBeNull();
        expect(threwPrismaError.code).toBe("P2003");
        expect(threwPrismaError.message).toContain("Foreign key constraint violated");
    });

    it("5. REAL DB: deleting an Asset cascades to delete its AssetHistory rows in PostgreSQL (onDelete: Cascade)", async () => {
        // Create an unlinked asset for cascade testing
        const cascadeAssetId = `ast_cascade_${testRunId}`;
        await prisma.asset.create({
            data: {
                id: cascadeAssetId,
                workspaceId: wsId,
                assetNumber: `AST-CASC-${testRunId}`,
                name: "Temporary Generator",
                status: "IN_STORAGE",
            },
        });

        // Create AssetHistory records referencing this asset
        const historyId1 = `ah_c1_${testRunId}`;
        const historyId2 = `ah_c2_${testRunId}`;
        await prisma.assetHistory.createMany({
            data: [
                {
                    id: historyId1,
                    workspaceId: wsId,
                    assetId: cascadeAssetId,
                    eventType: "CREATED",
                    actorRole: "ADMIN",
                    reason: "Initial intake",
                },
                {
                    id: historyId2,
                    workspaceId: wsId,
                    assetId: cascadeAssetId,
                    eventType: "STATUS_CHANGED",
                    actorRole: "MANAGER",
                    reason: "Moved to storage",
                },
            ],
        });

        // Verify history rows exist in DB
        const beforeCount = await prisma.assetHistory.count({
            where: { assetId: cascadeAssetId },
        });
        expect(beforeCount).toBe(2);

        // Delete the Asset
        await prisma.asset.delete({
            where: { id: cascadeAssetId },
        });

        // Verify Postgres cascade deleted all child AssetHistory records from the live database
        const afterCount = await prisma.assetHistory.count({
            where: { assetId: cascadeAssetId },
        });
        expect(afterCount).toBe(0);
    });

    it("6. REAL DB: deleting a User referenced as actorUserId on AssetHistory sets actorUserId to NULL (onDelete: SetNull)", async () => {
        // Create an ephemeral user
        const ephemeralUserId = `usr_eph_${testRunId}`;
        await prisma.user.create({
            data: {
                id: ephemeralUserId,
                name: "Ephemeral Manager",
                email: `eph_${testRunId}@example.com`,
            },
        });

        // Create an ephemeral asset & history record
        const ephAssetId = `ast_eph_${testRunId}`;
        const ephHistoryId = `ah_eph_${testRunId}`;
        await prisma.asset.create({
            data: {
                id: ephAssetId,
                workspaceId: wsId,
                assetNumber: `AST-EPH-${testRunId}`,
                name: "Audit Test Pump",
                status: "OPERATIONAL",
            },
        });

        await prisma.assetHistory.create({
            data: {
                id: ephHistoryId,
                workspaceId: wsId,
                assetId: ephAssetId,
                eventType: "STATUS_CHANGED",
                actorUserId: ephemeralUserId,
                actorRole: "MANAGER",
                reason: "Routine inspection completed",
            },
        });

        // Verify actorUserId is set to the user ID in the live DB
        const historyBefore = await prisma.assetHistory.findUnique({
            where: { id: ephHistoryId },
        });
        expect(historyBefore?.actorUserId).toBe(ephemeralUserId);

        // Delete the User
        await prisma.user.delete({
            where: { id: ephemeralUserId },
        });

        // Verify Postgres SetNull updated actorUserId to null without deleting the audit history record
        const historyAfter = await prisma.assetHistory.findUnique({
            where: { id: ephHistoryId },
        });
        expect(historyAfter).not.toBeNull();
        expect(historyAfter?.id).toBe(ephHistoryId);
        expect(historyAfter?.actorUserId).toBeNull();
        expect(historyAfter?.reason).toBe("Routine inspection completed");
    });

    it("7. REAL DB: permits multiple AssetCategory rows with code = null within the same workspace in PostgreSQL", async () => {
        const nullCat1 = `cat_null1_${testRunId}`;
        const nullCat2 = `cat_null2_${testRunId}`;

        const created1 = await prisma.assetCategory.create({
            data: {
                id: nullCat1,
                workspaceId: wsId,
                name: `Null Code Category 1 ${testRunId}`,
                code: null,
            },
        });

        const created2 = await prisma.assetCategory.create({
            data: {
                id: nullCat2,
                workspaceId: wsId,
                name: `Null Code Category 2 ${testRunId}`,
                code: null,
            },
        });

        expect(created1.code).toBeNull();
        expect(created2.code).toBeNull();
        expect(created1.id).not.toBe(created2.id);

        // Clean up categories
        await prisma.assetCategory.deleteMany({
            where: { id: { in: [nullCat1, nullCat2] } },
        });
    });
});
