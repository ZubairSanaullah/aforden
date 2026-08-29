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
    APPROVED_PUBLIC_QUOTE_DTO_KEYS,
    APPROVED_PUBLIC_QUOTE_LINE_ITEM_DTO_KEYS,
} from "@/lib/publicApi/quotes/quoteDto";
import { GET as listQuotesHandler } from "@/app/api/v1/quotes/route";
import * as quotesRouteModule from "@/app/api/v1/quotes/route";
import { GET as getQuoteHandler } from "@/app/api/v1/quotes/[id]/route";
import * as quoteItemRouteModule from "@/app/api/v1/quotes/[id]/route";

describe("Phase 1.18.11 — Public Quote API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `quote_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_q_1_${runId}`;
    const user1Id = `usr_q_1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let unrelatedKey1Secret: string; // key without quotes:read scope

    let customer1Id: string;
    let location1Id: string;
    let quote1Id: string;

    // Tenant 2
    const ws2Id = `ws_q_2_${runId}`;
    const user2Id = `usr_q_2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    let customer2Id: string;
    let location2Id: string;
    let foreignQuote2Id: string;

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
                email: `quote-admin1-${runId}@example.com`,
                name: "Quote Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Quote Workspace 1",
                slug: `quote-ws1-${runId}`,
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
                email: `quote-admin2-${runId}@example.com`,
                name: "Quote Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Quote Workspace 2",
                slug: `quote-ws2-${runId}`,
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
            name: "Quote Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.QUOTES_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const unrelatedKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.INVENTORY_READ], // lacks quotes:read
            environment: ApiKeyEnvironment.LIVE,
        });
        unrelatedKey1Secret = unrelatedKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Quote Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [PUBLIC_API_SCOPES.QUOTES_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Customer, Location, Quote, and Line Items in Workspace 1
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                name: "Nexus Corporation",
                customerNumber: `CUST-Q1-${runId}`,
                status: "ACTIVE",
            },
        });
        customer1Id = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: customer1Id,
                name: "Nexus Tower East",
                addressLine1: "500 Tech Blvd",
                city: "Boston",
                country: "USA",
                isPrimary: true,
            },
        });
        location1Id = loc1.id;

        const q1 = await prisma.quote.create({
            data: {
                workspaceId: ws1Id,
                quoteNumber: `Q-2026-001`,
                customerId: customer1Id,
                locationId: location1Id,
                status: "DRAFT",
                title: "HVAC Retrofit Proposal",
                description: "Complete replacement of 3 rooftop HVAC units",
                internalNotes: "Internal target margin is 42% - confidential",
                termsAndConditions: "Net 30 days upon completion",
                currencyCode: "USD",
                validUntil: new Date("2026-10-31T23:59:59Z"),
                subtotal: 12000.0,
                discountType: "PERCENTAGE",
                discountValue: 5.0,
                discountAmount: 600.0,
                taxRate: 0.08,
                taxAmount: 912.0,
                total: 12312.0,
            },
        });
        quote1Id = q1.id;

        await prisma.quoteLineItem.create({
            data: {
                quoteId: quote1Id,
                workspaceId: ws1Id,
                lineItemType: "CUSTOM",
                name: "Commercial Chiller Unit 5-Ton",
                description: "Energy Star certified commercial chiller",
                quantity: 3.0,
                unitPrice: 4000.0,
                unitCost: 2200.0, // Internal cost - MUST NOT LEAK
                discountAmount: 200.0,
                subtotal: 11800.0,
                taxRate: 0.08,
                taxAmount: 944.0,
                total: 12744.0,
                sortOrder: 1,
            },
        });

        // 6. Seed Customer, Location, and Quote in Workspace 2
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                name: "Global Dynamics",
                customerNumber: `CUST-Q2-${runId}`,
                status: "ACTIVE",
            },
        });
        customer2Id = cust2.id;

        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: customer2Id,
                name: "Research Complex",
                addressLine1: "1 Science Park",
                city: "Cambridge",
                country: "USA",
                isPrimary: true,
            },
        });
        location2Id = loc2.id;

        const q2 = await prisma.quote.create({
            data: {
                workspaceId: ws2Id,
                quoteNumber: `Q-2026-002`,
                customerId: customer2Id,
                locationId: location2Id,
                status: "DRAFT",
                title: "Laboratory Air Filtration",
                subtotal: 8500.0,
                total: 8500.0,
            },
        });
        foreignQuote2Id = q2.id;
    });

    afterAll(async () => {
        if (prisma) {
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
                await prisma.quoteLineItem.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.quote.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.serviceLocation.deleteMany({
                    where: { customer: { workspaceId: { in: wsIds } } },
                });
                await prisma.customer.deleteMany({
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
        it("should return the exact approved PublicQuoteDto key set and exclude internalNotes/lineItem unitCost", async () => {
            const req = mockRequest(`/api/v1/quotes/${quote1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getQuoteHandler(req, {
                params: Promise.resolve({ id: quote1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();

            const returnedHeaderKeys = Object.keys(json.data)
                .filter((k) => k !== "lineItems")
                .sort();
            const expectedHeaderKeys = [...APPROVED_PUBLIC_QUOTE_DTO_KEYS].sort();

            expect(returnedHeaderKeys).toEqual(expectedHeaderKeys);

            // Assert exclusion of sensitive internal fields
            expect(json.data).not.toHaveProperty("internalNotes");
            expect(json.data).not.toHaveProperty("convertedByMemberId");
            expect(json.data).not.toHaveProperty("workspaceId");

            expect(json.data.id).toBe(quote1Id);
            expect(json.data.quoteNumber).toBe("Q-2026-001");
            expect(json.data.total).toBe(12312.0);

            // Check line item projection and cost protection
            expect(json.data.lineItems).toBeDefined();
            expect(json.data.lineItems).toHaveLength(1);

            const lineItem = json.data.lineItems[0];
            const returnedLineItemKeys = Object.keys(lineItem).sort();
            const expectedLineItemKeys = [...APPROVED_PUBLIC_QUOTE_LINE_ITEM_DTO_KEYS].sort();

            expect(returnedLineItemKeys).toEqual(expectedLineItemKeys);
            expect(lineItem).not.toHaveProperty("unitCost"); // Protect profit margin
            expect(lineItem.name).toBe("Commercial Chiller Unit 5-Ton");
            expect(lineItem.unitPrice).toBe(4000.0);
            expect(lineItem.total).toBe(12744.0);
        });
    });

    // -------------------------------------------------------------------------
    // 2. Collection & Item Endpoints
    // -------------------------------------------------------------------------
    describe("2. Collection & Item Endpoints", () => {
        it("GET /api/v1/quotes should return paginated list of quotes", async () => {
            const req = mockRequest("/api/v1/quotes?limit=10", {
                token: fullKey1Secret,
            });

            const res = await listQuotesHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);
            expect(json.meta?.pagination?.limit).toBe(10);
        });

        it("GET /api/v1/quotes/:id should fetch single quote by ID", async () => {
            const req = mockRequest(`/api/v1/quotes/${quote1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getQuoteHandler(req, {
                params: Promise.resolve({ id: quote1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.id).toBe(quote1Id);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Strict Read-Only Invariant
    // -------------------------------------------------------------------------
    describe("3. Strict Read-Only Invariant", () => {
        it("should confirm quote route modules ONLY export GET", () => {
            expect(quotesRouteModule).toHaveProperty("GET");
            expect(quotesRouteModule).not.toHaveProperty("POST");
            expect(quotesRouteModule).not.toHaveProperty("PATCH");
            expect(quotesRouteModule).not.toHaveProperty("DELETE");
            expect(quotesRouteModule).not.toHaveProperty("PUT");

            expect(quoteItemRouteModule).toHaveProperty("GET");
            expect(quoteItemRouteModule).not.toHaveProperty("POST");
            expect(quoteItemRouteModule).not.toHaveProperty("PATCH");
            expect(quoteItemRouteModule).not.toHaveProperty("DELETE");
            expect(quoteItemRouteModule).not.toHaveProperty("PUT");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("4. Authentication & Scope Enforcement", () => {
        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/quotes");
            const res = await listQuotesHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/quotes should reject key lacking quotes:read scope with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/quotes", {
                token: unrelatedKey1Secret,
            });

            const res = await listQuotesHandler(req);
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
        it("GET /api/v1/quotes/:id should return 404 NOT_FOUND for foreign workspace quote", async () => {
            const req = mockRequest(`/api/v1/quotes/${foreignQuote2Id}`, {
                token: fullKey1Secret,
            });

            const res = await getQuoteHandler(req, {
                params: Promise.resolve({ id: foreignQuote2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("should return byte-identical 404 responses for nonexistent vs foreign-tenant quote ID under identical requestId", async () => {
            const testReqId = `fixed-trace-quote-${Date.now()}`;

            const nonExistentReq = mockRequest(
                "/api/v1/quotes/quote_nonexistent_999999999999",
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const nonExistentRes = await getQuoteHandler(nonExistentReq, {
                params: Promise.resolve({ id: "quote_nonexistent_999999999999" }),
            });

            const foreignReq = mockRequest(`/api/v1/quotes/${foreignQuote2Id}`, {
                token: fullKey1Secret,
                headers: { "x-request-id": testReqId },
            });
            const foreignRes = await getQuoteHandler(foreignReq, {
                params: Promise.resolve({ id: foreignQuote2Id }),
            });

            const nonExistentText = await nonExistentRes.text();
            const foreignText = await foreignRes.text();

            expect(nonExistentRes.status).toBe(404);
            expect(foreignRes.status).toBe(404);
            expect(nonExistentText).toBe(foreignText);
        });

        it("GET /api/v1/quotes (list) should strictly isolate records: Workspace 1 list NEVER contains Workspace 2 quotes", async () => {
            const req1 = mockRequest("/api/v1/quotes", { token: fullKey1Secret });
            const res1 = await listQuotesHandler(req1);
            const json1 = await res1.json();

            const ws1QuoteIds = json1.data.map((q: any) => q.id);
            expect(ws1QuoteIds).toContain(quote1Id);
            expect(ws1QuoteIds).not.toContain(foreignQuote2Id);

            const req2 = mockRequest("/api/v1/quotes", { token: fullKey2Secret });
            const res2 = await listQuotesHandler(req2);
            const json2 = await res2.json();

            const ws2QuoteIds = json2.data.map((q: any) => q.id);
            expect(ws2QuoteIds).toContain(foreignQuote2Id);
            expect(ws2QuoteIds).not.toContain(quote1Id);
        });
    });
});
