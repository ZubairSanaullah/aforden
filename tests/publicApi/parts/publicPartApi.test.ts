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
import { APPROVED_PUBLIC_PART_DTO_KEYS } from "@/lib/publicApi/parts/partDto";
import { GET as listPartsHandler } from "@/app/api/v1/parts/route";
import * as partsRouteModule from "@/app/api/v1/parts/route";
import { GET as getPartHandler } from "@/app/api/v1/parts/[id]/route";
import * as partItemRouteModule from "@/app/api/v1/parts/[id]/route";

describe("Phase 1.18.11 — Public Part API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `part_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_part_1_${runId}`;
    const user1Id = `usr_part_1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let unrelatedKey1Secret: string; // key without inventory:read scope
    let part1Id: string;

    // Tenant 2
    const ws2Id = `ws_part_2_${runId}`;
    const user2Id = `usr_part_2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;
    let foreignPart2Id: string;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Setup Workspace 1 and Admin User
        await prisma.user.create({
            data: {
                id: user1Id,
                email: `part-admin1-${runId}@example.com`,
                name: "Part Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Part Workspace 1",
                slug: `part-ws1-${runId}`,
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

        // 2. Setup Workspace 2 and Admin User
        await prisma.user.create({
            data: {
                id: user2Id,
                email: `part-admin2-${runId}@example.com`,
                name: "Part Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Part Workspace 2",
                slug: `part-ws2-${runId}`,
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
            name: "Part Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.INVENTORY_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const unrelatedKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ], // lacks inventory:read
            environment: ApiKeyEnvironment.LIVE,
        });
        unrelatedKey1Secret = unrelatedKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Part Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [PUBLIC_API_SCOPES.INVENTORY_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Part in Workspace 1
        const p1 = await prisma.part.create({
            data: {
                workspaceId: ws1Id,
                name: "OEM Chiller Compressor Valve 4000",
                sku: `SKU-VALVE-${runId}`,
                description: "Heavy duty 4-inch compressor valve",
                unitOfMeasure: "EACH",
                unitCost: 145.50, // Internal cost - MUST NOT LEAK
                minimumStockLevel: 5.0, // Internal threshold - MUST NOT LEAK
                status: "ACTIVE",
            },
        });
        part1Id = p1.id;

        // 6. Seed Part in Workspace 2
        const p2 = await prisma.part.create({
            data: {
                workspaceId: ws2Id,
                name: "Titanium HVAC Duct Coupler",
                sku: `SKU-DUCT-${runId}`,
                description: "High pressure duct coupler",
                unitOfMeasure: "EACH",
                unitCost: 280.00,
                minimumStockLevel: 2.0,
                status: "ACTIVE",
            },
        });
        foreignPart2Id = p2.id;
    });

    afterAll(async () => {
        if (prisma) {
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
                await prisma.part.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.apiKey.deleteMany({
                    where: { developerApplication: { workspaceId: { in: wsIds } } },
                });
                await prisma.developerApplication.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
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
    // 1. Canonical Public DTO Projection & Margin/Cost Protection
    // -------------------------------------------------------------------------
    describe("1. Canonical Public DTO Projection & Cost Protection", () => {
        it("should return the exact approved PublicPartDto key set and exclude internal unitCost/minimumStockLevel", async () => {
            const req = mockRequest(`/api/v1/parts/${part1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getPartHandler(req, {
                params: Promise.resolve({ id: part1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();

            const returnedKeys = Object.keys(json.data).sort();
            const expectedKeys = [...APPROVED_PUBLIC_PART_DTO_KEYS].sort();

            expect(returnedKeys).toEqual(expectedKeys);

            // Explicit assertion of internal cost and planning metric exclusion
            expect(json.data).not.toHaveProperty("unitCost");
            expect(json.data).not.toHaveProperty("minimumStockLevel");
            expect(json.data).not.toHaveProperty("workspaceId");

            expect(json.data.id).toBe(part1Id);
            expect(json.data.name).toBe("OEM Chiller Compressor Valve 4000");
            expect(json.data.sku).toBe(`SKU-VALVE-${runId}`);
            expect(json.data.unitOfMeasure).toBe("EACH");
            expect(json.data.status).toBe("ACTIVE");
        });
    });

    // -------------------------------------------------------------------------
    // 2. Collection & Item Endpoints
    // -------------------------------------------------------------------------
    describe("2. Collection & Item Endpoints", () => {
        it("GET /api/v1/parts should return paginated list of parts", async () => {
            const req = mockRequest("/api/v1/parts?limit=10", {
                token: fullKey1Secret,
            });

            const res = await listPartsHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);
            expect(json.meta?.pagination?.limit).toBe(10);
        });

        it("GET /api/v1/parts/:id should fetch single part by ID", async () => {
            const req = mockRequest(`/api/v1/parts/${part1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getPartHandler(req, {
                params: Promise.resolve({ id: part1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.id).toBe(part1Id);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Strict Read-Only Invariant
    // -------------------------------------------------------------------------
    describe("3. Strict Read-Only Invariant", () => {
        it("should confirm route handlers ONLY export GET", () => {
            expect(partsRouteModule).toHaveProperty("GET");
            expect(partsRouteModule).not.toHaveProperty("POST");
            expect(partsRouteModule).not.toHaveProperty("PATCH");
            expect(partsRouteModule).not.toHaveProperty("DELETE");
            expect(partsRouteModule).not.toHaveProperty("PUT");

            expect(partItemRouteModule).toHaveProperty("GET");
            expect(partItemRouteModule).not.toHaveProperty("POST");
            expect(partItemRouteModule).not.toHaveProperty("PATCH");
            expect(partItemRouteModule).not.toHaveProperty("DELETE");
            expect(partItemRouteModule).not.toHaveProperty("PUT");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("4. Authentication & Scope Enforcement", () => {
        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/parts");
            const res = await listPartsHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/parts should reject key lacking inventory:read scope with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/parts", {
                token: unrelatedKey1Secret,
            });

            const res = await listPartsHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    // -------------------------------------------------------------------------
    // 5. Tenant Isolation & Enumeration Resistance
    // -------------------------------------------------------------------------
    describe("5. Tenant Isolation & Enumeration Resistance", () => {
        it("GET /api/v1/parts/:id should return 404 NOT_FOUND for foreign workspace part", async () => {
            const req = mockRequest(`/api/v1/parts/${foreignPart2Id}`, {
                token: fullKey1Secret,
            });

            const res = await getPartHandler(req, {
                params: Promise.resolve({ id: foreignPart2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("should return byte-identical 404 responses for nonexistent vs foreign-tenant part ID under identical requestId", async () => {
            const testReqId = `fixed-trace-part-${Date.now()}`;

            const nonExistentReq = mockRequest(
                "/api/v1/parts/part_nonexistent_999999999999",
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const nonExistentRes = await getPartHandler(nonExistentReq, {
                params: Promise.resolve({ id: "part_nonexistent_999999999999" }),
            });

            const foreignReq = mockRequest(`/api/v1/parts/${foreignPart2Id}`, {
                token: fullKey1Secret,
                headers: { "x-request-id": testReqId },
            });
            const foreignRes = await getPartHandler(foreignReq, {
                params: Promise.resolve({ id: foreignPart2Id }),
            });

            const nonExistentText = await nonExistentRes.text();
            const foreignText = await foreignRes.text();

            expect(nonExistentRes.status).toBe(404);
            expect(foreignRes.status).toBe(404);
            expect(nonExistentText).toBe(foreignText);
        });

        it("GET /api/v1/parts (list) should strictly isolate records: Workspace 1 list NEVER contains Workspace 2 parts", async () => {
            const req1 = mockRequest("/api/v1/parts", { token: fullKey1Secret });
            const res1 = await listPartsHandler(req1);
            const json1 = await res1.json();

            const ws1PartIds = json1.data.map((p: any) => p.id);
            expect(ws1PartIds).toContain(part1Id);
            expect(ws1PartIds).not.toContain(foreignPart2Id);

            const req2 = mockRequest("/api/v1/parts", { token: fullKey2Secret });
            const res2 = await listPartsHandler(req2);
            const json2 = await res2.json();

            const ws2PartIds = json2.data.map((p: any) => p.id);
            expect(ws2PartIds).toContain(foreignPart2Id);
            expect(ws2PartIds).not.toContain(part1Id);
        });
    });
});
