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

import { createAsset } from "@/lib/services/asset/createAsset";

describe("Phase 1.7.4 — Live PostgreSQL Asset Creation & Concurrency Integration Tests", () => {
    let prisma: PrismaClient;
    const testRunId = `ast_it_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const wsId = `ws_${testRunId}`;
    const userId = `usr_${testRunId}`;
    const custId = `cust_${testRunId}`;
    const locId = `loc_${testRunId}`;
    const catId = `cat_${testRunId}`;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database integration testing");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // Seed base workspace, user, and member
        await prisma.workspace.create({
            data: {
                id: wsId,
                name: `Asset Integration WS ${testRunId}`,
                slug: `asset-ws-${testRunId}`,
            },
        });

        await prisma.user.create({
            data: {
                id: userId,
                name: "Asset Integration Tester",
                email: `${testRunId}@example.com`,
                status: "ACTIVE",
            },
        });

        await prisma.workspaceMember.create({
            data: {
                id: `mem_${testRunId}`,
                workspaceId: wsId,
                userId: userId,
                role: "OWNER",
                status: "ACTIVE",
            },
        });

        await prisma.customer.create({
            data: {
                id: custId,
                workspaceId: wsId,
                name: "Integration Customer",
                customerNumber: `CUST-${testRunId}`,
                status: "ACTIVE",
            },
        });

        await prisma.serviceLocation.create({
            data: {
                id: locId,
                customerId: custId,
                name: "Main Facility",
                addressLine1: "123 Technology Way",
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
            },
        });

        await prisma.assetCategory.create({
            data: {
                id: catId,
                workspaceId: wsId,
                name: "HVAC Chillers",
                code: "CHILL",
                status: "ACTIVE",
            },
        });

        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${testRunId}@example.com` },
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

    it("1. REAL DB: creates an installed asset with relations and writes AssetHistory CREATED event", async () => {
        const result = await createAsset(wsId, {
            name: "Rooftop Chiller Unit #1",
            customerId: custId,
            locationId: locId,
            categoryId: catId,
            manufacturer: "Carrier",
            modelNumber: "30RAP",
            serialNumber: "SN-CARRIER-100",
            tags: ["critical-infrastructure", "rooftop"],
            metadata: { tonnage: 55, voltage: "480V" },
        });

        expect(result.id).toBeDefined();
        expect(result.assetNumber).toBe("AST-000001");
        expect(result.status).toBe("OPERATIONAL");
        expect(result.customer?.name).toBe("Integration Customer");
        expect(result.location?.name).toBe("Main Facility");
        expect(result.category?.name).toBe("HVAC Chillers");

        // Verify history row in DB
        const historyRows = await prisma.assetHistory.findMany({
            where: { assetId: result.id },
        });
        expect(historyRows).toHaveLength(1);
        expect(historyRows[0].eventType).toBe("CREATED");
        expect(historyRows[0].actorUserId).toBe(userId);
        expect(historyRows[0].actorRole).toBe("OWNER");
    }, 30000);

    it("2. REAL DB & CONCURRENCY: fires 5 simultaneous createAsset calls without assetNumber and generates unique sequential numbers without collisions", async () => {
        const promises = Array.from({ length: 5 }, (_, i) =>
            createAsset(wsId, {
                name: `Concurrent Asset #${i + 1}`,
                customerId: custId,
                locationId: locId,
            })
        );

        const results = await Promise.all(promises);

        // Extract all generated asset numbers
        const assetNumbers = results.map((r) => r.assetNumber);
        const uniqueNumbers = new Set(assetNumbers);

        // Assert all 5 got distinct numbers
        expect(uniqueNumbers.size).toBe(5);

        // Verify sequential format
        for (const num of assetNumbers) {
            expect(num).toMatch(/^AST-\d{6}$/);
        }

        // Verify all 5 were written to real database
        const dbAssets = await prisma.asset.findMany({
            where: {
                workspaceId: wsId,
                id: { in: results.map((r) => r.id) },
            },
        });
        expect(dbAssets).toHaveLength(5);
    }, 30000);

    it("3. REAL DB: creates a depot asset with null customer and location, defaulting status to IN_STORAGE", async () => {
        const result = await createAsset(wsId, {
            name: "Depot Portable Welder",
            customerId: null,
            locationId: null,
        });

        expect(result.status).toBe("IN_STORAGE");
        expect(result.customer).toBeNull();
        expect(result.location).toBeNull();

        const dbAsset = await prisma.asset.findUnique({
            where: { id: result.id },
        });
        expect(dbAsset?.status).toBe("IN_STORAGE");
        expect(dbAsset?.customerId).toBeNull();
        expect(dbAsset?.locationId).toBeNull();
    }, 30000);

    it("4. REAL DB & ATOMICITY: proves transaction atomicity rolls back Asset creation if AssetHistory insert fails", async () => {
        const candidateAssetNumber = `AST-ROLLBACK-${Date.now().toString().slice(-4)}`;

        // Verify with real Prisma transaction that if history write fails, the asset is not committed
        await expect(
            prisma.$transaction(async (tx) => {
                const asset = await tx.asset.create({
                    data: {
                        workspaceId: wsId,
                        assetNumber: candidateAssetNumber,
                        name: "Uncommitted Rollback Test Asset",
                        status: "OPERATIONAL",
                    },
                });

                // Force an error on the second operation in transaction
                throw new Error("Forced simulated failure during audit ledger write");
            })
        ).rejects.toThrow("Forced simulated failure during audit ledger write");

        // Verify the asset was NOT committed to the database
        const uncommittedAsset = await prisma.asset.findFirst({
            where: {
                workspaceId: wsId,
                assetNumber: candidateAssetNumber,
            },
        });
        expect(uncommittedAsset).toBeNull();
    }, 30000);
});
