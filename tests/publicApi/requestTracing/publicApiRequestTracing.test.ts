import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
    createDeveloperApplication,
    createApiKey,
} from "@/lib/services/developerApp/developerAppService";
import {
    PUBLIC_API_SCOPES,
    REQUEST_ID_HEADER_NAME,
    isValidRequestId,
    generateRequestId,
    resolveRequestId,
    withPublicApiAuth,
    jsonError,
} from "@/lib/publicApi";
import { GET as listWorkOrdersHandler, POST as createWorkOrderHandler } from "@/app/api/v1/work-orders/route";
import { GET as getWorkOrderHandler } from "@/app/api/v1/work-orders/[id]/route";

describe("Phase 1.18.15 — Request IDs & Distributed Trace Foundation", () => {
    let prisma: PrismaClient;

    let ws1Id: string;
    let user1Id: string;
    let app1Id: string;
    let apiKey1Secret: string;
    let apiKey1Id: string;

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

        // Setup Test Workspace
        const ws1 = await prisma.workspace.create({
            data: {
                name: `Trace WS ${runId}`,
                slug: `trace-ws-${runId}`,
            },
        });
        ws1Id = ws1.id;

        const user1 = await prisma.user.create({
            data: {
                name: `Trace User ${runId}`,
                email: `trace-user-${runId}@example.com`,
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

        // Setup Developer App & Key
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "Trace Test App",
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

        // Seed domain resources for Work Order creation
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                name: `Trace Customer ${runId}`,
                email: `trace-cust-${runId}@example.com`,
            },
        });
        cust1Id = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: cust1Id,
                name: "Trace HQ Location",
                addressLine1: "123 Trace Blvd",
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
                name: "Trace Catalog",
                status: "ACTIVE",
            },
        });

        const wt1 = await prisma.workType.create({
            data: {
                workspaceId: ws1Id,
                catalogId: cat1.id,
                name: `Trace WorkType ${runId}`,
                code: `WT-TR-${runId}`,
                status: "ACTIVE",
                estimatedDuration: 60,
            },
        });
        wt1Id = wt1.id;
    });

    afterAll(async () => {
        if (ws1Id) {
            await prisma.workspace.deleteMany({
                where: { id: ws1Id },
            });
        }
        if (user1Id) {
            await prisma.user.deleteMany({
                where: { id: user1Id },
            });
        }
        await prisma.$disconnect();
    });

    beforeEach(async () => {
        await prisma.apiRequestLog.deleteMany({
            where: { workspaceId: ws1Id },
        });
        await prisma.apiIdempotencyRecord.deleteMany({
            where: { workspaceId: ws1Id },
        });
    });

    function createGetRequest(url: string, token?: string, customHeaders?: Record<string, string>): Request {
        const headers = new Headers();
        if (token) {
            headers.set("authorization", `Bearer ${token}`);
        }
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

    async function waitForSpecificLogs(wsId: string, requestIds: string[], maxRetries = 30): Promise<any[]> {
        for (let i = 0; i < maxRetries; i++) {
            const logs = await prisma.apiRequestLog.findMany({
                where: { workspaceId: wsId, requestId: { in: requestIds } },
            });
            if (logs.length >= requestIds.length) {
                return logs;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return prisma.apiRequestLog.findMany({
            where: { workspaceId: wsId, requestId: { in: requestIds } },
        });
    }

    describe("1. End-to-End Trace Identity Consistency", () => {
        it("guarantees identical requestId across response header, body meta, and ApiRequestLog record", async () => {
            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret);
            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();
            expect(headerRequestId?.startsWith("req_")).toBe(true);

            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.meta).toBeDefined();
            expect(body.meta.requestId).toBe(headerRequestId);

            const logs = await waitForSpecificLogs(ws1Id, [headerRequestId!]);
            expect(logs.length).toBe(1);
            expect(logs[0].requestId).toBe(headerRequestId);
            expect(logs[0].statusCode).toBe(200);
        });

        it("preserves valid client-supplied X-Request-Id across header, body meta, and database log", async () => {
            const clientTraceId = "client-trace-custom-98765-prod";
            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret, {
                [REQUEST_ID_HEADER_NAME]: clientTraceId,
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBe(clientTraceId);

            const body = await res.json();
            expect(body.meta.requestId).toBe(clientTraceId);

            const logs = await waitForSpecificLogs(ws1Id, [clientTraceId]);
            expect(logs.length).toBe(1);
            expect(logs[0].requestId).toBe(clientTraceId);
        });
    });

    describe("2. Client-Supplied ID Validation & Sanitization Guard", () => {
        it("unit tests isValidRequestId and resolveRequestId on malicious or malformed inputs", () => {
            // Valid cases
            expect(isValidRequestId("req_valid_custom_client_trace_123")).toBe(true);
            expect(isValidRequestId("client-trace-id-12345")).toBe(true);
            expect(isValidRequestId("a".repeat(64))).toBe(true);

            // Invalid / Malicious cases
            expect(isValidRequestId("")).toBe(false);
            expect(isValidRequestId(null)).toBe(false);
            expect(isValidRequestId(undefined)).toBe(false);
            expect(isValidRequestId("   ")).toBe(false);
            expect(isValidRequestId("req_'; DROP TABLE api_request_logs; --")).toBe(false);
            expect(isValidRequestId("<script>alert('xss')</script>")).toBe(false);
            expect(isValidRequestId("req_valid\r\nInjected-Header: evil")).toBe(false);
            expect(isValidRequestId("req_🚀_trace_🔥")).toBe(false);
            expect(isValidRequestId("a".repeat(65))).toBe(false);
            expect(isValidRequestId("req with spaces")).toBe(false);
            expect(isValidRequestId("req\twith\ttabs")).toBe(false);

            // resolveRequestId fallback behavior
            const fallback1 = resolveRequestId("req_'; DROP TABLE api_request_logs; --");
            expect(fallback1.isGenerated).toBe(true);
            expect(fallback1.requestId.startsWith("req_")).toBe(true);
            expect(fallback1.requestId).not.toContain("DROP TABLE");

            const fallback2 = resolveRequestId("<script>alert(1)</script>");
            expect(fallback2.isGenerated).toBe(true);
            expect(fallback2.requestId.startsWith("req_")).toBe(true);
            expect(fallback2.requestId).not.toContain("<script>");

            const fallback3 = resolveRequestId("req_valid\r\nInjected: evil");
            expect(fallback3.isGenerated).toBe(true);
            expect(fallback3.requestId.startsWith("req_")).toBe(true);
            expect(fallback3.requestId).not.toContain("Injected");
        });

        it("rejects SQL injection vectors in X-Request-Id at HTTP boundary and generates safe server ID", async () => {
            const maliciousId = "req_'; DROP TABLE api_request_logs; --";
            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret, {
                [REQUEST_ID_HEADER_NAME]: maliciousId,
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).not.toBe(maliciousId);
            expect(headerRequestId?.startsWith("req_")).toBe(true);
            expect(isValidRequestId(headerRequestId)).toBe(true);

            const logs = await waitForSpecificLogs(ws1Id, [headerRequestId!]);
            expect(logs[0].requestId).toBe(headerRequestId);
            expect(logs[0].requestId).not.toContain("DROP TABLE");
        });

        it("rejects XSS and HTML characters in X-Request-Id at HTTP boundary", async () => {
            const xssId = "<script>alert('xss')</script>";
            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret, {
                [REQUEST_ID_HEADER_NAME]: xssId,
            });

            const res = await listWorkOrdersHandler(req);
            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).not.toBe(xssId);
            expect(isValidRequestId(headerRequestId)).toBe(true);
        });

        it("rejects overly long IDs exceeding 64 characters at HTTP boundary", async () => {
            const longId = "req_" + "A".repeat(100);
            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret, {
                [REQUEST_ID_HEADER_NAME]: longId,
            });

            const res = await listWorkOrdersHandler(req);
            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).not.toBe(longId);
            expect(headerRequestId?.length).toBeLessThanOrEqual(64);
        });
    });

    describe("3. Comprehensive Error Status Code Matrix Coverage", () => {
        it("includes X-Request-Id and matching error.requestId on 401 UNAUTHORIZED", async () => {
            const req = createGetRequest("http://localhost/api/v1/work-orders", "afd_live_invalid_secret_key");
            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(401);

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();
            expect(headerRequestId?.startsWith("req_")).toBe(true);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
            expect(json.error.requestId).toBe(headerRequestId);
        });

        it("includes X-Request-Id and matching error.requestId on 403 FORBIDDEN", async () => {
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

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
            expect(json.error.requestId).toBe(headerRequestId);
        });

        it("includes X-Request-Id and matching error.requestId on 404 NOT_FOUND", async () => {
            const req = createGetRequest("http://localhost/api/v1/work-orders/cuid_nonexistent_12345", apiKey1Secret);
            const res = await getWorkOrderHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_12345" }) });
            expect(res.status).toBe(404);

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.requestId).toBe(headerRequestId);
        });

        it("includes X-Request-Id and matching error.requestId on 409 IDEMPOTENCY_CONFLICT", async () => {
            const idempotencyKey = `idm_trace_conflict_${Date.now()}`;

            // First request: valid creation
            const req1 = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    customerId: cust1Id,
                    locationId: loc1Id,
                    workTypeId: wt1Id,
                    title: "Original Work Order",
                },
                apiKey1Secret,
                { "Idempotency-Key": idempotencyKey },
            );
            const res1 = await createWorkOrderHandler(req1);
            expect(res1.status).toBe(201);

            // Second request: same idempotency key with DIFFERENT payload -> 409
            const req2 = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    customerId: cust1Id,
                    locationId: loc1Id,
                    workTypeId: wt1Id,
                    title: "Altered Work Order Payload",
                },
                apiKey1Secret,
                { "Idempotency-Key": idempotencyKey },
            );
            const res2 = await createWorkOrderHandler(req2);
            expect(res2.status).toBe(409);

            const headerRequestId = res2.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();

            const json = await res2.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("IDEMPOTENCY_CONFLICT");
            expect(json.error.requestId).toBe(headerRequestId);
        });

        it("includes X-Request-Id and matching error.requestId on 422 VALIDATION_ERROR", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                { title: "" }, // Missing customerId, locationId, etc.
                apiKey1Secret,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(422);

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.requestId).toBe(headerRequestId);
        });

        it("includes X-Request-Id and matching error.requestId on 429 RATE_LIMITED", async () => {
            // Rapidly exhaust unauthenticated IP rate limit (60 requests limit)
            const fakeIp = "192.0.2.199";
            let rateLimitedRes: Response | null = null;

            for (let i = 0; i < 70; i++) {
                const req = createGetRequest("http://localhost/api/v1/work-orders", undefined, {
                    "x-forwarded-for": fakeIp,
                });
                const res = await listWorkOrdersHandler(req);
                if (res.status === 429) {
                    rateLimitedRes = res;
                    break;
                }
            }

            expect(rateLimitedRes).not.toBeNull();
            expect(rateLimitedRes!.status).toBe(429);

            const headerRequestId = rateLimitedRes!.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();

            const json = await rateLimitedRes!.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("RATE_LIMITED");
            expect(json.error.requestId).toBe(headerRequestId);
        });

        it("includes X-Request-Id and matching error.requestId on 500 INTERNAL_SERVER_ERROR", async () => {
            // Create a route handler that throws an unhandled error
            const failingHandler = withPublicApiAuth(async () => {
                throw new Error("Simulated unhandled domain failure");
            });

            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret);
            const res = await failingHandler(req);
            expect(res.status).toBe(500);

            const headerRequestId = res.headers.get(REQUEST_ID_HEADER_NAME);
            expect(headerRequestId).toBeDefined();

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(json.error.requestId).toBe(headerRequestId);
        });
    });

    describe("4. Idempotent Replay Request ID Synchronization", () => {
        it("returns current request's unique trace ID in header, body meta, and log on idempotent replay", async () => {
            const idempotencyKey = `idm_trace_replay_test_${Date.now()}`;

            // Request 1: Initial creation
            const req1TraceId = "req_initial_trace_11111";
            const req1 = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    customerId: cust1Id,
                    locationId: loc1Id,
                    workTypeId: wt1Id,
                    title: "Replay Test Work Order",
                },
                apiKey1Secret,
                {
                    "Idempotency-Key": idempotencyKey,
                    [REQUEST_ID_HEADER_NAME]: req1TraceId,
                },
            );

            const res1 = await createWorkOrderHandler(req1);
            expect(res1.status).toBe(201);
            expect(res1.headers.get(REQUEST_ID_HEADER_NAME)).toBe(req1TraceId);
            expect(res1.headers.get("Idempotent-Replay")).toBeNull();

            const json1 = await res1.json();
            expect(json1.meta.requestId).toBe(req1TraceId);
            const createdWorkOrderId = json1.data.id;

            // Request 2: Replay with NEW trace ID
            const req2TraceId = "req_replay_trace_22222";
            const req2 = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    customerId: cust1Id,
                    locationId: loc1Id,
                    workTypeId: wt1Id,
                    title: "Replay Test Work Order",
                },
                apiKey1Secret,
                {
                    "Idempotency-Key": idempotencyKey,
                    [REQUEST_ID_HEADER_NAME]: req2TraceId,
                },
            );

            const res2 = await createWorkOrderHandler(req2);
            expect(res2.status).toBe(201);
            expect(res2.headers.get("Idempotent-Replay")).toBe("true");

            // CRITICAL ASSERTION: The replayed response MUST have the NEW request's trace ID
            expect(res2.headers.get(REQUEST_ID_HEADER_NAME)).toBe(req2TraceId);

            const json2 = await res2.json();
            expect(json2.data.id).toBe(createdWorkOrderId); // Same entity returned
            expect(json2.meta.requestId).toBe(req2TraceId); // Fresh trace ID in meta

            // Check database request logs: both distinct records present with their respective trace IDs
            const logs = await waitForSpecificLogs(ws1Id, [req1TraceId, req2TraceId]);
            expect(logs.length).toBe(2);

            const logReqIds = logs.map((l) => l.requestId);
            expect(logReqIds).toContain(req1TraceId);
            expect(logReqIds).toContain(req2TraceId);
        });
    });
}, 30000);
