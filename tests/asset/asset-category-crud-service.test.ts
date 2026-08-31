import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    assetCategoryFindFirst: vi.fn(),
    assetCategoryCreate: vi.fn(),
    assetCategoryUpdate: vi.fn(),
    assetCategoryDelete: vi.fn(),
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
            create: mocks.assetCategoryCreate,
            update: mocks.assetCategoryUpdate,
            delete: mocks.assetCategoryDelete,
        },
    },
}));

import { createAssetCategory } from "@/lib/services/assetCategory/createAssetCategory";
import { updateAssetCategory } from "@/lib/services/assetCategory/updateAssetCategory";
import { deactivateAssetCategory } from "@/lib/services/assetCategory/deactivateAssetCategory";
import { deleteAssetCategory } from "@/lib/services/assetCategory/deleteAssetCategory";
import {
    AssetCategoryNotFoundError,
    AssetCategoryAlreadyExistsError,
    AssetCategoryDeletionNotAllowedError,
} from "@/lib/services/assetCategory/assetCategoryErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type {
    AssetCategory,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.11 — AssetCategory CRUD Service Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let categoriesMap: Map<string, any>;

    const WS_ID = "ws_cat_crud_1";
    const WS_ID_2 = "ws_cat_crud_2";

    const USER_ADMIN: User = {
        id: "usr_adm_cat",
        name: "Admin User",
        email: "admin@cat.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "usr_tech_cat",
        name: "Tech User",
        email: "tech@cat.com",
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
        name: "Alpha Equipment Corp",
        slug: "alpha-eq",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_cat",
        userId: USER_ADMIN.id,
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_cat",
        userId: USER_TECH.id,
        workspaceId: WS_ID,
        role: "TECHNICIAN",
        status: "ACTIVE",
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

        categoriesMap = new Map();

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
            for (const cat of categoriesMap.values()) {
                if (where.workspaceId && cat.workspaceId !== where.workspaceId) continue;
                if (where.id) {
                    if (typeof where.id === "object" && where.id.not && cat.id === where.id.not) continue;
                    if (typeof where.id === "string" && cat.id !== where.id) continue;
                }
                if (where.name?.equals && cat.name.toLowerCase() === where.name.equals.toLowerCase()) {
                    return cat;
                }
                if (where.code?.equals && cat.code && cat.code.toLowerCase() === where.code.equals.toLowerCase()) {
                    return cat;
                }
                if (where.id && typeof where.id === "string" && cat.id === where.id) {
                    return cat;
                }
            }
            return null;
        });

        mocks.assetCategoryCreate.mockImplementation(async ({ data }: any) => {
            const id = `cat_${categoriesMap.size + 1}`;
            const created = {
                id,
                workspaceId: data.workspaceId,
                name: data.name,
                code: data.code ?? null,
                description: data.description ?? null,
                status: data.status ?? "ACTIVE",
                sortOrder: data.sortOrder ?? 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                _count: { assets: 0 },
            };
            categoriesMap.set(id, created);
            return created;
        });

        mocks.assetCategoryUpdate.mockImplementation(async ({ where, data }: any) => {
            const found = categoriesMap.get(where.id);
            if (!found) {
                const err: any = new Error("Record not found");
                err.code = "P2025";
                throw err;
            }
            const updated = {
                ...found,
                ...data,
                updatedAt: new Date(),
            };
            categoriesMap.set(where.id, updated);
            return updated;
        });

        mocks.assetCategoryDelete.mockImplementation(async ({ where }: any) => {
            const found = categoriesMap.get(where.id);
            if (!found) {
                const err: any = new Error("Record not found");
                err.code = "P2025";
                throw err;
            }
            categoriesMap.delete(where.id);
            return found;
        });
    });

    function seedCategory(overrides: Partial<any> = {}): any {
        const id = `cat_${categoriesMap.size + 1}`;
        const cat = {
            id,
            workspaceId: WS_ID,
            name: `HVAC Systems ${categoriesMap.size + 1}`,
            code: `HVAC-${categoriesMap.size + 1}`,
            description: "Cooling and heating",
            status: "ACTIVE",
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { assets: 0 },
            ...overrides,
        };
        categoriesMap.set(id, cat);
        return cat;
    }

    describe("1. createAssetCategory", () => {
        it("creates a new category with name, code, description, sortOrder", async () => {
            const result = await createAssetCategory(WS_ID, {
                name: "Commercial Chillers",
                code: "CHILL-COMM",
                description: "Heavy commercial chillers",
                sortOrder: 5,
            });

            expect(result.name).toBe("Commercial Chillers");
            expect(result.code).toBe("CHILL-COMM");
            expect(result.sortOrder).toBe(5);
            expect(result.status).toBe("ACTIVE");
        });

        it("rejects duplicate category name in same workspace (409 AssetCategoryAlreadyExistsError)", async () => {
            seedCategory({ name: "Commercial Chillers" });

            await expect(
                createAssetCategory(WS_ID, {
                    name: "commercial chillers", // case-insensitive collision
                }),
            ).rejects.toThrow(AssetCategoryAlreadyExistsError);
        });

        it("rejects duplicate category code in same workspace (409 AssetCategoryAlreadyExistsError)", async () => {
            seedCategory({ code: "CHILL-COMM" });

            await expect(
                createAssetCategory(WS_ID, {
                    name: "Different Name",
                    code: "CHILL-COMM",
                }),
            ).rejects.toThrow(AssetCategoryAlreadyExistsError);
        });

        it("rejects unauthorized TECHNICIAN role with ForbiddenError (403)", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                createAssetCategory(WS_ID, {
                    name: "Generators",
                }),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("2. updateAssetCategory", () => {
        it("updates name, description, and status", async () => {
            const cat = seedCategory({ name: "Old Name", code: "OLD-CODE" });

            const updated = await updateAssetCategory(WS_ID, cat.id, {
                name: "New Name",
                description: "Updated description",
                status: "INACTIVE",
            });

            expect(updated.name).toBe("New Name");
            expect(updated.description).toBe("Updated description");
            expect(updated.status).toBe("INACTIVE");
        });

        it("rejects renaming to an existing category name in the workspace (409 AssetCategoryAlreadyExistsError)", async () => {
            const cat1 = seedCategory({ name: "Category One" });
            const cat2 = seedCategory({ name: "Category Two" });

            await expect(
                updateAssetCategory(WS_ID, cat2.id, {
                    name: "Category One",
                }),
            ).rejects.toThrow(AssetCategoryAlreadyExistsError);
        });

        it("throws AssetCategoryNotFoundError (404) for non-existent category", async () => {
            await expect(
                updateAssetCategory(WS_ID, "cat_nonexistent", {
                    name: "New Name",
                }),
            ).rejects.toThrow(AssetCategoryNotFoundError);
        });
    });

    describe("3. deactivateAssetCategory", () => {
        it("sets status to INACTIVE", async () => {
            const cat = seedCategory({ status: "ACTIVE" });

            const deactivated = await deactivateAssetCategory(WS_ID, cat.id);
            expect(deactivated.status).toBe("INACTIVE");
        });
    });

    describe("4. deleteAssetCategory", () => {
        it("deletes an unreferenced category with 0 assets", async () => {
            const cat = seedCategory({ _count: { assets: 0 } });

            const deleted = await deleteAssetCategory(WS_ID, cat.id);
            expect(deleted.id).toBe(cat.id);
            expect(categoriesMap.has(cat.id)).toBe(false);
        });

        it("blocks deletion when referenced by assets (409 AssetCategoryDeletionNotAllowedError)", async () => {
            const cat = seedCategory({ _count: { assets: 3 } });

            await expect(deleteAssetCategory(WS_ID, cat.id)).rejects.toThrow(
                AssetCategoryDeletionNotAllowedError,
            );
            expect(categoriesMap.has(cat.id)).toBe(true);
        });
    });
});
