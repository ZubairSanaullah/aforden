import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    getAssets: vi.fn(),
    createAsset: vi.fn(),
    getAssetOperationalSummary: vi.fn(),
    getAsset: vi.fn(),
    updateAsset: vi.fn(),
    deleteAsset: vi.fn(),
    transitionAssetStatus: vi.fn(),
    transferAssetLocation: vi.fn(),
    transferAssetOwnership: vi.fn(),
    getAssetHistory: vi.fn(),
    getAssetWorkOrders: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/services/asset", () => ({
    getAssets: mocks.getAssets,
    createAsset: mocks.createAsset,
    getAssetOperationalSummary: mocks.getAssetOperationalSummary,
    getAsset: mocks.getAsset,
    updateAsset: mocks.updateAsset,
    deleteAsset: mocks.deleteAsset,
    transitionAssetStatus: mocks.transitionAssetStatus,
    transferAssetLocation: mocks.transferAssetLocation,
    transferAssetOwnership: mocks.transferAssetOwnership,
    getAssetHistory: mocks.getAssetHistory,
    getAssetWorkOrders: mocks.getAssetWorkOrders,
}));

import {
    GET as listAssetsRoute,
    POST as createAssetRoute,
} from "@/app/api/assets/route";
import { GET as getSummaryRoute } from "@/app/api/assets/summary/route";
import {
    GET as getAssetRoute,
    PATCH as updateAssetRoute,
    DELETE as deleteAssetRoute,
} from "@/app/api/assets/[assetId]/route";
import { PATCH as transitionStatusRoute } from "@/app/api/assets/[assetId]/status/route";
import { POST as transferRoute } from "@/app/api/assets/[assetId]/transfer/route";
import { GET as getHistoryRoute } from "@/app/api/assets/[assetId]/history/route";
import { GET as getWorkOrdersRoute } from "@/app/api/assets/[assetId]/work-orders/route";

import {
    AssetNotFoundError,
    AssetDeletionNotAllowedError,
    AssetInvalidStatusTransitionError,
    AssetMissingStatusReasonError,
    DuplicateAssetNumberError,
    AssetImmutableError,
} from "@/lib/services/asset/assetErrors";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";

