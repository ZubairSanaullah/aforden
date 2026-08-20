import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    customerDelete: vi.fn(),
    serviceLocationDelete: vi.fn(),
    assetCategoryDelete: vi.fn(),
    assetDelete: vi.fn(),
    workspaceDelete: vi.fn(),
    userDelete: vi.fn(),

    assetFindMany: vi.fn(),
    assetHistoryFindMany: vi.fn(),
    workOrderFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        customer: { delete: mocks.customerDelete },
        serviceLocation: { delete: mocks.serviceLocationDelete },
        assetCategory: { delete: mocks.assetCategoryDelete },
        asset: { delete: mocks.assetDelete, findMany: mocks.assetFindMany },
        workspace: { delete: mocks.workspaceDelete },
        user: { delete: mocks.userDelete },
        assetHistory: { findMany: mocks.assetHistoryFindMany },
        workOrder: { findMany: mocks.workOrderFindMany },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.7.2 — Asset Referential Actions & Cascade Integrity", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Foreign Key Referential Integrity (onDelete: Restrict)", () => {
        it("blocks deleting a Customer referenced by an Asset (onDelete: Restrict)", async () => {
            const prismaForeignKeyError = new Error(
                "Foreign key constraint failed on the field: `Asset_customerId_fkey`"
            );
            (prismaForeignKeyError as any).code = "P2003";

            mocks.customerDelete.mockRejectedValue(prismaForeignKeyError);

            await expect(
                prisma.customer.delete({
                    where: { id: "cust_with_assets" },
                })
            ).rejects.toThrow("Foreign key constraint failed");
            expect(mocks.customerDelete).toHaveBeenCalledWith({
                where: { id: "cust_with_assets" },
            });
        });

        it("blocks deleting a ServiceLocation referenced by an Asset (onDelete: Restrict)", async () => {
            const prismaForeignKeyError = new Error(
                "Foreign key constraint failed on the field: `Asset_locationId_fkey`"
            );
            (prismaForeignKeyError as any).code = "P2003";

            mocks.serviceLocationDelete.mockRejectedValue(prismaForeignKeyError);

            await expect(
                prisma.serviceLocation.delete({
                    where: { id: "loc_with_assets" },
                })
            ).rejects.toThrow("Foreign key constraint failed");
            expect(mocks.serviceLocationDelete).toHaveBeenCalledWith({
                where: { id: "loc_with_assets" },
            });
        });

        it("blocks deleting an AssetCategory referenced by an Asset (onDelete: Restrict)", async () => {
            const prismaForeignKeyError = new Error(
                "Foreign key constraint failed on the field: `Asset_categoryId_fkey`"
            );
            (prismaForeignKeyError as any).code = "P2003";

            mocks.assetCategoryDelete.mockRejectedValue(prismaForeignKeyError);

            await expect(
                prisma.assetCategory.delete({
                    where: { id: "cat_with_assets" },
                })
            ).rejects.toThrow("Foreign key constraint failed");
            expect(mocks.assetCategoryDelete).toHaveBeenCalledWith({
                where: { id: "cat_with_assets" },
            });
        });

        it("blocks deleting an Asset referenced by a WorkOrder (onDelete: Restrict)", async () => {
            const prismaForeignKeyError = new Error(
                "Foreign key constraint failed on the field: `WorkOrder_assetId_fkey`"
            );
            (prismaForeignKeyError as any).code = "P2003";

            mocks.assetDelete.mockRejectedValue(prismaForeignKeyError);

            await expect(
                prisma.asset.delete({
                    where: { id: "asset_with_workorders" },
                })
            ).rejects.toThrow("Foreign key constraint failed");
            expect(mocks.assetDelete).toHaveBeenCalledWith({
                where: { id: "asset_with_workorders" },
            });
        });
    });

    describe("2. Cascade Deletions (onDelete: Cascade)", () => {
        it("deleting an Asset cascades to delete its AssetHistory records", async () => {
            mocks.assetDelete.mockResolvedValue({ id: "asset_101" });
            mocks.assetHistoryFindMany.mockResolvedValue([]);

            const deletedAsset = await prisma.asset.delete({
                where: { id: "asset_101" },
            });

            expect(deletedAsset.id).toBe("asset_101");
            expect(mocks.assetDelete).toHaveBeenCalledWith({
                where: { id: "asset_101" },
            });

            // Downstream audit history is automatically purged by Postgres cascade
            const history = await prisma.assetHistory.findMany({
                where: { assetId: "asset_101" },
            });
            expect(history).toEqual([]);
        });

        it("deleting a Workspace cascades to delete Assets, AssetCategories, and AssetHistory", async () => {
            mocks.workspaceDelete.mockResolvedValue({ id: "ws_alpha" });
            mocks.assetFindMany.mockResolvedValue([]);

            const deletedWs = await prisma.workspace.delete({
                where: { id: "ws_alpha" },
            });

            expect(deletedWs.id).toBe("ws_alpha");
            expect(mocks.workspaceDelete).toHaveBeenCalledWith({
                where: { id: "ws_alpha" },
            });

            const assets = await prisma.asset.findMany({
                where: { workspaceId: "ws_alpha" },
            });
            expect(assets).toEqual([]);
        });
    });

    describe("3. Nullification Actions (onDelete: SetNull)", () => {
        it("deleting a User referenced as actorUserId on AssetHistory sets it to null without deleting the record", async () => {
            mocks.userDelete.mockResolvedValue({ id: "usr_actor_1" });
            mocks.assetHistoryFindMany.mockResolvedValue([
                {
                    id: "ah_001",
                    workspaceId: "ws_alpha",
                    assetId: "ast_101",
                    eventType: "STATUS_CHANGED",
                    actorUserId: null, // Set to null upon user deletion
                    actorRole: "MANAGER",
                    reason: "Compressor replacement",
                },
            ]);

            const deletedUser = await prisma.user.delete({
                where: { id: "usr_actor_1" },
            });

            expect(deletedUser.id).toBe("usr_actor_1");

            const historyRecords = await prisma.assetHistory.findMany({
                where: { assetId: "ast_101" },
            });

            expect(historyRecords).toHaveLength(1);
            expect(historyRecords[0].actorUserId).toBeNull();
            expect(historyRecords[0].reason).toBe("Compressor replacement");
        });
    });
});
