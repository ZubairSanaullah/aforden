import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    getAssetCategories: vi.fn(),
    createAssetCategory: vi.fn(),
    getAssetCategory: vi.fn(),
    updateAssetCategory: vi.fn(),
    deleteAssetCategory: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/services/assetCategory", () => ({
    getAssetCategories: mocks.getAssetCategories,
    createAssetCategory: mocks.createAssetCategory,
    getAssetCategory: mocks.getAssetCategory,
    updateAssetCategory: mocks.updateAssetCategory,
    deleteAssetCategory: mocks.deleteAssetCategory,
}));

import {
    GET as listCategoriesRoute,
    POST as createCategoryRoute,
} from "@/app/api/asset-categories/route";
import {
    GET as getCategoryRoute,
    PATCH as updateCategoryRoute,
    DELETE as deleteCategoryRoute,
} from "@/app/api/asset-categories/[categoryId]/route";

import {
    AssetCategoryNotFoundError,
    AssetCategoryAlreadyExistsError,
    AssetCategoryDeletionNotAllowedError,
} from "@/lib/services/assetCategory/assetCategoryErrors";

describe("Phase 1.7.11 — AssetCategory REST API Routes Suite", () => {
    const WS_ID = "ws_rest_cat_1";
    const CAT_ID = "cat_rest_1";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    function makeRequest(
        url: string,
        options: {
            method?: string;
            headers?: Record<string, string>;
            body?: any;
            rawBody?: string;
        } = {},
    ): Request {
        const headers: Record<string, string> = {
            "x-workspace-id": WS_ID,
            ...options.headers,
        };

        let body: string | undefined = undefined;
        if (options.rawBody !== undefined) {
            body = options.rawBody;
            headers["content-type"] = "application/json";
        } else if (options.body !== undefined) {
            body = JSON.stringify(options.body);
            headers["content-type"] = "application/json";
        }

        return new Request(url, {
            method: options.method || "GET",
            headers,
            body,
        });
    }

    // =========================================================================
    // 1. GET /api/asset-categories & POST /api/asset-categories
    // =========================================================================
    describe("1. /api/asset-categories", () => {
        it("GET /api/asset-categories returns 200 on success", async () => {
            const mockResult = { items: [{ id: CAT_ID, name: "HVAC" }], pagination: { total: 1 } };
            mocks.getAssetCategories.mockResolvedValueOnce(mockResult);

            const req = makeRequest("http://localhost/api/asset-categories?status=ACTIVE");
            const res = await listCategoriesRoute(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockResult);
            expect(mocks.getAssetCategories).toHaveBeenCalledWith(WS_ID, { status: "ACTIVE" });
        });

        it("GET /api/asset-categories returns 400 if workspace ID is missing", async () => {
            const req = new Request("http://localhost/api/asset-categories");
            const res = await listCategoriesRoute(req);
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("POST /api/asset-categories returns 201 on creation", async () => {
            const mockCreated = { id: CAT_ID, name: "Generators", code: "GEN" };
            mocks.createAssetCategory.mockResolvedValueOnce(mockCreated);

            const req = makeRequest("http://localhost/api/asset-categories", {
                method: "POST",
                body: { name: "Generators", code: "GEN" },
            });

            const res = await createCategoryRoute(req);
            const json = await res.json();

            expect(res.status).toBe(201);
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockCreated);
            expect(mocks.createAssetCategory).toHaveBeenCalledWith(WS_ID, {
                name: "Generators",
                code: "GEN",
            });
        });

        it("POST /api/asset-categories returns 409 on duplicate name/code", async () => {
            mocks.createAssetCategory.mockRejectedValueOnce(new AssetCategoryAlreadyExistsError());

            const req = makeRequest("http://localhost/api/asset-categories", {
                method: "POST",
                body: { name: "Duplicate Category" },
            });

            const res = await createCategoryRoute(req);
            const json = await res.json();

            expect(res.status).toBe(409);
            expect(json.error.code).toBe("ASSET_CATEGORY_ALREADY_EXISTS");
        });
    });

    // =========================================================================
    // 2. /api/asset-categories/[categoryId]
    // =========================================================================
    describe("2. /api/asset-categories/[categoryId]", () => {
        it("GET /api/asset-categories/[categoryId] returns 200 on success", async () => {
            const mockCategory = { id: CAT_ID, name: "HVAC" };
            mocks.getAssetCategory.mockResolvedValueOnce(mockCategory);

            const req = makeRequest(`http://localhost/api/asset-categories/${CAT_ID}`);
            const res = await getCategoryRoute(req, { params: Promise.resolve({ categoryId: CAT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockCategory);
            expect(mocks.getAssetCategory).toHaveBeenCalledWith(WS_ID, CAT_ID);
        });

        it("GET /api/asset-categories/[categoryId] returns 404 if not found", async () => {
            mocks.getAssetCategory.mockRejectedValueOnce(new AssetCategoryNotFoundError());

            const req = makeRequest(`http://localhost/api/asset-categories/${CAT_ID}`);
            const res = await getCategoryRoute(req, { params: Promise.resolve({ categoryId: CAT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(404);
            expect(json.error.code).toBe("ASSET_CATEGORY_NOT_FOUND");
        });

        it("PATCH /api/asset-categories/[categoryId] updates category returning 200", async () => {
            const mockUpdated = { id: CAT_ID, name: "Updated Category", status: "INACTIVE" };
            mocks.updateAssetCategory.mockResolvedValueOnce(mockUpdated);

            const req = makeRequest(`http://localhost/api/asset-categories/${CAT_ID}`, {
                method: "PATCH",
                body: { name: "Updated Category", status: "INACTIVE" },
            });

            const res = await updateCategoryRoute(req, { params: Promise.resolve({ categoryId: CAT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockUpdated);
            expect(mocks.updateAssetCategory).toHaveBeenCalledWith(WS_ID, CAT_ID, {
                name: "Updated Category",
                status: "INACTIVE",
            });
        });

        it("DELETE /api/asset-categories/[categoryId] returns 200 on deletion", async () => {
            const mockDeleted = { id: CAT_ID, name: "Deleted Category" };
            mocks.deleteAssetCategory.mockResolvedValueOnce(mockDeleted);

            const req = makeRequest(`http://localhost/api/asset-categories/${CAT_ID}`, {
                method: "DELETE",
            });

            const res = await deleteCategoryRoute(req, { params: Promise.resolve({ categoryId: CAT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockDeleted);
            expect(mocks.deleteAssetCategory).toHaveBeenCalledWith(WS_ID, CAT_ID);
        });

        it("DELETE /api/asset-categories/[categoryId] returns 409 if referenced by assets", async () => {
            mocks.deleteAssetCategory.mockRejectedValueOnce(new AssetCategoryDeletionNotAllowedError());

            const req = makeRequest(`http://localhost/api/asset-categories/${CAT_ID}`, {
                method: "DELETE",
            });

            const res = await deleteCategoryRoute(req, { params: Promise.resolve({ categoryId: CAT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(409);
            expect(json.error.code).toBe("ASSET_CATEGORY_DELETION_NOT_ALLOWED");
        });
    });
});
