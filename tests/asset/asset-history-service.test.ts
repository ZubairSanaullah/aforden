import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    workOrderFindFirst: vi.fn(),
    assetFindFirst: vi.fn(),
    assetHistoryFindMany: vi.fn(),
    assetHistoryCount: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        workspace: { findUnique: mocks.workspaceFindUnique },
        workspaceMember: { findUnique: mocks.workspaceMemberFindUnique },
        technicianProfile: { findFirst: mocks.technicianProfileFindFirst },
        workOrder: { findFirst: mocks.workOrderFindFirst },
        asset: { findFirst: mocks.assetFindFirst },
        assetHistory: {
            findMany: mocks.assetHistoryFindMany,
            count: mocks.assetHistoryCount,
        },
    },
}));

import {
    getAssetHistory,
    toAssetHistoryReadModel,
} from "@/lib/services/asset/getAssetHistory";
import { AssetNotFoundError } from "@/lib/services/asset/assetErrors";
import type {
    AssetHistoryEventType,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.10 — Asset Operational History & Audit Ledger Service Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let assetsMap: Map<string, any>;
    let historyList: any[];

    const WS_ID = "ws_hist_1";
    const WS_ID_2 = "ws_hist_2";

    const USER_ADMIN: User = {
        id: "usr_adm_hist",
        name: "Admin Audit User",
        email: "admin@audit.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "usr_tech_hist",
        name: "Tech Audit User",
        email: "tech@audit.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Alpha Equipment Corp",
        slug: "alpha-eq",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_hist",
        userId: USER_ADMIN.id,
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_hist",
        userId: USER_TECH.id,
        workspaceId: WS_ID,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_ASSET = {
        id: "ast_hist_1",
        workspaceId: WS_ID,
        assetNumber: "AST-000001",
        name: "Primary Chiller #1",
        status: "OPERATIONAL",
        customerId: "cust_1",
        locationId: "loc_1",
        categoryId: "cat_1",
        createdAt: new Date("2026-01-01T08:00:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_TECH.id, USER_TECH],
        ]);

        workspacesMap = new Map([[WS_ID, WS_ALPHA]]);

        membersMap = new Map([
            [`${USER_ADMIN.id}_${WS_ID}`, MEMBER_ADMIN],
            [`${USER_TECH.id}_${WS_ID}`, MEMBER_TECH],
        ]);

        assetsMap = new Map([[FIXTURE_ASSET.id, FIXTURE_ASSET]]);
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
            return found;
        });

        mocks.technicianProfileFindFirst.mockImplementation(async () => {
            return { id: "tech_prof_1", employeeId: "emp_1" };
        });

        mocks.workOrderFindFirst.mockImplementation(async () => null);

        function filterHistory(where: any) {
            return historyList.filter((item) => {
                if (where.workspaceId && item.workspaceId !== where.workspaceId) return false;
                if (where.assetId && item.assetId !== where.assetId) return false;
                if (where.eventType) {
                    if (where.eventType.in && Array.isArray(where.eventType.in)) {
                        if (!where.eventType.in.includes(item.eventType)) return false;
                    } else if (item.eventType !== where.eventType) {
                        return false;
                    }
                }
                return true;
            });
        }

        mocks.assetHistoryFindMany.mockImplementation(async ({ where, orderBy, skip = 0, take = 20 }: any) => {
            const filtered = filterHistory(where);
            // Default sort: createdAt desc
            filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            const paged = filtered.slice(skip, skip + take);
            return paged.map((entry) => ({
                ...entry,
                actorUser: entry.actorUserId ? usersMap.get(entry.actorUserId) ?? null : null,
            }));
        });

        mocks.assetHistoryCount.mockImplementation(async ({ where }: any) => {
            const filtered = filterHistory(where);
            return filtered.length;
        });
    });

    function seedHistoryEntry(overrides: Partial<any> = {}): any {
        const id = `ah_${historyList.length + 1}`;
        const entry = {
            id,
            workspaceId: WS_ID,
            assetId: FIXTURE_ASSET.id,
            eventType: "CREATED" as AssetHistoryEventType,
            actorUserId: USER_ADMIN.id,
            actorRole: "ADMIN",
            reason: "Initial registration",
            metadata: { name: FIXTURE_ASSET.name },
            createdAt: new Date(Date.now() - (10 - historyList.length) * 60000),
            ...overrides,
        };
        historyList.push(entry);
        return entry;
    }

    describe("1. Paginated Timeline Retrieval & Ordering", () => {
        it("retrieves history records ordered by createdAt descending by default", async () => {
            const e1 = seedHistoryEntry({
                eventType: "CREATED",
                createdAt: new Date("2026-01-01T10:00:00Z"),
            });
            const e2 = seedHistoryEntry({
                eventType: "LOCATION_TRANSFERRED",
                createdAt: new Date("2026-01-02T12:00:00Z"),
            });
            const e3 = seedHistoryEntry({
                eventType: "STATUS_CHANGED",
                createdAt: new Date("2026-01-03T15:00:00Z"),
            });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id);

            expect(result.items.length).toBe(3);
            expect(result.items[0].id).toBe(e3.id);
            expect(result.items[1].id).toBe(e2.id);
            expect(result.items[2].id).toBe(e1.id);
            expect(result.pagination.total).toBe(3);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.pageSize).toBe(20);
            expect(result.pagination.totalPages).toBe(1);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("supports custom page and pageSize pagination", async () => {
            for (let i = 0; i < 5; i++) {
                seedHistoryEntry({
                    eventType: "STATUS_CHANGED",
                    createdAt: new Date(`2026-01-0${i + 1}T10:00:00Z`),
                });
            }

            const page1 = await getAssetHistory(WS_ID, FIXTURE_ASSET.id, {
                page: 1,
                pageSize: 2,
            });

            expect(page1.items.length).toBe(2);
            expect(page1.pagination.total).toBe(5);
            expect(page1.pagination.totalPages).toBe(3);
            expect(page1.pagination.hasNextPage).toBe(true);
            expect(page1.pagination.hasPreviousPage).toBe(false);

            const page2 = await getAssetHistory(WS_ID, FIXTURE_ASSET.id, {
                page: 2,
                pageSize: 2,
            });

            expect(page2.items.length).toBe(2);
            expect(page2.pagination.page).toBe(2);
            expect(page2.pagination.hasNextPage).toBe(true);
            expect(page2.pagination.hasPreviousPage).toBe(true);
        });
    });

    describe("2. Filtering by EventType", () => {
        it("filters history by a single eventType", async () => {
            seedHistoryEntry({ eventType: "CREATED" });
            seedHistoryEntry({ eventType: "STATUS_CHANGED" });
            seedHistoryEntry({ eventType: "STATUS_CHANGED" });
            seedHistoryEntry({ eventType: "LOCATION_TRANSFERRED" });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id, {
                eventType: "STATUS_CHANGED",
            });

            expect(result.items.length).toBe(2);
            expect(result.items.every((i) => i.eventType === "STATUS_CHANGED")).toBe(true);
            expect(result.pagination.total).toBe(2);
        });

        it("filters history by an array of eventTypes", async () => {
            seedHistoryEntry({ eventType: "CREATED" });
            seedHistoryEntry({ eventType: "STATUS_CHANGED" });
            seedHistoryEntry({ eventType: "DECOMMISSIONED" });
            seedHistoryEntry({ eventType: "LOCATION_TRANSFERRED" });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id, {
                eventType: ["STATUS_CHANGED", "DECOMMISSIONED"],
            });

            expect(result.items.length).toBe(2);
            expect(
                result.items.every(
                    (i) => i.eventType === "STATUS_CHANGED" || i.eventType === "DECOMMISSIONED",
                ),
            ).toBe(true);
        });

        it("filters history by a comma-separated eventType string", async () => {
            seedHistoryEntry({ eventType: "CREATED" });
            seedHistoryEntry({ eventType: "LOCATION_TRANSFERRED" });
            seedHistoryEntry({ eventType: "OWNERSHIP_TRANSFERRED" });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id, {
                eventType: "LOCATION_TRANSFERRED,OWNERSHIP_TRANSFERRED",
            });

            expect(result.items.length).toBe(2);
            expect(
                result.items.every(
                    (i) =>
                        i.eventType === "LOCATION_TRANSFERRED" ||
                        i.eventType === "OWNERSHIP_TRANSFERRED",
                ),
            ).toBe(true);
        });
    });

    describe("3. Actor Summary Resolution & Deleted User Graceful Handling", () => {
        it("resolves active actor User display info into actor and actorName", async () => {
            seedHistoryEntry({
                actorUserId: USER_ADMIN.id,
            });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id);
            expect(result.items.length).toBe(1);

            const entry = result.items[0];
            expect(entry.actorUserId).toBe(USER_ADMIN.id);
            expect(entry.actorName).toBe(USER_ADMIN.name);
            expect(entry.actor).toEqual({
                id: USER_ADMIN.id,
                name: USER_ADMIN.name,
                email: USER_ADMIN.email,
            });
        });

        it("gracefully handles null actorUserId (deleted user per SetNull FK) with Deleted User placeholder", async () => {
            seedHistoryEntry({
                actorUserId: null,
            });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id);
            expect(result.items.length).toBe(1);

            const entry = result.items[0];
            expect(entry.actorUserId).toBeNull();
            expect(entry.actorName).toBe("Deleted User");
            expect(entry.actor).toEqual({
                id: null,
                name: "Deleted User",
                email: null,
            });
        });

        it("toAssetHistoryReadModel unit test verifies actor projection mapping", () => {
            const withActor = toAssetHistoryReadModel({
                id: "ah_1",
                workspaceId: WS_ID,
                assetId: FIXTURE_ASSET.id,
                eventType: "CREATED",
                actorUserId: "usr_1",
                actorRole: "ADMIN",
                reason: "Init",
                metadata: { key: "val" },
                createdAt: new Date("2026-01-01"),
                actorUser: { id: "usr_1", name: "John Doe", email: "john@example.com" },
            });

            expect(withActor.actorName).toBe("John Doe");
            expect(withActor.actor?.id).toBe("usr_1");

            const withoutActor = toAssetHistoryReadModel({
                id: "ah_2",
                workspaceId: WS_ID,
                assetId: FIXTURE_ASSET.id,
                eventType: "STATUS_CHANGED",
                actorUserId: null,
                actorRole: "ADMIN",
                reason: "Null user test",
                metadata: null,
                createdAt: new Date("2026-01-02"),
                actorUser: null,
            });

            expect(withoutActor.actorName).toBe("Deleted User");
            expect(withoutActor.actor).toEqual({
                id: null,
                name: "Deleted User",
                email: null,
            });
        });
    });

    describe("4. Technician Role Scoping (Consistent with getAsset 1.7.8)", () => {
        it("allows TECHNICIAN to view history when assigned to active WorkOrder on the asset", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            seedHistoryEntry({ eventType: "CREATED" });

            // Assign technician to active WorkOrder on FIXTURE_ASSET.id
            mocks.workOrderFindFirst.mockResolvedValueOnce({
                id: "wo_1",
                assetId: FIXTURE_ASSET.id,
                assignedTechnicianId: "tech_prof_1",
                status: "ASSIGNED",
            });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id);
            expect(result.items.length).toBe(1);
        });

        it("allows TECHNICIAN to view history when assigned to active WorkOrder on the asset's location", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            seedHistoryEntry({ eventType: "CREATED" });

            // Assign technician to active WorkOrder at location
            mocks.workOrderFindFirst.mockResolvedValueOnce({
                id: "wo_2",
                locationId: FIXTURE_ASSET.locationId,
                assignedTechnicianId: "tech_prof_1",
                status: "IN_PROGRESS",
            });

            const result = await getAssetHistory(WS_ID, FIXTURE_ASSET.id);
            expect(result.items.length).toBe(1);
        });

        it("denies TECHNICIAN (throws 404 AssetNotFoundError) when not assigned to any active WorkOrder for the asset or location", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            seedHistoryEntry({ eventType: "CREATED" });

            // No active assignment
            mocks.workOrderFindFirst.mockResolvedValueOnce(null);

            await expect(getAssetHistory(WS_ID, FIXTURE_ASSET.id)).rejects.toThrow(
                AssetNotFoundError,
            );
        });
    });

    describe("5. Multi-Tenant Isolation & Error Handling", () => {
        it("throws AssetNotFoundError (404) for non-existent asset ID", async () => {
            await expect(getAssetHistory(WS_ID, "ast_nonexistent_999")).rejects.toThrow(
                AssetNotFoundError,
            );
        });

        it("throws AssetNotFoundError (404) for cross-tenant IDOR history retrieval", async () => {
            const crossTenantAsset = {
                id: "ast_cross_1",
                workspaceId: WS_ID_2,
                assetNumber: "AST-CROSS-01",
                name: "Cross Tenant Asset",
            };
            assetsMap.set(crossTenantAsset.id, crossTenantAsset);

            await expect(getAssetHistory(WS_ID, crossTenantAsset.id)).rejects.toThrow(
                AssetNotFoundError,
            );
        });
    });
});