describe("Phase 1.7.11 — Asset REST API Routes Suite", () => {
    const WS_ID = "ws_rest_asset_1";
    const ASSET_ID = "ast_rest_1";

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
    // 1. GET /api/assets & POST /api/assets
    // =========================================================================
    describe("1. /api/assets", () => {
        it("GET /api/assets returns 200 and data envelope", async () => {
            const mockResult = { items: [{ id: ASSET_ID, name: "Chiller" }], pagination: { total: 1 } };
            mocks.getAssets.mockResolvedValueOnce(mockResult);

            const req = makeRequest(`http://localhost/api/assets?status=OPERATIONAL&page=1&pageSize=10`);
            const res = await listAssetsRoute(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockResult);
            expect(mocks.getAssets).toHaveBeenCalledWith(WS_ID, {
                status: "OPERATIONAL",
                page: "1",
                pageSize: "10",
            });
        });

        it("GET /api/assets returns 400 if workspace ID is missing", async () => {
            const req = new Request("http://localhost/api/assets");
            const res = await listAssetsRoute(req);
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("POST /api/assets returns 201 on successful asset creation", async () => {
            const mockCreated = { id: ASSET_ID, name: "New Generator", status: "OPERATIONAL" };
            mocks.createAsset.mockResolvedValueOnce(mockCreated);

            const req = makeRequest("http://localhost/api/assets", {
                method: "POST",
                body: { name: "New Generator" },
            });

            const res = await createAssetRoute(req);
            const json = await res.json();

            expect(res.status).toBe(201);
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockCreated);
            expect(mocks.createAsset).toHaveBeenCalledWith(WS_ID, { name: "New Generator" });
        });

        it("POST /api/assets returns 400 for malformed JSON body", async () => {
            const req = makeRequest("http://localhost/api/assets", {
                method: "POST",
                rawBody: "{ invalid json ...",
            });

            const res = await createAssetRoute(req);
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("POST /api/assets maps DuplicateAssetNumberError to 409", async () => {
            mocks.createAsset.mockRejectedValueOnce(new DuplicateAssetNumberError());

            const req = makeRequest("http://localhost/api/assets", {
                method: "POST",
                body: { name: "Duplicate Asset", assetNumber: "AST-000001" },
            });

            const res = await createAssetRoute(req);
            const json = await res.json();

            expect(res.status).toBe(409);
            expect(json.error.code).toBe("DUPLICATE_ASSET_NUMBER");
        });

        it("POST /api/assets maps UnauthorizedError to 401", async () => {
            mocks.createAsset.mockRejectedValueOnce(new UnauthorizedError());

            const req = makeRequest("http://localhost/api/assets", {
                method: "POST",
                body: { name: "Asset" },
            });

            const res = await createAssetRoute(req);
            expect(res.status).toBe(401);
        });
    });

    // =========================================================================
    // 2. GET /api/assets/summary
    // =========================================================================
    describe("2. /api/assets/summary", () => {
        it("GET /api/assets/summary returns 200 and operational metrics", async () => {
            const mockSummary = { totalAssets: 10, operationalAssets: 8, outOfServiceAssets: 2 };
            mocks.getAssetOperationalSummary.mockResolvedValueOnce(mockSummary);

            const req = makeRequest("http://localhost/api/assets/summary");
            const res = await getSummaryRoute(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockSummary);
            expect(mocks.getAssetOperationalSummary).toHaveBeenCalledWith(WS_ID);
        });
    });

    // =========================================================================
    // 3. /api/assets/[assetId]
    // =========================================================================
    describe("3. /api/assets/[assetId]", () => {
        it("GET /api/assets/[assetId] returns 200 on success", async () => {
            const mockAsset = { id: ASSET_ID, name: "Chiller Unit" };
            mocks.getAsset.mockResolvedValueOnce(mockAsset);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}`);
            const res = await getAssetRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockAsset);
            expect(mocks.getAsset).toHaveBeenCalledWith(WS_ID, ASSET_ID);
        });

        it("GET /api/assets/[assetId] returns 404 for missing or cross-tenant asset", async () => {
            mocks.getAsset.mockRejectedValueOnce(new AssetNotFoundError());

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}`);
            const res = await getAssetRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(404);
            expect(json.error.code).toBe("ASSET_NOT_FOUND");
        });

        it("PATCH /api/assets/[assetId] returns 200 on update", async () => {
            const mockUpdated = { id: ASSET_ID, name: "Updated Chiller" };
            mocks.updateAsset.mockResolvedValueOnce(mockUpdated);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}`, {
                method: "PATCH",
                body: { name: "Updated Chiller" },
            });

            const res = await updateAssetRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockUpdated);
            expect(mocks.updateAsset).toHaveBeenCalledWith(WS_ID, ASSET_ID, { name: "Updated Chiller" });
        });

        it("PATCH /api/assets/[assetId] maps AssetImmutableError to 409", async () => {
            mocks.updateAsset.mockRejectedValueOnce(new AssetImmutableError());

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}`, {
                method: "PATCH",
                body: { name: "New Name" },
            });

            const res = await updateAssetRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(409);
            expect(json.error.code).toBe("ASSET_IMMUTABLE");
        });

        it("DELETE /api/assets/[assetId] returns 200 on successful deletion", async () => {
            const mockDeleted = { id: ASSET_ID, name: "Deleted Chiller" };
            mocks.deleteAsset.mockResolvedValueOnce(mockDeleted);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}`, {
                method: "DELETE",
            });

            const res = await deleteAssetRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockDeleted);
            expect(mocks.deleteAsset).toHaveBeenCalledWith(WS_ID, ASSET_ID);
        });

        it("DELETE /api/assets/[assetId] returns 409 if asset is referenced by work orders", async () => {
            mocks.deleteAsset.mockRejectedValueOnce(new AssetDeletionNotAllowedError());

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}`, {
                method: "DELETE",
            });

            const res = await deleteAssetRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(409);
            expect(json.error.code).toBe("ASSET_DELETION_NOT_ALLOWED");
        });
    });

    // =========================================================================
    // 4. PATCH /api/assets/[assetId]/status
    // =========================================================================
    describe("4. /api/assets/[assetId]/status", () => {
        it("transitions status to DECOMMISSIONED returning 200", async () => {
            const mockTransitioned = { id: ASSET_ID, status: "DECOMMISSIONED" };
            mocks.transitionAssetStatus.mockResolvedValueOnce(mockTransitioned);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/status`, {
                method: "PATCH",
                body: { toStatus: "DECOMMISSIONED", statusReason: "Seasonal winter closure" },
            });

            const res = await transitionStatusRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockTransitioned);
            expect(mocks.transitionAssetStatus).toHaveBeenCalledWith(WS_ID, ASSET_ID, {
                toStatus: "DECOMMISSIONED",
                statusReason: "Seasonal winter closure",
            });
        });

        it("transitions status to RETIRED returning 200", async () => {
            const mockRetired = { id: ASSET_ID, status: "RETIRED" };
            mocks.transitionAssetStatus.mockResolvedValueOnce(mockRetired);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/status`, {
                method: "PATCH",
                body: { toStatus: "RETIRED", statusReason: "End of life scrap" },
            });

            const res = await transitionStatusRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            expect(res.status).toBe(200);
        });

        it("maps AssetInvalidStatusTransitionError to 409", async () => {
            mocks.transitionAssetStatus.mockRejectedValueOnce(
                new AssetInvalidStatusTransitionError("Transition from OPERATIONAL to RETIRED not allowed"),
            );

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/status`, {
                method: "PATCH",
                body: { toStatus: "RETIRED" },
            });

            const res = await transitionStatusRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            expect(res.status).toBe(409);
        });

        it("maps AssetMissingStatusReasonError to 422", async () => {
            mocks.transitionAssetStatus.mockRejectedValueOnce(new AssetMissingStatusReasonError());

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/status`, {
                method: "PATCH",
                body: { toStatus: "DECOMMISSIONED" },
            });

            const res = await transitionStatusRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            expect(res.status).toBe(422);
        });
    });

    // =========================================================================
    // 5. POST /api/assets/[assetId]/transfer
    // =========================================================================
    describe("5. /api/assets/[assetId]/transfer", () => {
        it("dispatches to transferAssetOwnership when customerId is present in payload", async () => {
            const mockTransferred = { id: ASSET_ID, customerId: "cust_2", locationId: "loc_2" };
            mocks.transferAssetOwnership.mockResolvedValueOnce(mockTransferred);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/transfer`, {
                method: "POST",
                body: {
                    customerId: "cust_2",
                    locationId: "loc_2",
                    transferReason: "Sold to new tenant",
                },
            });

            const res = await transferRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockTransferred);
            expect(mocks.transferAssetOwnership).toHaveBeenCalledWith(WS_ID, ASSET_ID, {
                customerId: "cust_2",
                locationId: "loc_2",
                transferReason: "Sold to new tenant",
            });
            expect(mocks.transferAssetLocation).not.toHaveBeenCalled();
        });

        it("dispatches to transferAssetLocation when locationId is present (and no customerId)", async () => {
            const mockTransferred = { id: ASSET_ID, locationId: "loc_3" };
            mocks.transferAssetLocation.mockResolvedValueOnce(mockTransferred);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/transfer`, {
                method: "POST",
                body: {
                    locationId: "loc_3",
                    transferReason: "Relocated to Building B",
                },
            });

            const res = await transferRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockTransferred);
            expect(mocks.transferAssetLocation).toHaveBeenCalledWith(WS_ID, ASSET_ID, {
                locationId: "loc_3",
                transferReason: "Relocated to Building B",
            });
            expect(mocks.transferAssetOwnership).not.toHaveBeenCalled();
        });

        it("returns 422 if neither customerId nor locationId is provided in transfer payload", async () => {
            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/transfer`, {
                method: "POST",
                body: {
                    transferReason: "Ambiguous request without target",
                },
            });

            const res = await transferRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(422);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(mocks.transferAssetLocation).not.toHaveBeenCalled();
            expect(mocks.transferAssetOwnership).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 6. GET /api/assets/[assetId]/history & /api/assets/[assetId]/work-orders
    // =========================================================================
    describe("6. History & WorkOrders Sub-resource Routes", () => {
        it("GET /api/assets/[assetId]/history returns 200 on success", async () => {
            const mockHistory = { items: [{ id: "ah_1", eventType: "CREATED" }], pagination: { total: 1 } };
            mocks.getAssetHistory.mockResolvedValueOnce(mockHistory);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/history?eventType=CREATED`);
            const res = await getHistoryRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockHistory);
            expect(mocks.getAssetHistory).toHaveBeenCalledWith(WS_ID, ASSET_ID, { eventType: "CREATED" });
        });

        it("GET /api/assets/[assetId]/work-orders returns 200 on success", async () => {
            const mockWoList = { items: [{ id: "wo_1", title: "Inspection" }], pagination: { total: 1 } };
            mocks.getAssetWorkOrders.mockResolvedValueOnce(mockWoList);

            const req = makeRequest(`http://localhost/api/assets/${ASSET_ID}/work-orders?status=OPEN`);
            const res = await getWorkOrdersRoute(req, { params: Promise.resolve({ assetId: ASSET_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.data).toEqual(mockWoList);
            expect(mocks.getAssetWorkOrders).toHaveBeenCalledWith(WS_ID, ASSET_ID, { status: "OPEN" });
        });
    });
});
