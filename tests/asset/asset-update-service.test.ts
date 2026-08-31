import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    assetCategoryFindFirst: vi.fn(),
    assetFindFirst: vi.fn(),
    assetUpdate: vi.fn(),
    assetHistoryCreate: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderCount: vi.fn(),
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
        assetCategory: {
            findFirst: mocks.assetCategoryFindFirst,
        },
        asset: {
            findFirst: mocks.assetFindFirst,
            update: mocks.assetUpdate,
        },
        assetHistory: {
            create: mocks.assetHistoryCreate,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            count: mocks.workOrderCount,
        },
        $transaction: mocks.transaction,
    },
}));

import { updateAsset } from "@/lib/services/asset/updateAsset";
import {
    AssetNotFoundError,
    AssetCategoryNotFoundError,
    AssetCategoryInactiveError,
    AssetImmutableError,
    AssetNumberLockedError,
    DuplicateAssetNumberError,
} from "@/lib/services/asset/assetErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import type {
    Asset,
    AssetCategory,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.5 — Asset Update Service Unit Tests", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let categoriesList: AssetCategory[];
    let assetsList: any[];
    let historyList: any[];

    const WS_ID = "ws_alpha_update";
    const WS_ID_BETA = "ws_beta_update";

    const USER_ADMIN: User = {
        id: "usr_admin_1",
        name: "Admin User",
        email: "admin@update.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_MANAGER: User = {
        id: "usr_manager_1",
        name: "Manager User",
        email: "manager@update.com",
        platformRole: null,
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
        email: "tech@update.com",
        platformRole: null,
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

    const MEMBER_MANAGER: WorkspaceMember = {
        id: "mem_mgr_1",
        workspaceId: WS_ID,
        userId: USER_MANAGER.id,
        role: "MANAGER",
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

    const makeAsset = (overrides: Partial<Asset> = {}): any => ({
        id: "ast_update_1",
        workspaceId: WS_ID,
        assetNumber: "AST-000100",
        name: "Main Rooftop Chiller",
        customerId: "cust_1",
        locationId: "loc_1",
        categoryId: "cat_1",
        manufacturer: "Carrier",
        modelNumber: "30RAP",
        serialNumber: "SN-CARRIER-001",
        status: "OPERATIONAL",
        subLocationNotes: "Roof Section B",
        installationDate: new Date("2025-01-01"),
        warrantyExpiresAt: new Date("2030-01-01"),
        purchaseDate: new Date("2024-12-01"),
        purchaseCost: "50000.00",
        notes: "Primary chiller",
        tags: ["critical", "rooftop"],
        metadata: { tonnage: 50 },
        decommissionedAt: null,
        retiredAt: null,
        customer: { id: "cust_1", customerNumber: "CUST-001", name: "Client Corp" },
        location: { id: "loc_1", name: "Plant 1", addressLine1: "100 Ave", city: "Dallas", state: "TX", latitude: null, longitude: null },
        category: { id: "cat_1", name: "Commercial HVAC", code: "HVAC" },
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_MANAGER.id, USER_MANAGER],
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

        membersMap = new Map([
            [`${WS_ID}_${USER_ADMIN.id}`, MEMBER_ADMIN],
            [`${WS_ID}_${USER_MANAGER.id}`, MEMBER_MANAGER],
            [`${WS_ID}_${USER_TECH.id}`, MEMBER_TECH],
        ]);

        categoriesList = [
            {
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Commercial HVAC",
                code: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "cat_2",
                workspaceId: WS_ID,
                name: "Generators",
                code: "GEN",
                description: null,
                status: "ACTIVE",
                sortOrder: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "cat_inactive",
                workspaceId: WS_ID,
                name: "Inactive Category",
                code: "INACT",
                description: null,
                status: "INACTIVE",
                sortOrder: 3,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "cat_beta",
                workspaceId: WS_ID_BETA,
                name: "Beta Category",
                code: "BC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        assetsList = [makeAsset()];
        historyList = [];

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

        mocks.assetCategoryFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                categoriesList.find(
                    (c) => c.id === where.id && c.workspaceId === where.workspaceId
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
            if (data.categoryId) {
                asset.category = categoriesList.find((c) => c.id === data.categoryId) || null;
            }
            return asset;
        });

        mocks.assetHistoryCreate.mockImplementation(async ({ data }: any) => {
            const row = { id: `hist_${historyList.length + 1}`, ...data };
            historyList.push(row);
            return row;
        });

        mocks.workOrderCount.mockResolvedValue(0);
        mocks.workOrderFindFirst.mockResolvedValue(null);

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

    it("1. updates mutable fields on active asset and captures diff in AssetHistory", async () => {
        const result = await updateAsset(WS_ID, "ast_update_1", {
            name: "Updated Rooftop Chiller Unit #1",
            manufacturer: "Trane",
            notes: "Annual coil cleaning performed",
            tags: ["critical", "updated-tag"],
            metadata: { tonnage: 55 },
        });

        expect(result.name).toBe("Updated Rooftop Chiller Unit #1");
        expect(result.manufacturer).toBe("Trane");
        expect(result.notes).toBe("Annual coil cleaning performed");

        // Verify history entry
        expect(historyList).toHaveLength(1);
        expect(historyList[0].eventType).toBe("UPDATED");
        expect(historyList[0].actorUserId).toBe(USER_ADMIN.id);
        expect(historyList[0].metadata.diff.name).toEqual({
            oldValue: "Main Rooftop Chiller",
            newValue: "Updated Rooftop Chiller Unit #1",
        });
    });

    it("2. rejects update on RETIRED asset with AssetImmutableError", async () => {
        assetsList[0].status = "RETIRED";

        await expect(
            updateAsset(WS_ID, "ast_update_1", {
                name: "Try Update Retired",
            })
        ).rejects.toThrow(AssetImmutableError);
    });

    it("3. allows OWNER/ADMIN to modify assetNumber when 0 work orders exist", async () => {
        mocks.workOrderCount.mockResolvedValue(0);

        const result = await updateAsset(WS_ID, "ast_update_1", {
            assetNumber: "AST-NEW-009",
        });

        expect(result.assetNumber).toBe("AST-NEW-009");
    });

    it("4. blocks assetNumber modification once historical WorkOrders exist", async () => {
        mocks.workOrderCount.mockResolvedValue(2); // 2 work orders reference this asset

        await expect(
            updateAsset(WS_ID, "ast_update_1", {
                assetNumber: "AST-NEW-009",
            })
        ).rejects.toThrow(AssetNumberLockedError);
    });

    it("5. blocks non-owner/non-admin roles from modifying assetNumber", async () => {
        mocks.auth.mockResolvedValue({
            user: { id: USER_MANAGER.id, email: USER_MANAGER.email },
        });

        await expect(
            updateAsset(WS_ID, "ast_update_1", {
                assetNumber: "AST-NEW-009",
            })
        ).rejects.toThrow(ForbiddenError);
    });

    it("6. validates updated categoryId (throws 404 if not found)", async () => {
        await expect(
            updateAsset(WS_ID, "ast_update_1", {
                categoryId: "cat_non_existent",
            })
        ).rejects.toThrow(AssetCategoryNotFoundError);
    });

    it("7. validates updated categoryId (throws 400 if category is inactive)", async () => {
        await expect(
            updateAsset(WS_ID, "ast_update_1", {
                categoryId: "cat_inactive",
            })
        ).rejects.toThrow(AssetCategoryInactiveError);
    });

    it("8. enforces TECHNICIAN scoping rule (allowed if assigned active work order)", async () => {
        mocks.auth.mockResolvedValue({
            user: { id: USER_TECH.id, email: USER_TECH.email },
        });

        // Simulate qualifying active work order assigned to this technician
        mocks.workOrderFindFirst.mockResolvedValue({
            id: "wo_qualifying_1",
            status: "IN_PROGRESS",
            assetId: "ast_update_1",
        });

        const result = await updateAsset(WS_ID, "ast_update_1", {
            notes: "Technician diagnostic notes added on site",
        });

        expect(result.notes).toBe("Technician diagnostic notes added on site");
    });

    it("9. enforces TECHNICIAN scoping rule (rejected with 403 if no active assigned work order)", async () => {
        mocks.auth.mockResolvedValue({
            user: { id: USER_TECH.id, email: USER_TECH.email },
        });

        mocks.workOrderFindFirst.mockResolvedValue(null); // No work order

        await expect(
            updateAsset(WS_ID, "ast_update_1", {
                notes: "Technician diagnostic notes added on site",
            })
        ).rejects.toThrow(ForbiddenError);
    });

    it("10. throws AssetNotFoundError for cross-tenant assetId (IDOR protection)", async () => {
        assetsList.push(makeAsset({ id: "ast_beta_1", workspaceId: WS_ID_BETA }));

        await expect(
            updateAsset(WS_ID, "ast_beta_1", {
                name: "Cross Tenant Update",
            })
        ).rejects.toThrow(AssetNotFoundError);
    });
});
