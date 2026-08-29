import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
    createDeveloperApplication,
    createApiKey,
    ApiKeyEnvironment,
} from "@/lib/services/developerApp";
import { PUBLIC_API_SCOPES } from "@/lib/publicApi/scopes";
import {
    withTenantScope,
    getAuthenticatedWorkspaceId,
    runWithPublicApiContext,
} from "@/lib/publicApi";
import {
    GET as echoGetHandler,
    POST as echoPostHandler,
    registerMockTenantResource,
    clearMockTenantResources,
} from "@/app/api/v1/_internal-test-only/tenant-scoped-echo/route";

describe("Phase 1.18.6 — Public API Tenant Isolation & Scoping Primitives", () => {
    let prisma: PrismaClient;
    const runId = `tenant_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_tenant_1_${runId}`;
    const user1Id = `usr_tenant_1_${runId}`;
    let app1Id: string;
    let key1Secret: string;
    const item1Id = `item_ws1_${runId}`;

    // Tenant 2
    const ws2Id = `ws_tenant_2_${runId}`;
    const user2Id = `usr_tenant_2_${runId}`;
    let app2Id: string;
    let key2Secret: string;
    const item2Id = `item_ws2_${runId}`;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Create Workspace 1 & Credentials
        await prisma.user.create({
            data: {
                id: user1Id,
                email: `tenant1-${runId}@example.com`,
                name: "Tenant 1 User",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Tenant 1 Workspace",
                slug: `tenant-1-slug-${runId}`,
            },
        });
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "Tenant 1 Client",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;
        const key1 = await createApiKey(ws1Id, app1Id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [PUBLIC_API_SCOPES.PING_READ],
        });
        key1Secret = key1.rawSecretKey;

        // 2. Create Workspace 2 & Credentials
        await prisma.user.create({
            data: {
                id: user2Id,
                email: `tenant2-${runId}@example.com`,
                name: "Tenant 2 User",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Tenant 2 Workspace",
                slug: `tenant-2-slug-${runId}`,
            },
        });
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Tenant 2 Client",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;
        const key2 = await createApiKey(ws2Id, app2Id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [PUBLIC_API_SCOPES.PING_READ],
        });
        key2Secret = key2.rawSecretKey;

        // 3. Register real dynamic mock resources scoped to the dynamic workspace IDs
        registerMockTenantResource({
            id: item1Id,
            name: "HVAC Unit A (Tenant 1)",
            workspaceId: ws1Id,
        });
        registerMockTenantResource({
            id: item2Id,
            name: "Elevator Motor B (Tenant 2)",
            workspaceId: ws2Id,
        });
    });

    afterAll(async () => {
        clearMockTenantResources();
        if (prisma) {
            await prisma.developerApplication.deleteMany({
                where: { createdByUserId: { in: [user1Id, user2Id] } },
            });
            await prisma.workspace.deleteMany({
                where: { id: { in: [ws1Id, ws2Id] } },
            });
            await prisma.user.deleteMany({
                where: { id: { in: [user1Id, user2Id] } },
            });
            await prisma.$disconnect();
        }
    });

    describe("1. Tenant Resolution Chain Integrity", () => {
        it("should resolve Workspace 1 ID when authenticated with Workspace 1 API key", async () => {
            const req = new Request("http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${key1Secret}`,
                    "x-request-id": "tenant-res-ws1",
                },
            });

            const res = await echoGetHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.resolvedWorkspaceId).toBe(ws1Id);
            expect(json.data.developerApplicationId).toBe(app1Id);
        });

        it("should resolve Workspace 2 ID when authenticated with Workspace 2 API key", async () => {
            const req = new Request("http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${key2Secret}`,
                    "x-request-id": "tenant-res-ws2",
                },
            });

            const res = await echoGetHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.resolvedWorkspaceId).toBe(ws2Id);
            expect(json.data.developerApplicationId).toBe(app2Id);
        });
    });

    describe("2. Caller-Supplied Workspace Parameter Immunity", () => {
        it("should ignore query parameter overrides (?workspaceId=... / ?workspace_id=...)", async () => {
            const maliciousUrl = `http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo?workspaceId=${ws2Id}&workspace_id=${ws2Id}`;
            const req = new Request(maliciousUrl, {
                method: "GET",
                headers: {
                    authorization: `Bearer ${key1Secret}`,
                    "x-request-id": "tenant-override-query",
                },
            });

            const res = await echoGetHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            // Context MUST remain Workspace 1 despite malicious query params
            expect(json.data.resolvedWorkspaceId).toBe(ws1Id);
            expect(json.data.callerSuppliedParametersIgnored.queryWorkspaceId).toBe(ws2Id);
        });

        it("should ignore custom header overrides (X-Workspace-Id / Workspace-Id)", async () => {
            const req = new Request("http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${key1Secret}`,
                    "x-workspace-id": ws2Id,
                    "workspace-id": ws2Id,
                    "x-request-id": "tenant-override-header",
                },
            });

            const res = await echoGetHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.resolvedWorkspaceId).toBe(ws1Id);
            expect(json.data.callerSuppliedParametersIgnored.headerWorkspaceId).toBe(ws2Id);
        });

        it("should ignore body overrides ({ workspaceId: ... }) on POST mutations", async () => {
            const req = new Request("http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${key1Secret}`,
                    "content-type": "application/json",
                    "x-request-id": "tenant-override-body",
                },
                body: JSON.stringify({
                    workspaceId: ws2Id, // Attempted spoof
                    name: "Malicious Resource Creation",
                }),
            });

            const res = await echoPostHandler(req);
            expect(res.status).toBe(201);

            const json = await res.json();
            expect(json.success).toBe(true);
            // Enforced workspaceId strictly matches the authenticated key
            expect(json.data.enforcedWorkspaceId).toBe(ws1Id);
        });
    });

    describe("3. Cross-Tenant Resource Isolation & Enumeration Resistance", () => {
        it("should return HTTP 200 when querying a real resource genuinely belonging to the authenticated workspace (Workspace 1)", async () => {
            const req = new Request(
                `http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo?resourceId=${item1Id}`,
                {
                    method: "GET",
                    headers: {
                        authorization: `Bearer ${key1Secret}`,
                        "x-request-id": "own-tenant-query-ws1",
                    },
                },
            );
            const res = await echoGetHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual({
                id: item1Id,
                name: "HVAC Unit A (Tenant 1)",
                workspaceId: ws1Id,
            });
        });

        it("should return HTTP 200 when querying a real resource genuinely belonging to the authenticated workspace (Workspace 2)", async () => {
            const req = new Request(
                `http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo?resourceId=${item2Id}`,
                {
                    method: "GET",
                    headers: {
                        authorization: `Bearer ${key2Secret}`,
                        "x-request-id": "own-tenant-query-ws2",
                    },
                },
            );
            const res = await echoGetHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual({
                id: item2Id,
                name: "Elevator Motor B (Tenant 2)",
                workspaceId: ws2Id,
            });
        });

        it("should return HTTP 404 NOT_FOUND when querying a real resource that belongs to another tenant (Workspace 2 item queried with Workspace 1 key)", async () => {
            const req = new Request(
                `http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo?resourceId=${item2Id}`,
                {
                    method: "GET",
                    headers: {
                        authorization: `Bearer ${key1Secret}`,
                        "x-request-id": "cross-tenant-blocked",
                    },
                },
            );
            const res = await echoGetHandler(req);
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.message).toBe("Resource not found.");
        });

        it("should return HTTP 404 NOT_FOUND when querying a non-existent resource ID", async () => {
            const req = new Request(
                "http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo?resourceId=item_completely_non_existent",
                {
                    method: "GET",
                    headers: {
                        authorization: `Bearer ${key1Secret}`,
                        "x-request-id": "non-existent-item",
                    },
                },
            );
            const res = await echoGetHandler(req);
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.message).toBe("Resource not found.");
        });

        it("should return byte-identical 404 NOT_FOUND responses for nonexistent resource vs cross-tenant resource under identical requestId", async () => {
            const fixedRequestId = "cross-tenant-enum-check-123";

            // Case A: Querying completely non-existent item
            const reqNonExistent = new Request(
                "http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo?resourceId=item_non_existent",
                {
                    method: "GET",
                    headers: {
                        authorization: `Bearer ${key1Secret}`,
                        "x-request-id": fixedRequestId,
                    },
                },
            );
            const resNonExistent = await echoGetHandler(reqNonExistent);
            expect(resNonExistent.status).toBe(404);
            const bodyNonExistent = await resNonExistent.text();

            // Case B: Querying real item belonging to Workspace 2 using Workspace 1 key
            const reqForeign = new Request(
                `http://localhost:3000/api/v1/_internal-test-only/tenant-scoped-echo?resourceId=${item2Id}`,
                {
                    method: "GET",
                    headers: {
                        authorization: `Bearer ${key1Secret}`,
                        "x-request-id": fixedRequestId,
                    },
                },
            );
            const resForeign = await echoGetHandler(reqForeign);
            expect(resForeign.status).toBe(404);
            const bodyForeign = await resForeign.text();

            // Zero distinguishing signal: bodies are 100% byte-identical
            expect(bodyForeign).toBe(bodyNonExistent);
        });
    });

    describe("4. withTenantScope Primitive Verification", () => {
        it("should extract workspaceId from context and execute callback correctly", async () => {
            const mockContext = {
                requestId: "test-ctx-1",
                startTime: Date.now(),
                version: "v1",
                auth: {
                    apiKeyId: "key_mock_1",
                    developerApplicationId: "app_mock_1",
                    developerApplicationName: "Mock App",
                    workspaceId: "ws_mock_target_777",
                    environment: "LIVE" as const,
                    scopes: ["ping:read"],
                },
            };

            await runWithPublicApiContext(mockContext, async () => {
                const resolvedWs = getAuthenticatedWorkspaceId();
                expect(resolvedWs).toBe("ws_mock_target_777");

                const result = await withTenantScope(async (tenantId, paramA, paramB) => {
                    return `${tenantId}:${paramA}:${paramB}`;
                }, "alpha", 123);

                expect(result).toBe("ws_mock_target_777:alpha:123");
            });
        });
    });
});
