import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    assetFindFirst: vi.fn(),
    assetFindMany: vi.fn(),
    assetCount: vi.fn(),
    assetGroupBy: vi.fn(),
    assetCategoryFindMany: vi.fn(),
    workOrderFindMany: vi.fn(),
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
            findMany: mocks.assetFindMany,
            count: mocks.assetCount,
            groupBy: mocks.assetGroupBy,
        },
        assetCategory: {
            findMany: mocks.assetCategoryFindMany,
        },
        workOrder: {
            findMany: mocks.workOrderFindMany,
        },
    },
}));

import { getAsset } from "@/lib/services/asset/getAsset";
import { getAssets, listAssets } from "@/lib/services/asset/getAssets";
import { getAssetOperationalSummary } from "@/lib/services/asset/getAssetOperationalSummary";
import { AssetNotFoundError } from "@/lib/services/asset/assetErrors";
import { ForbiddenError, UnauthorizedError } from "@/lib/services/authorization/authorizationErrors";
import { ZodError } from "zod";
import type {
    Customer,
    ServiceLocation,
    AssetCategory,
    User,
    Workspace,
    WorkspaceMember,
    Asset,
} from "@/generated/prisma/client";

describe("Phase 1.7.8 — Asset Directory & Query Architecture Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let assetsList: any[];
    let categoriesList: AssetCategory[];
    let activeWorkOrdersMap: Map<string, { assetId?: string | null; locationId?: string | null; status: string }>;

    const WS_ID = "ws_asset_query_1";
    const WS_ID_2 = "ws_asset_query_2";

    const USER_ADMIN: User = {
        id: "usr_adm_asset_query",
        name: "Admin Asset Query",
        email: "admin@assetquery.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "usr_tech_asset_query",
        name: "Tech Asset Query",
        email: "tech@assetquery.com",
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
        slug: "alpha-equipment",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_asset_query",
        userId: USER_ADMIN.id,
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_asset_query",
        userId: USER_TECH.id,
        workspaceId: WS_ID,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_asset_query_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-000101",
        name: "Apex Logistics",
        email: "apex@logistics.com",
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

    const FIXTURE_CUSTOMER_2: Customer = {
        id: "cust_asset_query_2",
        workspaceId: WS_ID,
        customerNumber: "CUST-000102",
        name: "Beacon Hospitality",
        email: "beacon@hotels.com",
        phone: "+1-555-0102",
        website: null,
        addressLine1: "202 Beacon Way",
        addressLine2: null,
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        country: "US",
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_LOCATION: ServiceLocation = {
        id: "loc_asset_query_1",
        customerId: FIXTURE_CUSTOMER.id,
        name: "Apex HQ Rooftop",
        addressLine1: "101 Apex Blvd",
        addressLine2: "Rooftop Zone B",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
        latitude: 30.2672 as any,
        longitude: -97.7431 as any,
        notes: null,
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_LOCATION_2: ServiceLocation = {
        id: "loc_asset_query_2",
        customerId: FIXTURE_CUSTOMER_2.id,
        name: "Beacon Tower Basement",
        addressLine1: "202 Beacon Way",
        addressLine2: "Plant Room 1",
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        country: "US",
        latitude: 32.7767 as any,
        longitude: -96.7970 as any,
        notes: null,
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CATEGORY_HVAC: AssetCategory = {
        id: "cat_hvac_1",
        workspaceId: WS_ID,
        name: "Commercial HVAC",
        code: "HVAC-COMM",
        description: "Heavy commercial heating and cooling",
        status: "ACTIVE",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CATEGORY_GEN: AssetCategory = {
        id: "cat_gen_1",
        workspaceId: WS_ID,
        name: "Emergency Generators",
        code: "GEN-PWR",
        description: "Diesel and natural gas backup power systems",
        status: "ACTIVE",
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
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

        assetsList = [];
        categoriesList = [FIXTURE_CATEGORY_HVAC, FIXTURE_CATEGORY_GEN];
        activeWorkOrdersMap = new Map();

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
            const found = assetsList.find((ast) => {
                if (where.id && ast.id !== where.id) return false;
                if (where.workspaceId && ast.workspaceId !== where.workspaceId) return false;
                if (where.OR && Array.isArray(where.OR)) {
                    // Technician scoping check
                    const matchesTech = where.OR.some((clause: any) => {
                        if (clause.workOrders?.some) {
                            const wo = activeWorkOrdersMap.get(ast.id);
                            return wo && ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status);
                        }
                        if (clause.location?.workOrders?.some) {
                            if (!ast.locationId) return false;
                            const wo = activeWorkOrdersMap.get(ast.locationId);
                            return wo && ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status);
                        }
                        return false;
                    });
                    if (!matchesTech) return false;
                }
                return true;
            });

            if (!found) return null;

            return {
                ...found,
                customer:
                    found.customerId === FIXTURE_CUSTOMER_2.id
                        ? FIXTURE_CUSTOMER_2
                        : found.customerId === FIXTURE_CUSTOMER.id
                          ? FIXTURE_CUSTOMER
                          : null,
                location:
                    found.locationId === FIXTURE_LOCATION_2.id
                        ? FIXTURE_LOCATION_2
                        : found.locationId === FIXTURE_LOCATION.id
                          ? FIXTURE_LOCATION
                          : null,
                category:
                    found.categoryId === FIXTURE_CATEGORY_GEN.id
                        ? FIXTURE_CATEGORY_GEN
                        : found.categoryId === FIXTURE_CATEGORY_HVAC.id
                          ? FIXTURE_CATEGORY_HVAC
                          : null,
            };
        });

        function filterAssets(where: any) {
            return assetsList.filter((ast) => {
                const clauses = where.AND ? where.AND : [where];
                for (const clause of clauses) {
                    if (clause.workspaceId && ast.workspaceId !== clause.workspaceId) return false;
                    if (clause.status && ast.status !== clause.status) return false;
                    if (clause.customerId && ast.customerId !== clause.customerId) return false;
                    if (clause.locationId && ast.locationId !== clause.locationId) return false;
                    if (clause.categoryId && ast.categoryId !== clause.categoryId) return false;
                    if (clause.categoryId === null && ast.categoryId !== null) return false;
                    if (clause.manufacturer?.contains) {
                        if (!ast.manufacturer) return false;
                        if (!ast.manufacturer.toLowerCase().includes(clause.manufacturer.contains.toLowerCase())) return false;
                    }
                    if (clause.tags?.hasSome && Array.isArray(clause.tags.hasSome)) {
                        const hasTag = clause.tags.hasSome.some((t: string) => ast.tags.includes(t));
                        if (!hasTag) return false;
                    }
                    if (clause.tags?.has && typeof clause.tags.has === "string") {
                        if (!ast.tags || !ast.tags.includes(clause.tags.has)) return false;
                    }
                    if (clause.OR && Array.isArray(clause.OR)) {
                        const matchesOr = clause.OR.some((orClause: any) => {
                            // Technician scoping branch
                            if (orClause.workOrders?.some) {
                                const wo = activeWorkOrdersMap.get(ast.id);
                                return wo && ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status);
                            }
                            if (orClause.location?.workOrders?.some) {
                                if (!ast.locationId) return false;
                                const wo = activeWorkOrdersMap.get(ast.locationId);
                                return wo && ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status);
                            }
                            // Search branch
                            if (orClause.assetNumber?.contains) {
                                return ast.assetNumber.toLowerCase().includes(orClause.assetNumber.contains.toLowerCase());
                            }
                            if (orClause.name?.contains) {
                                return ast.name.toLowerCase().includes(orClause.name.contains.toLowerCase());
                            }
                            if (orClause.serialNumber?.contains && ast.serialNumber) {
                                return ast.serialNumber.toLowerCase().includes(orClause.serialNumber.contains.toLowerCase());
                            }
                            if (orClause.modelNumber?.contains && ast.modelNumber) {
                                return ast.modelNumber.toLowerCase().includes(orClause.modelNumber.contains.toLowerCase());
                            }
                            if (orClause.manufacturer?.contains && ast.manufacturer) {
                                return ast.manufacturer.toLowerCase().includes(orClause.manufacturer.contains.toLowerCase());
                            }
                            if (orClause.customer?.name?.contains) {
                                const cust = ast.customerId === FIXTURE_CUSTOMER_2.id ? FIXTURE_CUSTOMER_2 : ast.customerId === FIXTURE_CUSTOMER.id ? FIXTURE_CUSTOMER : null;
                                return cust?.name.toLowerCase().includes(orClause.customer.name.contains.toLowerCase());
                            }
                            if (orClause.location?.name?.contains) {
                                const loc = ast.locationId === FIXTURE_LOCATION_2.id ? FIXTURE_LOCATION_2 : ast.locationId === FIXTURE_LOCATION.id ? FIXTURE_LOCATION : null;
                                return loc?.name.toLowerCase().includes(orClause.location.name.contains.toLowerCase());
                            }
                            return false;
                        });
                        if (!matchesOr) return false;
                    }
                }
                return true;
            });
        }

        mocks.assetFindMany.mockImplementation(async ({ where, orderBy, skip = 0, take = 20 }: any) => {
            let filtered = filterAssets(where);

            // Sorting
            if (orderBy && Array.isArray(orderBy)) {
                filtered.sort((a, b) => {
                    for (const sortObj of orderBy) {
                        const [key, direction] = Object.entries(sortObj)[0];
                        const valA = (a as any)[key];
                        const valB = (b as any)[key];
                        if (valA === valB) continue;
                        if (valA === null || valA === undefined) return 1;
                        if (valB === null || valB === undefined) return -1;
                        if (direction === "asc") {
                            return valA > valB ? 1 : -1;
                        } else {
                            return valA < valB ? 1 : -1;
                        }
                    }
                    return 0;
                });
            }

            const paged = filtered.slice(skip, skip + take);
            return paged.map((ast) => ({
                ...ast,
                customer:
                    ast.customerId === FIXTURE_CUSTOMER_2.id
                        ? FIXTURE_CUSTOMER_2
                        : ast.customerId === FIXTURE_CUSTOMER.id
                          ? FIXTURE_CUSTOMER
                          : null,
                location:
                    ast.locationId === FIXTURE_LOCATION_2.id
                        ? FIXTURE_LOCATION_2
                        : ast.locationId === FIXTURE_LOCATION.id
                          ? FIXTURE_LOCATION
                          : null,
                category:
                    ast.categoryId === FIXTURE_CATEGORY_GEN.id
                        ? FIXTURE_CATEGORY_GEN
                        : ast.categoryId === FIXTURE_CATEGORY_HVAC.id
                          ? FIXTURE_CATEGORY_HVAC
                          : null,
            }));
        });

        mocks.assetCount.mockImplementation(async ({ where }: any) => {
            const results = filterAssets(where);
            return results.length;
        });

        mocks.assetGroupBy.mockImplementation(async ({ by, where }: any) => {
            const counts = new Map<string, number>();
            for (const ast of assetsList) {
                if (where.workspaceId && ast.workspaceId !== where.workspaceId) continue;
                counts.set(ast.status, (counts.get(ast.status) || 0) + 1);
            }
            return Array.from(counts.entries()).map(([status, count]) => ({
                status,
                _count: { _all: count },
            }));
        });

        mocks.assetCategoryFindMany.mockImplementation(async ({ where }: any) => {
            return categoriesList.map((cat) => ({
                id: cat.id,
                name: cat.name,
                sortOrder: cat.sortOrder,
                _count: {
                    assets: assetsList.filter((a) => a.workspaceId === where.workspaceId && a.categoryId === cat.id).length,
                },
            }));
        });
    });

    function seedAsset(overrides: Partial<any> = {}): any {
        const index = assetsList.length + 1;
        const asset: any = {
            id: `ast_query_${index}`,
            workspaceId: WS_ID,
            assetNumber: `AST-${String(index).padStart(6, "0")}`,
            name: `Asset Item ${index}`,
            status: "OPERATIONAL",
            manufacturer: "Carrier",
            modelNumber: `MOD-${index}`,
            serialNumber: `SN-${index}000`,
            subLocationNotes: `Floor ${index}`,
            installationDate: new Date("2025-01-01"),
            warrantyExpiresAt: new Date("2028-01-01"),
            purchaseDate: new Date("2024-12-01"),
            purchaseCost: 15000,
            notes: "Test notes",
            tags: ["critical-infrastructure"],
            metadata: { tonnage: 10 },
            customerId: FIXTURE_CUSTOMER.id,
            locationId: FIXTURE_LOCATION.id,
            categoryId: FIXTURE_CATEGORY_HVAC.id,
            decommissionedAt: null,
            retiredAt: null,
            createdAt: new Date(`2026-01-0${Math.min(index, 9)}T10:00:00Z`),
            updatedAt: new Date(`2026-01-0${Math.min(index, 9)}T10:00:00Z`),
            ...overrides,
        };
        assetsList.push(asset);
        return asset;
    }

    // =========================================================================
    // 1. getAsset Single-Asset Retrieval
    // =========================================================================
    describe("1. getAsset Single-Asset Retrieval", () => {
        it("retrieves single asset with full nested relations (happy path)", async () => {
            const seeded = seedAsset({
                name: "Chiller #1",
                manufacturer: "Trane",
                purchaseCost: "25000.50",
            });

            const result = await getAsset(WS_ID, seeded.id);

            expect(result.id).toBe(seeded.id);
            expect(result.name).toBe("Chiller #1");
            expect(result.manufacturer).toBe("Trane");
            expect(result.customer).toEqual({
                id: FIXTURE_CUSTOMER.id,
                customerNumber: FIXTURE_CUSTOMER.customerNumber,
                name: FIXTURE_CUSTOMER.name,
            });
            expect(result.location).toEqual({
                id: FIXTURE_LOCATION.id,
                name: FIXTURE_LOCATION.name,
                addressLine1: FIXTURE_LOCATION.addressLine1,
                city: FIXTURE_LOCATION.city,
                state: FIXTURE_LOCATION.state,
                latitude: 30.2672,
                longitude: -97.7431,
            });
            expect(result.category).toEqual({
                id: FIXTURE_CATEGORY_HVAC.id,
                name: FIXTURE_CATEGORY_HVAC.name,
                code: FIXTURE_CATEGORY_HVAC.code,
            });
        });

        it("throws AssetNotFoundError (404) for non-existent asset ID", async () => {
            await expect(getAsset(WS_ID, "ast_non_existent")).rejects.toThrow(AssetNotFoundError);
        });

        it("throws AssetNotFoundError (404) for cross-tenant IDOR asset access", async () => {
            const crossTenantAsset = seedAsset({
                workspaceId: WS_ID_2,
            });

            await expect(getAsset(WS_ID, crossTenantAsset.id)).rejects.toThrow(AssetNotFoundError);
        });

        it("allows TECHNICIAN view if assigned to an active work order targeting the asset", async () => {
            const ast = seedAsset({ name: "Tech Target Asset" });

            // Set caller to TECHNICIAN
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            // Mock active work order assigned to technician targeting ast.id
            activeWorkOrdersMap.set(ast.id, { assetId: ast.id, status: "IN_PROGRESS" });

            const result = await getAsset(WS_ID, ast.id);
            expect(result.id).toBe(ast.id);
            expect(result.name).toBe("Tech Target Asset");
        });

        it("allows TECHNICIAN view if assigned to an active work order at the asset's location", async () => {
            const ast = seedAsset({
                name: "Location Shared Asset",
                locationId: FIXTURE_LOCATION.id,
            });

            // Set caller to TECHNICIAN
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            // Mock active work order assigned to technician at FIXTURE_LOCATION.id
            activeWorkOrdersMap.set(FIXTURE_LOCATION.id, { locationId: FIXTURE_LOCATION.id, status: "OPEN" });

            const result = await getAsset(WS_ID, ast.id);
            expect(result.id).toBe(ast.id);
        });

        it("denies TECHNICIAN (throws 404 AssetNotFoundError) if no active work order targets the asset or its location", async () => {
            const ast = seedAsset({ name: "Restricted Asset" });

            // Set caller to TECHNICIAN
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            // No active work order assigned
            await expect(getAsset(WS_ID, ast.id)).rejects.toThrow(AssetNotFoundError);
        });

        it("denies TECHNICIAN (throws 404 AssetNotFoundError) if technician's work order is COMPLETED/terminal", async () => {
            const ast = seedAsset({ name: "Terminal WorkOrder Asset" });

            // Set caller to TECHNICIAN
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            // Terminal work order
            activeWorkOrdersMap.set(ast.id, { assetId: ast.id, status: "COMPLETED" });

            await expect(getAsset(WS_ID, ast.id)).rejects.toThrow(AssetNotFoundError);
        });
    });

    // =========================================================================
    // 2. getAssets Multi-Filter Directory, Search, Sort & Pagination
    // =========================================================================
    describe("2. getAssets Directory, Search, Sort & Pagination", () => {
        beforeEach(() => {
            // Seed multiple assets with diverse attributes
            seedAsset({
                name: "Primary Chiller",
                assetNumber: "AST-000001",
                serialNumber: "SN-CHILL-100",
                modelNumber: "MOD-CH-1",
                manufacturer: "Carrier",
                status: "OPERATIONAL",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                categoryId: FIXTURE_CATEGORY_HVAC.id,
                tags: ["critical-infrastructure", "rooftop"],
                createdAt: new Date("2026-01-01"),
            });

            seedAsset({
                name: "Backup Generator",
                assetNumber: "AST-000002",
                serialNumber: "SN-GEN-200",
                modelNumber: "MOD-GEN-2",
                manufacturer: "Caterpillar",
                status: "OUT_OF_SERVICE",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                categoryId: FIXTURE_CATEGORY_GEN.id,
                tags: ["critical-infrastructure", "backup-power"],
                createdAt: new Date("2026-01-02"),
            });

            seedAsset({
                name: "Basement Sump Pump",
                assetNumber: "AST-000003",
                serialNumber: "SN-PUMP-300",
                modelNumber: "MOD-PUMP-3",
                manufacturer: "Grundfos",
                status: "DEGRADED",
                customerId: FIXTURE_CUSTOMER_2.id,
                locationId: FIXTURE_LOCATION_2.id,
                categoryId: null,
                tags: ["basement", "plumbing"],
                createdAt: new Date("2026-01-03"),
            });

            seedAsset({
                name: "Depot Mobile AC",
                assetNumber: "AST-000004",
                serialNumber: "SN-DEPOT-400",
                modelNumber: "MOD-DEP-4",
                manufacturer: "Carrier",
                status: "IN_STORAGE",
                customerId: null,
                locationId: null,
                categoryId: FIXTURE_CATEGORY_HVAC.id,
                tags: ["mobile", "depot"],
                createdAt: new Date("2026-01-04"),
            });
        });

        it("lists all workspace assets with default pagination", async () => {
            const result = await getAssets(WS_ID);

            expect(result.items.length).toBe(4);
            expect(result.pagination.total).toBe(4);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.pageSize).toBe(20);
            expect(result.pagination.totalPages).toBe(1);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("filters by status", async () => {
            const result = await getAssets(WS_ID, { status: "OUT_OF_SERVICE" });

            expect(result.items.length).toBe(1);
            expect(result.items[0].assetNumber).toBe("AST-000002");
            expect(result.items[0].status).toBe("OUT_OF_SERVICE");
        });

        it("filters by customerId", async () => {
            const result = await getAssets(WS_ID, { customerId: FIXTURE_CUSTOMER_2.id });

            expect(result.items.length).toBe(1);
            expect(result.items[0].name).toBe("Basement Sump Pump");
            expect(result.items[0].customerName).toBe(FIXTURE_CUSTOMER_2.name);
        });

        it("filters by locationId", async () => {
            const result = await getAssets(WS_ID, { locationId: FIXTURE_LOCATION.id });

            expect(result.items.length).toBe(2);
            expect(result.items.every((a) => a.locationId === FIXTURE_LOCATION.id)).toBe(true);
        });

        it("filters by categoryId", async () => {
            const result = await getAssets(WS_ID, { categoryId: FIXTURE_CATEGORY_GEN.id });

            expect(result.items.length).toBe(1);
            expect(result.items[0].name).toBe("Backup Generator");
            expect(result.items[0].categoryName).toBe(FIXTURE_CATEGORY_GEN.name);
        });

        it("filters by manufacturer", async () => {
            const result = await getAssets(WS_ID, { manufacturer: "carrier" });

            expect(result.items.length).toBe(2);
            expect(result.items.every((a) => a.manufacturer === "Carrier")).toBe(true);
        });

        it("filters by tags with ANY-match semantics (hasSome)", async () => {
            // Searching for assets tagged either 'rooftop' or 'plumbing'
            const result = await getAssets(WS_ID, { tags: ["rooftop", "plumbing"] });

            expect(result.items.length).toBe(2);
            const names = result.items.map((i) => i.name);
            expect(names).toContain("Primary Chiller"); // has rooftop
            expect(names).toContain("Basement Sump Pump"); // has plumbing
        });

        it("filters with combined multi-criteria", async () => {
            const result = await getAssets(WS_ID, {
                status: "OPERATIONAL",
                categoryId: FIXTURE_CATEGORY_HVAC.id,
                manufacturer: "Carrier",
            });

            expect(result.items.length).toBe(1);
            expect(result.items[0].name).toBe("Primary Chiller");
        });

        describe("Search across all confirmed search fields", () => {
            it("searches by assetNumber", async () => {
                const result = await getAssets(WS_ID, { search: "AST-000003" });
                expect(result.items.length).toBe(1);
                expect(result.items[0].name).toBe("Basement Sump Pump");
            });

            it("searches by name", async () => {
                const result = await getAssets(WS_ID, { search: "Generator" });
                expect(result.items.length).toBe(1);
                expect(result.items[0].name).toBe("Backup Generator");
            });

            it("searches by serialNumber", async () => {
                const result = await getAssets(WS_ID, { search: "SN-CHILL-100" });
                expect(result.items.length).toBe(1);
                expect(result.items[0].name).toBe("Primary Chiller");
            });

            it("searches by modelNumber", async () => {
                const result = await getAssets(WS_ID, { search: "MOD-GEN-2" });
                expect(result.items.length).toBe(1);
                expect(result.items[0].name).toBe("Backup Generator");
            });

            it("searches by manufacturer", async () => {
                const result = await getAssets(WS_ID, { search: "Grundfos" });
                expect(result.items.length).toBe(1);
                expect(result.items[0].name).toBe("Basement Sump Pump");
            });

            it("searches by relational customer name", async () => {
                const result = await getAssets(WS_ID, { search: "Beacon" });
                expect(result.items.length).toBe(1);
                expect(result.items[0].customerName).toBe("Beacon Hospitality");
            });

            it("searches by relational location name", async () => {
                const result = await getAssets(WS_ID, { search: "Apex HQ" });
                expect(result.items.length).toBe(2);
            });
        });

        describe("Sorting & Allowlist Enforcement", () => {
            it("sorts by name ascending and descending", async () => {
                const asc = await getAssets(WS_ID, { sortBy: "name", sortOrder: "asc" });
                expect(asc.items[0].name).toBe("Backup Generator");

                const desc = await getAssets(WS_ID, { sortBy: "name", sortOrder: "desc" });
                expect(desc.items[0].name).toBe("Primary Chiller");
            });

            it("sorts by assetNumber", async () => {
                const asc = await getAssets(WS_ID, { sortBy: "assetNumber", sortOrder: "asc" });
                expect(asc.items[0].assetNumber).toBe("AST-000001");
            });

            it("rejects non-allowlisted sort fields via Zod validation", async () => {
                await expect(getAssets(WS_ID, { sortBy: "unsupportedField" as any })).rejects.toThrow(ZodError);
            });
        });

        describe("Pagination Bounds", () => {
            it("handles pagination slicing, hasNextPage and hasPreviousPage accurately", async () => {
                const page1 = await getAssets(WS_ID, { page: 1, pageSize: 2 });
                expect(page1.items.length).toBe(2);
                expect(page1.pagination.page).toBe(1);
                expect(page1.pagination.pageSize).toBe(2);
                expect(page1.pagination.total).toBe(4);
                expect(page1.pagination.totalPages).toBe(2);
                expect(page1.pagination.hasNextPage).toBe(true);
                expect(page1.pagination.hasPreviousPage).toBe(false);

                const page2 = await getAssets(WS_ID, { page: 2, pageSize: 2 });
                expect(page2.items.length).toBe(2);
                expect(page2.pagination.page).toBe(2);
                expect(page2.pagination.hasNextPage).toBe(false);
                expect(page2.pagination.hasPreviousPage).toBe(true);
            });
        });

        describe("N+1 Query Avoidance & Isolation", () => {
            it("executes single findMany query with relation includes (avoiding N+1 loops)", async () => {
                mocks.assetFindMany.mockClear();

                await getAssets(WS_ID);

                expect(mocks.assetFindMany).toHaveBeenCalledTimes(1);
                expect(mocks.assetFindMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        include: {
                            customer: true,
                            location: true,
                            category: true,
                        },
                    }),
                );
            });

            it("enforces tenant isolation (cross-tenant assets never appear)", async () => {
                seedAsset({
                    name: "Cross Tenant Beta Unit",
                    workspaceId: WS_ID_2,
                });

                const result = await getAssets(WS_ID);
                expect(result.items.some((a) => a.workspaceId === WS_ID_2)).toBe(false);
                expect(result.pagination.total).toBe(4);
            });

            it("enforces TECHNICIAN list-scoping consistent with getAsset", async () => {
                // Set caller to TECHNICIAN
                mocks.auth.mockResolvedValue({
                    user: { id: USER_TECH.id, email: USER_TECH.email },
                });

                // Assign technician to only Primary Chiller (AST-000001)
                activeWorkOrdersMap.set("ast_query_1", { assetId: "ast_query_1", status: "OPEN" });

                const result = await getAssets(WS_ID);
                expect(result.items.length).toBe(1);
                expect(result.items[0].assetNumber).toBe("AST-000001");
            });
        });
    });

    // =========================================================================
    // 3. getAssetOperationalSummary Metrics Dashboard
    // =========================================================================
    describe("3. getAssetOperationalSummary", () => {
        beforeEach(() => {
            // 2 OPERATIONAL (1 HVAC, 1 GEN)
            seedAsset({ status: "OPERATIONAL", categoryId: FIXTURE_CATEGORY_HVAC.id });
            seedAsset({ status: "OPERATIONAL", categoryId: FIXTURE_CATEGORY_GEN.id });

            // 1 DEGRADED (HVAC)
            seedAsset({ status: "DEGRADED", categoryId: FIXTURE_CATEGORY_HVAC.id });

            // 2 OUT_OF_SERVICE:
            // 1 tagged "critical-infrastructure" (HVAC) -> counts toward both outOfServiceAssets and criticalOutOfServiceAssets
            seedAsset({
                status: "OUT_OF_SERVICE",
                categoryId: FIXTURE_CATEGORY_HVAC.id,
                tags: ["critical-infrastructure", "rooftop"],
            });
            // 1 tagged "non-critical" (Uncategorized) -> counts toward outOfServiceAssets but NOT criticalOutOfServiceAssets
            seedAsset({
                status: "OUT_OF_SERVICE",
                categoryId: null,
                tags: ["non-critical", "plumbing"],
            });

            // 1 IN_STORAGE (Uncategorized)
            seedAsset({ status: "IN_STORAGE", categoryId: null });

            // 1 DECOMMISSIONED (GEN)
            seedAsset({ status: "DECOMMISSIONED", categoryId: FIXTURE_CATEGORY_GEN.id });

            // 1 RETIRED (GEN)
            seedAsset({ status: "RETIRED", categoryId: FIXTURE_CATEGORY_GEN.id });
        });

        it("aggregates correct counts by status and totalAssets with distinct criticalOutOfServiceAssets", async () => {
            const summary = await getAssetOperationalSummary(WS_ID);

            expect(summary.totalAssets).toBe(8);
            expect(summary.operationalAssets).toBe(2);
            expect(summary.degradedAssets).toBe(1);
            expect(summary.outOfServiceAssets).toBe(2);
            expect(summary.criticalOutOfServiceAssets).toBe(1); // Exactly 1 has critical-infrastructure tag
            expect(summary.inStorageAssets).toBe(1);
            expect(summary.decommissionedAssets).toBe(1);
            expect(summary.retiredAssets).toBe(1);
        });

        it("proves criticalOutOfServiceAssets diverges from outOfServiceAssets when an OUT_OF_SERVICE asset lacks the critical-infrastructure tag", async () => {
            const summary = await getAssetOperationalSummary(WS_ID);

            // Total out of service assets is 2
            expect(summary.outOfServiceAssets).toBe(2);
            // Critical out of service assets is strictly 1 (only the one tagged critical-infrastructure)
            expect(summary.criticalOutOfServiceAssets).toBe(1);
            expect(summary.criticalOutOfServiceAssets).toBeLessThan(summary.outOfServiceAssets);
        });

        it("aggregates correct counts by category including Uncategorized bucket for null categoryId", async () => {
            const summary = await getAssetOperationalSummary(WS_ID);

            expect(summary.byCategory).toEqual(
                expect.arrayContaining([
                    {
                        categoryId: FIXTURE_CATEGORY_HVAC.id,
                        categoryName: FIXTURE_CATEGORY_HVAC.name,
                        count: 3,
                    },
                    {
                        categoryId: FIXTURE_CATEGORY_GEN.id,
                        categoryName: FIXTURE_CATEGORY_GEN.name,
                        count: 3,
                    },
                    {
                        categoryId: null,
                        categoryName: "Uncategorized",
                        count: 2,
                    },
                ]),
            );
        });

        it("enforces tenant isolation on summary counts", async () => {
            seedAsset({
                workspaceId: WS_ID_2,
                status: "OUT_OF_SERVICE",
                tags: ["critical-infrastructure"],
            });

            const summary = await getAssetOperationalSummary(WS_ID);
            expect(summary.totalAssets).toBe(8);
            expect(summary.outOfServiceAssets).toBe(2);
            expect(summary.criticalOutOfServiceAssets).toBe(1);
        });
    });
});
