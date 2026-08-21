import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

import { deleteAsset } from "@/lib/services/asset/deleteAsset";
import { AssetDeletionNotAllowedError } from "@/lib/services/asset/assetErrors";

describe("Phase 1.7.9 — Live PostgreSQL Database Asset Deletion Integration Tests", () => {
    let prisma: PrismaClient;
    const testRunId = `del_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const wsId = `ws_${testRunId}`;
    const userId = `usr_${testRunId}`;
    const memberId = `mem_${testRunId}`;
    const custId = `cust_${testRunId}`;
    const locId = `loc_${testRunId}`;
    const catId = `cat_${testRunId}`;
    const catalogId = `sc_${testRunId}`;
    const workTypeId = `wt_${testRunId}`;
    const assetId1 = `ast1_${testRunId}`;
    const assetId2 = `ast2_${testRunId}`;
    const woId = `wo_${testRunId}`;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database integration testing");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Seed base workspace & user with ADMIN membership
        await prisma.workspace.create({
            data: {
                id: wsId,
                name: `Deletion Test Workspace ${testRunId}`,
                slug: `test-del-ws-${testRunId}`,
            },
        });

        await prisma.user.create({
            data: {
                id: userId,
                name: "Admin Integration User",
                email: `${testRunId}@example.com`,
                status: "ACTIVE",
            },
        });

        await prisma.workspaceMember.create({
            data: {
                id: memberId,
                workspaceId: wsId,
                userId: userId,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // Mock auth to return this admin user
        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${testRunId}@example.com` },
        });

        // 2. Seed Customer, Location, Category, Catalog & WorkType
        await prisma.customer.create({
            data: {
                id: custId,
                workspaceId: wsId,
                customerNumber: `CUST-${testRunId}`,
                name: "Apex Integration Client",
                status: "ACTIVE",
            },
        });

        await prisma.serviceLocation.create({
            data: {
                id: locId,
                customerId: custId,
                name: "Plant A",
                addressLine1: "100 Industrial Parkway",
                city: "Austin",
                country: "USA",
            },
        });

        await prisma.assetCategory.create({
            data: {
                id: catId,
                workspaceId: wsId,
                name: `HVAC-${testRunId}`,
                status: "ACTIVE",
            },
        });

        await prisma.serviceCatalog.create({
            data: {
                id: catalogId,
                workspaceId: wsId,
                name: "HVAC Services",
                status: "ACTIVE",
            },
        });

        await prisma.workType.create({
            data: {
                id: workTypeId,
                workspaceId: wsId,
                catalogId: catalogId,
                name: "Chiller Maintenance",
                code: `MAINT-${testRunId}`,
                status: "ACTIVE",
            },
        });
    });

    afterAll(async () => {
        try {
            await prisma.workspace.deleteMany({ where: { id: wsId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        } catch {
            // ignore cleanup errors
        }
        await prisma.$disconnect();
    });

    it("1. REAL DB: deleteAsset() deletes unreferenced asset and cascade-deletes its AssetHistory rows", async () => {
        // Create an unreferenced asset
        await prisma.asset.create({
            data: {
                id: assetId1,
                workspaceId: wsId,
                customerId: custId,
                locationId: locId,
                categoryId: catId,
                assetNumber: `AST-DEL-${testRunId}-01`,
                name: "Chiller Unit 1",
                status: "OPERATIONAL",
            },
        });

        // Create 2 AssetHistory records for this asset
        await prisma.assetHistory.createMany({
            data: [
                {
                    id: `ah1_${testRunId}`,
                    workspaceId: wsId,
                    assetId: assetId1,
                    eventType: "CREATED",
                    actorUserId: userId,
                    actorRole: "ADMIN",
                    reason: "Initial registration",
                },
                {
                    id: `ah2_${testRunId}`,
                    workspaceId: wsId,
                    assetId: assetId1,
                    eventType: "STATUS_CHANGED",
                    actorUserId: userId,
                    actorRole: "ADMIN",
                    reason: "Inspection check",
                },
            ],
        });

        // Confirm history records exist before deletion
        const historyBefore = await prisma.assetHistory.findMany({
            where: { assetId: assetId1 },
        });
        expect(historyBefore.length).toBe(2);

        // Call deleteAsset service
        const deletedViewModel = await deleteAsset(wsId, assetId1);

        expect(deletedViewModel.id).toBe(assetId1);
        expect(deletedViewModel.name).toBe("Chiller Unit 1");

        // Verify Asset row is gone from PostgreSQL
        const assetAfter = await prisma.asset.findUnique({
            where: { id: assetId1 },
        });
        expect(assetAfter).toBeNull();

        // Verify all AssetHistory rows for this assetId are cascade-deleted in PostgreSQL
        const historyAfter = await prisma.assetHistory.findMany({
            where: { assetId: assetId1 },
        });
        expect(historyAfter.length).toBe(0);
    });

    it("2. REAL DB: deleteAsset() is blocked when asset is referenced by a WorkOrder", async () => {
        // Create an asset
        await prisma.asset.create({
            data: {
                id: assetId2,
                workspaceId: wsId,
                customerId: custId,
                locationId: locId,
                categoryId: catId,
                assetNumber: `AST-DEL-${testRunId}-02`,
                name: "Chiller Unit 2",
                status: "OPERATIONAL",
            },
        });

        // Create a WorkOrder referencing this asset
        await prisma.workOrder.create({
            data: {
                id: woId,
                workspaceId: wsId,
                customerId: custId,
                locationId: locId,
                workTypeId: workTypeId,
                assetId: assetId2,
                workOrderNumber: `WO-${testRunId}`,
                workTypeName: "Chiller Maintenance",
                workTypeCode: `MAINT-${testRunId}`,
                estimatedDuration: 60,
                title: "Scheduled repair",
            },
        });

        // Attempting deleteAsset service must throw AssetDeletionNotAllowedError
        await expect(deleteAsset(wsId, assetId2)).rejects.toThrow(
            AssetDeletionNotAllowedError,
        );

        // Verify Asset remains intact in PostgreSQL
        const assetStillExists = await prisma.asset.findUnique({
            where: { id: assetId2 },
        });
        expect(assetStillExists).not.toBeNull();
        expect(assetStillExists?.id).toBe(assetId2);
    });
});
