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
    createWorkOrder,
    transitionWorkOrderStatus,
} from "@/lib/services/workOrder";
import {
    GET as listWorkOrdersHandler,
    POST as createWorkOrderHandler,
} from "@/app/api/v1/work-orders/route";
import {
    GET as getWorkOrderHandler,
    PATCH as updateWorkOrderHandler,
} from "@/app/api/v1/work-orders/[id]/route";

describe("Phase 1.18.7 — Public WorkOrder API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `wo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_wo_1_${runId}`;
    const user1Id = `usr_wo_1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let readOnlyKey1Secret: string;
    let writeOnlyKey1Secret: string;

    // Tenant 2
    const ws2Id = `ws_wo_2_${runId}`;
    const user2Id = `usr_wo_2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    // Domain IDs for Tenant 1
    let customer1Id: string;
    let location1Id: string;
    let workType1Id: string;
    let workOrder1Id: string;
    let completedWorkOrder1Id: string;

    // Domain IDs for Tenant 2
    let customer2Id: string;
    let location2Id: string;
    let workType2Id: string;
    let workOrder2Id: string;

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
                email: `wo-user1-${runId}@example.com`,
                name: "WO Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "WorkOrder Test Workspace 1",
                slug: `wo-ws1-${runId}`,
            },
        });
        const mem1 = await prisma.workspaceMember.create({
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
                email: `wo-user2-${runId}@example.com`,
                name: "WO Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "WorkOrder Test Workspace 2",
                slug: `wo-ws2-${runId}`,
            },
        });
        const mem2 = await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: user2Id,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // 3. Setup Developer Applications & API Keys for Workspace 1
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "WO Integration Client 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const readKey1 = await createApiKey(ws1Id, app1Id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ],
        });
        readOnlyKey1Secret = readKey1.rawSecretKey;

        const writeKey1 = await createApiKey(ws1Id, app1Id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [PUBLIC_API_SCOPES.WORK_ORDERS_WRITE],
        });
        writeOnlyKey1Secret = writeKey1.rawSecretKey;

        // 4. Setup Developer Application & Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "WO Integration Client 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Domain Resources for Workspace 1 (Customer, Location, WorkType)
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                name: "Apex Enterprises",
                customerNumber: `CUST-1-${runId}`,
                status: "ACTIVE",
            },
        });
        customer1Id = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: customer1Id,
                name: "Headquarters Plant",
                addressLine1: "100 Industrial Parkway",
                city: "Detroit",
                state: "MI",
                postalCode: "48201",
                country: "USA",
            },
        });
        location1Id = loc1.id;

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
                name: "HVAC Maintenance",
                code: `WT-HVAC-${runId}`,
                status: "ACTIVE",
                estimatedDuration: 120,
            },
        });
        workType1Id = wt1.id;

        // Seed WorkOrder 1 in Workspace 1
        const actor1 = {
            user: { id: user1Id, name: "Admin 1", email: `wo-user1-${runId}@example.com`, status: "ACTIVE", emailVerified: new Date() },
            workspace: { id: ws1Id, name: "WS 1", slug: `wo-ws1-${runId}`, logoUrl: null, timezone: "UTC" },
            membership: { id: mem1.id, role: "ADMIN" as const, status: "ACTIVE" as const },
        };

        const wo1 = await createWorkOrder(
            ws1Id,
            {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "HVAC Spring Overhaul",
                priority: "HIGH",
                description: "Quarterly preventative maintenance inspection",
            },
            actor1,
        );
        workOrder1Id = wo1.id;

        // Seed second WorkOrder in Workspace 1 and transition to COMPLETED
        const woComp = await createWorkOrder(
            ws1Id,
            {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Cancelled Maintenance Check",
                priority: "LOW",
            },
            actor1,
        );
        completedWorkOrder1Id = woComp.id;
        await transitionWorkOrderStatus(
            ws1Id,
            completedWorkOrder1Id,
            {
                toStatus: "CANCELLED",
                cancellationReason: "Cancelled for testing",
            },
            actor1,
        );

        // 6. Seed Domain Resources for Workspace 2
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                name: "Zenith Corp",
                customerNumber: `CUST-2-${runId}`,
                status: "ACTIVE",
            },
        });
        customer2Id = cust2.id;

        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: customer2Id,
                name: "Zenith Tower",
                addressLine1: "500 Main Street",
                city: "Chicago",
                state: "IL",
                postalCode: "60601",
                country: "USA",
            },
        });
        location2Id = loc2.id;

        const cat2 = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws2Id,
                name: "Building Services",
                status: "ACTIVE",
            },
        });

        const wt2 = await prisma.workType.create({
            data: {
                workspaceId: ws2Id,
                catalogId: cat2.id,
                name: "Elevator Inspection",
                code: `WT-ELEV-${runId}`,
                status: "ACTIVE",
                estimatedDuration: 90,
            },
        });
        workType2Id = wt2.id;

        const actor2 = {
            user: { id: user2Id, name: "Admin 2", email: `wo-user2-${runId}@example.com`, status: "ACTIVE", emailVerified: new Date() },
            workspace: { id: ws2Id, name: "WS 2", slug: `wo-ws2-${runId}`, logoUrl: null, timezone: "UTC" },
            membership: { id: mem2.id, role: "ADMIN" as const, status: "ACTIVE" as const },
        };

        const wo2 = await createWorkOrder(
            ws2Id,
            {
                customerId: customer2Id,
                locationId: location2Id,
                workTypeId: workType2Id,
                title: "Zenith Elevator Safety Check",
                priority: "MEDIUM",
            },
            actor2,
        );
        workOrder2Id = wo2.id;
    }, 30000);

    afterAll(async () => {
        if (prisma) {
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
                where: { developerApplication: { workspaceId: { in: [ws1Id, ws2Id] } } },
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
        }
    }, 30000);

    describe("1. Canonical DTO Shape & Field Exclusion (No Leaks)", () => {
        it("should return the exact approved PublicWorkOrderDto key set and exclude internal-only fields", async () => {
            const req = new Request(`http://localhost:3000/api/v1/work-orders/${workOrder1Id}`, {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "x-request-id": "dto-check-req",
                },
            });

            const res = await getWorkOrderHandler(req, { params: Promise.resolve({ id: workOrder1Id }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.meta.requestId).toBe("dto-check-req");
            expect(json.meta.timestamp).toBeDefined();

            const data = json.data;
            const expectedKeys = [
                "id",
                "workOrderNumber",
                "status",
                "priority",
                "title",
                "description",
                "customerId",
                "locationId",
                "workTypeId",
                "assignedTechnicianId",
                "assetId",
                "estimatedDuration",
                "holdReason",
                "cancellationReason",
                "startedAt",
                "completedAt",
                "cancelledAt",
                "createdAt",
                "updatedAt",
            ];

            expect(Object.keys(data).sort()).toEqual(expectedKeys.sort());

            // Assert internal-only fields are NOT present
            expect(data.workspaceId).toBeUndefined();
            expect(data.internalNotes).toBeUndefined();
            expect(data.customerName).toBeUndefined();
            expect(data.locationAddress).toBeUndefined();
            expect(data.isDeleted).toBeUndefined();
        });
    });

    describe("2. Endpoints CRUD Success Flow", () => {
        it("GET /api/v1/work-orders (list) should return paginated collection of work orders", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders?limit=10", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                },
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(2);
            expect(json.meta.pagination).toBeDefined();
            expect(json.meta.pagination.limit).toBe(10);
        });

        it("POST /api/v1/work-orders should create a new work order and return HTTP 201", async () => {
            const payload = {
                customerId: customer1Id,
                locationId: location1Id,
                workTypeId: workType1Id,
                title: "Emergency Pipe Burst Repair",
                priority: "URGENT",
                description: "Immediate plumber dispatch needed",
            };

            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "content-type": "application/json",
                    "x-request-id": "create-wo-req",
                },
                body: JSON.stringify(payload),
            });

            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(201);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.title).toBe("Emergency Pipe Burst Repair");
            expect(json.data.priority).toBe("URGENT");
            expect(json.data.status).toBe("OPEN");
            expect(json.data.customerId).toBe(customer1Id);
            expect(json.meta.requestId).toBe("create-wo-req");
        });

        it("PATCH /api/v1/work-orders/:id should update mutable fields and return HTTP 200", async () => {
            const patchPayload = {
                title: "HVAC Spring Overhaul - Phase 2",
                priority: "URGENT",
                description: "Updated priority following customer escalations",
            };

            const req = new Request(`http://localhost:3000/api/v1/work-orders/${workOrder1Id}`, {
                method: "PATCH",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "content-type": "application/json",
                    "x-request-id": "patch-wo-req",
                },
                body: JSON.stringify(patchPayload),
            });

            const res = await updateWorkOrderHandler(req, { params: Promise.resolve({ id: workOrder1Id }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.title).toBe("HVAC Spring Overhaul - Phase 2");
            expect(json.data.priority).toBe("URGENT");
            expect(json.data.description).toBe("Updated priority following customer escalations");
        });
    });

    describe("3. Scope Authorization Enforcement (403 FORBIDDEN)", () => {
        it("GET /api/v1/work-orders should reject write-only key with 403 FORBIDDEN", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${writeOnlyKey1Secret}`,
                },
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
            expect(json.error.message).toBe("Missing required API scope.");
        });

        it("POST /api/v1/work-orders should reject read-only key with 403 FORBIDDEN", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${readOnlyKey1Secret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    customerId: customer1Id,
                    locationId: location1Id,
                    workTypeId: workType1Id,
                    title: "Blocked Attempt",
                }),
            });

            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("PATCH /api/v1/work-orders/:id should reject read-only key with 403 FORBIDDEN", async () => {
            const req = new Request(`http://localhost:3000/api/v1/work-orders/${workOrder1Id}`, {
                method: "PATCH",
                headers: {
                    authorization: `Bearer ${readOnlyKey1Secret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({ title: "Unauthorized Patch" }),
            });

            const res = await updateWorkOrderHandler(req, { params: Promise.resolve({ id: workOrder1Id }) });
            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    describe("4. Authentication Enforcement (401 UNAUTHORIZED)", () => {
        it("should return 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "GET",
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error.code).toBe("UNAUTHORIZED");
            expect(json.error.message).toBe("Invalid or missing API key.");
        });
    });

    describe("5. Cross-Tenant Isolation & Enumeration Resistance (404 Uniformity)", () => {
        it("GET /api/v1/work-orders/:id should return 404 NOT_FOUND for foreign workspace work order", async () => {
            const req = new Request(`http://localhost:3000/api/v1/work-orders/${workOrder2Id}`, {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`, // Workspace 1 key querying Workspace 2 WO
                },
            });

            const res = await getWorkOrderHandler(req, { params: Promise.resolve({ id: workOrder2Id }) });
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.message).toBe("Work order not found.");
        });

        it("PATCH /api/v1/work-orders/:id should return 404 NOT_FOUND for foreign workspace work order", async () => {
            const req = new Request(`http://localhost:3000/api/v1/work-orders/${workOrder2Id}`, {
                method: "PATCH",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({ title: "Hacked Title" }),
            });

            const res = await updateWorkOrderHandler(req, { params: Promise.resolve({ id: workOrder2Id }) });
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("should return byte-identical 404 responses for nonexistent vs foreign-tenant work order ID under identical requestId", async () => {
            const fixedRequestId = "wo-enum-check-fixed";

            // Nonexistent ID
            const reqNonExistent = new Request("http://localhost:3000/api/v1/work-orders/wo_00000000000000000000000000", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "x-request-id": fixedRequestId,
                },
            });
            const resNonExistent = await getWorkOrderHandler(reqNonExistent, { params: Promise.resolve({ id: "wo_00000000000000000000000000" }) });
            expect(resNonExistent.status).toBe(404);
            const bodyNonExistent = await resNonExistent.text();

            // Real ID from Workspace 2
            const reqForeign = new Request(`http://localhost:3000/api/v1/work-orders/${workOrder2Id}`, {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "x-request-id": fixedRequestId,
                },
            });
            const resForeign = await getWorkOrderHandler(reqForeign, { params: Promise.resolve({ id: workOrder2Id }) });
            expect(resForeign.status).toBe(404);
            const bodyForeign = await resForeign.text();

            expect(bodyForeign).toBe(bodyNonExistent);
        });

        it("GET /api/v1/work-orders (list) should strictly isolate records: Workspace 1 list NEVER contains Workspace 2 work orders", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders?limit=100", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                },
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            const returnedIds = json.data.map((item: any) => item.id);

            expect(returnedIds).toContain(workOrder1Id);
            expect(returnedIds).not.toContain(workOrder2Id);
        });
    });

    describe("6. Input Validation (422 VALIDATION_ERROR)", () => {
        it("POST /api/v1/work-orders should return 422 with field-level details on invalid body", async () => {
            const invalidPayload = {
                // missing customerId, locationId, workTypeId
                title: "", // empty title
                priority: "INVALID_PRIORITY_ENUM",
                unknownProperty: "sneaky",
            };

            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(invalidPayload),
            });

            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.message).toBe("The request body failed validation constraints.");
            expect(Array.isArray(json.error.details)).toBe(true);
            expect(json.error.details.length).toBeGreaterThan(0);
        });

        it("PATCH /api/v1/work-orders/:id should return 422 on invalid patch payload", async () => {
            const invalidPatch = {
                priority: "SUPER_URGENT_NOT_REAL",
            };

            const req = new Request(`http://localhost:3000/api/v1/work-orders/${workOrder1Id}`, {
                method: "PATCH",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(invalidPatch),
            });

            const res = await updateWorkOrderHandler(req, { params: Promise.resolve({ id: workOrder1Id }) });
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });    describe("7. Domain Conflict / State Guard (409 CONFLICT)", () => {
        it("PATCH /api/v1/work-orders/:id on a CANCELLED work order should return 409 CONFLICT", async () => {
            const req = new Request(`http://localhost:3000/api/v1/work-orders/${completedWorkOrder1Id}`, {
                method: "PATCH",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({ title: "Attempt to update cancelled job" }),
            });

            const res = await updateWorkOrderHandler(req, { params: Promise.resolve({ id: completedWorkOrder1Id }) });
            expect(res.status).toBe(409);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("CONFLICT");
            expect(json.error.message).toBe("Work order is in a terminal state and cannot be updated.");
        });
    });

    describe("8. Pagination, Filtering, and Sorting Contracts", () => {
        it("should apply limit parameter correctly", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders?limit=1", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                },
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBe(1);
            expect(json.meta.pagination.limit).toBe(1);
            expect(json.meta.pagination.hasMore).toBe(true);
            expect(json.meta.pagination.nextCursor).toBeDefined();
        });

        it("should filter by status (status=CANCELLED)", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders?status=CANCELLED", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                },
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBeGreaterThanOrEqual(1);
            for (const item of json.data) {
                expect(item.status).toBe("CANCELLED");
            }
        });

        it("should sort by createdAt descending by default (-createdAt)", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders?sort=-created_at", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${fullKey1Secret}`,
                },
            });

            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            if (json.data.length >= 2) {
                const date1 = new Date(json.data[0].createdAt).getTime();
                const date2 = new Date(json.data[1].createdAt).getTime();
                expect(date1).toBeGreaterThanOrEqual(date2);
            }
        });
    });
});
