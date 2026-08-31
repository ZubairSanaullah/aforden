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
    PUBLIC_ERROR_STATUS_MAP,
    STATUS_TO_PUBLIC_ERROR_MAP,
    getErrorDocumentationUrl,
    jsonError,
    withPublicApiAuth,
    REQUEST_ID_HEADER_NAME,
} from "@/lib/publicApi";
import { GET as listWorkOrdersHandler, POST as createWorkOrderHandler } from "@/app/api/v1/work-orders/route";
import { GET as getWorkOrderHandler } from "@/app/api/v1/work-orders/[id]/route";
import { GET as getCustomerHandler, POST as createCustomerHandler } from "@/app/api/v1/customers/route";
import { GET as getSingleCustomerHandler, PATCH as updateCustomerHandler } from "@/app/api/v1/customers/[id]/route";
import { GET as getAssetHandler } from "@/app/api/v1/assets/[id]/route";
import { GET as getScheduleHandler } from "@/app/api/v1/schedules/route";
import { GET as getTechnicianHandler } from "@/app/api/v1/technicians/[id]/route";
import { GET as getQuoteHandler } from "@/app/api/v1/quotes/[id]/route";
import { GET as getInvoiceHandler } from "@/app/api/v1/invoices/[id]/route";
import { GET as getPartHandler } from "@/app/api/v1/parts/[id]/route";
import { GET as getInventoryHandler } from "@/app/api/v1/inventory/route";

