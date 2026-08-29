import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
    createDeveloperApplication,
    createApiKey,
    ApiKeyEnvironment,
} from "@/lib/services/developerApp";
import { PUBLIC_API_SCOPES } from "@/lib/publicApi/scopes";
import {
    APPROVED_PUBLIC_ASSET_DTO_KEYS,
} from "@/lib/publicApi/assets/assetDto";
import {
    GET as listAssetsHandler,
    POST as createAssetHandler,
} from "@/app/api/v1/assets/route";
import {
    GET as getAssetHandler,
    PATCH as updateAssetHandler,
} from "@/app/api/v1/assets/[id]/route";

describe("Phase 1.18.9 — Public Asset & Equipment API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `ast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_ast_1_${runId}`;
    const user1Id = `usr_ast_1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let readOnlyKey1Secret: string;
    let writeOnlyKey1Secret: string;

    // Tenant 2
    const ws2Id = `ws_ast_2_${runId}`;
    const user2Id = `usr_ast_2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    // Domain IDs for Tenant 1
    let activeCustomer1Id: string;
    let inactiveCustomer1Id: string;
    let customerB1Id: string;
    let location1Id: string;
    let locationB1Id: string;
    let asset1Id: string;
    let asset2Id: string;

    // Domain IDs for Tenant 2
    let activeCustomer2Id: string;
    let location2Id: string;
    let foreignAsset2Id: string;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Setup Workspace 1 and Membership
        await prisma.user.create({
            data: {
                id: user1Id,
                email: `ast-user1-${runId}@example.com`,
                name: "Asset Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Asset Test Workspace 1",
                slug: `ast-ws1-${runId}`,
            },
        });
        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws1Id,
                userId: user1Id,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // 2. Setup Workspace 2 and Membership
        await prisma.user.create({
            data: {
                id: user2Id,
                email: `ast-user2-${runId}@example.com`,
                name: "Asset Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Asset Test Workspace 2",
                slug: `ast-ws2-${runId}`,
            },
        });
        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: user2Id,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // 3. Setup Developer Applications & API Keys for Workspace 1
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "Asset Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [
                PUBLIC_API_SCOPES.ASSETS_READ,
                PUBLIC_API_SCOPES.ASSETS_WRITE,
            ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const readKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.ASSETS_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        readOnlyKey1Secret = readKey1.rawSecretKey;

        const writeKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.ASSETS_WRITE],
            environment: ApiKeyEnvironment.LIVE,
        });
        writeOnlyKey1Secret = writeKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Asset Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [
                PUBLIC_API_SCOPES.ASSETS_READ,
                PUBLIC_API_SCOPES.ASSETS_WRITE,
            ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Customer A, Customer B, Inactive Customer, and Locations in Workspace 1
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `CUST-AST-001`,
                name: "Apex Manufacturing WS1",
                email: `apex-${runId}@example.com`,
                status: "ACTIVE",
            },
        });
        activeCustomer1Id = cust1.id;

        const custB = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `CUST-AST-002`,
                name: "Beacon Logistics WS1",
                email: `beacon-${runId}@example.com`,
                status: "ACTIVE",
            },
        });
        customerB1Id = custB.id;

        const inactiveCust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `CUST-AST-INACTIVE`,
                name: "Inactive Corp WS1",
                email: `inactive-${runId}@example.com`,
                status: "INACTIVE",
            },
        });
        inactiveCustomer1Id = inactiveCust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: activeCustomer1Id,
                name: "Apex Main Plant",
                addressLine1: "500 Apex Blvd",
                city: "Detroit",
                country: "USA",
                isPrimary: true,
            },
        });
        location1Id = loc1.id;

        const locB = await prisma.serviceLocation.create({
            data: {
                customerId: customerB1Id,
                name: "Beacon Warehouse A",
                addressLine1: "700 Freight Way",
                city: "Chicago",
                country: "USA",
                isPrimary: true,
            },
        });
        locationB1Id = locB.id;

        // 6. Seed Initial Assets in Workspace 1
        const asset1 = await prisma.asset.create({
            data: {
                workspaceId: ws1Id,
                assetNumber: `AST-WS1-000001`,
                name: "Industrial Chiller 5000",
                status: "OPERATIONAL",
                customerId: activeCustomer1Id,
                locationId: location1Id,
                manufacturer: "Carrier",
                modelNumber: "AquaEdge 19DV",
                serialNumber: `SN-CARRIER-${runId}`,
                purchaseCost: "45000.00",
                notes: "Internal private maintenance records",
                tags: ["chiller", "hvac", "critical"],
            },
        });
        asset1Id = asset1.id;

        const asset2 = await prisma.asset.create({
            data: {
                workspaceId: ws1Id,
                assetNumber: `AST-WS1-000002`,
                name: "Backup Diesel Generator",
                status: "IN_STORAGE",
                manufacturer: "Caterpillar",
                modelNumber: "Cat C32",
                serialNumber: `SN-CAT-${runId}`,
                purchaseCost: "85000.00",
                tags: ["generator", "backup"],
            },
        });
        asset2Id = asset2.id;

        // 7. Seed Customer, Location, and Asset in Workspace 2
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                customerNumber: `CUST-WS2-001`,
                name: "Stark Energy WS2",
                email: `stark-energy-${runId}@example.com`,
                status: "ACTIVE",
            },
        });
        activeCustomer2Id = cust2.id;

        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: activeCustomer2Id,
                name: "Stark Arc Reactor Facility",
                addressLine1: "10880 Malibu Point",
                city: "Malibu",
                country: "USA",
                isPrimary: true,
            },
        });
        location2Id = loc2.id;

        const foreignAsset = await prisma.asset.create({
            data: {
                workspaceId: ws2Id,
                assetNumber: `AST-WS2-000001`,
                name: "Arc Reactor Core",
                status: "OPERATIONAL",
                customerId: activeCustomer2Id,
                locationId: location2Id,
                manufacturer: "Stark Industries",
                modelNumber: "Mark IV Reactor",
                serialNumber: `SN-STARK-${runId}`,
                notes: "Top secret reactor blueprint",
                tags: ["energy", "classified"],
            },
        });
        foreignAsset2Id = foreignAsset.id;
    });

    afterAll(async () => {
        if (prisma) {
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
                await prisma.assetHistory.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.asset.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
            }
            const customerIds = [activeCustomer1Id, inactiveCustomer1Id, customerB1Id, activeCustomer2Id].filter(Boolean);
            if (customerIds.length > 0) {
                await prisma.serviceLocation.deleteMany({
                    where: { customerId: { in: customerIds } },
                });
                await prisma.customer.deleteMany({
                    where: { id: { in: customerIds } },
                });
            }
            const appIds = [app1Id, app2Id].filter(Boolean);
            if (appIds.length > 0) {
                await prisma.apiKey.deleteMany({
                    where: { developerApplicationId: { in: appIds } },
                });
                await prisma.developerApplication.deleteMany({
                    where: { id: { in: appIds } },
                });
            }
            if (wsIds.length > 0) {
                await prisma.workspaceMember.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.workspace.deleteMany({
                    where: { id: { in: wsIds } },
                });
            }
            const userIds = [user1Id, user2Id].filter(Boolean);
            if (userIds.length > 0) {
                await prisma.user.deleteMany({
                    where: { id: { in: userIds } },
                });
            }
            await prisma.$disconnect();
        }
    });

    function mockRequest(
        path: string,
        options?: {
            method?: string;
            token?: string;
            body?: any;
            headers?: Record<string, string>;
        },
    ): Request {
        const method = options?.method || "GET";
        const headers = new Headers(options?.headers || {});
        if (options?.token) {
            headers.set("Authorization", `Bearer ${options.token}`);
        }
        if (options?.body) {
            headers.set("Content-Type", "application/json");
        }

        const url = `https://api.aforden.com${path}`;
        const init: RequestInit = {
            method,
            headers,
        };
        if (options?.body) {
            init.body = JSON.stringify(options.body);
        }

        return new Request(url, init);
    }

    // -------------------------------------------------------------------------
    // 1. Canonical Public DTO Projection & Sanitization
    // -------------------------------------------------------------------------
    describe("1. Canonical Public DTO Projection & Sanitization", () => {
        it("should return the exact approved PublicAssetDto key set and exclude internal-only fields", async () => {
            const req = mockRequest(`/api/v1/assets/${asset1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getAssetHandler(req, {
                params: Promise.resolve({ id: asset1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();

            const returnedKeys = Object.keys(json.data).sort();
            const expectedKeys = [...APPROVED_PUBLIC_ASSET_DTO_KEYS].sort();

            expect(returnedKeys).toEqual(expectedKeys);
            expect(json.data).not.toHaveProperty("workspaceId");
            expect(json.data).not.toHaveProperty("notes");
            expect(json.data).not.toHaveProperty("metadata");
            expect(json.data).not.toHaveProperty("purchaseCost");
            expect(json.data).not.toHaveProperty("customer");
            expect(json.data).not.toHaveProperty("location");
            expect(json.data).not.toHaveProperty("category");
            expect(json.data).not.toHaveProperty("workOrders");
            expect(json.data).not.toHaveProperty("history");
            expect(json.data.customerId).toBe(activeCustomer1Id);
            expect(json.data.locationId).toBe(location1Id);
            expect(json.data.tags).toEqual(["chiller", "hvac", "critical"]);
        });
    });

    // -------------------------------------------------------------------------
    // 2. Collection & Item Endpoints
    // -------------------------------------------------------------------------
    describe("2. Asset Endpoints (GET list, GET item, POST create, PATCH update)", () => {
        let createdAssetId: string;

        it("GET /api/v1/assets (list) should return paginated collection of assets", async () => {
            const req = mockRequest("/api/v1/assets?limit=10", {
                token: fullKey1Secret,
            });

            const res = await listAssetsHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(2);
            expect(json.meta?.pagination).toBeDefined();
            expect(json.meta.pagination.limit).toBe(10);
        });

        it("POST /api/v1/assets should create a new asset and return HTTP 201 with auto-generated assetNumber", async () => {
            const req = mockRequest("/api/v1/assets", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Centrifugal Air Compressor",
                    customerId: activeCustomer1Id,
                    locationId: location1Id,
                    manufacturer: "Ingersoll Rand",
                    modelNumber: "Centac C800",
                    serialNumber: `SN-IR-${Date.now()}`,
                    tags: ["compressor", "pneumatics"],
                },
            });

            const res = await createAssetHandler(req);
            expect(res.status).toBe(201);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBeDefined();
            expect(json.data.name).toBe("Centrifugal Air Compressor");
            expect(json.data.status).toBe("OPERATIONAL");
            expect(json.data.assetNumber).toBeDefined();
            expect(json.data.customerId).toBe(activeCustomer1Id);
            expect(json.data.locationId).toBe(location1Id);
            expect(json.data).not.toHaveProperty("workspaceId");
            expect(json.data).not.toHaveProperty("purchaseCost");
            createdAssetId = json.data.id;
        });

        it("PATCH /api/v1/assets/:id should update mutable fields and return HTTP 200", async () => {
            const req = mockRequest(`/api/v1/assets/${createdAssetId}`, {
                method: "PATCH",
                token: fullKey1Secret,
                body: {
                    manufacturer: "Ingersoll Rand Inc",
                    subLocationNotes: "Mounted on concrete pad in Compressor Room 3",
                },
            });

            const res = await updateAssetHandler(req, {
                params: Promise.resolve({ id: createdAssetId }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(createdAssetId);
            expect(json.data.manufacturer).toBe("Ingersoll Rand Inc");
            expect(json.data.subLocationNotes).toBe("Mounted on concrete pad in Compressor Room 3");
            expect(json.data).not.toHaveProperty("purchaseCost");
        });

        it("PATCH /api/v1/assets/:id ignores customerId/locationId and preserves original customer/location bindings (immutable bindings guard)", async () => {
            // Attempt to reassign customer and location to Customer B / Location B via PATCH
            const req = mockRequest(`/api/v1/assets/${createdAssetId}`, {
                method: "PATCH",
                token: fullKey1Secret,
                body: {
                    name: "Air Compressor - Relocation Attempt",
                    customerId: customerB1Id,
                    locationId: locationB1Id,
                },
            });

            const res = await updateAssetHandler(req, {
                params: Promise.resolve({ id: createdAssetId }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            // Name was successfully updated
            expect(json.data.name).toBe("Air Compressor - Relocation Attempt");
            // customerId and locationId were stripped/ignored and remain bound to original Customer A
            expect(json.data.customerId).toBe(activeCustomer1Id);
            expect(json.data.locationId).toBe(location1Id);

            // Confirm directly against the database that the asset record was NOT mutated
            const dbRecord = await prisma.asset.findUnique({
                where: { id: createdAssetId },
            });
            expect(dbRecord?.customerId).toBe(activeCustomer1Id);
            expect(dbRecord?.locationId).toBe(location1Id);
            expect(dbRecord?.name).toBe("Air Compressor - Relocation Attempt");
        });
    });

    // -------------------------------------------------------------------------
    // 3. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("3. Authentication & Scope Enforcement", () => {
        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/assets");
            const res = await listAssetsHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/assets should reject write-only key with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/assets", {
                token: writeOnlyKey1Secret,
            });

            const res = await listAssetsHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("POST /api/v1/assets should reject read-only key with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/assets", {
                method: "POST",
                token: readOnlyKey1Secret,
                body: { name: "Should Fail Equipment" },
            });

            const res = await createAssetHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("PATCH /api/v1/assets/:id should reject read-only key with 403 FORBIDDEN", async () => {
            const req = mockRequest(`/api/v1/assets/${asset1Id}`, {
                method: "PATCH",
                token: readOnlyKey1Secret,
                body: { name: "Forbidden Update" },
            });

            const res = await updateAssetHandler(req, {
                params: Promise.resolve({ id: asset1Id }),
            });
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Tenant Isolation & Enumeration Resistance (1.18.6 contract)
    // -------------------------------------------------------------------------
    describe("4. Tenant Isolation & Enumeration Resistance", () => {
        it("GET /api/v1/assets/:id should return 404 NOT_FOUND for foreign workspace asset", async () => {
            const req = mockRequest(`/api/v1/assets/${foreignAsset2Id}`, {
                token: fullKey1Secret,
            });

            const res = await getAssetHandler(req, {
                params: Promise.resolve({ id: foreignAsset2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("PATCH /api/v1/assets/:id should return 404 NOT_FOUND for foreign workspace asset", async () => {
            const req = mockRequest(`/api/v1/assets/${foreignAsset2Id}`, {
                method: "PATCH",
                token: fullKey1Secret,
                body: { name: "Hijacked Asset Name" },
            });

            const res = await updateAssetHandler(req, {
                params: Promise.resolve({ id: foreignAsset2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("should return byte-identical 404 responses for nonexistent vs foreign-tenant asset ID under identical requestId", async () => {
            const testReqId = `fixed-trace-ast-${Date.now()}`;

            const nonExistentReq = mockRequest(
                "/api/v1/assets/ast_nonexistent_999999999999",
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const nonExistentRes = await getAssetHandler(nonExistentReq, {
                params: Promise.resolve({ id: "ast_nonexistent_999999999999" }),
            });

            const foreignReq = mockRequest(`/api/v1/assets/${foreignAsset2Id}`, {
                token: fullKey1Secret,
                headers: { "x-request-id": testReqId },
            });
            const foreignRes = await getAssetHandler(foreignReq, {
                params: Promise.resolve({ id: foreignAsset2Id }),
            });

            const nonExistentText = await nonExistentRes.text();
            const foreignText = await foreignRes.text();

            expect(nonExistentRes.status).toBe(404);
            expect(foreignRes.status).toBe(404);
            expect(nonExistentText).toBe(foreignText);
        });

        it("GET /api/v1/assets (list) should strictly isolate records: Workspace 1 list NEVER contains Workspace 2 assets", async () => {
            const req1 = mockRequest("/api/v1/assets", { token: fullKey1Secret });
            const res1 = await listAssetsHandler(req1);
            const json1 = await res1.json();

            const ws1AssetIds = json1.data.map((a: any) => a.id);
            expect(ws1AssetIds).toContain(asset1Id);
            expect(ws1AssetIds).toContain(asset2Id);
            expect(ws1AssetIds).not.toContain(foreignAsset2Id);

            const req2 = mockRequest("/api/v1/assets", { token: fullKey2Secret });
            const res2 = await listAssetsHandler(req2);
            const json2 = await res2.json();

            const ws2AssetIds = json2.data.map((a: any) => a.id);
            expect(ws2AssetIds).toContain(foreignAsset2Id);
            expect(ws2AssetIds).not.toContain(asset1Id);
            expect(ws2AssetIds).not.toContain(asset2Id);
        });
    });

    // -------------------------------------------------------------------------
    // 5. Relational Resolution & Cross-Customer IDOR / Parity Guards
    // -------------------------------------------------------------------------
    describe("5. Relational Resolution & IDOR / Parity Guards", () => {
        it("POST /api/v1/assets should reject creation with foreign workspace customerId (404 NOT_FOUND)", async () => {
            const req = mockRequest("/api/v1/assets", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Rogue Foreign Customer Asset",
                    customerId: activeCustomer2Id, // belongs to Workspace 2!
                },
            });

            const res = await createAssetHandler(req);
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.message).toContain("Customer not found");
        });

        it("POST /api/v1/assets should reject creation with foreign workspace locationId (404 NOT_FOUND)", async () => {
            const req = mockRequest("/api/v1/assets", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Rogue Foreign Location Asset",
                    customerId: activeCustomer1Id,
                    locationId: location2Id, // belongs to Workspace 2!
                },
            });

            const res = await createAssetHandler(req);
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("POST /api/v1/assets within same workspace should reject mismatched customer and location (422 VALIDATION_ERROR)", async () => {
            // Customer A + Location B (Location B belongs to Customer B within WS1)
            const req = mockRequest("/api/v1/assets", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Mismatched Customer/Location Asset",
                    customerId: activeCustomer1Id,
                    locationId: locationB1Id,
                },
            });

            const res = await createAssetHandler(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.message).toContain("Specified service location does not belong to the specified customer");
        });

        it("POST /api/v1/assets should reject assigning asset to an INACTIVE customer (409 CONFLICT)", async () => {
            const req = mockRequest("/api/v1/assets", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Inactive Customer Asset",
                    customerId: inactiveCustomer1Id,
                },
            });

            const res = await createAssetHandler(req);
            expect(res.status).toBe(409);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("CONFLICT");
            expect(json.error.message).toContain("inactive customer");
        });
    });

    // -------------------------------------------------------------------------
    // 6. Validation Error Handling (422)
    // -------------------------------------------------------------------------
    describe("6. Validation & Schema Enforcement", () => {
        it("POST /api/v1/assets should return 422 with field-level details on empty name", async () => {
            const req = mockRequest("/api/v1/assets", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "", // empty name
                },
            });

            const res = await createAssetHandler(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(Array.isArray(json.error.details)).toBe(true);
            expect(json.error.details.length).toBeGreaterThanOrEqual(1);
        });

        it("PATCH /api/v1/assets/:id should return 422 on invalid name length", async () => {
            const req = mockRequest(`/api/v1/assets/${asset1Id}`, {
                method: "PATCH",
                token: fullKey1Secret,
                body: {
                    name: "", // empty string on patch
                },
            });

            const res = await updateAssetHandler(req, {
                params: Promise.resolve({ id: asset1Id }),
            });
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });

    // -------------------------------------------------------------------------
    // 7. Pagination, Filtering, Sorting
    // -------------------------------------------------------------------------
    describe("7. Pagination, Filtering & Sorting", () => {
        it("should apply limit parameter correctly", async () => {
            const req = mockRequest("/api/v1/assets?limit=1", {
                token: fullKey1Secret,
            });

            const res = await listAssetsHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBe(1);
            expect(json.meta.pagination.limit).toBe(1);
            expect(json.meta.pagination.hasMore).toBe(true);
            expect(json.meta.pagination.nextCursor).toBeDefined();
        });

        it("should filter by status (status=IN_STORAGE)", async () => {
            const req = mockRequest("/api/v1/assets?status=IN_STORAGE", {
                token: fullKey1Secret,
            });

            const res = await listAssetsHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            for (const item of json.data) {
                expect(item.status).toBe("IN_STORAGE");
            }
        });

        it("should filter by customerId", async () => {
            const req = mockRequest(`/api/v1/assets?customerId=${activeCustomer1Id}`, {
                token: fullKey1Secret,
            });

            const res = await listAssetsHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            for (const item of json.data) {
                expect(item.customerId).toBe(activeCustomer1Id);
            }
        });

        it("should sort by name ascending when requested", async () => {
            const req = mockRequest("/api/v1/assets?sort=name", {
                token: fullKey1Secret,
            });

            const res = await listAssetsHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBeGreaterThanOrEqual(1);
        });
    });
});
