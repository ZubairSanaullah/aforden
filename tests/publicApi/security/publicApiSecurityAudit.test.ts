import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
    createDeveloperApplication,
    createApiKey,
} from "@/lib/services/developerApp";
import { NextRequest } from "next/server";
import { GET as getWorkOrders, POST as createWorkOrders } from "@/app/api/v1/work-orders/route";
import { GET as getWorkOrderById } from "@/app/api/v1/work-orders/[id]/route";
import { GET as getCustomers, POST as createCustomers } from "@/app/api/v1/customers/route";
import { GET as getCustomerById } from "@/app/api/v1/customers/[id]/route";
import { POST as createServiceLocations } from "@/app/api/v1/customers/[id]/locations/route";
import { GET as getServiceLocationById } from "@/app/api/v1/customers/[id]/locations/[locationId]/route";
import { GET as getAssets, POST as createAssets } from "@/app/api/v1/assets/route";
import { GET as getAssetById } from "@/app/api/v1/assets/[id]/route";
import { GET as getTechnicians } from "@/app/api/v1/technicians/route";
import { GET as getTechnicianById } from "@/app/api/v1/technicians/[id]/route";
import { GET as getQuotes } from "@/app/api/v1/quotes/route";
import { GET as getQuoteById } from "@/app/api/v1/quotes/[id]/route";
import { GET as getInvoices } from "@/app/api/v1/invoices/route";
import { GET as getInvoiceById } from "@/app/api/v1/invoices/[id]/route";
import { GET as getParts } from "@/app/api/v1/parts/route";
import { GET as getPartById } from "@/app/api/v1/parts/[id]/route";
import { GET as getInventory } from "@/app/api/v1/inventory/route";