describe("Phase 1.18.16 — Public API Error Contract", () => {
    let prisma: PrismaClient;

    let ws1Id: string;
    let user1Id: string;
    let app1Id: string;
    let apiKey1Secret: string;
    let apiKey1Id: string;

    const runId = Math.random().toString(36).substring(2, 9);

    beforeAll(async () => {
        const connectionString =
            process.env.TEST_DATABASE_URL ||
            process.env.DATABASE_URL ||
            "postgresql://postgres:postgres@localhost:5432/aforden";

        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });

        const ws1 = await prisma.workspace.create({
            data: {
                name: `Error Contract WS ${runId}`,
                slug: `error-ws-${runId}`,
            },
        });
        ws1Id = ws1.id;

        const user1 = await prisma.user.create({
            data: {
                name: `Error User ${runId}`,
                email: `error-user-${runId}@example.com`,
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

        const app1 = await createDeveloperApplication(ws1Id, {
            name: "Error Test App",
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
                PUBLIC_API_SCOPES.ASSETS_READ,
                PUBLIC_API_SCOPES.ASSETS_WRITE,
                PUBLIC_API_SCOPES.SCHEDULES_READ,
                PUBLIC_API_SCOPES.TECHNICIANS_READ,
                PUBLIC_API_SCOPES.QUOTES_READ,
                PUBLIC_API_SCOPES.INVOICES_READ,
                PUBLIC_API_SCOPES.INVENTORY_READ,
            ],
        });
        apiKey1Secret = key1Res.rawSecretKey;
        apiKey1Id = key1Res.id;
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

    describe("1. Canonical 9-Code Taxonomy & Envelope Shape Stability", () => {
        const canonicalCodes = [
            "UNAUTHORIZED",
            "FORBIDDEN",
            "VALIDATION_ERROR",
            "NOT_FOUND",
            "CONFLICT",
            "RATE_LIMITED",
            "IDEMPOTENCY_CONFLICT",
            "API_VERSION_UNSUPPORTED",
            "INTERNAL_SERVER_ERROR",
        ] as const;

        it("taxonomy contains exactly the 9 canonical codes locked in Section 7", () => {
            expect(Object.keys(PUBLIC_ERROR_CODES).sort()).toEqual([...canonicalCodes].sort());
        });

        it("maps each canonical code to its standardized HTTP status code", () => {
            expect(PUBLIC_ERROR_STATUS_MAP.UNAUTHORIZED).toBe(401);
            expect(PUBLIC_ERROR_STATUS_MAP.FORBIDDEN).toBe(403);
            expect(PUBLIC_ERROR_STATUS_MAP.VALIDATION_ERROR).toBe(422);
            expect(PUBLIC_ERROR_STATUS_MAP.NOT_FOUND).toBe(404);
            expect(PUBLIC_ERROR_STATUS_MAP.CONFLICT).toBe(409);
            expect(PUBLIC_ERROR_STATUS_MAP.RATE_LIMITED).toBe(429);
            expect(PUBLIC_ERROR_STATUS_MAP.IDEMPOTENCY_CONFLICT).toBe(409);
            expect(PUBLIC_ERROR_STATUS_MAP.API_VERSION_UNSUPPORTED).toBe(404);
            expect(PUBLIC_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR).toBe(500);
        });

        it("reverse maps HTTP status codes to canonical error codes", () => {
            expect(STATUS_TO_PUBLIC_ERROR_MAP[401]).toBe("UNAUTHORIZED");
            expect(STATUS_TO_PUBLIC_ERROR_MAP[403]).toBe("FORBIDDEN");
            expect(STATUS_TO_PUBLIC_ERROR_MAP[422]).toBe("VALIDATION_ERROR");
            expect(STATUS_TO_PUBLIC_ERROR_MAP[404]).toBe("NOT_FOUND");
            expect(STATUS_TO_PUBLIC_ERROR_MAP[409]).toBe("CONFLICT");
            expect(STATUS_TO_PUBLIC_ERROR_MAP[429]).toBe("RATE_LIMITED");
            expect(STATUS_TO_PUBLIC_ERROR_MAP[500]).toBe("INTERNAL_SERVER_ERROR");
        });

        it("generates stable, canonical documentationUrl for every code in the taxonomy", () => {
            for (const code of canonicalCodes) {
                const url = getErrorDocumentationUrl(code);
                expect(url).toBe(`https://docs.aforden.com/api/errors#${code}`);
            }
        });

        it("jsonError produces exact envelope structure without extraneous top-level properties", async () => {
            const res = jsonError("NOT_FOUND", "Resource missing", {
                status: 404,
                requestId: "req_test_envelope_123",
            });

            expect(res.status).toBe(404);
            expect(res.headers.get("x-aforden-error-code")).toBe("NOT_FOUND");

            const body = await res.json();
            // Exactly two top-level keys: success and error
            expect(Object.keys(body).sort()).toEqual(["error", "success"].sort());
            expect(body.success).toBe(false);

            // Exactly four standard keys on error payload (plus optional details)
            expect(Object.keys(body.error).sort()).toEqual([
                "code",
                "documentationUrl",
                "message",
                "requestId",
            ].sort());

            expect(body.error.code).toBe("NOT_FOUND");
            expect(body.error.message).toBe("Resource missing");
            expect(body.error.requestId).toBe("req_test_envelope_123");
            expect(body.error.documentationUrl).toBe("https://docs.aforden.com/api/errors#NOT_FOUND");
        });
    });

    describe("2. Details Array Schema Strict Invariance", () => {
        it("strictly enforces { field, issue, message } schema on Zod validation errors", async () => {
            const req = createPostRequest("http://localhost/api/v1/work-orders", { title: "" }, apiKey1Secret);
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(422);

            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("VALIDATION_ERROR");
            expect(Array.isArray(body.error.details)).toBe(true);
            expect(body.error.details.length).toBeGreaterThanOrEqual(1);

            for (const detail of body.error.details) {
                expect(typeof detail.issue).toBe("string");
                expect(typeof detail.message).toBe("string");
                if (detail.field !== undefined) {
                    expect(typeof detail.field).toBe("string");
                }
                // Assert no foreign or arbitrary keys leak in detail items
                const validKeys = ["field", "issue", "message"];
                for (const key of Object.keys(detail)) {
                    expect(validKeys).toContain(key);
                }
            }
        });

        it("strictly enforces { issue, message } schema on scope authorization errors", async () => {
            // Create read-only key
            const readOnlyKey = await createApiKey(ws1Id, app1Id, {
                environment: "LIVE",
                scopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ],
            });

            const req = createPostRequest("http://localhost/api/v1/work-orders", { title: "Test WO" }, readOnlyKey.rawSecretKey);
            const res = await createWorkOrderHandler(req);
            expect(res.status).toBe(403);

            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("FORBIDDEN");
            expect(Array.isArray(body.error.details)).toBe(true);
            expect(body.error.details.length).toBe(1);

            const scopeDetail = body.error.details[0];
            expect(scopeDetail.issue).toBe("INSUFFICIENT_SCOPE");
            expect(scopeDetail.message).toContain("Missing:");
        });
    });

    describe("3. Exception Sanitization & Zero-Leakage Guarantee", () => {
        it("never leaks internal database error messages, table names, or stack traces on 500 errors", async () => {
            const failingHandler = withPublicApiAuth(async () => {
                const err = new Error("relation \"work_orders\" does not exist in schema \"public\"");
                (err as any).code = "P2002";
                (err as any).clientVersion = "7.9.1";
                throw err;
            });

            const req = createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret);
            const res = await failingHandler(req);
            expect(res.status).toBe(500);

            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(body.error.message).toBe("An unexpected error occurred processing your request.");

            // String inspection: zero internal leakage
            const bodyStr = JSON.stringify(body);
            expect(bodyStr).not.toContain("relation");
            expect(bodyStr).not.toContain("work_orders");
            expect(bodyStr).not.toContain("P2002");
            expect(bodyStr).not.toContain("7.9.1");
            expect(bodyStr).not.toContain("stack");
            expect(bodyStr).not.toContain("Error:");
        });

        it("customer error handler sanitizes unexpected exceptions rather than reflecting raw message", async () => {
            const failingCustomerHandler = withPublicApiAuth(async () => {
                throw new Error("FATAL: database disk quota exceeded during customer insert");
            });

            const req = createPostRequest("http://localhost/api/v1/customers", { name: "Test Cust" }, apiKey1Secret);
            const res = await failingCustomerHandler(req);
            expect(res.status).toBe(500);

            const body = await res.json();
            expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(body.error.message).toBe("An unexpected error occurred processing your request.");

            const bodyStr = JSON.stringify(body);
            expect(bodyStr).not.toContain("FATAL");
            expect(bodyStr).not.toContain("disk quota");
        });
    });

    describe("4. Cross-Domain Route Error Consistency Sweep", () => {
        it("WorkOrders: returns 404 NOT_FOUND with canonical envelope", async () => {
            const req = createGetRequest("http://localhost/api/v1/work-orders/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getWorkOrderHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("NOT_FOUND");
            expect(body.error.documentationUrl).toBe("https://docs.aforden.com/api/errors#NOT_FOUND");
        });

        it("Customers: returns 404 NOT_FOUND with canonical envelope", async () => {
            const req = createGetRequest("http://localhost/api/v1/customers/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getSingleCustomerHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("NOT_FOUND");
            expect(body.error.documentationUrl).toBe("https://docs.aforden.com/api/errors#NOT_FOUND");
        });

        it("Assets: returns 404 NOT_FOUND with canonical envelope", async () => {
            const req = createGetRequest("http://localhost/api/v1/assets/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getAssetHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("NOT_FOUND");
            expect(body.error.documentationUrl).toBe("https://docs.aforden.com/api/errors#NOT_FOUND");
        });

        it("Technicians: returns 404 NOT_FOUND with canonical envelope", async () => {
            const req = createGetRequest("http://localhost/api/v1/technicians/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getTechnicianHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("NOT_FOUND");
        });

        it("Quotes: returns 404 NOT_FOUND with canonical envelope", async () => {
            const req = createGetRequest("http://localhost/api/v1/quotes/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getQuoteHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("NOT_FOUND");
        });

        it("Invoices: returns 404 NOT_FOUND with canonical envelope", async () => {
            const req = createGetRequest("http://localhost/api/v1/invoices/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getInvoiceHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("NOT_FOUND");
        });

        it("Parts: returns 404 NOT_FOUND with canonical envelope", async () => {
            const req = createGetRequest("http://localhost/api/v1/parts/cuid_nonexistent_9999", apiKey1Secret);
            const res = await getPartHandler(req, { params: Promise.resolve({ id: "cuid_nonexistent_9999" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("NOT_FOUND");
        });
    });
}, 30000);
