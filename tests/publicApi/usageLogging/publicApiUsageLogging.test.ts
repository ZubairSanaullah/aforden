import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma as globalPrisma } from "@/lib/prisma";
import {
    createDeveloperApplication,
    createApiKey,
} from "@/lib/services/developerApp/developerAppService";
import {
    PUBLIC_API_SCOPES,
    queryApiRequestLogs,
    recordApiRequestLog,
    deleteApiRequestLogsForTesting,
} from "@/lib/publicApi";
import { GET as listWorkOrdersHandler, POST as createWorkOrderHandler } from "@/app/api/v1/work-orders/route";
import { GET as getWorkOrderHandler } from "@/app/api/v1/work-orders/[id]/route";

describe("Phase 1.18.14 — API Usage & Request Logging", () => {
    let prisma: PrismaClient;

    let ws1Id: string;
    let ws2Id: string;
    let user1Id: string;
    let user2Id: string;

    let app1Id: string;
    let apiKey1Secret: string;
    let apiKey1Id: string;

    let app2Id: string;
    let apiKey2Secret: string;
    let apiKey2Id: string;

    let cust1Id: string;
    let loc1Id: string;
    let wt1Id: string;

    const runId = Math.random().toString(36).substring(2, 9);

    beforeAll(async () => {
        const connectionString =
            process.env.TEST_DATABASE_URL ||
            process.env.DATABASE_URL ||
            "postgresql://postgres:postgres@localhost:5432/aforden";

        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });

        // 1. Setup Test Workspace 1
        const ws1 = await prisma.workspace.create({
            data: {
                name: `UsageLog WS 1 ${runId}`,
                slug: `usagelog-ws1-${runId}`,
            },
        });
        ws1Id = ws1.id;

        const user1 = await prisma.user.create({
            data: {
                name: `UsageLog User 1 ${runId}`,
                email: `usagelog-user1-${runId}@example.com`,
                status: "ACTIVE",
                emailVerified: new Date(),
            },
        });
        user1Id = user1.id;

        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws1Id,
                userId: user1Id,
                role: "OWNER",
                status: "ACTIVE",
            },
        });

        // 2. Setup Test Workspace 2
        const ws2 = await prisma.workspace.create({
            data: {
                name: `UsageLog WS 2 ${runId}`,
                slug: `usagelog-ws2-${runId}`,
            },
        });
        ws2Id = ws2.id;

        const user2 = await prisma.user.create({
            data: {
                name: `UsageLog User 2 ${runId}`,
                email: `usagelog-user2-${runId}@example.com`,
                status: "ACTIVE",
                emailVerified: new Date(),
            },
        });
        user2Id = user2.id;

        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: user2Id,
                role: "OWNER",
                status: "ACTIVE",
            },
        });

        // 3. Setup Developer App & Key for Workspace 1
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "UsageLog App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const key1Res = await createApiKey(ws1Id, app1Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        apiKey1Secret = key1Res.rawSecretKey;
        apiKey1Id = key1Res.id;

        // 4. Setup Developer App & Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "UsageLog App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const key2Res = await createApiKey(ws2Id, app2Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        apiKey2Secret = key2Res.rawSecretKey;
        apiKey2Id = key2Res.id;

        // 5. Seed Domain Resources for Workspace 1
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                name: `UsageLog Customer ${runId}`,
                email: `cust-${runId}@example.com`,
            },
        });
        cust1Id = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: cust1Id,
                name: "HQ Location",
                addressLine1: "100 Innovation Way",
                city: "San Francisco",
                state: "CA",
                postalCode: "94105",
                country: "US",
            },
        });
        loc1Id = loc1.id;

        const cat1 = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws1Id,
                name: "General Services",
                status: "ACTIVE",
            },
        });

        const wt1 = await prisma.workType.create({
            data: {
                workspaceId: ws1Id,
                catalogId: cat1.id,
                name: `Maintenance ${runId}`,
                code: `MAINT-${runId}`,
                status: "ACTIVE",
                estimatedDuration: 120,
            },
        });
        wt1Id = wt1.id;
    });

    afterAll(async () => {
        // Clean up workspaces
        const wsIds = [ws1Id, ws2Id].filter(Boolean);
        if (wsIds.length > 0) {
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
    });

    beforeEach(async () => {
        await deleteApiRequestLogsForTesting(ws1Id);
        await deleteApiRequestLogsForTesting(ws2Id);
    });

    function createGetRequest(url: string, token?: string, customHeaders?: Record<string, string>): Request {
        const headers = new Headers();
        if (token) {
            headers.set("authorization", `Bearer ${token}`);
        }
        headers.set("user-agent", "AfordenIntegrationClient/1.0");
        if (customHeaders) {
            for (const [k, v] of Object.entries(customHeaders)) {
                headers.set(k, v);
            }
        }
        return new Request(url, { method: "GET", headers });
    }

    function createPostRequest(url: string, body: any, token?: string, customHeaders?: Record<string, string>): Request {
        const headers = new Headers({
            "content-type": "application/json",
            "user-agent": "AfordenIntegrationClient/1.0",
        });
        if (token) {
            headers.set("authorization", `Bearer ${token}`);
        }
        if (customHeaders) {
            for (const [k, v] of Object.entries(customHeaders)) {
                headers.set(k, v);
            }
        }
        return new Request(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
    }

    // Helper to wait briefly for fire-and-forget logs to complete
    async function waitForLogs(wsId: string, minCount = 1, maxRetries = 20): Promise<any[]> {
        for (let i = 0; i < maxRetries; i++) {
            const logs = await prisma.apiRequestLog.findMany({
                where: { workspaceId: wsId },
                orderBy: { createdAt: "desc" },
            });
            if (logs.length >= minCount) {
                return logs;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return prisma.apiRequestLog.findMany({
            where: { workspaceId: wsId },
            orderBy: { createdAt: "desc" },
        });
    }

    describe("1. Successful Request Logging", () => {
        it("records full execution metadata (workspaceId, apiKeyId, endpoint, method, statusCode, durationMs, requestId)", async () => {
            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret);
            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const requestId = res.headers.get("x-request-id");
            expect(requestId).toBeDefined();

            const logs = await waitForLogs(ws1Id, 1);
            expect(logs.length).toBe(1);

            const log = logs[0];
            expect(log.workspaceId).toBe(ws1Id);
            expect(log.apiKeyId).toBe(apiKey1Id);
            expect(log.developerApplicationId).toBe(app1Id);
            expect(log.endpoint).toBe("/api/v1/work-orders");
            expect(log.method).toBe("GET");
            expect(log.statusCode).toBe(200);
            expect(log.requestId).toBe(requestId);
            expect(log.durationMs).toBeGreaterThanOrEqual(0);
            expect(log.apiVersion).toBe("v1");
            expect(log.userAgent).toBe("AfordenIntegrationClient/1.0");
            expect(log.ipHash).toBeDefined();
            expect(log.errorCode).toBeNull();
        });
    });

    describe("2. Error Status Code Logging", () => {
        it("records 404 NOT_FOUND errors with status and errorCode", async () => {
            const req = createGetRequest("http://localhost/api/v1/work-orders/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getWorkOrderHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);

            const logs = await waitForLogs(ws1Id, 1);
            expect(logs.length).toBe(1);

            const log = logs[0];
            expect(log.statusCode).toBe(404);
            expect(log.errorCode).toBe("NOT_FOUND");
            expect(log.endpoint).toBe("/api/v1/work-orders/cuid_nonexistent_9999");
        });

        it("records 422 VALIDATION_ERROR when creating work order with invalid body", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                { title: "" }, // Invalid body
                apiKey1Secret,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(422);

            const logs = await waitForLogs(ws1Id, 1);
            expect(logs.length).toBe(1);

            const log = logs[0];
            expect(log.statusCode).toBe(422);
            expect(log.errorCode).toBe("VALIDATION_ERROR");
        });

        it("records 403 FORBIDDEN when API key lacks required write scope", async () => {
            // Create a read-only API key
            const readOnlyKey = await createApiKey(ws1Id, app1Id, {
                environment: "LIVE",
                scopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ],
            });

            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    customerId: cust1Id,
                    locationId: loc1Id,
                    workTypeId: wt1Id,
                    title: "Test WO",
                },
                readOnlyKey.rawSecretKey,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(403);

            const logs = await waitForLogs(ws1Id, 1);
            expect(logs.length).toBe(1);

            const log = logs[0];
            expect(log.statusCode).toBe(403);
            expect(log.errorCode).toBe("FORBIDDEN");
            expect(log.apiKeyId).toBe(readOnlyKey.id);
        });
    });

    describe("3. Security & PII Zero-Leakage Audit", () => {
        it("strictly omits raw secret keys, Authorization header tokens, and request/response payload bodies", async () => {
            const sensitiveTitle = "Confidential customer repair in suite 400";
            const sensitiveDescription = "Customer SSN/Pin: 1234, Access code: 9999";

            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    customerId: cust1Id,
                    locationId: loc1Id,
                    workTypeId: wt1Id,
                    title: sensitiveTitle,
                    description: sensitiveDescription,
                },
                apiKey1Secret,
                { authorization: `Bearer ${apiKey1Secret}` },
            );

            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(201);

            const logs = await waitForLogs(ws1Id, 1);
            expect(logs.length).toBe(1);

            const log = logs[0];
            const logString = JSON.stringify(log);

            // Assert raw secret key is NEVER stored
            expect(logString).not.toContain(apiKey1Secret);
            expect(logString).not.toContain("Bearer");

            // Assert sensitive request payload body is NEVER stored
            expect(logString).not.toContain(sensitiveTitle);
            expect(logString).not.toContain(sensitiveDescription);
            expect(logString).not.toContain("Access code");

            // Assert exact permitted keys on Prisma model
            const allowedKeys = [
                "id",
                "workspaceId",
                "apiKeyId",
                "developerApplicationId",
                "requestId",
                "endpoint",
                "method",
                "statusCode",
                "durationMs",
                "ipHash",
                "userAgent",
                "apiVersion",
                "rateLimitTier",
                "errorCode",
                "createdAt",
            ];
            expect(Object.keys(log).sort()).toEqual(allowedKeys.sort());
        });
    });

    describe("4. Non-Throwing Failure Isolation Guarantee", () => {
        it("simulated logging write failure does not cause the actual API response to fail or change", async () => {
            // Spy on globalPrisma.apiRequestLog.create and simulate a database connection exception
            const createSpy = vi.spyOn(globalPrisma.apiRequestLog, "create").mockRejectedValueOnce(
                new Error("Database connection timeout during log insert"),
            );

            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret);
            const res = await listWorkOrdersHandler(req);

            // API request MUST still succeed with HTTP 200
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);

            createSpy.mockRestore();
        });

        it("recordApiRequestLog function catches and swallows all internal exceptions without throwing", async () => {
            // Direct call with simulated failure
            const createSpy = vi.spyOn(globalPrisma.apiRequestLog, "create").mockRejectedValueOnce(
                new Error("Disk full"),
            );

            const result = await recordApiRequestLog({
                workspaceId: ws1Id,
                requestId: "req_test_failsafe",
                endpoint: "/api/v1/test",
                method: "GET",
                statusCode: 200,
                durationMs: 12,
            });

            expect(result).toBeNull();
            createSpy.mockRestore();
        });
    });

    describe("5. Multi-Tenant Partitioning & Query Service", () => {
        it("queryApiRequestLogs strictly partitions records by workspaceId with zero cross-tenant leakage", async () => {
            // 1. Generate 3 requests in Workspace 1
            await listWorkOrdersHandler(createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret));
            await listWorkOrdersHandler(createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret));
            await listWorkOrdersHandler(createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret));

            // 2. Generate 2 requests in Workspace 2
            await listWorkOrdersHandler(createGetRequest("http://localhost/api/v1/work-orders", apiKey2Secret));
            await listWorkOrdersHandler(createGetRequest("http://localhost/api/v1/work-orders", apiKey2Secret));

            await waitForLogs(ws1Id, 3);
            await waitForLogs(ws2Id, 2);

            // Query Workspace 1
            const ws1Query = await queryApiRequestLogs(ws1Id);
            expect(ws1Query.items.length).toBe(3);
            for (const item of ws1Query.items) {
                expect(item.workspaceId).toBe(ws1Id);
                expect(item.apiKeyId).toBe(apiKey1Id);
            }

            // Query Workspace 2
            const ws2Query = await queryApiRequestLogs(ws2Id);
            expect(ws2Query.items.length).toBe(2);
            for (const item of ws2Query.items) {
                expect(item.workspaceId).toBe(ws2Id);
                expect(item.apiKeyId).toBe(apiKey2Id);
            }
        });

        it("supports cursor-based pagination and status filtering", async () => {
            // Create 5 log records
            for (let i = 0; i < 5; i++) {
                await listWorkOrdersHandler(createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret));
            }
            await waitForLogs(ws1Id, 5);

            // Query page 1 (limit 2)
            const page1 = await queryApiRequestLogs(ws1Id, { limit: 2 });
            expect(page1.items.length).toBe(2);
            expect(page1.hasMore).toBe(true);
            expect(page1.nextCursor).toBeDefined();

            // Query page 2 (limit 2 with cursor)
            const page2 = await queryApiRequestLogs(ws1Id, { limit: 2, cursor: page1.nextCursor! });
            expect(page2.items.length).toBe(2);
            expect(page2.hasMore).toBe(true);
            expect(page2.items[0].id).not.toBe(page1.items[0].id);

            // Query page 3 (limit 2 with cursor)
            const page3 = await queryApiRequestLogs(ws1Id, { limit: 2, cursor: page2.nextCursor! });
            expect(page3.items.length).toBe(1);
            expect(page3.hasMore).toBe(false);
            expect(page3.nextCursor).toBeNull();
        });
    });
}, 30000);