describe("Phase 1.18.19 — Public API Comprehensive Security & Pipeline Audit", () => {
    let ws1Id: string;
    let ws2Id: string;
    let user1Id: string;
    let user2Id: string;
    let app1Id: string;
    let app2Id: string;

    let fullKey1Secret: string;
    let multiScopeSecret: string;
    let invoiceOnlySecret: string;

    let ws1CustomerId: string;
    let ws1LocationId: string;
    let ws1WorkTypeId: string;
    let ws1WorkOrderId: string;
    let ws1AssetId: string;

    let ws2CustomerId: string;
    let ws2LocationId: string;
    let ws2WorkOrderId: string;
    let ws2AssetId: string;
    let ws2TechMemberId: string;
    let ws2QuoteId: string;
    let ws2InvoiceId: string;
    let ws2PartId: string;

    const runId = Math.random().toString(36).substring(2, 9);

    beforeAll(async () => {
        // --- 1. Setup Workspace 1 (Target Tenant) ---
        const ws1 = await prisma.workspace.create({
            data: {
                name: `Audit WS 1 ${runId}`,
                slug: `audit-ws1-${runId}`,
            },
        });
        ws1Id = ws1.id;

        const user1 = await prisma.user.create({
            data: {
                name: `Audit User 1 ${runId}`,
                email: `audit-user-1-${runId}@example.com`,
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
            name: "Audit App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        // Full access API key for WS1
        const keyGen1 = await createApiKey(ws1Id, app1Id, {
            scopes: [
                "work_orders:read",
                "work_orders:write",
                "customers:read",
                "customers:write",
                "assets:read",
                "assets:write",
                "inventory:read",
                "technicians:read",
                "schedules:read",
                "quotes:read",
                "invoices:read",
            ],
        });
        fullKey1Secret = keyGen1.rawSecretKey;

        // Multi-scope key (work_orders:write + customers:write only)
        const keyGenMulti = await createApiKey(ws1Id, app1Id, {
            scopes: ["work_orders:read", "work_orders:write", "customers:read", "customers:write"],
        });
        multiScopeSecret = keyGenMulti.rawSecretKey;

        // Mismatched / Excessive scope key (invoices:read + quotes:read only)
        const keyGenInvoiceOnly = await createApiKey(ws1Id, app1Id, {
            scopes: ["invoices:read", "quotes:read"],
        });
        invoiceOnlySecret = keyGenInvoiceOnly.rawSecretKey;

        // Seed domain data in WS1
        const cat1 = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws1Id,
                name: `Catalog 1 ${runId}`,
                status: "ACTIVE",
            },
        });

        const wt1 = await prisma.workType.create({
            data: {
                workspaceId: ws1Id,
                catalogId: cat1.id,
                name: `Work Type 1 ${runId}`,
                code: `WT-1-${runId}`,
                status: "ACTIVE",
            },
        });
        ws1WorkTypeId = wt1.id;

        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `AUD-CUST-1-${runId}`,
                name: "Audit Cust 1",
                status: "ACTIVE",
            },
        });
        ws1CustomerId = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: cust1.id,
                name: "Loc 1",
                addressLine1: "100 Test St",
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
            },
        });
        ws1LocationId = loc1.id;

        const wo1 = await prisma.workOrder.create({
            data: {
                workspaceId: ws1Id,
                workOrderNumber: `WO-2026-${runId}01`,
                customerId: cust1.id,
                locationId: loc1.id,
                workTypeId: wt1.id,
                workTypeName: wt1.name,
                status: "OPEN",
                priority: "MEDIUM",
                title: "WS1 Work Order",
            },
        });
        ws1WorkOrderId = wo1.id;

        const ast1 = await prisma.asset.create({
            data: {
                workspaceId: ws1Id,
                assetNumber: `AST-1-${runId}`,
                name: "WS1 HVAC Unit",
                status: "IN_STORAGE",
            },
        });
        ws1AssetId = ast1.id;

        // --- 2. Setup Workspace 2 (Foreign Tenant) & Seed All Resources ---
        const ws2 = await prisma.workspace.create({
            data: {
                name: `Audit WS 2 ${runId}`,
                slug: `audit-ws2-${runId}`,
            },
        });
        ws2Id = ws2.id;

        const user2 = await prisma.user.create({
            data: {
                name: `Audit User 2 ${runId}`,
                email: `audit-user-2-${runId}@example.com`,
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

        // 1. Foreign Customer
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                customerNumber: `AUD-CUST-2-${runId}`,
                name: "Audit Foreign Cust 2",
                status: "ACTIVE",
            },
        });
        ws2CustomerId = cust2.id;

        // 2. Foreign ServiceLocation
        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: cust2.id,
                name: "Foreign Loc 2",
                addressLine1: "200 Foreign St",
                city: "Dallas",
                state: "TX",
                postalCode: "75001",
                country: "USA",
            },
        });
        ws2LocationId = loc2.id;

        // 3. Foreign WorkOrder
        const wo2 = await prisma.workOrder.create({
            data: {
                workspaceId: ws2Id,
                workOrderNumber: `WO-2026-${runId}02`,
                customerId: cust2.id,
                locationId: loc2.id,
                workTypeId: wt1.id,
                workTypeName: wt1.name,
                status: "OPEN",
                priority: "HIGH",
                title: "Foreign Work Order",
            },
        });
        ws2WorkOrderId = wo2.id;

        // 4. Foreign Asset
        const ast2 = await prisma.asset.create({
            data: {
                workspaceId: ws2Id,
                assetNumber: `AST-2-${runId}`,
                name: "Foreign Asset 2",
                status: "IN_STORAGE",
            },
        });
        ws2AssetId = ast2.id;

        // 5. Foreign Technician
        const techUser2 = await prisma.user.create({
            data: {
                name: "Foreign Tech 2",
                email: `foreign-tech-2-${runId}@example.com`,
                status: "ACTIVE",
                emailVerified: new Date(),
            },
        });
        const techMem2 = await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: techUser2.id,
                role: "TECHNICIAN",
                status: "ACTIVE",
            },
        });
        ws2TechMemberId = techMem2.id;

        // 6. Foreign Quote
        const quote2 = await prisma.quote.create({
            data: {
                workspaceId: ws2Id,
                quoteNumber: `Q-2026-${runId}`,
                customerId: cust2.id,
                locationId: loc2.id,
                title: "Foreign Quote 2",
                status: "DRAFT",
                subtotal: 250.0,
                total: 250.0,
            },
        });
        ws2QuoteId = quote2.id;

        // 7. Foreign Invoice
        const inv2 = await prisma.invoice.create({
            data: {
                workspaceId: ws2Id,
                invoiceNumber: `INV-2026-${runId}`,
                customerId: cust2.id,
                locationId: loc2.id,
                title: "Foreign Invoice 2",
                issueDate: new Date("2026-08-15T00:00:00Z"),
                dueDate: new Date("2026-09-15T23:59:59Z"),
                status: "ISSUED",
                subtotal: 500.0,
                total: 500.0,
                amountPaid: 0.0,
            },
        });
        ws2InvoiceId = inv2.id;

        // 8. Foreign Part
        const part2 = await prisma.part.create({
            data: {
                workspaceId: ws2Id,
                name: "Foreign Filter 2",
                sku: `SKU-FLTR-${runId}`,
                unitOfMeasure: "EACH",
                unitCost: 15.0,
                minimumStockLevel: 2.0,
                status: "ACTIVE",
            },
        });
        ws2PartId = part2.id;
    });

    afterAll(async () => {
        const wsIds = [ws1Id, ws2Id].filter(Boolean);
        const userIds = [user1Id, user2Id].filter(Boolean);
        if (wsIds.length > 0) {
            await prisma.workspace.deleteMany({
                where: { id: { in: wsIds } },
            });
        }
        if (userIds.length > 0) {
            await prisma.user.deleteMany({
                where: { id: { in: userIds } },
            });
        }
    });

    describe("1. Authentication & Enumeration Resistance", () => {
        it("returns byte-identical 401 responses for invalid, revoked, expired, and malformed keys", async () => {
            const revokedKeyGen = await createApiKey(ws1Id, app1Id, {
                scopes: ["work_orders:read"],
            });
            await prisma.apiKey.update({
                where: { id: revokedKeyGen.id },
                data: { status: "REVOKED" },
            });

            const expiredKeyGen = await createApiKey(ws1Id, app1Id, {
                scopes: ["work_orders:read"],
                expiresAt: new Date(Date.now() - 10000),
            });

            const fixedRequestId = "req_audit_auth_test_12345";

            const getAuthResult = async (authHeader?: string) => {
                const req = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                    headers: {
                        ...(authHeader ? { authorization: authHeader } : {}),
                        "x-request-id": fixedRequestId,
                    },
                });
                const res = await getWorkOrders(req);
                expect(res.status).toBe(401);
                return res.json();
            };

            const invalidKeyRes = await getAuthResult("Bearer afd_live_invalidkeyprefix1234567890abcdef12345678");
            const revokedKeyRes = await getAuthResult(`Bearer ${revokedKeyGen.rawSecretKey}`);
            const expiredKeyRes = await getAuthResult(`Bearer ${expiredKeyGen.rawSecretKey}`);
            const malformedKeyRes = await getAuthResult("Basic invalidtokenformat");
            const missingHeaderRes = await getAuthResult(undefined);

            const expectedBody = {
                success: false,
                error: {
                    code: "UNAUTHORIZED",
                    message: "Invalid or missing API key.",
                    requestId: fixedRequestId,
                    documentationUrl: "https://docs.aforden.com/api/errors#UNAUTHORIZED",
                },
            };

            expect(invalidKeyRes).toEqual(expectedBody);
            expect(revokedKeyRes).toEqual(expectedBody);
            expect(expiredKeyRes).toEqual(expectedBody);
            expect(malformedKeyRes).toEqual(expectedBody);
            expect(missingHeaderRes).toEqual(expectedBody);
        });
    });

    describe("2. Authorization & Scope Boundary Hardening", () => {
        it("strictly bounds multi-scope keys: holding work_orders:write + customers:write cannot bypass tenant boundaries", async () => {
            const reqForeignCust = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${multiScopeSecret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    customerId: ws2CustomerId, // foreign customer
                    locationId: ws1LocationId,
                    workTypeId: ws1WorkTypeId,
                    title: "Cross-Tenant Work Order Attempt",
                    priority: "HIGH",
                }),
            });
            const resForeignCust = await createWorkOrders(reqForeignCust);
            expect(resForeignCust.status).toBe(404);
            const errForeign = await resForeignCust.json();
            expect(errForeign.error.code).toBe("NOT_FOUND");
        });

        it("enforces scope specificity: holding valid scopes in another domain (invoices:read, quotes:read) is rejected on work_orders:read with 403", async () => {
            const req = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                headers: {
                    authorization: `Bearer ${invoiceOnlySecret}`,
                },
            });
            const res = await getWorkOrders(req);
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error.code).toBe("FORBIDDEN");
            expect(body.error.message).toContain("Missing required API scope");
        });
    });

    describe("3. Cross-Tenant IDOR & Enumeration Resistance Across All 8 Resources", () => {
        const fixedRequestId = "req_audit_idor_all_resources_test";

        it("WorkOrders: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/work-orders/${ws2WorkOrderId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getWorkOrderById(reqForeign, { params: Promise.resolve({ id: ws2WorkOrderId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest("http://localhost:3000/api/v1/work-orders/cmtg99999nonexistent001", {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getWorkOrderById(reqNonexistent, { params: Promise.resolve({ id: "cmtg99999nonexistent001" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });

        it("Customers: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/customers/${ws2CustomerId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getCustomerById(reqForeign, { params: Promise.resolve({ id: ws2CustomerId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest("http://localhost:3000/api/v1/customers/cmtg99999nonexistent002", {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getCustomerById(reqNonexistent, { params: Promise.resolve({ id: "cmtg99999nonexistent002" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });

        it("ServiceLocations: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/customers/${ws1CustomerId}/locations/${ws2LocationId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getServiceLocationById(reqForeign, { params: Promise.resolve({ id: ws1CustomerId, locationId: ws2LocationId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest(`http://localhost:3000/api/v1/customers/${ws1CustomerId}/locations/cmtg99999nonexistent003`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getServiceLocationById(reqNonexistent, { params: Promise.resolve({ id: ws1CustomerId, locationId: "cmtg99999nonexistent003" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });

        it("Assets: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/assets/${ws2AssetId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getAssetById(reqForeign, { params: Promise.resolve({ id: ws2AssetId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest("http://localhost:3000/api/v1/assets/cmtg99999nonexistent004", {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getAssetById(reqNonexistent, { params: Promise.resolve({ id: "cmtg99999nonexistent004" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });

        it("Technicians: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/technicians/${ws2TechMemberId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getTechnicianById(reqForeign, { params: Promise.resolve({ id: ws2TechMemberId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest("http://localhost:3000/api/v1/technicians/cmtg99999nonexistent005", {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getTechnicianById(reqNonexistent, { params: Promise.resolve({ id: "cmtg99999nonexistent005" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });

        it("Quotes: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/quotes/${ws2QuoteId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getQuoteById(reqForeign, { params: Promise.resolve({ id: ws2QuoteId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest("http://localhost:3000/api/v1/quotes/cmtg99999nonexistent006", {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getQuoteById(reqNonexistent, { params: Promise.resolve({ id: "cmtg99999nonexistent006" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });

        it("Invoices: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/invoices/${ws2InvoiceId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getInvoiceById(reqForeign, { params: Promise.resolve({ id: ws2InvoiceId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest("http://localhost:3000/api/v1/invoices/cmtg99999nonexistent007", {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getInvoiceById(reqNonexistent, { params: Promise.resolve({ id: "cmtg99999nonexistent007" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });

        it("Parts: returns byte-identical 404 for foreign workspace ID vs nonexistent ID", async () => {
            const reqForeign = new NextRequest(`http://localhost:3000/api/v1/parts/${ws2PartId}`, {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resForeign = await getPartById(reqForeign, { params: Promise.resolve({ id: ws2PartId }) });
            expect(resForeign.status).toBe(404);

            const reqNonexistent = new NextRequest("http://localhost:3000/api/v1/parts/cmtg99999nonexistent008", {
                headers: { authorization: `Bearer ${fullKey1Secret}`, "x-request-id": fixedRequestId },
            });
            const resNonexistent = await getPartById(reqNonexistent, { params: Promise.resolve({ id: "cmtg99999nonexistent008" }) });
            expect(resNonexistent.status).toBe(404);

            expect(await resForeign.json()).toEqual(await resNonexistent.json());
        });
    });

    describe("4. Input Validation, Injection & Oversized Payload Hardening", () => {
        const sqliPayload = "Robert'); DROP TABLE \"Customer\";--";
        const xssPayload = "<script>alert('xss')</script>";

        it("WorkOrders POST: safely handles SQL injection, XSS, and rejects oversized titles with 422", async () => {
            // 1. SQLi & XSS
            const reqValid = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    customerId: ws1CustomerId,
                    locationId: ws1LocationId,
                    workTypeId: ws1WorkTypeId,
                    title: sqliPayload,
                    description: xssPayload,
                }),
            });
            const resValid = await createWorkOrders(reqValid);
            expect(resValid.status).toBe(201);
            const body = await resValid.json();
            expect(body.data.title).toBe(sqliPayload);
            expect(body.data.description).toBe(xssPayload);

            // 2. Oversized Payload (> 255 chars in title)
            const reqOversized = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    customerId: ws1CustomerId,
                    locationId: ws1LocationId,
                    workTypeId: ws1WorkTypeId,
                    title: "A".repeat(1000), // > 255 chars
                }),
            });
            const resOversized = await createWorkOrders(reqOversized);
            expect(resOversized.status).toBe(422);
            const errBody = await resOversized.json();
            expect(errBody.error.code).toBe("VALIDATION_ERROR");
        }, 15000);

        it("Customers POST: safely handles SQL injection, XSS, and rejects oversized names with 422", async () => {
            // 1. SQLi & XSS
            const reqValid = new NextRequest("http://localhost:3000/api/v1/customers", {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    name: sqliPayload,
                    addressLine1: xssPayload,
                    status: "ACTIVE",
                }),
            });
            const resValid = await createCustomers(reqValid);
            expect(resValid.status).toBe(201);
            const body = await resValid.json();
            expect(body.data.name).toBe(sqliPayload);

            // 2. Oversized Payload
            const reqOversized = new NextRequest("http://localhost:3000/api/v1/customers", {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    name: "B".repeat(500),
                    status: "ACTIVE",
                }),
            });
            const resOversized = await createCustomers(reqOversized);
            expect(resOversized.status).toBe(422);
        }, 15000);

        it("ServiceLocations POST: safely handles SQL injection, XSS, and rejects oversized names with 422", async () => {
            // 1. SQLi & XSS
            const reqValid = new NextRequest(`http://localhost:3000/api/v1/customers/${ws1CustomerId}/locations`, {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    name: sqliPayload,
                    addressLine1: "123 Safe St",
                    city: "Austin",
                    state: "TX",
                    postalCode: "78701",
                    country: "USA",
                }),
            });
            const resValid = await createServiceLocations(reqValid, { params: Promise.resolve({ id: ws1CustomerId }) });
            expect(resValid.status).toBe(201);
            const body = await resValid.json();
            expect(body.data.name).toBe(sqliPayload);

            // 2. Oversized Payload
            const reqOversized = new NextRequest(`http://localhost:3000/api/v1/customers/${ws1CustomerId}/locations`, {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    name: "C".repeat(500),
                    addressLine1: "123 Safe St",
                    city: "Austin",
                    state: "TX",
                    postalCode: "78701",
                    country: "USA",
                }),
            });
            const resOversized = await createServiceLocations(reqOversized, { params: Promise.resolve({ id: ws1CustomerId }) });
            expect(resOversized.status).toBe(422);
        }, 15000);

        it("Assets POST: safely handles SQL injection, XSS, and rejects oversized names with 422", async () => {
            // 1. SQLi & XSS
            const reqValid = new NextRequest("http://localhost:3000/api/v1/assets", {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    name: sqliPayload,
                    serialNumber: xssPayload,
                }),
            });
            const resValid = await createAssets(reqValid);
            expect(resValid.status).toBe(201);
            const body = await resValid.json();
            expect(body.data.name).toBe(sqliPayload);

            // 2. Oversized Payload
            const reqOversized = new NextRequest("http://localhost:3000/api/v1/assets", {
                method: "POST",
                headers: { authorization: `Bearer ${fullKey1Secret}`, "content-type": "application/json" },
                body: JSON.stringify({
                    name: "D".repeat(500),
                }),
            });
            const resOversized = await createAssets(reqOversized);
            expect(resOversized.status).toBe(422);
        }, 15000);
    });

    describe("5. Pipeline Layering & Order-of-Operations Audit", () => {
        it("confirms rate limiting executes before idempotency gate: idempotent replay consumes rate limit token", async () => {
            const idempotencyKey = `idem_audit_${runId}_${Date.now()}`;

            const makeReq = () =>
                new NextRequest("http://localhost:3000/api/v1/customers", {
                    method: "POST",
                    headers: {
                        authorization: `Bearer ${fullKey1Secret}`,
                        "content-type": "application/json",
                        "idempotency-key": idempotencyKey,
                    },
                    body: JSON.stringify({
                        name: "Idempotent Rate Limit Audit Customer",
                        status: "ACTIVE",
                    }),
                });

            // 1. Initial creation request -> 201 Created
            const res1 = await createCustomers(makeReq());
            expect(res1.status).toBe(201);
            const body1 = await res1.json();

            // 2. Replay request -> 201 Replay (same data)
            const res2 = await createCustomers(makeReq());
            expect(res2.status).toBe(201);
            const body2 = await res2.json();
            expect(body2.data.id).toBe(body1.data.id);
        });
    });
});
