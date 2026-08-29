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
import { APPROVED_PUBLIC_INVENTORY_DTO_KEYS } from "@/lib/publicApi/inventory/inventoryDto";
import { GET as listInventoryHandler } from "@/app/api/v1/inventory/route";
import * as inventoryRouteModule from "@/app/api/v1/inventory/route";

describe("Phase 1.18.11 — Public Inventory API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_inv_1_${runId}`;
    const user1Id = `usr_inv_1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let unrelatedKey1Secret: string;

    let part1Id: string;
    let loc1Id: string;
    let balance1Id: string;

    // Tenant 2
    const ws2Id = `ws_inv_2_${runId}`;
    const user2Id = `usr_inv_2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    let part2Id: string;
    let loc2Id: string;
    let foreignBalance2Id: string;

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
                email: `inv-admin1-${runId}@example.com`,
                name: "Inv Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Inventory Workspace 1",
                slug: `inv-ws1-${runId}`,
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
                email: `inv-admin2-${runId}@example.com`,
                name: "Inv Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Inventory Workspace 2",
                slug: `inv-ws2-${runId}`,
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
            name: "Inventory Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.INVENTORY_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const unrelatedKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.CUSTOMERS_READ], // lacks inventory:read
            environment: ApiKeyEnvironment.LIVE,
        });
        unrelatedKey1Secret = unrelatedKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Inventory Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [PUBLIC_API_SCOPES.INVENTORY_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Part, Location, and Balance in Workspace 1
        const p1 = await prisma.part.create({
            data: {
                workspaceId: ws1Id,
                name: "Copper Pipe Joint 1/2in",
                sku: `SKU-PIPE-${runId}`,
                unitOfMeasure: "EACH",
                unitCost: 12.50,
                status: "ACTIVE",
            },
        });
        part1Id = p1.id;

        const loc1 = await prisma.inventoryLocation.create({
            data: {
                workspaceId: ws1Id,
                name: "Central Warehouse A",
                code: `WH-A-${runId}`,
                locationType: "WAREHOUSE",
            },
        });
        loc1Id = loc1.id;

        const b1 = await prisma.inventoryBalance.create({
            data: {
                workspaceId: ws1Id,
                partId: part1Id,
                locationId: loc1Id,
                quantityOnHand: 150.0,
                quantityReserved: 25.0,
            },
        });
        balance1Id = b1.id;

        // 6. Seed Part, Location, and Balance in Workspace 2
        const p2 = await prisma.part.create({
            data: {
                workspaceId: ws2Id,
                name: "Galvanized Steel Flange 2in",
                sku: `SKU-FLANGE-${runId}`,
                unitOfMeasure: "EACH",
                unitCost: 45.00,
                status: "ACTIVE",
            },
        });
        part2Id = p2.id;

        const loc2 = await prisma.inventoryLocation.create({
            data: {
                workspaceId: ws2Id,
                name: "Main Storage Facility",
                code: `WH-B-${runId}`,
                locationType: "WAREHOUSE",
            },
        });
        loc2Id = loc2.id;

        const b2 = await prisma.inventoryBalance.create({
            data: {
                workspaceId: ws2Id,
                partId: part2Id,
                locationId: loc2Id,
                quantityOnHand: 80.0,
                quantityReserved: 10.0,
            },
        });
        foreignBalance2Id = b2.id;
    });

    afterAll(async () => {
        if (prisma) {
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
                await prisma.inventoryBalance.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.inventoryLocation.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
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
    // 1. Canonical Public DTO Projection
    // -------------------------------------------------------------------------
    describe("1. Canonical Public DTO Projection", () => {
        it("should return the exact approved PublicInventoryBalanceDto key set with calculated available quantity", async () => {
            const req = mockRequest("/api/v1/inventory", {
                token: fullKey1Secret,
            });

            const res = await listInventoryHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);

            const firstItem = json.data[0];
            const returnedKeys = Object.keys(firstItem).sort();
            const expectedKeys = [...APPROVED_PUBLIC_INVENTORY_DTO_KEYS].sort();

            expect(returnedKeys).toEqual(expectedKeys);
            expect(firstItem).not.toHaveProperty("workspaceId");

            expect(firstItem.id).toBe(balance1Id);
            expect(firstItem.partId).toBe(part1Id);
            expect(firstItem.locationId).toBe(loc1Id);
            expect(firstItem.quantityOnHand).toBe(150.0);
            expect(firstItem.quantityReserved).toBe(25.0);
            expect(firstItem.quantityAvailable).toBe(125.0); // (150 - 25)
        });
    });

    // -------------------------------------------------------------------------
    // 2. Strict Read-Only Invariant
    // -------------------------------------------------------------------------
    describe("2. Strict Read-Only Invariant", () => {
        it("should confirm inventory route module ONLY exports GET", () => {
            expect(inventoryRouteModule).toHaveProperty("GET");
            expect(inventoryRouteModule).not.toHaveProperty("POST");
            expect(inventoryRouteModule).not.toHaveProperty("PATCH");
            expect(inventoryRouteModule).not.toHaveProperty("DELETE");
            expect(inventoryRouteModule).not.toHaveProperty("PUT");
        });
    });

    // -------------------------------------------------------------------------
    // 3. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("3. Authentication & Scope Enforcement", () => {
        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/inventory");
            const res = await listInventoryHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/inventory should reject key lacking inventory:read scope with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/inventory", {
                token: unrelatedKey1Secret,
            });

            const res = await listInventoryHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Tenant Isolation
    // -------------------------------------------------------------------------
    describe("4. Tenant Isolation", () => {
        it("GET /api/v1/inventory (list) should strictly isolate records: Workspace 1 NEVER sees Workspace 2 balances", async () => {
            const req1 = mockRequest("/api/v1/inventory", { token: fullKey1Secret });
            const res1 = await listInventoryHandler(req1);
            const json1 = await res1.json();

            const ws1BalanceIds = json1.data.map((b: any) => b.id);
            expect(ws1BalanceIds).toContain(balance1Id);
            expect(ws1BalanceIds).not.toContain(foreignBalance2Id);

            const req2 = mockRequest("/api/v1/inventory", { token: fullKey2Secret });
            const res2 = await listInventoryHandler(req2);
            const json2 = await res2.json();

            const ws2BalanceIds = json2.data.map((b: any) => b.id);
            expect(ws2BalanceIds).toContain(foreignBalance2Id);
            expect(ws2BalanceIds).not.toContain(balance1Id);
        });
    });
});
