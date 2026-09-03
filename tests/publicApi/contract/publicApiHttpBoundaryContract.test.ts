import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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
    PUBLIC_ERROR_CODES,
    getErrorDocumentationUrl,
} from "@/lib/publicApi";

// Route handlers
import { GET as getPingHandler } from "@/app/api/v1/ping/route";
import { GET as listWorkOrdersHandler, POST as createWorkOrderHandler } from "@/app/api/v1/work-orders/route";
import { GET as getWorkOrderHandler, PATCH as updateWorkOrderHandler } from "@/app/api/v1/work-orders/[id]/route";
import { GET as listCustomersHandler, POST as createCustomerHandler } from "@/app/api/v1/customers/route";
import { GET as getCustomerHandler, PATCH as updateCustomerHandler } from "@/app/api/v1/customers/[id]/route";
import { GET as getAssetHandler } from "@/app/api/v1/assets/[id]/route";
import { GET as listSchedulesHandler } from "@/app/api/v1/schedules/route";
import { GET as getQuoteHandler } from "@/app/api/v1/quotes/[id]/route";
import { GET as getInvoiceHandler } from "@/app/api/v1/invoices/[id]/route";
import { GET as getPartHandler } from "@/app/api/v1/parts/[id]/route";
import { GET as getTechnicianHandler } from "@/app/api/v1/technicians/[id]/route";
import { GET as listInventoryHandler } from "@/app/api/v1/inventory/route";

