import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    assetFindFirst: vi.fn(),
    assetUpdate: vi.fn(),
    assetHistoryCreate: vi.fn(),
    workOrderFindUnique: vi.fn(),
    workOrderUpdate: vi.fn(),
    transaction: vi.fn(),
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
        customer: {
            findFirst: mocks.customerFindFirst,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
        },
        asset: {
            findFirst: mocks.assetFindFirst,
            update: mocks.assetUpdate,
        },
        assetHistory: {
            create: mocks.assetHistoryCreate,
        },
        workOrder: {
            findUnique: mocks.workOrderFindUnique,
            update: mocks.workOrderUpdate,
        },
        $transaction: mocks.transaction,
    },
}));

import { transferAssetLocation } from "@/lib/services/asset/transferAssetLocation";
import { transferAssetOwnership } from "@/lib/services/asset/transferAssetOwnership";
import {
    AssetNotFoundError,
    AssetCustomerNotFoundError,
    AssetCustomerInactiveError,
    AssetLocationNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetImmutableError,
    AssetDecommissionedTransferError,
} from "@/lib/services/asset/assetErrors";
import {
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import type {
    Asset,
    Customer,
    ServiceLocation,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.6 — Asset Location & Ownership Transfer Service Unit Tests", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: any[];
    let locationsList: any[];
    let assetsList: any[];
    let historyList: any[];
    let workOrdersList: any[];

    const WS_ID = "ws_alpha_transfer";
    const WS_ID_BETA = "ws_beta_transfer";

    const USER_ADMIN: User = {
        id: "usr_admin_1",
        name: "Admin User",
        email: "admin@transfer.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "usr_tech_1",
        name: "Tech User",
        email: "tech@transfer.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_admin_1",
        workspaceId: WS_ID,
        userId: USER_ADMIN.id,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_1",
        workspaceId: WS_ID,
        userId: USER_TECH.id,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const makeAsset = (overrides: any = {}): any => ({
        id: "ast_transfer_1",
        workspaceId: WS_ID,
        assetNumber: "AST-000300",
        name: "Commercial Chiller Unit",
        customerId: "cust_1",
        locationId: "loc_1",
        categoryId: "cat_1",
        manufacturer: "Carrier",
        modelNumber: "30RAP",
        serialNumber: "SN-CARRIER-300",
        status: "OPERATIONAL",
        subLocationNotes: "Floor 1 Mechanical",
        installationDate: null,
        warrantyExpiresAt: null,
        purchaseDate: null,
        purchaseCost: null,
        notes: null,
        tags: [],
        metadata: null,
        decommissionedAt: null,
        retiredAt: null,
        customer: { id: "cust_1", customerNumber: "CUST-001", name: "Alpha Corp" },
        location: { id: "loc_1", name: "Building A", addressLine1: "100 Main", city: "Dallas", state: "TX", latitude: null, longitude: null },
        category: { id: "cat_1", name: "HVAC", code: "HVAC" },
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_TECH.id, USER_TECH],
        ]);

        workspacesMap = new Map([
            [
                WS_ID,
                {
                    id: WS_ID,
                    name: "Alpha Corp",
                    slug: "alpha-corp",
                    logoUrl: null,
                    timezone: "America/New_York",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
            [
                WS_ID_BETA,
                {
                    id: WS_ID_BETA,
                    name: "Beta Corp",
                    slug: "beta-corp",
                    logoUrl: null,
                    timezone: "America/Chicago",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        ]);

        membersMap = new Map([
            [`${WS_ID}_${USER_ADMIN.id}`, MEMBER_ADMIN],
            [`${WS_ID}_${USER_TECH.id}`, MEMBER_TECH],
        ]);

        customersList = [
            {
                id: "cust_1",
                workspaceId: WS_ID,
                customerNumber: "CUST-000001",
                name: "Customer Alpha",
                status: "ACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "cust_2",
                workspaceId: WS_ID,
                customerNumber: "CUST-000002",
                name: "Customer Beta",
                status: "ACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "cust_inactive",
                workspaceId: WS_ID,
                customerNumber: "CUST-000003",
                name: "Customer Inactive",
                status: "INACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        locationsList = [
            {
                id: "loc_1",
                customerId: "cust_1",
                name: "Building A",
                addressLine1: "100 Main",
                city: "Dallas",
                state: "TX",
                postalCode: "75001",
                country: "USA",
                latitude: null,
                longitude: null,
                customer: { workspaceId: WS_ID },
            },
            {
                id: "loc_2",
                customerId: "cust_1",
                name: "Building B",
                addressLine1: "200 Oak",
                city: "Dallas",
                state: "TX",
                postalCode: "75002",
                country: "USA",
                latitude: null,
                longitude: null,
                customer: { workspaceId: WS_ID },
            },
            {
                id: "loc_cust2",
                customerId: "cust_2",
                name: "Facility Beta",
                addressLine1: "500 Pine",
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
                latitude: null,
                longitude: null,
                customer: { workspaceId: WS_ID },
            },
        ];

        assetsList = [makeAsset()];
        historyList = [];

        workOrdersList = [
            {
                id: "wo_historical_1",
                workspaceId: WS_ID,
                workOrderNumber: "WO-00001",
                customerId: "cust_1",
                locationId: "loc_1",
                assetId: "ast_transfer_1",
                status: "COMPLETED",
            },
        ];

        mocks.auth.mockResolvedValue({
            user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
        });

        mocks.userFindUnique.mockImplementation(async ({ where }: any) => {
            return usersMap.get(where.id) || null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: any) => {
            return workspacesMap.get(where.id) || null;
        });

        mocks.workspaceMemberFindUnique.mockImplementation(async ({ where }: any) => {
            const compound = where.userId_workspaceId || where.workspaceId_userId;
            if (compound) {
                const key = `${compound.workspaceId}_${compound.userId}`;
                return membersMap.get(key) || null;
            }
            return null;
        });

        mocks.customerFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                customersList.find(
                    (c) => c.id === where.id && c.workspaceId === where.workspaceId
                ) || null
            );
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                locationsList.find(
                    (l) => l.id === where.id && l.customer.workspaceId === where.customer?.workspaceId
                ) || null
            );
        });

        mocks.assetFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                assetsList.find(
                    (a) => a.id === where.id && a.workspaceId === where.workspaceId
                ) || null
            );
        });

        mocks.assetUpdate.mockImplementation(async ({ where, data }: any) => {
            const asset = assetsList.find((a) => a.id === where.id);
            if (!asset) throw new Error("Not found");
            Object.assign(asset, data);
            if (data.customerId) {
                asset.customer = customersList.find((c) => c.id === data.customerId) || null;
            }
            if (data.locationId) {
                asset.location = locationsList.find((l) => l.id === data.locationId) || null;
            } else if (data.locationId === null) {
                asset.location = null;
            }
            return asset;
        });

        mocks.assetHistoryCreate.mockImplementation(async ({ data }: any) => {
            const row = { id: `hist_${historyList.length + 1}`, ...data };
            historyList.push(row);
            return row;
        });

        mocks.workOrderFindUnique.mockImplementation(async ({ where }: any) => {
            return workOrdersList.find((w) => w.id === where.id) || null;
        });

        mocks.transaction.mockImplementation(async (callback: any) => {
            return callback({
                asset: {
                    update: mocks.assetUpdate,
                },
                assetHistory: {
                    create: mocks.assetHistoryCreate,
                },
            });
        });
    });

    // -----------------------------------------------------------------------
    // 1. transferAssetLocation Tests
    // -----------------------------------------------------------------------
    describe("1. transferAssetLocation", () => {
        it("transfers asset location to a different location under the same customer", async () => {
            const result = await transferAssetLocation(WS_ID, "ast_transfer_1", {
                locationId: "loc_2",
                subLocationNotes: "Floor 3 Roof",
                transferReason: "Relocated chiller to Building B rooftop",
            });

            expect(result.location?.id).toBe("loc_2");
            expect(result.location?.name).toBe("Building B");
            expect(result.subLocationNotes).toBe("Floor 3 Roof");

            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("LOCATION_TRANSFERRED");
            expect(historyList[0].reason).toBe("Relocated chiller to Building B rooftop");
            expect(historyList[0].metadata.fromLocationId).toBe("loc_1");
            expect(historyList[0].metadata.toLocationId).toBe("loc_2");
        });

        it("throws AssetLocationNotFoundError if destination locationId does not exist", async () => {
            await expect(
                transferAssetLocation(WS_ID, "ast_transfer_1", {
                    locationId: "non_existent_loc",
                    transferReason: "Relocating",
                })
            ).rejects.toThrow(AssetLocationNotFoundError);
        });

        it("throws AssetLocationCustomerMismatchError if destination belongs to a different customer", async () => {
            await expect(
                transferAssetLocation(WS_ID, "ast_transfer_1", {
                    locationId: "loc_cust2", // Belongs to cust_2, asset belongs to cust_1
                    transferReason: "Relocating cross-customer",
                })
            ).rejects.toThrow(AssetLocationCustomerMismatchError);
        });

        it("throws AssetLocationRequiresCustomerError for depot asset with no customer", async () => {
            assetsList[0] = makeAsset({
                customerId: null,
                locationId: null,
                status: "IN_STORAGE",
            });

            await expect(
                transferAssetLocation(WS_ID, "ast_transfer_1", {
                    locationId: "loc_1",
                    transferReason: "Trying to assign location directly to depot asset",
                })
            ).rejects.toThrow(AssetLocationRequiresCustomerError);
        });

        it("throws AssetImmutableError if asset is in RETIRED status", async () => {
            assetsList[0] = makeAsset({ status: "RETIRED" });

            await expect(
                transferAssetLocation(WS_ID, "ast_transfer_1", {
                    locationId: "loc_2",
                    transferReason: "Relocating retired asset",
                })
            ).rejects.toThrow(AssetImmutableError);
        });

        it("throws AssetDecommissionedTransferError if asset is in DECOMMISSIONED status", async () => {
            assetsList[0] = makeAsset({ status: "DECOMMISSIONED" });

            await expect(
                transferAssetLocation(WS_ID, "ast_transfer_1", {
                    locationId: "loc_2",
                    transferReason: "Relocating decommissioned asset",
                })
            ).rejects.toThrow(AssetDecommissionedTransferError);
        });

        it("rejects TECHNICIAN callers outright with ForbiddenError", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                transferAssetLocation(WS_ID, "ast_transfer_1", {
                    locationId: "loc_2",
                    transferReason: "Technician trying to transfer location",
                })
            ).rejects.toThrow(ForbiddenError);
        });

        it("returns current read model as no-op when destination and notes are unchanged", async () => {
            const result = await transferAssetLocation(WS_ID, "ast_transfer_1", {
                locationId: "loc_1",
                subLocationNotes: "Floor 1 Mechanical",
                transferReason: "No-op transfer",
            });

            expect(result.location?.id).toBe("loc_1");
            expect(historyList).toHaveLength(0); // Zero writes
        });

        it("throws AssetNotFoundError for cross-tenant assetId (IDOR protection)", async () => {
            assetsList.push(makeAsset({ id: "ast_beta_transfer", workspaceId: WS_ID_BETA }));

            await expect(
                transferAssetLocation(WS_ID, "ast_beta_transfer", {
                    locationId: "loc_2",
                    transferReason: "Cross-tenant transfer",
                })
            ).rejects.toThrow(AssetNotFoundError);
        });
    });

    // -----------------------------------------------------------------------
    // 2. transferAssetOwnership Tests
    // -----------------------------------------------------------------------
    describe("2. transferAssetOwnership", () => {
        it("transfers asset ownership to a new customer and assigns a new location", async () => {
            const result = await transferAssetOwnership(WS_ID, "ast_transfer_1", {
                customerId: "cust_2",
                locationId: "loc_cust2",
                subLocationNotes: "Austin Server Room",
                transferReason: "Asset sold to Customer Beta",
            });

            expect(result.customer?.id).toBe("cust_2");
            expect(result.customer?.name).toBe("Customer Beta");
            expect(result.location?.id).toBe("loc_cust2");
            expect(result.location?.name).toBe("Facility Beta");

            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("OWNERSHIP_TRANSFERRED");
            expect(historyList[0].metadata).toEqual({
                fromCustomerId: "cust_1",
                toCustomerId: "cust_2",
                fromLocationId: "loc_1",
                toLocationId: "loc_cust2",
                fromSubLocationNotes: "Floor 1 Mechanical",
                toSubLocationNotes: "Austin Server Room",
            });
        });

        it("transfers asset ownership and clears locationId to null when locationId is omitted", async () => {
            const result = await transferAssetOwnership(WS_ID, "ast_transfer_1", {
                customerId: "cust_2",
                transferReason: "Asset acquired by Customer Beta without initial site placement",
            });

            expect(result.customer?.id).toBe("cust_2");
            expect(result.location).toBeNull();
            expect(assetsList[0].locationId).toBeNull();

            expect(historyList[0].metadata.toLocationId).toBeNull();
        });

        it("proves historical WorkOrder records remain completely untouched (Snapshot Rule §4.2)", async () => {
            // Verify historical work order before transfer
            const woBefore = workOrdersList.find((w) => w.id === "wo_historical_1");
            expect(woBefore.customerId).toBe("cust_1");
            expect(woBefore.locationId).toBe("loc_1");
            expect(woBefore.assetId).toBe("ast_transfer_1");

            // Execute ownership transfer
            await transferAssetOwnership(WS_ID, "ast_transfer_1", {
                customerId: "cust_2",
                locationId: "loc_cust2",
                transferReason: "Ownership transfer verification",
            });

            // Assert historical work order was NOT touched or cascaded
            const woAfter = workOrdersList.find((w) => w.id === "wo_historical_1");
            expect(woAfter.customerId).toBe("cust_1");
            expect(woAfter.locationId).toBe("loc_1");
            expect(woAfter.assetId).toBe("ast_transfer_1");
            expect(mocks.workOrderUpdate).not.toHaveBeenCalled();
        });

        it("throws AssetCustomerNotFoundError if target customerId does not exist", async () => {
            await expect(
                transferAssetOwnership(WS_ID, "ast_transfer_1", {
                    customerId: "non_existent_customer",
                    transferReason: "Transferring",
                })
            ).rejects.toThrow(AssetCustomerNotFoundError);
        });

        it("throws AssetCustomerInactiveError if target customer is INACTIVE", async () => {
            await expect(
                transferAssetOwnership(WS_ID, "ast_transfer_1", {
                    customerId: "cust_inactive",
                    transferReason: "Transferring to inactive customer",
                })
            ).rejects.toThrow(AssetCustomerInactiveError);
        });

        it("throws AssetLocationCustomerMismatchError if destination location does not belong to the target customer", async () => {
            await expect(
                transferAssetOwnership(WS_ID, "ast_transfer_1", {
                    customerId: "cust_2",
                    locationId: "loc_1", // loc_1 belongs to cust_1, not cust_2
                    transferReason: "Mismatched location",
                })
            ).rejects.toThrow(AssetLocationCustomerMismatchError);
        });

        it("throws AssetImmutableError if asset is RETIRED", async () => {
            assetsList[0] = makeAsset({ status: "RETIRED" });

            await expect(
                transferAssetOwnership(WS_ID, "ast_transfer_1", {
                    customerId: "cust_2",
                    transferReason: "Transferring retired asset",
                })
            ).rejects.toThrow(AssetImmutableError);
        });

        it("throws AssetDecommissionedTransferError if asset is DECOMMISSIONED", async () => {
            assetsList[0] = makeAsset({ status: "DECOMMISSIONED" });

            await expect(
                transferAssetOwnership(WS_ID, "ast_transfer_1", {
                    customerId: "cust_2",
                    transferReason: "Transferring decommissioned asset",
                })
            ).rejects.toThrow(AssetDecommissionedTransferError);
        });

        it("rejects TECHNICIAN callers outright with ForbiddenError", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                transferAssetOwnership(WS_ID, "ast_transfer_1", {
                    customerId: "cust_2",
                    transferReason: "Technician transferring ownership",
                })
            ).rejects.toThrow(ForbiddenError);
        });
    });
});
