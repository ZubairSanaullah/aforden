import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    assetCategoryFindFirst: vi.fn(),
    assetCategoryFindMany: vi.fn(),
    assetCategoryCount: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        workspace: { findUnique: mocks.workspaceFindUnique },
        workspaceMember: { findUnique: mocks.workspaceMemberFindUnique },
        assetCategory: {
            findFirst: mocks.assetCategoryFindFirst,
            findMany: mocks.assetCategoryFindMany,
            count: mocks.assetCategoryCount,
        },
    },
}));

import { getAssetCategories, listAssetCategories } from "@/lib/services/assetCategory/getAssetCategories";
import { getAssetCategory } from "@/lib/services/assetCategory/getAssetCategory";
import { AssetCategoryNotFoundError } from "@/lib/services/assetCategory/assetCategoryErrors";
import { ZodError } from "zod";
import type {
    AssetCategory,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.8 — AssetCategory Directory & Query Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let categoriesList: any[];

    const WS_ID = "ws_cat_query_1";
    const WS_ID_2 = "ws_cat_query_2";

    const USER_ADMIN: User = {
        id: "usr_adm_cat_query",
        name: "Admin Category Query",
        email: "admin@catquery.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Category Workspace",
        slug: "cat-ws",
        logoUrl: null,
        timezone: "UTC",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_cat_query",
        userId: USER_ADMIN.id,
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([[USER_ADMIN.id, USER_ADMIN]]);
        workspacesMap = new Map([[WS_ID, WS_ALPHA]]);
        membersMap = new Map([[`${USER_ADMIN.id}_${WS_ID}`, MEMBER_ADMIN]]);
        categoriesList = [];

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

        mocks.assetCategoryFindFirst.mockImplementation(async ({ where }: any) => {
            const found = categoriesList.find((cat) => {
                if (where.id && cat.id !== where.id) return false;
                if (where.workspaceId && cat.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;
            return {
                ...found,
                _count: { assets: found.assetsCount ?? 0 },
            };
        });

        mocks.assetCategoryFindMany.mockImplementation(async ({ where, orderBy, skip = 0, take = 50 }: any) => {
            let filtered = categoriesList.filter((cat) => {
                const clauses = where.AND ? where.AND : [where];
                for (const clause of clauses) {
                    if (clause.workspaceId && cat.workspaceId !== clause.workspaceId) return false;
                    if (clause.status && cat.status !== clause.status) return false;
                    if (clause.OR && Array.isArray(clause.OR)) {
                        const matchesOr = clause.OR.some((orClause: any) => {
                            if (orClause.name?.contains) {
                                return cat.name.toLowerCase().includes(orClause.name.contains.toLowerCase());
                            }
                            if (orClause.code?.contains && cat.code) {
                                return cat.code.toLowerCase().includes(orClause.code.contains.toLowerCase());
                            }
                            if (orClause.description?.contains && cat.description) {
                                return cat.description.toLowerCase().includes(orClause.description.contains.toLowerCase());
                            }
                            return false;
                        });
                        if (!matchesOr) return false;
                    }
                }
                return true;
            });

            // Sorting
            if (orderBy && Array.isArray(orderBy)) {
                filtered.sort((a, b) => {
                    for (const sortObj of orderBy) {
                        const [key, direction] = Object.entries(sortObj)[0];
                        const valA = (a as any)[key];
                        const valB = (b as any)[key];
                        if (valA === valB) continue;
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
            return paged.map((cat) => ({
                ...cat,
                _count: { assets: cat.assetsCount ?? 0 },
            }));
        });

        mocks.assetCategoryCount.mockImplementation(async ({ where }: any) => {
            const results = await mocks.assetCategoryFindMany({ where, skip: 0, take: 999999 });
            return results.length;
        });
    });

    function seedCategory(overrides: Partial<any> = {}): any {
        const index = categoriesList.length + 1;
        const category: any = {
            id: `cat_query_${index}`,
            workspaceId: WS_ID,
            name: `Category ${index}`,
            code: `CAT-${index}`,
            description: `Description for Category ${index}`,
            status: "ACTIVE",
            sortOrder: index,
            assetsCount: 3,
            createdAt: new Date(`2026-01-0${Math.min(index, 9)}T00:00:00Z`),
            updatedAt: new Date(`2026-01-0${Math.min(index, 9)}T00:00:00Z`),
            ...overrides,
        };
        categoriesList.push(category);
        return category;
    }

    describe("1. getAssetCategories List & Filter", () => {
        beforeEach(() => {
            seedCategory({
                name: "Commercial HVAC",
                code: "HVAC-COMM",
                description: "Chillers and RTUs",
                status: "ACTIVE",
                sortOrder: 1,
            });

            seedCategory({
                name: "Diesel Generators",
                code: "GEN-DSL",
                description: "Backup power",
                status: "ACTIVE",
                sortOrder: 2,
            });

            seedCategory({
                name: "Legacy Boilers",
                code: "BOIL-LEG",
                description: "Phase out",
                status: "INACTIVE",
                sortOrder: 3,
            });
        });

        it("defaults to listing ACTIVE categories ordered by sortOrder", async () => {
            const result = await getAssetCategories(WS_ID);

            expect(result.items.length).toBe(2);
            expect(result.items[0].name).toBe("Commercial HVAC");
            expect(result.items[1].name).toBe("Diesel Generators");
            expect(result.items.every((c) => c.status === "ACTIVE")).toBe(true);
        });

        it("filters by status: INACTIVE", async () => {
            const result = await getAssetCategories(WS_ID, { status: "INACTIVE" });

            expect(result.items.length).toBe(1);
            expect(result.items[0].name).toBe("Legacy Boilers");
            expect(result.items[0].status).toBe("INACTIVE");
        });

        it("returns all categories when status: ALL", async () => {
            const result = await getAssetCategories(WS_ID, { status: "ALL" });

            expect(result.items.length).toBe(3);
            expect(result.pagination?.total).toBe(3);
        });

        it("searches by name, code, or description", async () => {
            const byName = await getAssetCategories(WS_ID, { search: "HVAC" });
            expect(byName.items.length).toBe(1);
            expect(byName.items[0].name).toBe("Commercial HVAC");

            const byCode = await getAssetCategories(WS_ID, { search: "GEN-DSL" });
            expect(byCode.items.length).toBe(1);
            expect(byCode.items[0].code).toBe("GEN-DSL");

            const byDesc = await getAssetCategories(WS_ID, { search: "Backup power" });
            expect(byDesc.items.length).toBe(1);
            expect(byDesc.items[0].name).toBe("Diesel Generators");
        });

        it("sorts by name descending", async () => {
            const result = await getAssetCategories(WS_ID, {
                status: "ALL",
                sortBy: "name",
                sortOrder: "desc",
            });

            expect(result.items[0].name).toBe("Legacy Boilers");
            expect(result.items[1].name).toBe("Diesel Generators");
            expect(result.items[2].name).toBe("Commercial HVAC");
        });

        it("enforces tenant isolation (cross-tenant categories excluded)", async () => {
            seedCategory({
                name: "Beta Tenant Category",
                workspaceId: WS_ID_2,
            });

            const result = await getAssetCategories(WS_ID, { status: "ALL" });
            expect(result.items.some((c) => c.workspaceId === WS_ID_2)).toBe(false);
            expect(result.pagination?.total).toBe(3);
        });
    });

    describe("2. getAssetCategory Single Retrieval", () => {
        it("retrieves single category with assetsCount", async () => {
            const cat = seedCategory({
                name: "Fire Safety Systems",
                code: "FIRE-SAFE",
                assetsCount: 12,
            });

            const result = await getAssetCategory(WS_ID, cat.id);

            expect(result.id).toBe(cat.id);
            expect(result.name).toBe("Fire Safety Systems");
            expect(result.code).toBe("FIRE-SAFE");
            expect(result.assetsCount).toBe(12);
        });

        it("throws AssetCategoryNotFoundError (404) if category does not exist", async () => {
            await expect(getAssetCategory(WS_ID, "cat_missing_999")).rejects.toThrow(AssetCategoryNotFoundError);
        });

        it("throws AssetCategoryNotFoundError (404) for cross-tenant IDOR lookup", async () => {
            const crossCat = seedCategory({
                workspaceId: WS_ID_2,
            });

            await expect(getAssetCategory(WS_ID, crossCat.id)).rejects.toThrow(AssetCategoryNotFoundError);
        });
    });
});
