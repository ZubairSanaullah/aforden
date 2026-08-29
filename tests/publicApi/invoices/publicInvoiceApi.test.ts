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
    APPROVED_PUBLIC_INVOICE_DTO_KEYS,
    APPROVED_PUBLIC_INVOICE_LINE_ITEM_DTO_KEYS,
} from "@/lib/publicApi/invoices/invoiceDto";
import { GET as listInvoicesHandler } from "@/app/api/v1/invoices/route";
import * as invoicesRouteModule from "@/app/api/v1/invoices/route";
import { GET as getInvoiceHandler } from "@/app/api/v1/invoices/[id]/route";
import * as invoiceItemRouteModule from "@/app/api/v1/invoices/[id]/route";

describe("Phase 1.18.11 — Public Invoice API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `invc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_invc_1_${runId}`;
    const user1Id = `usr_invc_1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let unrelatedKey1Secret: string; // key without invoices:read scope

    let customer1Id: string;
    let location1Id: string;
    let invoice1Id: string;

    // Tenant 2
    const ws2Id = `ws_invc_2_${runId}`;
    const user2Id = `usr_invc_2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    let customer2Id: string;
    let location2Id: string;
    let foreignInvoice2Id: string;

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
                email: `invc-admin1-${runId}@example.com`,
                name: "Invoice Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Invoice Workspace 1",
                slug: `invc-ws1-${runId}`,
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
                email: `invc-admin2-${runId}@example.com`,
                name: "Invoice Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Invoice Workspace 2",
                slug: `invc-ws2-${runId}`,
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
            name: "Invoice Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.INVOICES_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const unrelatedKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.QUOTES_READ], // lacks invoices:read
            environment: ApiKeyEnvironment.LIVE,
        });
        unrelatedKey1Secret = unrelatedKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Invoice Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [PUBLIC_API_SCOPES.INVOICES_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Customer, Location, Invoice, Line Items, and Payment in Workspace 1
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                name: "OmniCorp Industries",
                customerNumber: `CUST-INV1-${runId}`,
                status: "ACTIVE",
            },
        });
        customer1Id = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: customer1Id,
                name: "Omni Distribution Hub",
                addressLine1: "777 Logistics Way",
                city: "Dallas",
                country: "USA",
                isPrimary: true,
            },
        });
        location1Id = loc1.id;

        const inv1 = await prisma.invoice.create({
            data: {
                workspaceId: ws1Id,
                invoiceNumber: `INV-2026-001`,
                customerId: customer1Id,
                locationId: location1Id,
                status: "PARTIALLY_PAID",
                title: "Quarterly Facilities Maintenance",
                notes: "Thank you for your business. Payment due within 30 days.",
                internalNotes: "Collections risk: LOW - internal rating A+",
                termsAndConditions: "Late payments incur 1.5% interest per month.",
                currencyCode: "USD",
                issueDate: new Date("2026-08-01T00:00:00Z"),
                dueDate: new Date("2026-08-31T23:59:59Z"),
                subtotal: 5000.0,
                discountType: "FIXED",
                discountValue: 200.0,
                discountAmount: 200.0,
                taxRate: 0.0825,
                taxAmount: 396.0,
                total: 5196.0,
                amountPaid: 2000.0,
                amountDue: 3196.0,
                issuedAt: new Date("2026-08-01T10:00:00Z"),
            },
        });
        invoice1Id = inv1.id;

        await prisma.invoiceLineItem.create({
            data: {
                invoiceId: invoice1Id,
                workspaceId: ws1Id,
                lineItemType: "CUSTOM",
                name: "Generator Diagnostics & Load Bank Testing",
                description: "Full diagnostic cycle and battery replacement",
                quantity: 1.0,
                unitPrice: 5000.0,
                unitCost: 1800.0, // Internal cost - MUST NOT LEAK
                discountAmount: 200.0,
                subtotal: 4800.0,
                taxRate: 0.0825,
                taxAmount: 396.0,
                total: 5196.0,
                sortOrder: 1,
            },
        });

        await prisma.payment.create({
            data: {
                workspaceId: ws1Id,
                invoiceId: invoice1Id,
                paymentNumber: `PAY-001-${runId}`,
                customerId: customer1Id,
                amount: 2000.0,
                currencyCode: "USD",
                paymentMethod: "CREDIT_CARD",
                referenceNumber: "ch_stripe_secret_token_123456", // Private gateway token - MUST NOT LEAK
                status: "RECORDED",
            },
        });

        // 6. Seed Customer, Location, and Invoice in Workspace 2
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                name: "Cyberdyne Systems",
                customerNumber: `CUST-INV2-${runId}`,
                status: "ACTIVE",
            },
        });
        customer2Id = cust2.id;

        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: customer2Id,
                name: "Main Laboratory",
                addressLine1: "18111 Nordhoff St",
                city: "Northridge",
                country: "USA",
                isPrimary: true,
            },
        });
        location2Id = loc2.id;

        const inv2 = await prisma.invoice.create({
            data: {
                workspaceId: ws2Id,
                invoiceNumber: `INV-2026-002`,
                customerId: customer2Id,
                locationId: location2Id,
                status: "ISSUED",
                title: "Server Room Cooling Overhaul",
                issueDate: new Date("2026-08-15T00:00:00Z"),
                dueDate: new Date("2026-09-15T23:59:59Z"),
                subtotal: 9400.0,
                total: 9400.0,
                amountPaid: 0.0,
                amountDue: 9400.0,
            },
        });
        foreignInvoice2Id = inv2.id;
    });

    afterAll(async () => {
        if (prisma) {
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
                await prisma.payment.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.invoiceLineItem.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.invoice.deleteMany({
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
    // 1. Canonical Public DTO Projection & Payment Gateway Security
    // -------------------------------------------------------------------------
    describe("1. Canonical Public DTO Projection & Financial Security", () => {
        it("should return the exact approved PublicInvoiceDto key set and exclude internalNotes/unitCost/payment provider references", async () => {
            const req = mockRequest(`/api/v1/invoices/${invoice1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getInvoiceHandler(req, {
                params: Promise.resolve({ id: invoice1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();

            const returnedHeaderKeys = Object.keys(json.data)
                .filter((k) => k !== "lineItems")
                .sort();
            const expectedHeaderKeys = [...APPROVED_PUBLIC_INVOICE_DTO_KEYS].sort();

            expect(returnedHeaderKeys).toEqual(expectedHeaderKeys);

            // Assert exclusion of internal notes, workspaceId, and raw payment structures
            expect(json.data).not.toHaveProperty("internalNotes");
            expect(json.data).not.toHaveProperty("payments");
            expect(json.data).not.toHaveProperty("workspaceId");

            expect(json.data.id).toBe(invoice1Id);
            expect(json.data.invoiceNumber).toBe("INV-2026-001");
            expect(json.data.total).toBe(5196.0);
            expect(json.data.amountPaid).toBe(2000.0);
            expect(json.data.amountDue).toBe(3196.0);
            expect(json.data.notes).toBe("Thank you for your business. Payment due within 30 days.");

            // Check line item projection and cost protection
            expect(json.data.lineItems).toBeDefined();
            expect(json.data.lineItems).toHaveLength(1);

            const lineItem = json.data.lineItems[0];
            const returnedLineItemKeys = Object.keys(lineItem).sort();
            const expectedLineItemKeys = [...APPROVED_PUBLIC_INVOICE_LINE_ITEM_DTO_KEYS].sort();

            expect(returnedLineItemKeys).toEqual(expectedLineItemKeys);
            expect(lineItem).not.toHaveProperty("unitCost"); // Protect profit margin
            expect(lineItem.name).toBe("Generator Diagnostics & Load Bank Testing");
            expect(lineItem.unitPrice).toBe(5000.0);
            expect(lineItem.total).toBe(5196.0);
        });
    });

    // -------------------------------------------------------------------------
    // 2. Collection & Item Endpoints
    // -------------------------------------------------------------------------
    describe("2. Collection & Item Endpoints", () => {
        it("GET /api/v1/invoices should return paginated list of invoices", async () => {
            const req = mockRequest("/api/v1/invoices?limit=10", {
                token: fullKey1Secret,
            });

            const res = await listInvoicesHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);
            expect(json.meta?.pagination?.limit).toBe(10);
        });

        it("GET /api/v1/invoices/:id should fetch single invoice by ID", async () => {
            const req = mockRequest(`/api/v1/invoices/${invoice1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getInvoiceHandler(req, {
                params: Promise.resolve({ id: invoice1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.id).toBe(invoice1Id);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Strict Read-Only Invariant
    // -------------------------------------------------------------------------
    describe("3. Strict Read-Only Invariant", () => {
        it("should confirm invoice route modules ONLY export GET", () => {
            expect(invoicesRouteModule).toHaveProperty("GET");
            expect(invoicesRouteModule).not.toHaveProperty("POST");
            expect(invoicesRouteModule).not.toHaveProperty("PATCH");
            expect(invoicesRouteModule).not.toHaveProperty("DELETE");
            expect(invoicesRouteModule).not.toHaveProperty("PUT");

            expect(invoiceItemRouteModule).toHaveProperty("GET");
            expect(invoiceItemRouteModule).not.toHaveProperty("POST");
            expect(invoiceItemRouteModule).not.toHaveProperty("PATCH");
            expect(invoiceItemRouteModule).not.toHaveProperty("DELETE");
            expect(invoiceItemRouteModule).not.toHaveProperty("PUT");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("4. Authentication & Scope Enforcement", () => {
        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/invoices");
            const res = await listInvoicesHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/invoices should reject key lacking invoices:read scope with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/invoices", {
                token: unrelatedKey1Secret,
            });

            const res = await listInvoicesHandler(req);
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
        it("GET /api/v1/invoices/:id should return 404 NOT_FOUND for foreign workspace invoice", async () => {
            const req = mockRequest(`/api/v1/invoices/${foreignInvoice2Id}`, {
                token: fullKey1Secret,
            });

            const res = await getInvoiceHandler(req, {
                params: Promise.resolve({ id: foreignInvoice2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("should return byte-identical 404 responses for nonexistent vs foreign-tenant invoice ID under identical requestId", async () => {
            const testReqId = `fixed-trace-invoice-${Date.now()}`;

            const nonExistentReq = mockRequest(
                "/api/v1/invoices/inv_nonexistent_999999999999",
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const nonExistentRes = await getInvoiceHandler(nonExistentReq, {
                params: Promise.resolve({ id: "inv_nonexistent_999999999999" }),
            });

            const foreignReq = mockRequest(`/api/v1/invoices/${foreignInvoice2Id}`, {
                token: fullKey1Secret,
                headers: { "x-request-id": testReqId },
            });
            const foreignRes = await getInvoiceHandler(foreignReq, {
                params: Promise.resolve({ id: foreignInvoice2Id }),
            });

            const nonExistentText = await nonExistentRes.text();
            const foreignText = await foreignRes.text();

            expect(nonExistentRes.status).toBe(404);
            expect(foreignRes.status).toBe(404);
            expect(nonExistentText).toBe(foreignText);
        });

        it("GET /api/v1/invoices (list) should strictly isolate records: Workspace 1 list NEVER contains Workspace 2 invoices", async () => {
            const req1 = mockRequest("/api/v1/invoices", { token: fullKey1Secret });
            const res1 = await listInvoicesHandler(req1);
            const json1 = await res1.json();

            const ws1InvoiceIds = json1.data.map((inv: any) => inv.id);
            expect(ws1InvoiceIds).toContain(invoice1Id);
            expect(ws1InvoiceIds).not.toContain(foreignInvoice2Id);

            const req2 = mockRequest("/api/v1/invoices", { token: fullKey2Secret });
            const res2 = await listInvoicesHandler(req2);
            const json2 = await res2.json();

            const ws2InvoiceIds = json2.data.map((inv: any) => inv.id);
            expect(ws2InvoiceIds).toContain(foreignInvoice2Id);
            expect(ws2InvoiceIds).not.toContain(invoice1Id);
        });

        it("should return raw reference ID strings without performing unscoped secondary lookups if a cross-workspace reference exists", async () => {
            // 1. Seed a valid Quote in Workspace 2
            const foreignQuote = await prisma.quote.create({
                data: {
                    workspaceId: ws2Id,
                    quoteNumber: `Q-FOREIGN-${runId}`,
                    customerId: customer2Id,
                    locationId: location2Id,
                    status: "DRAFT",
                    title: "Foreign Confidential Proposal",
                    internalNotes: "Confidential margin data in foreign tenant",
                    subtotal: 9999.0,
                    total: 9999.0,
                },
            });

            // 2. Seed a Workspace 1 invoice referencing the Workspace 2 quote ID
            const crossRefInvoice = await prisma.invoice.create({
                data: {
                    workspaceId: ws1Id,
                    invoiceNumber: `INV-CROSS-REF-${runId}`,
                    customerId: customer1Id,
                    locationId: location1Id,
                    quoteId: foreignQuote.id, // Cross-workspace reference ID
                    status: "ISSUED",
                    title: "Cross Reference Audit Invoice",
                    issueDate: new Date("2026-08-20T00:00:00Z"),
                    dueDate: new Date("2026-09-20T23:59:59Z"),
                    subtotal: 1000.0,
                    total: 1000.0,
                    amountDue: 1000.0,
                },
            });

            const req = mockRequest(`/api/v1/invoices/${crossRefInvoice.id}`, {
                token: fullKey1Secret,
            });
            const res = await getInvoiceHandler(req, {
                params: Promise.resolve({ id: crossRefInvoice.id }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);

            // Confirms only the bare scalar quoteId string is returned
            expect(json.data.quoteId).toBe(foreignQuote.id);

            // Confirms NO nested foreign quote details (title, customer, items, amounts) are resolved or exposed
            expect(json.data).not.toHaveProperty("quote");
            expect(json.data).not.toHaveProperty("workOrder");
            expect(JSON.stringify(json)).not.toContain("Foreign Confidential Proposal");
            expect(JSON.stringify(json)).not.toContain("Confidential margin data in foreign tenant");

            // Clean up test records
            await prisma.invoice.delete({ where: { id: crossRefInvoice.id } });
            await prisma.quote.delete({ where: { id: foreignQuote.id } });
        });
    });
});