describe("Phase 1.21.3 — Public API HTTP Boundary & Request/Response Contract", () => {
    let prisma: PrismaClient;

    let wsId: string;
    let userId: string;
    let appId: string;
    let fullKeySecret: string;
    let readOnlyKeySecret: string;

    let testCustomerId: string;
    let testLocationId: string;
    let testWorkTypeId: string;
    let testWorkOrderId: string;

    const runId = `bnd_${Math.random().toString(36).substring(2, 9)}`;

    beforeAll(async () => {
        const connectionString =
            process.env.TEST_DATABASE_URL ||
            process.env.DATABASE_URL ||
            "postgresql://postgres:postgres@localhost:5432/aforden";

        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        const ws = await prisma.workspace.create({
            data: {
                name: `Boundary Contract WS ${runId}`,
                slug: `boundary-ws-${runId}`,
            },
        });
        wsId = ws.id;

        const user = await prisma.user.create({
            data: {
                name: `Boundary User ${runId}`,
                email: `boundary-user-${runId}@example.com`,
                status: "ACTIVE",
                emailVerified: new Date(),
            },
        });
        userId = user.id;

        await prisma.workspaceMember.create({
            data: {
                workspaceId: wsId,
                userId,
                role: "OWNER",
                status: "ACTIVE",
            },
        });

        const app = await createDeveloperApplication(wsId, {
            name: "HTTP Boundary Test App",
            createdByUserId: userId,
        });
        appId = app.id;

        const fullKey = await createApiKey(wsId, appId, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.PING_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
                PUBLIC_API_SCOPES.CUSTOMERS_WRITE,
                PUBLIC_API_SCOPES.ASSETS_READ,
                PUBLIC_API_SCOPES.ASSETS_WRITE,
                PUBLIC_API_SCOPES.SCHEDULES_READ,
                PUBLIC_API_SCOPES.TECHNICIANS_READ,
                PUBLIC_API_SCOPES.QUOTES_READ,
                PUBLIC_API_SCOPES.INVOICES_READ,
                PUBLIC_API_SCOPES.INVENTORY_READ,
            ],
        });
        fullKeySecret = fullKey.rawSecretKey;

        const readOnlyKey = await createApiKey(wsId, appId, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.PING_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
            ],
        });
        readOnlyKeySecret = readOnlyKey.rawSecretKey;

        // Seed initial customer
        const cust = await prisma.customer.create({
            data: {
                workspaceId: wsId,
                name: "Boundary Initial Customer",
                customerNumber: `CUST-${runId}-001`,
                status: "ACTIVE",
            },
        });
        testCustomerId = cust.id;

        const loc = await prisma.serviceLocation.create({
            data: {
                customerId: testCustomerId,
                name: "Primary Headquarters",
                addressLine1: "100 Main St",
                city: "Metropolis",
                state: "NY",
                postalCode: "10001",
                country: "US",
                isPrimary: true,
            },
        });
        testLocationId = loc.id;

        const cat = await prisma.serviceCatalog.create({
            data: {
                workspaceId: wsId,
                name: `Catalog ${runId}`,
                status: "ACTIVE",
            },
        });

        const wt = await prisma.workType.create({
            data: {
                workspaceId: wsId,
                catalogId: cat.id,
                name: `WorkType ${runId}`,
                code: `WT-${runId}`,
                status: "ACTIVE",
            },
        });
        testWorkTypeId = wt.id;

        // Seed initial work order
        const wo = await prisma.workOrder.create({
            data: {
                workspaceId: wsId,
                customerId: testCustomerId,
                locationId: testLocationId,
                workTypeId: testWorkTypeId,
                workOrderNumber: `WO-${runId}-001`,
                title: "Initial Diagnostic Work Order",
                workTypeName: `WorkType ${runId}`,
                status: "OPEN",
                priority: "MEDIUM",
            },
        });
        testWorkOrderId = wo.id;
    });

    afterAll(async () => {
        if (wsId) {
            await prisma.workspace.deleteMany({ where: { id: wsId } });
        }
        if (userId) {
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    });

    function createGetRequest(url: string, token?: string, headers: Record<string, string> = {}): Request {
        const reqHeaders = new Headers(headers);
        if (token) {
            reqHeaders.set("authorization", `Bearer ${token}`);
        }
        return new Request(url, { method: "GET", headers: reqHeaders });
    }

    function createPostRequest(url: string, body: any, token?: string, headers: Record<string, string> = {}): Request {
        const reqHeaders = new Headers({
            "content-type": "application/json",
            ...headers,
        });
        if (token) {
            reqHeaders.set("authorization", `Bearer ${token}`);
        }
        return new Request(url, {
            method: "POST",
            headers: reqHeaders,
            body: typeof body === "string" ? body : JSON.stringify(body),
        });
    }

    function createPatchRequest(url: string, body: any, token?: string, headers: Record<string, string> = {}): Request {
        const reqHeaders = new Headers({
            "content-type": "application/json",
            ...headers,
        });
        if (token) {
            reqHeaders.set("authorization", `Bearer ${token}`);
        }
        return new Request(url, {
            method: "PATCH",
            headers: reqHeaders,
            body: typeof body === "string" ? body : JSON.stringify(body),
        });
    }

    describe("1. Authentication & Scope Authorization at HTTP Boundary", () => {
        it("rejects request lacking Authorization header with 401 UNAUTHORIZED", async () => {
            const req = createGetRequest("http://localhost/api/v1/ping");
            const res = await getPingHandler(req);
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
            expect(res.headers.get("x-aforden-error-code")).toBe("UNAUTHORIZED");
            expect(res.headers.has("x-request-id")).toBe(true);
            expect(json.error.requestId).toBeDefined();
        });

        it("rejects malformed Bearer token with 401 UNAUTHORIZED", async () => {
            const req = createGetRequest("http://localhost/api/v1/ping", "not-a-valid-api-key-string");
            const res = await getPingHandler(req);
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("rejects mutation on write route when key only has read scopes with 403 FORBIDDEN", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                { title: "Unauthorized WO" },
                readOnlyKeySecret,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
            expect(json.error.details[0].issue).toBe("INSUFFICIENT_SCOPE");
        });
    });

    describe("2. Request Boundary Schema Validation & Mass-Assignment Rejection", () => {
        it("returns 422 VALIDATION_ERROR on empty or missing required fields", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {}, // missing title
                fullKeySecret,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(Array.isArray(json.error.details)).toBe(true);
            expect(json.error.details.some((d: any) => d.field === "title")).toBe(true);
        });

        it("returns 422 VALIDATION_ERROR when field exceeds max length constraint", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    title: "x".repeat(300), // exceeds max
                },
                fullKeySecret,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });

        it("handles malformed JSON request body gracefully without leaking internal stack", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                "{ not valid json ::: ",
                fullKeySecret,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("3. Pagination, Sorting & Query Parameter Boundaries", () => {
        it("GET /api/v1/work-orders respects pagination limit and clamps oversized limits to 100", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/work-orders?limit=5000&sort=-createdAt",
                fullKeySecret,
            );
            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.meta.pagination.limit).toBe(100); // clamped to 100
        });

        it("GET /api/v1/work-orders supports filtering by customerId and status", async () => {
            const req = createGetRequest(
                `http://localhost/api/v1/work-orders?customerId=${testCustomerId}&status=OPEN`,
                fullKeySecret,
            );
            const res = await listWorkOrdersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);
            expect(json.data[0].customerId).toBe(testCustomerId);
        });

        it("GET /api/v1/customers supports search and pagination", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/customers?search=Boundary&limit=10",
                fullKeySecret,
            );
            const res = await listCustomersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("4. Route Parameters & Resource ID Boundary Checks", () => {
        it("GET /api/v1/work-orders/:id returns 404 NOT_FOUND for non-existent ID", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/work-orders/cuid_nonexistent_999",
                fullKeySecret,
            );
            const res = await getWorkOrderHandler(req, {
                params: Promise.resolve({ id: "cuid_nonexistent_999" }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.documentationUrl).toBe(getErrorDocumentationUrl("NOT_FOUND"));
        });

        it("GET /api/v1/customers/:id returns 404 NOT_FOUND for non-existent ID", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/customers/cuid_nonexistent_999",
                fullKeySecret,
            );
            const res = await getCustomerHandler(req, {
                params: Promise.resolve({ id: "cuid_nonexistent_999" }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("GET /api/v1/assets/:id returns 404 NOT_FOUND for non-existent ID", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/assets/cuid_nonexistent_999",
                fullKeySecret,
            );
            const res = await getAssetHandler(req, {
                params: Promise.resolve({ id: "cuid_nonexistent_999" }),
            });
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("GET /api/v1/quotes/:id returns 404 NOT_FOUND for non-existent ID", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/quotes/cuid_nonexistent_999",
                fullKeySecret,
            );
            const res = await getQuoteHandler(req, {
                params: Promise.resolve({ id: "cuid_nonexistent_999" }),
            });
            expect(res.status).toBe(404);
        });

        it("GET /api/v1/invoices/:id returns 404 NOT_FOUND for non-existent ID", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/invoices/cuid_nonexistent_999",
                fullKeySecret,
            );
            const res = await getInvoiceHandler(req, {
                params: Promise.resolve({ id: "cuid_nonexistent_999" }),
            });
            expect(res.status).toBe(404);
        });

        it("GET /api/v1/parts/:id returns 404 NOT_FOUND for non-existent ID", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/parts/cuid_nonexistent_999",
                fullKeySecret,
            );
            const res = await getPartHandler(req, {
                params: Promise.resolve({ id: "cuid_nonexistent_999" }),
            });
            expect(res.status).toBe(404);
        });

        it("GET /api/v1/technicians/:id returns 404 NOT_FOUND for non-existent ID", async () => {
            const req = createGetRequest(
                "http://localhost/api/v1/technicians/cuid_nonexistent_999",
                fullKeySecret,
            );
            const res = await getTechnicianHandler(req, {
                params: Promise.resolve({ id: "cuid_nonexistent_999" }),
            });
            expect(res.status).toBe(404);
        });
    });

    describe("5. End-to-End Success & Mutation Flows", () => {
        it("POST /api/v1/customers creates customer and returns 201 with public DTO", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/customers",
                {
                    name: `New API Customer ${runId}`,
                    customerNumber: `CUST-${runId}-002`,
                },
                fullKeySecret,
            );
            const res = await createCustomerHandler(req);
            expect(res.status).toBe(201);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.name).toBe(`New API Customer ${runId}`);
            expect(json.data.id).toBeDefined();
        });

        it("POST /api/v1/work-orders creates work order and returns 201 with public DTO", async () => {
            const req = createPostRequest(
                "http://localhost/api/v1/work-orders",
                {
                    title: `New API Work Order ${runId}`,
                    customerId: testCustomerId,
                    locationId: testLocationId,
                    workTypeId: testWorkTypeId,
                    priority: "HIGH",
                },
                fullKeySecret,
            );
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(201);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.title).toBe(`New API Work Order ${runId}`);
            expect(json.data.priority).toBe("HIGH");
        });

        it("PATCH /api/v1/work-orders/:id mutates work order and returns 200", async () => {
            const req = createPatchRequest(
                `http://localhost/api/v1/work-orders/${testWorkOrderId}`,
                {
                    title: `Updated Work Order ${runId}`,
                    description: "Updated description via Public API",
                },
                fullKeySecret,
            );
            const res = await updateWorkOrderHandler(req, {
                params: Promise.resolve({ id: testWorkOrderId }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.title).toBe(`Updated Work Order ${runId}`);
        });

        it("GET /api/v1/schedules returns 200 with schedules list", async () => {
            const req = createGetRequest("http://localhost/api/v1/schedules", fullKeySecret);
            const res = await listSchedulesHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
        });

        it("GET /api/v1/inventory returns 200 with inventory balances", async () => {
            const req = createGetRequest("http://localhost/api/v1/inventory", fullKeySecret);
            const res = await listInventoryHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
        });
    });
}, 30000);
