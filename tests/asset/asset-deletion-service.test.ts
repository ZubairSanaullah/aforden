import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    assetFindFirst: vi.fn(),
    assetDelete: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        workspace: { findUnique: mocks.workspaceFindUnique },
        workspaceMember: { findUnique: mocks.workspaceMemberFindUnique },
        asset: {
            findFirst: mocks.assetFindFirst,
            delete: mocks.assetDelete,
        },
    },
}));

import { deleteAsset } from "@/lib/services/asset/deleteAsset";
import {
    AssetNotFoundError,
    AssetDeletionNotAllowedError,
} from "@/lib/services/asset/assetErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type {
    Customer,
    ServiceLocation,
    AssetCategory,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.9 — Asset Deletion Service Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let assetsMap: Map<string, any>;

    const WS_ID = "ws_del_asset_1";
    const WS_ID_2 = "ws_del_asset_2";

    const USER_ADMIN: User = {
        id: "usr_adm_del",
        name: "Admin User",
        email: "admin@del.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_OWNER: User = {
        id: "usr_own_del",
        name: "Owner User",
        email: "owner@del.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_MGR: User = {
        id: "usr_mgr_del",
        name: "Manager User",
        email: "manager@del.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_DISPATCHER: User = {
        id: "usr_disp_del",
        name: "Dispatcher User",
        email: "dispatcher@del.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "usr_tech_del",
        name: "Tech User",
        email: "tech@del.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Alpha Deletion Corp",
        slug: "alpha-del",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_del",
        userId: USER_ADMIN.id,
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_OWNER: WorkspaceMember = {
        id: "mem_own_del",
        userId: USER_OWNER.id,
        workspaceId: WS_ID,
        role: "OWNER",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_MGR: WorkspaceMember = {
        id: "mem_mgr_del",
        userId: USER_MGR.id,
        workspaceId: WS_ID,
        role: "MANAGER",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_DISPATCHER: WorkspaceMember = {
        id: "mem_disp_del",
        userId: USER_DISPATCHER.id,
        workspaceId: WS_ID,
        role: "DISPATCHER",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_del",
        userId: USER_TECH.id,
        workspaceId: WS_ID,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_del_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-000001",
        name: "Apex Logistics",
        email: "apex@del.com",
        phone: "+1-555-0101",
        website: null,
        addressLine1: "101 Apex Blvd",
        addressLine2: null,
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_LOCATION: ServiceLocation = {
        id: "loc_del_1",
        customerId: FIXTURE_CUSTOMER.id,
        name: "Apex Plant A",
        addressLine1: "101 Apex Blvd",
        addressLine2: null,
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
        latitude: null,
        longitude: null,
        notes: null,
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CATEGORY: AssetCategory = {
        id: "cat_del_1",
        workspaceId: WS_ID,
        name: "Commercial HVAC",
        code: "HVAC-COMM",
        description: "Heavy cooling",
        status: "ACTIVE",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_OWNER.id, USER_OWNER],
            [USER_MGR.id, USER_MGR],
            [USER_DISPATCHER.id, USER_DISPATCHER],
            [USER_TECH.id, USER_TECH],
        ]);

        workspacesMap = new Map([[WS_ID, WS_ALPHA]]);

        membersMap = new Map([
            [`${USER_ADMIN.id}_${WS_ID}`, MEMBER_ADMIN],
            [`${USER_OWNER.id}_${WS_ID}`, MEMBER_OWNER],
            [`${USER_MGR.id}_${WS_ID}`, MEMBER_MGR],
            [`${USER_DISPATCHER.id}_${WS_ID}`, MEMBER_DISPATCHER],
            [`${USER_TECH.id}_${WS_ID}`, MEMBER_TECH],
        ]);

        assetsMap = new Map();

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
            if (where.userId_workspaceId) {
                const key = `${where.userId_workspaceId.userId}_${where.userId_workspaceId.workspaceId}`;
                return membersMap.get(key) || null;
            }
            if (where.id) return membersMap.get(where.id) || null;
            return null;
        });

        mocks.assetFindFirst.mockImplementation(async ({ where }: any) => {
            const found = assetsMap.get(where.id);
            if (!found) return null;
            if (where.workspaceId && found.workspaceId !== where.workspaceId) return null;
            return {
                ...found,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                category: FIXTURE_CATEGORY,
                _count: {
                    workOrders: found.workOrdersCount ?? 0,
                },
            };
        });

        mocks.assetDelete.mockImplementation(async ({ where }: any) => {
            const found = assetsMap.get(where.id);
            if (!found) {
                const err: any = new Error("Record to delete does not exist.");
                err.code = "P2025";
                throw err;
            }
            assetsMap.delete(where.id);
            return found;
        });
    });

    function seedAsset(overrides: Partial<any> = {}): any {
        const id = `ast_del_${assetsMap.size + 1}`;
        const asset = {
            id,
            workspaceId: WS_ID,
            assetNumber: `AST-00000${assetsMap.size + 1}`,
            name: `Test Asset ${assetsMap.size + 1}`,
            status: "OPERATIONAL",
            manufacturer: "Carrier",
            modelNumber: "MOD-100",
            serialNumber: "SN-100",
            subLocationNotes: "Rooftop",
            installationDate: new Date("2026-01-01"),
            warrantyExpiresAt: new Date("2028-01-01"),
            purchaseDate: new Date("2025-12-01"),
            purchaseCost: 20000,
            notes: "Draft asset",
            tags: ["critical-infrastructure"],
            metadata: { tonnage: 5 },
            customerId: FIXTURE_CUSTOMER.id,
            locationId: FIXTURE_LOCATION.id,
            categoryId: FIXTURE_CATEGORY.id,
            workOrdersCount: 0,
            decommissionedAt: null,
            retiredAt: null,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
            ...overrides,
        };
        assetsMap.set(id, asset);
        return asset;
    }

    describe("1. Successful Deletion & Canonical Read Model Return", () => {
        it("successfully deletes an unreferenced asset (0 work orders) and returns AssetDetailViewModel", async () => {
            const ast = seedAsset({
                name: "Draft Unreferenced Asset",
                purchaseCost: 15000,
            });

            const deleted = await deleteAsset(WS_ID, ast.id);

            expect(deleted.id).toBe(ast.id);
            expect(deleted.name).toBe("Draft Unreferenced Asset");
            expect(deleted.customer?.id).toBe(FIXTURE_CUSTOMER.id);
            expect(deleted.location?.id).toBe(FIXTURE_LOCATION.id);
            expect(deleted.category?.id).toBe(FIXTURE_CATEGORY.id);
            expect(deleted.purchaseCost).toBe(15000);

            expect(mocks.assetDelete).toHaveBeenCalledTimes(1);
            expect(mocks.assetDelete).toHaveBeenCalledWith({
                where: { id: ast.id },
            });
            expect(assetsMap.has(ast.id)).toBe(false);
        });

        it("allows OWNER to delete an unreferenced asset", async () => {
            const ast = seedAsset();
            mocks.auth.mockResolvedValue({
                user: { id: USER_OWNER.id, email: USER_OWNER.email },
            });

            const deleted = await deleteAsset(WS_ID, ast.id);
            expect(deleted.id).toBe(ast.id);
        });
    });

    describe("2. WorkOrder Reference Invariant Enforcement", () => {
        it("blocks deletion when asset has 1 or more WorkOrders (pre-check path throws 409 AssetDeletionNotAllowedError)", async () => {
            const ast = seedAsset({
                name: "Operational Asset with WorkOrders",
                workOrdersCount: 3,
            });

            await expect(deleteAsset(WS_ID, ast.id)).rejects.toThrow(
                AssetDeletionNotAllowedError,
            );

            // Verify delete query was never called due to pre-check
            expect(mocks.assetDelete).not.toHaveBeenCalled();
            expect(assetsMap.has(ast.id)).toBe(true);
        });

        it("translates PostgreSQL P2003 foreign key violation to AssetDeletionNotAllowedError (fallback defense)", async () => {
            const ast = seedAsset({
                workOrdersCount: 0, // Pre-check passes
            });

            // Simulate database race condition: delete throws P2003
            mocks.assetDelete.mockImplementationOnce(async () => {
                const err: any = new Error("Foreign key constraint failed on the field: `work_orders_assetId_fkey`");
                err.code = "P2003";
                throw err;
            });

            await expect(deleteAsset(WS_ID, ast.id)).rejects.toThrow(
                AssetDeletionNotAllowedError,
            );
        });
    });

    describe("3. Lifecycle Status Deletion-Eligibility Invariant", () => {
        it("allows deleting an unreferenced RETIRED asset with 0 WorkOrders (e.g. mistakenly retired entry)", async () => {
            const ast = seedAsset({
                status: "RETIRED",
                retiredAt: new Date(),
                workOrdersCount: 0,
            });

            const deleted = await deleteAsset(WS_ID, ast.id);
            expect(deleted.id).toBe(ast.id);
            expect(deleted.status).toBe("RETIRED");
        });

        it("allows deleting an unreferenced DECOMMISSIONED asset with 0 WorkOrders", async () => {
            const ast = seedAsset({
                status: "DECOMMISSIONED",
                decommissionedAt: new Date(),
                workOrdersCount: 0,
            });

            const deleted = await deleteAsset(WS_ID, ast.id);
            expect(deleted.id).toBe(ast.id);
            expect(deleted.status).toBe("DECOMMISSIONED");
        });

        it("allows deleting an unreferenced IN_STORAGE depot asset with 0 WorkOrders", async () => {
            const ast = seedAsset({
                status: "IN_STORAGE",
                customerId: null,
                locationId: null,
                workOrdersCount: 0,
            });

            const deleted = await deleteAsset(WS_ID, ast.id);
            expect(deleted.id).toBe(ast.id);
            expect(deleted.status).toBe("IN_STORAGE");
        });
    });

    describe("4. Role-Based Access Control (RBAC) Gating", () => {
        it("rejects MANAGER role with ForbiddenError (403)", async () => {
            const ast = seedAsset();
            mocks.auth.mockResolvedValue({
                user: { id: USER_MGR.id, email: USER_MGR.email },
            });

            await expect(deleteAsset(WS_ID, ast.id)).rejects.toThrow(ForbiddenError);
            expect(mocks.assetDelete).not.toHaveBeenCalled();
        });

        it("rejects DISPATCHER role with ForbiddenError (403)", async () => {
            const ast = seedAsset();
            mocks.auth.mockResolvedValue({
                user: { id: USER_DISPATCHER.id, email: USER_DISPATCHER.email },
            });

            await expect(deleteAsset(WS_ID, ast.id)).rejects.toThrow(ForbiddenError);
            expect(mocks.assetDelete).not.toHaveBeenCalled();
        });

        it("rejects TECHNICIAN role with ForbiddenError (403)", async () => {
            const ast = seedAsset();
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(deleteAsset(WS_ID, ast.id)).rejects.toThrow(ForbiddenError);
            expect(mocks.assetDelete).not.toHaveBeenCalled();
        });
    });

    describe("5. Multi-Tenant Isolation & Error Boundaries", () => {
        it("throws AssetNotFoundError (404) for non-existent asset ID", async () => {
            await expect(deleteAsset(WS_ID, "ast_nonexistent_999")).rejects.toThrow(
                AssetNotFoundError,
            );
        });

        it("throws AssetNotFoundError (404) for cross-tenant IDOR deletion attempt", async () => {
            const crossTenantAsset = seedAsset({
                workspaceId: WS_ID_2,
            });

            await expect(deleteAsset(WS_ID, crossTenantAsset.id)).rejects.toThrow(
                AssetNotFoundError,
            );
            expect(assetsMap.has(crossTenantAsset.id)).toBe(true);
        });

        it("throws AssetNotFoundError (404) for empty asset ID string", async () => {
            await expect(deleteAsset(WS_ID, "   ")).rejects.toThrow(AssetNotFoundError);
        });
    });
});
