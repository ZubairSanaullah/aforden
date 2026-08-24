import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    assetFindFirst: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderFindMany: vi.fn(),
    workOrderCount: vi.fn(),
    workOrderCreate: vi.fn(),
    workOrderUpdate: vi.fn(),
    workOrderHistoryCreate: vi.fn(),
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
        workType: {
            findFirst: mocks.workTypeFindFirst,
        },
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
        asset: {
            findFirst: mocks.assetFindFirst,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            findMany: mocks.workOrderFindMany,
            count: mocks.workOrderCount,
            create: mocks.workOrderCreate,
            update: mocks.workOrderUpdate,
        },
        workOrderHistory: {
            create: mocks.workOrderHistoryCreate,
        },
        $transaction: mocks.transaction,
    },
}));

import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { updateWorkOrder } from "@/lib/services/workOrder/updateWorkOrder";
import { getAssetWorkOrders } from "@/lib/services/asset/getAssetWorkOrders";
import {
    WorkOrderAssetCustomerMismatchError,
    WorkOrderAssetLocationMismatchError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    AssetNotFoundError,
    AssetImmutableError,
} from "@/lib/services/asset/assetErrors";
import type {
    Customer,
    ServiceLocation,
    WorkType,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.7 — WorkOrder <-> Asset Integration Tests", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: any[];
    let locationsList: any[];
    let workTypesList: any[];
    let assetsList: any[];
    let workOrdersList: any[];
    let workOrderHistoryList: any[];

    const WS_ID = "ws_wo_asset_alpha";
    const WS_ID_BETA = "ws_wo_asset_beta";

    const USER_ADMIN: User = {
        id: "usr_admin_wo_asset",
        name: "Admin WO Asset",
        email: "admin@woasset.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_admin_wo_asset",
        workspaceId: WS_ID,
        userId: USER_ADMIN.id,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([[USER_ADMIN.id, USER_ADMIN]]);
        workspacesMap = new Map([
            [
                WS_ID,
                {
                    id: WS_ID,
                    name: "Alpha Corp",
                    slug: "alpha-corp",
                    logoUrl: null,
                    timezone: "America/New_York",
                    defaultCurrencyCode: "USD",
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
                    defaultCurrencyCode: "USD",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        ]);

        membersMap = new Map([[`${WS_ID}_${USER_ADMIN.id}`, MEMBER_ADMIN]]);

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
        ];

        locationsList = [
            {
                id: "loc_1",
                customerId: "cust_1",
                name: "Site Alpha 1",
                addressLine1: "100 Main",
                addressLine2: null,
                city: "Dallas",
                state: "TX",
                postalCode: "75001",
                country: "USA",
            },
            {
                id: "loc_2",
                customerId: "cust_1",
                name: "Site Alpha 2",
                addressLine1: "200 Oak",
                addressLine2: null,
                city: "Dallas",
                state: "TX",
                postalCode: "75002",
                country: "USA",
            },
        ];

        workTypesList = [
            {
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "cat_1",
                name: "HVAC Maintenance",
                code: "HVAC-MAINT",
                status: "ACTIVE",
                estimatedDuration: 120,
                catalog: {
                    id: "cat_1",
                    status: "ACTIVE",
                },
            },
        ];

        assetsList = [
            {
                id: "ast_matched",
                workspaceId: WS_ID,
                assetNumber: "AST-000100",
                name: "Chiller Unit A",
                customerId: "cust_1",
                locationId: "loc_1",
                status: "OPERATIONAL",
            },
            {
                id: "ast_matched_2",
                workspaceId: WS_ID,
                assetNumber: "AST-000105",
                name: "Chiller Unit A2",
                customerId: "cust_1",
                locationId: "loc_1",
                status: "OPERATIONAL",
            },
            {
                id: "ast_diff_loc",
                workspaceId: WS_ID,
                assetNumber: "AST-000101",
                name: "Chiller Unit B",
                customerId: "cust_1",
                locationId: "loc_2", // Different location than loc_1
                status: "OPERATIONAL",
            },
            {
                id: "ast_diff_cust",
                workspaceId: WS_ID,
                assetNumber: "AST-000102",
                name: "Chiller Unit C",
                customerId: "cust_2", // Different customer than cust_1
                locationId: null,
                status: "OPERATIONAL",
            },
            {
                id: "ast_depot",
                workspaceId: WS_ID,
                assetNumber: "AST-000103",
                name: "Depot Standby Pump",
                customerId: null,
                locationId: null,
                status: "IN_STORAGE",
            },
            {
                id: "ast_retired",
                workspaceId: WS_ID,
                assetNumber: "AST-000104",
                name: "Scrapped Compressor",
                customerId: "cust_1",
                locationId: "loc_1",
                status: "RETIRED",
            },
            {
                id: "ast_beta",
                workspaceId: WS_ID_BETA,
                assetNumber: "AST-000999",
                name: "Beta Tenant Unit",
                customerId: "cust_beta",
                locationId: "loc_beta",
                status: "OPERATIONAL",
            },
        ];

        workOrdersList = [];
        workOrderHistoryList = [];

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
                    (l) => l.id === where.id && l.customerId === where.customerId
                ) || null
            );
        });

        mocks.workTypeFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                workTypesList.find(
                    (w) => w.id === where.id && w.workspaceId === where.workspaceId
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

        mocks.workOrderFindFirst.mockImplementation(async ({ where, select }: any) => {
            if (where.workOrderNumber?.startsWith) {
                const prefix = where.workOrderNumber.startsWith;
                const match = workOrdersList
                    .filter((w) => w.workspaceId === where.workspaceId && w.workOrderNumber.startsWith(prefix))
                    .sort((a, b) => b.workOrderNumber.localeCompare(a.workOrderNumber))[0];
                return match ? { workOrderNumber: match.workOrderNumber } : null;
            }
            const wo = workOrdersList.find((w) => w.id === where.id && w.workspaceId === where.workspaceId);
            if (!wo) return null;
            return {
                ...wo,
                customer: customersList.find((c) => c.id === wo.customerId)!,
                location: locationsList.find((l) => l.id === wo.locationId)!,
                workType: workTypesList.find((wt) => wt.id === wo.workTypeId)!,
            };
        });

        mocks.workOrderCreate.mockImplementation(async ({ data, include }: any) => {
            const wo = {
                id: `wo_${workOrdersList.length + 1}`,
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workOrdersList.push(wo);
            return {
                ...wo,
                customer: customersList.find((c) => c.id === wo.customerId)!,
                location: locationsList.find((l) => l.id === wo.locationId)!,
                workType: workTypesList.find((wt) => wt.id === wo.workTypeId)!,
            };
        });

        mocks.workOrderUpdate.mockImplementation(async ({ where, data }: any) => {
            const wo = workOrdersList.find((w) => w.id === where.id);
            if (!wo) throw new Error("Not found");
            Object.assign(wo, data);
            return {
                ...wo,
                customer: customersList.find((c) => c.id === wo.customerId)!,
                location: locationsList.find((l) => l.id === wo.locationId)!,
                workType: workTypesList.find((wt) => wt.id === wo.workTypeId)!,
            };
        });

        mocks.workOrderHistoryCreate.mockImplementation(async ({ data }: any) => {
            const hist = { id: `woh_${workOrderHistoryList.length + 1}`, ...data };
            workOrderHistoryList.push(hist);
            return hist;
        });

        mocks.workOrderCount.mockImplementation(async ({ where }: any) => {
            return workOrdersList.filter(
                (w) => w.workspaceId === where.workspaceId && (where.assetId ? w.assetId === where.assetId : true)
            ).length;
        });

        mocks.workOrderFindMany.mockImplementation(async ({ where }: any) => {
            return workOrdersList
                .filter(
                    (w) => w.workspaceId === where.workspaceId && (where.assetId ? w.assetId === where.assetId : true)
                )
                .map((wo) => ({
                    ...wo,
                    customer: customersList.find((c) => c.id === wo.customerId)!,
                    location: locationsList.find((l) => l.id === wo.locationId)!,
                    workType: workTypesList.find((wt) => wt.id === wo.workTypeId)!,
                }));
        });

        mocks.transaction.mockImplementation(async (callback: any) => {
            return callback({
                workOrder: {
                    findFirst: mocks.workOrderFindFirst,
                    create: mocks.workOrderCreate,
                    update: mocks.workOrderUpdate,
                },
                workOrderHistory: {
                    create: mocks.workOrderHistoryCreate,
                },
            });
        });
    });

    // -----------------------------------------------------------------------
    // 1. createWorkOrder with Asset Validation
    // -----------------------------------------------------------------------
    describe("1. createWorkOrder with Asset Integration", () => {
        it("creates a work order with a valid matching assetId", async () => {
            const result = await createWorkOrder(WS_ID, {
                customerId: "cust_1",
                locationId: "loc_1",
                workTypeId: "wt_1",
                assetId: "ast_matched",
                title: "Service Chiller Unit A",
                priority: "HIGH",
            });

            expect(result.assetId).toBe("ast_matched");
            expect(result.customerId).toBe("cust_1");
            expect(result.locationId).toBe("loc_1");
            expect(workOrdersList[0].assetId).toBe("ast_matched");
        });

        it("rejects assetId belonging to a different customer with WorkOrderAssetCustomerMismatchError", async () => {
            await expect(
                createWorkOrder(WS_ID, {
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "ast_diff_cust", // belongs to cust_2
                    title: "Cross customer asset test",
                })
            ).rejects.toThrow(WorkOrderAssetCustomerMismatchError);
        });

        it("rejects assetId located at a different location with WorkOrderAssetLocationMismatchError", async () => {
            await expect(
                createWorkOrder(WS_ID, {
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "ast_diff_loc", // located at loc_2
                    title: "Mismatched location asset test",
                })
            ).rejects.toThrow(WorkOrderAssetLocationMismatchError);
        });

        it("allows depot asset (customerId === null) to be assigned to any customer/location work order", async () => {
            const result = await createWorkOrder(WS_ID, {
                customerId: "cust_1",
                locationId: "loc_1",
                workTypeId: "wt_1",
                assetId: "ast_depot", // depot asset
                title: "Deploying standby pump to Site 1",
            });

            expect(result.assetId).toBe("ast_depot");
            expect(result.customerId).toBe("cust_1");
            expect(result.locationId).toBe("loc_1");
        });

        it("throws AssetNotFoundError if assetId does not exist", async () => {
            await expect(
                createWorkOrder(WS_ID, {
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "non_existent_asset",
                    title: "Missing asset test",
                })
            ).rejects.toThrow(AssetNotFoundError);
        });

        it("throws AssetNotFoundError if assetId belongs to another workspace (cross-tenant IDOR)", async () => {
            await expect(
                createWorkOrder(WS_ID, {
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "ast_beta", // belongs to WS_ID_BETA
                    title: "Cross tenant asset test",
                })
            ).rejects.toThrow(AssetNotFoundError);
        });

        it("throws AssetImmutableError if target asset is RETIRED", async () => {
            await expect(
                createWorkOrder(WS_ID, {
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "ast_retired", // RETIRED status
                    title: "Retired asset test",
                })
            ).rejects.toThrow(AssetImmutableError);
        });

        it("creates work order without assetId unchanged (non-asset regression check)", async () => {
            const result = await createWorkOrder(WS_ID, {
                customerId: "cust_1",
                locationId: "loc_1",
                workTypeId: "wt_1",
                title: "General Maintenance without specific asset",
            });

            expect(result.assetId).toBeNull();
            expect(result.customerId).toBe("cust_1");
            expect(result.locationId).toBe("loc_1");
        });
    });

    // -----------------------------------------------------------------------
    // 2. updateWorkOrder with Asset Validation & Mutability
    // -----------------------------------------------------------------------
    describe("2. updateWorkOrder with Asset Integration", () => {
        beforeEach(async () => {
            // Seed an initial work order
            await createWorkOrder(WS_ID, {
                customerId: "cust_1",
                locationId: "loc_1",
                workTypeId: "wt_1",
                title: "Initial Work Order",
            });
        });

        it("attaches a valid matching assetId to an existing work order", async () => {
            const updated = await updateWorkOrder(WS_ID, "wo_1", {
                assetId: "ast_matched",
            });

            expect(updated.assetId).toBe("ast_matched");
        });

        it("clears assetId on existing work order when assetId is null", async () => {
            workOrdersList[0].assetId = "ast_matched";

            const updated = await updateWorkOrder(WS_ID, "wo_1", {
                assetId: null,
            });

            expect(updated.assetId).toBeNull();
        });

        it("changes assetId from one valid asset to another valid matching asset", async () => {
            workOrdersList[0].assetId = "ast_matched";

            const updated = await updateWorkOrder(WS_ID, "wo_1", {
                assetId: "ast_matched_2",
            });

            expect(updated.assetId).toBe("ast_matched_2");
            expect(workOrdersList[0].assetId).toBe("ast_matched_2");
        });

        it("re-applies consistency validation when changing an already-populated assetId to an invalid asset", async () => {
            workOrdersList[0].assetId = "ast_matched";

            // Attempt change to asset belonging to a different customer
            await expect(
                updateWorkOrder(WS_ID, "wo_1", {
                    assetId: "ast_diff_cust",
                })
            ).rejects.toThrow(WorkOrderAssetCustomerMismatchError);

            // Attempt change to asset at a different location
            await expect(
                updateWorkOrder(WS_ID, "wo_1", {
                    assetId: "ast_diff_loc",
                })
            ).rejects.toThrow(WorkOrderAssetLocationMismatchError);

            // Attempt change to a retired asset
            await expect(
                updateWorkOrder(WS_ID, "wo_1", {
                    assetId: "ast_retired",
                })
            ).rejects.toThrow(AssetImmutableError);

            // Verify original assetId was not mutated on failure
            expect(workOrdersList[0].assetId).toBe("ast_matched");
        });

        it("rejects attaching an asset belonging to a different customer", async () => {
            await expect(
                updateWorkOrder(WS_ID, "wo_1", {
                    assetId: "ast_diff_cust",
                })
            ).rejects.toThrow(WorkOrderAssetCustomerMismatchError);
        });

        it("rejects attaching an asset located at a different location", async () => {
            await expect(
                updateWorkOrder(WS_ID, "wo_1", {
                    assetId: "ast_diff_loc",
                })
            ).rejects.toThrow(WorkOrderAssetLocationMismatchError);
        });

        it("rejects attaching a RETIRED asset to an existing work order", async () => {
            await expect(
                updateWorkOrder(WS_ID, "wo_1", {
                    assetId: "ast_retired",
                })
            ).rejects.toThrow(AssetImmutableError);
        });
    });

    // -----------------------------------------------------------------------
    // 3. getAssetWorkOrders Query Helper
    // -----------------------------------------------------------------------
    describe("3. getAssetWorkOrders Query Helper", () => {
        beforeEach(() => {
            workOrdersList = [
                {
                    id: "wo_asset_1",
                    workspaceId: WS_ID,
                    workOrderNumber: "WO-2026-000001",
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "ast_matched",
                    assignedTechnicianId: null,
                    workTypeName: "HVAC Maintenance",
                    workTypeCode: "HVAC-MAINT",
                    estimatedDuration: 120,
                    status: "OPEN",
                    priority: "MEDIUM",
                    title: "Chiller Inspection 1",
                    description: null,
                    internalNotes: null,
                    holdReason: null,
                    cancellationReason: null,
                    startedAt: null,
                    completedAt: null,
                    cancelledAt: null,
                    createdAt: new Date("2026-01-01"),
                    updatedAt: new Date("2026-01-01"),
                },
                {
                    id: "wo_asset_2",
                    workspaceId: WS_ID,
                    workOrderNumber: "WO-2026-000002",
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "ast_matched",
                    assignedTechnicianId: null,
                    workTypeName: "HVAC Maintenance",
                    workTypeCode: "HVAC-MAINT",
                    estimatedDuration: 120,
                    status: "COMPLETED",
                    priority: "HIGH",
                    title: "Chiller Repair 2",
                    description: null,
                    internalNotes: null,
                    holdReason: null,
                    cancellationReason: null,
                    startedAt: new Date("2026-01-02"),
                    completedAt: new Date("2026-01-02"),
                    cancelledAt: null,
                    createdAt: new Date("2026-01-02"),
                    updatedAt: new Date("2026-01-02"),
                },
                {
                    id: "wo_other_asset",
                    workspaceId: WS_ID,
                    workOrderNumber: "WO-2026-000003",
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    assetId: "ast_diff_loc",
                    assignedTechnicianId: null,
                    workTypeName: "HVAC Maintenance",
                    workTypeCode: "HVAC-MAINT",
                    estimatedDuration: 120,
                    status: "OPEN",
                    priority: "LOW",
                    title: "Different Asset WO",
                    description: null,
                    internalNotes: null,
                    holdReason: null,
                    cancellationReason: null,
                    startedAt: null,
                    completedAt: null,
                    cancelledAt: null,
                    createdAt: new Date("2026-01-03"),
                    updatedAt: new Date("2026-01-03"),
                },
            ];
        });

        it("returns paginated work orders associated with the specified asset", async () => {
            const result = await getAssetWorkOrders(WS_ID, "ast_matched");

            expect(result.pagination.total).toBe(2);
            expect(result.items).toHaveLength(2);
            expect(result.items[0].assetId).toBe("ast_matched");
            expect(result.items[1].assetId).toBe("ast_matched");
        });

        it("returns empty items when asset has no associated work orders", async () => {
            const result = await getAssetWorkOrders(WS_ID, "ast_depot");

            expect(result.pagination.total).toBe(0);
            expect(result.items).toHaveLength(0);
        });

        it("throws AssetNotFoundError if assetId does not exist", async () => {
            await expect(
                getAssetWorkOrders(WS_ID, "non_existent_asset")
            ).rejects.toThrow(AssetNotFoundError);
        });

        it("throws AssetNotFoundError for cross-tenant assetId lookup", async () => {
            await expect(
                getAssetWorkOrders(WS_ID, "ast_beta")
            ).rejects.toThrow(AssetNotFoundError);
        });
    });
});
