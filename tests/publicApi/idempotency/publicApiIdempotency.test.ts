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
} from "@/lib/services/developerApp";
import { PUBLIC_API_SCOPES } from "@/lib/publicApi/scopes";
import {
    POST as createWorkOrderHandler,
    GET as listWorkOrdersHandler,
} from "@/app/api/v1/work-orders/route";
import {
    PATCH as updateWorkOrderHandler,
    GET as getWorkOrderHandler,
} from "@/app/api/v1/work-orders/[id]/route";
import {
    POST as createCustomerHandler,
} from "@/app/api/v1/customers/route";
import {
    PATCH as updateCustomerHandler,
} from "@/app/api/v1/customers/[id]/route";

describe("Phase 1.18.12 — Public API Idempotency & Safe Mutation Architecture", () => {
    let prisma: PrismaClient;
    const runId = `idm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_idm_1_${runId}`;
    const user1Id = `usr_idm_1_${runId}`;
    let app1Id: string;
    let apiKey1Secret: string;
    let apiKey1Id: string;

    // Tenant 1 - Second API Client (distinct key in same workspace)
    let app1Client2Id: string;
    let apiKey1Client2Secret: string;
    let apiKey1Client2Id: string;

    // Tenant 2 (Cross-tenant testing)
    const ws2Id = `ws_idm_2_${runId}`;
    const user2Id = `usr_idm_2_${runId}`;
    let app2Id: string;
    let apiKey2Secret: string;
    let apiKey2Id: string;

    // Shared domain IDs for Workspace 1
    let customer1Id: string;
    let location1Id: string;
    let workType1Id: string;

    // Shared domain IDs for Workspace 2
    let customer2Id: string;
    let location2Id: string;
    let workType2Id: string;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Setup Workspace 1 and Users
        await prisma.user.create({
            data: {
                id: user1Id,
                email: `idm-admin1-${runId}@example.com`,
                name: "Idempotency Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Idempotency Workspace 1",
                slug: `idm-ws1-${runId}`,
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

        // 2. Setup Workspace 2 and Users
        await prisma.user.create({
            data: {
                id: user2Id,
                email: `idm-admin2-${runId}@example.com`,
                name: "Idempotency Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Idempotency Workspace 2",
                slug: `idm-ws2-${runId}`,
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
            name: "App 1 Primary Client",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;
        const key1Res = await createApiKey(ws1Id, app1Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
                PUBLIC_API_SCOPES.CUSTOMERS_WRITE,
            ],
        });
        apiKey1Secret = key1Res.rawSecretKey;
        apiKey1Id = key1Res.id;

        // Second client in Workspace 1
        const app1Client2 = await createDeveloperApplication(ws1Id, {
            name: "App 1 Secondary Client",
            createdByUserId: user1Id,
        });
        app1Client2Id = app1Client2.id;
        const key1Client2Res = await createApiKey(ws1Id, app1Client2Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
                PUBLIC_API_SCOPES.CUSTOMERS_WRITE,
            ],
        });
        apiKey1Client2Secret = key1Client2Res.rawSecretKey;
        apiKey1Client2Id = key1Client2Res.id;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "App 2 Client",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;
        const key2Res = await createApiKey(ws2Id, app2Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
                PUBLIC_API_SCOPES.CUSTOMERS_WRITE,
            ],
        });
        apiKey2Secret = key2Res.rawSecretKey;
        apiKey2Id = key2Res.id;

        // 5. Seed Domain Pre-requisites for Workspace 1
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                name: "Customer Alpha WS1",
                customerNumber: `CUST-1-${runId}`,
                status: "ACTIVE",
            },
        });
        customer1Id = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: customer1Id,
                name: "Building A",
                addressLine1: "100 Alpha St",
                city: "Seattle",
                state: "WA",
                postalCode: "98101",
                country: "US",
            },
        });
        location1Id = loc1.id;

        const cat1 = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws1Id,
                name: "HVAC Catalog WS1",
                status: "ACTIVE",
            },
        });
        const wt1 = await prisma.workType.create({
            data: {
                workspaceId: ws1Id,
                catalogId: cat1.id,
                name: "Compressor Replacement",
                code: `WT-COMP-${runId}`,
                status: "ACTIVE",
            },
        });
        workType1Id = wt1.id;

        // 6. Seed Domain Pre-requisites for Workspace 2
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                name: "Customer Beta WS2",
                customerNumber: `CUST-2-${runId}`,
                status: "ACTIVE",
            },
        });
        customer2Id = cust2.id;

        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: customer2Id,
                name: "Building B",
                addressLine1: "200 Beta St",
                city: "Portland",
                state: "OR",
                postalCode: "97201",
                country: "US",
            },
        });
        location2Id = loc2.id;

        const cat2 = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws2Id,
                name: "HVAC Catalog WS2",
                status: "ACTIVE",
            },
        });
        const wt2 = await prisma.workType.create({
            data: {
                workspaceId: ws2Id,
                catalogId: cat2.id,
                name: "Thermostat Repair",
                code: `WT-THERM-${runId}`,
                status: "ACTIVE",
            },
        });
        workType2Id = wt2.id;
    }, 30000);

    afterAll(async () => {
        // Clean up test data across both workspaces
        await prisma.apiIdempotencyRecord.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        await prisma.workOrderHistory.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        await prisma.workOrder.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        await prisma.workType.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        await prisma.serviceCatalog.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        if (customer1Id || customer2Id) {
            await prisma.serviceLocation.deleteMany({
                where: { customerId: { in: [customer1Id, customer2Id].filter(Boolean) } },
            });
        }
        await prisma.customer.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        await prisma.apiKey.deleteMany({
            where: {
                developerApplication: { workspaceId: { in: [ws1Id, ws2Id] } },
            },
        });
        await prisma.developerApplication.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        await prisma.workspaceMember.deleteMany({
            where: { workspaceId: { in: [ws1Id, ws2Id] } },
        });
        await prisma.workspace.deleteMany({
            where: { id: { in: [ws1Id, ws2Id] } },
        });
        await prisma.user.deleteMany({
            where: { id: { in: [user1Id, user2Id] } },
        });
        await prisma.$disconnect();
    }, 30000);

    // Helper: Build standard test requests
    function createRequest(
        url: string,
        method: string,
        bearerToken: string,
        body?: any,
        headersInit?: Record<string, string>,
    ): Request {
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${bearerToken}`);
        headers.set("Content-Type", "application/json");

        if (headersInit) {
            for (const [k, v] of Object.entries(headersInit)) {
                headers.set(k, v);
            }
        }

        return new Request(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    }

    describe("1. Idempotency Key Replay & Mutation Deduplication", () => {
        it("repeated identical request with same key returns original response without creating a 2nd resource", async () => {
            const idempotencyKey = `key_dedup_${runId}_1`;
            const payload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "HVAC Inspection - Dedup Test",
                priority: "HIGH",
            };

            // Count initial work orders in DB for workspace 1
            const countBefore = await prisma.workOrder.count({
                where: { workspaceId: ws1Id },
            });

            // 1st Request
            const req1 = createRequest(
                "http://localhost/api/v1/work-orders",
                "POST",
                apiKey1Secret,
                payload,
                { "Idempotency-Key": idempotencyKey },
            );
            const res1 = await createWorkOrderHandler(req1);
            expect(res1.status).toBe(201);
            const json1 = await res1.json();
            expect(json1.success).toBe(true);
            expect(json1.data.title).toBe("HVAC Inspection - Dedup Test");
            const createdId = json1.data.id;

            // Direct DB verification: Exactly 1 record created
            const countAfterFirst = await prisma.workOrder.count({
                where: { workspaceId: ws1Id },
            });
            expect(countAfterFirst).toBe(countBefore + 1);

            // 2nd Request (Identical Key & Payload)
            const req2 = createRequest(
                "http://localhost/api/v1/work-orders",
                "POST",
                apiKey1Secret,
                payload,
                { "Idempotency-Key": idempotencyKey },
            );
            const res2 = await createWorkOrderHandler(req2);
            expect(res2.status).toBe(201);
            expect(res2.headers.get("idempotent-replay")).toBe("true");

            const json2 = await res2.json();
            expect(json2.success).toBe(true);
            expect(json2.data.id).toBe(createdId);
            expect(json2.data.title).toBe("HVAC Inspection - Dedup Test");

            // Direct DB verification: Still only 1 record created!
            const countAfterSecond = await prisma.workOrder.count({
                where: { workspaceId: ws1Id },
            });
            expect(countAfterSecond).toBe(countBefore + 1);
        });

        it("identical payload with different key order or formatting still matches canonical hash", async () => {
            const idempotencyKey = `key_canonical_${runId}`;
            // Intentionally reordered keys
            const payload1 = {
                title: "Canonical Order Test",
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                priority: "MEDIUM",
            };
            const payload2 = {
                priority: "MEDIUM",
                workTypeId: workType1Id,
                locationId: location1Id,
                title: "Canonical Order Test",
                customerId: customer1Id,
            };

            const req1 = createRequest(
                "http://localhost/api/v1/work-orders",
                "POST",
                apiKey1Secret,
                payload1,
                { "Idempotency-Key": idempotencyKey },
            );
            const res1 = await createWorkOrderHandler(req1);
            expect(res1.status).toBe(201);
            const json1 = await res1.json();

            // Replay with differently ordered keys
            const req2 = createRequest(
                "http://localhost/api/v1/work-orders",
                "POST",
                apiKey1Secret,
                payload2,
                { "Idempotency-Key": idempotencyKey },
            );
            const res2 = await createWorkOrderHandler(req2);
            expect(res2.status).toBe(201);
            expect(res2.headers.get("idempotent-replay")).toBe("true");
            const json2 = await res2.json();
            expect(json2.data.id).toBe(json1.data.id);
        });
    });

    describe("2. Payload Mismatch Detection & Conflict Handling", () => {
        it("repeated request with same key but DIFFERENT payload returns 409 IDEMPOTENCY_CONFLICT", async () => {
            const idempotencyKey = `key_conflict_${runId}`;
            const initialPayload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Original WorkOrder",
                priority: "LOW",
            };
            const differentPayload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Mismatched WorkOrder Title",
                priority: "HIGH",
            };

            // 1st Request
            const req1 = createRequest(
                "http://localhost/api/v1/work-orders",
                "POST",
                apiKey1Secret,
                initialPayload,
                { "Idempotency-Key": idempotencyKey },
            );
            const res1 = await createWorkOrderHandler(req1);
            expect(res1.status).toBe(201);

            // 2nd Request with differing payload
            const req2 = createRequest(
                "http://localhost/api/v1/work-orders",
                "POST",
                apiKey1Secret,
                differentPayload,
                { "Idempotency-Key": idempotencyKey },
            );
            const res2 = await createWorkOrderHandler(req2);
            expect(res2.status).toBe(409);

            const json2 = await res2.json();
            expect(json2.success).toBe(false);
            expect(json2.error.code).toBe("IDEMPOTENCY_CONFLICT");
            expect(json2.error.message).toContain("different request payload");
        });
    });

    describe("3. Concurrency & Race-Condition Mutual Exclusion", () => {
        it("concurrent simultaneous requests with same key execute exactly once and second fails fast", async () => {
            const idempotencyKey = `key_race_${runId}`;
            const payload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Concurrent Race Safety WorkOrder",
                priority: "HIGH",
            };

            const countBefore = await prisma.workOrder.count({
                where: {
                    workspaceId: ws1Id,
                    title: "Concurrent Race Safety WorkOrder",
                },
            });
            expect(countBefore).toBe(0);

            // Dispatch 2 simultaneous requests racing for the same idempotency key
            const [resA, resB] = await Promise.all([
                createWorkOrderHandler(
                    createRequest(
                        "http://localhost/api/v1/work-orders",
                        "POST",
                        apiKey1Secret,
                        payload,
                        { "Idempotency-Key": idempotencyKey },
                    ),
                ),
                createWorkOrderHandler(
                    createRequest(
                        "http://localhost/api/v1/work-orders",
                        "POST",
                        apiKey1Secret,
                        payload,
                        { "Idempotency-Key": idempotencyKey },
                    ),
                ),
            ]);

            const statuses = [resA.status, resB.status];
            // One must succeed with 201; the concurrent racer must either receive 409 IDEMPOTENCY_CONFLICT or 201 (if it was served the replay after completion)
            expect(statuses).toContain(201);

            // Direct DB verification: EXACTLY ONE work order created in database
            const countAfter = await prisma.workOrder.count({
                where: {
                    workspaceId: ws1Id,
                    title: "Concurrent Race Safety WorkOrder",
                },
            });
            expect(countAfter).toBe(1);
        });
    });

    describe("4. Key Independence & Multi-Resource Creation", () => {
        it("different idempotency keys execute independently and create two distinct resources", async () => {
            const keyA = `key_indep_A_${runId}`;
            const keyB = `key_indep_B_${runId}`;

            const payloadA = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Independent Job A",
                priority: "LOW",
            };
            const payloadB = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Independent Job B",
                priority: "LOW",
            };

            const resA = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payloadA,
                    { "Idempotency-Key": keyA },
                ),
            );
            const resB = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payloadB,
                    { "Idempotency-Key": keyB },
                ),
            );

            expect(resA.status).toBe(201);
            expect(resB.status).toBe(201);

            const jsonA = await resA.json();
            const jsonB = await resB.json();

            expect(jsonA.data.id).not.toBe(jsonB.data.id);
            expect(jsonA.data.title).toBe("Independent Job A");
            expect(jsonB.data.title).toBe("Independent Job B");
        });
    });

    describe("5. Cross-Tenant & Cross-Client Isolation", () => {
        it("same key literal in different workspaces executes independently with zero interference", async () => {
            const sharedKey = `shared_cross_tenant_key_${runId}`;

            const payloadWS1 = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Tenant 1 Job",
                priority: "HIGH",
            };
            const payloadWS2 = {
                customerId: customer2Id,
                locationId: location2Id,
                workTypeId: workType2Id,
                title: "Tenant 2 Job",
                priority: "HIGH",
            };

            // Workspace 1 request with shared key
            const res1 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payloadWS1,
                    { "Idempotency-Key": sharedKey },
                ),
            );
            expect(res1.status).toBe(201);
            const json1 = await res1.json();
            expect(json1.data.customerId).toBe(customer1Id);

            // Workspace 2 request with SAME literal key
            const res2 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey2Secret,
                    payloadWS2,
                    { "Idempotency-Key": sharedKey },
                ),
            );
            expect(res2.status).toBe(201);
            const json2 = await res2.json();
            expect(json2.data.customerId).toBe(customer2Id);
            expect(json2.data.id).not.toBe(json1.data.id);

            // Both workspaces have exactly 1 record created
            const countWS1 = await prisma.workOrder.count({
                where: { workspaceId: ws1Id, title: "Tenant 1 Job" },
            });
            const countWS2 = await prisma.workOrder.count({
                where: { workspaceId: ws2Id, title: "Tenant 2 Job" },
            });
            expect(countWS1).toBe(1);
            expect(countWS2).toBe(1);
        });

        it("same key literal from different API clients in same workspace executes independently per apiKeyId", async () => {
            const sharedKey = `shared_cross_client_key_${runId}`;

            const payloadClient1 = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Client 1 Submission",
                priority: "LOW",
            };
            const payloadClient2 = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Client 2 Submission",
                priority: "LOW",
            };

            // Primary client submission
            const res1 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payloadClient1,
                    { "Idempotency-Key": sharedKey },
                ),
            );
            expect(res1.status).toBe(201);
            const json1 = await res1.json();

            // Secondary client submission with same key
            const res2 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Client2Secret,
                    payloadClient2,
                    { "Idempotency-Key": sharedKey },
                ),
            );
            expect(res2.status).toBe(201);
            const json2 = await res2.json();

            expect(json1.data.id).not.toBe(json2.data.id);
            expect(json1.data.title).toBe("Client 1 Submission");
            expect(json2.data.title).toBe("Client 2 Submission");
        });
    });

    describe("6. Key Expiration (TTL) & Lifecycle", () => {
        it("expired key is treated as new request and executes fresh mutation", async () => {
            const idempotencyKey = `key_ttl_${runId}`;
            const payload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "TTL WorkOrder Initial",
                priority: "LOW",
            };

            // 1. First execution
            const res1 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payload,
                    { "Idempotency-Key": idempotencyKey },
                ),
            );
            expect(res1.status).toBe(201);
            const json1 = await res1.json();
            const id1 = json1.data.id;

            // 2. Simulate 24-hour expiration by setting expiresAt to 1 hour in the past
            await prisma.apiIdempotencyRecord.updateMany({
                where: {
                    workspaceId: ws1Id,
                    apiKeyId: apiKey1Id,
                    idempotencyKey,
                },
                data: {
                    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
                },
            });

            // 3. Subsequent request with expired key -> executes fresh mutation
            const payload2 = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "TTL WorkOrder Re-executed",
                priority: "HIGH",
            };
            const res2 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payload2,
                    { "Idempotency-Key": idempotencyKey },
                ),
            );
            expect(res2.status).toBe(201);
            expect(res2.headers.get("idempotent-replay")).toBeNull();
            const json2 = await res2.json();
            const id2 = json2.data.id;

            expect(id1).not.toBe(id2);
            expect(json2.data.title).toBe("TTL WorkOrder Re-executed");
        });
    });

    describe("7. Missing Idempotency-Key Header (Optional Mode)", () => {
        it("requests without Idempotency-Key execute normally without deduplication", async () => {
            const payload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Optional Header Job",
                priority: "LOW",
            };

            // Request 1 (No header)
            const res1 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payload,
                ),
            );
            expect(res1.status).toBe(201);
            const json1 = await res1.json();

            // Request 2 (No header, same payload)
            const res2 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payload,
                ),
            );
            expect(res2.status).toBe(201);
            const json2 = await res2.json();

            // Both executed and created 2 separate records
            expect(json1.data.id).not.toBe(json2.data.id);
        });
    });

    describe("8. PATCH Mutation Idempotency", () => {
        it("PATCH mutation with Idempotency-Key is properly deduplicated and replayed", async () => {
            // Create a work order first
            const created = await prisma.workOrder.create({
                data: {
                    workspaceId: ws1Id,
                    customerId: customer1Id,
                    locationId: location1Id,
                    workTypeId: workType1Id,
                    workTypeName: "Compressor Replacement",
                    workOrderNumber: `WO-PATCH-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    title: "Initial Title for Patch",
                    priority: "LOW",
                    status: "OPEN",
                },
            });

            const patchKey = `patch_key_${runId}`;
            const patchPayload = {
                title: "Patched Title - Safe Mutation",
                priority: "HIGH",
            };

            const routeContext = { params: Promise.resolve({ id: created.id }) };

            // 1st PATCH
            const res1 = await updateWorkOrderHandler(
                createRequest(
                    `http://localhost/api/v1/work-orders/${created.id}`,
                    "PATCH",
                    apiKey1Secret,
                    patchPayload,
                    { "Idempotency-Key": patchKey },
                ),
                routeContext,
            );
            expect(res1.status).toBe(200);
            const json1 = await res1.json();
            expect(json1.data.title).toBe("Patched Title - Safe Mutation");
            expect(json1.data.priority).toBe("HIGH");

            // 2nd PATCH (Replay)
            const res2 = await updateWorkOrderHandler(
                createRequest(
                    `http://localhost/api/v1/work-orders/${created.id}`,
                    "PATCH",
                    apiKey1Secret,
                    patchPayload,
                    { "Idempotency-Key": patchKey },
                ),
                routeContext,
            );
            expect(res2.status).toBe(200);
            expect(res2.headers.get("idempotent-replay")).toBe("true");
            const json2 = await res2.json();
            expect(json2.data.title).toBe("Patched Title - Safe Mutation");
        });
    });

    describe("9. Header Validation & Information Leakage Prevention", () => {
        it("rejects keys longer than 255 characters with 422 VALIDATION_ERROR", async () => {
            const oversizedKey = "k".repeat(256);
            const payload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Invalid Key Test",
                priority: "LOW",
            };

            const res = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payload,
                    { "Idempotency-Key": oversizedKey },
                ),
            );

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.details[0].field).toBe("Idempotency-Key");
        });

        it("confirms no internal Prisma model or stored idempotency record details leak in responses", async () => {
            const idempotencyKey = `key_leak_check_${runId}`;
            const payload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Leakage Check Job",
                priority: "LOW",
            };

            const res1 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payload,
                    { "Idempotency-Key": idempotencyKey },
                ),
            );
            const json1 = await res1.json();

            // Check keys in envelope
            expect(Object.keys(json1).sort()).toEqual(["data", "meta", "success"]);
            expect(json1.data.scopedKeyHash).toBeUndefined();
            expect(json1.data.requestHash).toBeUndefined();
            expect(json1.data.apiKeyId).toBeUndefined();
            expect(json1.data.workspaceId).toBeUndefined();

            // Check replayed response
            const res2 = await createWorkOrderHandler(
                createRequest(
                    "http://localhost/api/v1/work-orders",
                    "POST",
                    apiKey1Secret,
                    payload,
                    { "Idempotency-Key": idempotencyKey },
                ),
            );
            const json2 = await res2.json();
            expect(Object.keys(json2).sort()).toEqual(["data", "meta", "success"]);
            expect(json2.data.scopedKeyHash).toBeUndefined();
            expect(json2.data.requestHash).toBeUndefined();
        });
    });
}, 30000);

