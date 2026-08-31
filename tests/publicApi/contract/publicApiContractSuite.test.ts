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
import { GET as getWorkOrderById, PATCH as updateWorkOrderById } from "@/app/api/v1/work-orders/[id]/route";
import { GET as getCustomers, POST as createCustomers } from "@/app/api/v1/customers/route";
import { GET as getCustomerById } from "@/app/api/v1/customers/[id]/route";
import { POST as createServiceLocations, GET as getServiceLocations } from "@/app/api/v1/customers/[id]/locations/route";
import { GET as getServiceLocationById } from "@/app/api/v1/customers/[id]/locations/[locationId]/route";
import { GET as getAssets, POST as createAssets } from "@/app/api/v1/assets/route";
import { GET as getQuotes } from "@/app/api/v1/quotes/route";
import { GET as getInvoices } from "@/app/api/v1/invoices/route";
import { GET as getParts } from "@/app/api/v1/parts/route";
import { GET as getInventory } from "@/app/api/v1/inventory/route";
import { GET as getTechnicians } from "@/app/api/v1/technicians/route";

import { APPROVED_PUBLIC_WORK_ORDER_DTO_KEYS, toPublicWorkOrderDto } from "@/lib/publicApi/workOrders/workOrderDto";
import { APPROVED_PUBLIC_CUSTOMER_DTO_KEYS, APPROVED_PUBLIC_SERVICE_LOCATION_DTO_KEYS, toPublicCustomerDto, toPublicServiceLocationDto } from "@/lib/publicApi/customers/customerDto";
import { APPROVED_PUBLIC_ASSET_DTO_KEYS, toPublicAssetDto } from "@/lib/publicApi/assets/assetDto";
import { APPROVED_PUBLIC_QUOTE_DTO_KEYS, toPublicQuoteDto } from "@/lib/publicApi/quotes/quoteDto";
import { APPROVED_PUBLIC_INVOICE_DTO_KEYS, toPublicInvoiceDto } from "@/lib/publicApi/invoices/invoiceDto";
import { APPROVED_PUBLIC_PART_DTO_KEYS, toPublicPartDto } from "@/lib/publicApi/parts/partDto";
import { APPROVED_PUBLIC_INVENTORY_BALANCE_DTO_KEYS, toPublicInventoryBalanceDto } from "@/lib/publicApi/inventory/inventoryDto";
import { APPROVED_PUBLIC_TECHNICIAN_DTO_KEYS, toPublicTechnicianDto } from "@/lib/publicApi/technicians/technicianDto";

import { SUPPORTED_API_VERSIONS, DEFAULT_API_VERSION, parseApiVersionFromPath, SUPPORTED_VERSIONS_HEADER_NAME } from "@/lib/publicApi/versions";
import { handleApiVersionDispatch } from "@/lib/publicApi/dispatch";

describe("Phase 1.18.20 — Public API Unified Contract Suite", () => {
    let ws1Id: string;
    let user1Id: string;
    let app1Id: string;
    let fullKeySecret: string;
    let readOnlyKeySecret: string;

    let customerId: string;
    let locationId: string;
    let workTypeId: string;

    const runId = Math.random().toString(36).substring(2, 9);

    beforeAll(async () => {
        const ws1 = await prisma.workspace.create({
            data: {
                name: `Contract Suite WS ${runId}`,
                slug: `contract-ws-${runId}`,
            },
        });
        ws1Id = ws1.id;

        const user1 = await prisma.user.create({
            data: {
                name: `Contract User ${runId}`,
                email: `contract-user-${runId}@example.com`,
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
            name: "Contract Suite App",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const keyFull = await createApiKey(ws1Id, app1Id, {
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
        fullKeySecret = keyFull.rawSecretKey;

        const keyReadOnly = await createApiKey(ws1Id, app1Id, {
            scopes: ["work_orders:read", "customers:read"],
        });
        readOnlyKeySecret = keyReadOnly.rawSecretKey;

        // Seed basic operational domain models
        const cat = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws1Id,
                name: `Contract Catalog ${runId}`,
                status: "ACTIVE",
            },
        });

        const wt = await prisma.workType.create({
            data: {
                workspaceId: ws1Id,
                catalogId: cat.id,
                name: `Contract Work Type ${runId}`,
                code: `CWT-${runId}`,
                status: "ACTIVE",
            },
        });
        workTypeId = wt.id;
    });

    afterAll(async () => {
        if (ws1Id) {
            await prisma.workspace.deleteMany({ where: { id: ws1Id } });
        }
        if (user1Id) {
            await prisma.user.deleteMany({ where: { id: user1Id } });
        }
    });

    describe("1. Full Cross-Cutting Lifecycle Contract", () => {
        it("executes multi-stage contract: Auth -> Scope -> Idempotency -> TraceId -> RateLimits -> Filtering -> Sorting -> Pagination", async () => {
            const customTraceId = `req_contract_flow_${runId}_${Date.now()}`;
            const customerIdempotencyKey = `idem_cust_${runId}_${Date.now()}`;

            // --- Step 1: Create Customer with Idempotency Key & Trace ID ---
            const createCustReq = new NextRequest("http://localhost:3000/api/v1/customers", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${fullKeySecret}`,
                    "content-type": "application/json",
                    "idempotency-key": customerIdempotencyKey,
                    "x-request-id": customTraceId,
                },
                body: JSON.stringify({
                    name: `Contract Acme Corp ${runId}`,
                    status: "ACTIVE",
                    email: `acme-${runId}@example.com`,
                    phone: "+15550001111",
                }),
            });

            const custRes = await createCustomers(createCustReq);
            expect(custRes.status).toBe(201);
            expect(custRes.headers.get("x-request-id")).toBe(customTraceId);
            expect(custRes.headers.get("x-ratelimit-limit")).toBeDefined();
            expect(custRes.headers.get("x-ratelimit-remaining")).toBeDefined();

            const custBody = await custRes.json();
            expect(custBody.success).toBe(true);
            expect(custBody.data.id).toBeDefined();
            expect(custBody.data.name).toBe(`Contract Acme Corp ${runId}`);
            customerId = custBody.data.id;

            // --- Step 2: Idempotency Replay Verification ---
            const replayCustReq = new NextRequest("http://localhost:3000/api/v1/customers", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${fullKeySecret}`,
                    "content-type": "application/json",
                    "idempotency-key": customerIdempotencyKey,
                    "x-request-id": `req_replay_${customTraceId}`,
                },
                body: JSON.stringify({
                    name: `Contract Acme Corp ${runId}`,
                    status: "ACTIVE",
                    email: `acme-${runId}@example.com`,
                    phone: "+15550001111",
                }),
            });

            const replayRes = await createCustomers(replayCustReq);
            expect(replayRes.status).toBe(201);
            const replayBody = await replayRes.json();
            expect(replayBody.data.id).toBe(customerId);

            // --- Step 3: Create Service Location ---
            const createLocReq = new NextRequest(`http://localhost:3000/api/v1/customers/${customerId}/locations`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${fullKeySecret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    name: "Headquarters",
                    addressLine1: "100 Innovation Way",
                    city: "Austin",
                    state: "TX",
                    postalCode: "78701",
                    country: "USA",
                }),
            });

            const locRes = await createServiceLocations(createLocReq, { params: Promise.resolve({ id: customerId }) });
            expect(locRes.status).toBe(201);
            const locBody = await locRes.json();
            locationId = locBody.data.id;

            // --- Step 4: Create 3 Work Orders for Filtering & Pagination Testing ---
            for (let i = 1; i <= 3; i++) {
                const createWoReq = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                    method: "POST",
                    headers: {
                        authorization: `Bearer ${fullKeySecret}`,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        customerId,
                        locationId,
                        workTypeId,
                        title: `Contract Work Order ${i}`,
                        priority: i === 1 ? "HIGH" : "MEDIUM",
                        description: `Automated test work order ${i}`,
                    }),
                });
                const woRes = await createWorkOrders(createWoReq);
                expect(woRes.status).toBe(201);
            }

            // --- Step 5: Filtered, Sorted, and Paginated List Query ---
            const listReq = new NextRequest(
                `http://localhost:3000/api/v1/work-orders?customer_id=${customerId}&priority=HIGH&sort=-createdAt&limit=1`,
                {
                    headers: {
                        authorization: `Bearer ${fullKeySecret}`,
                        "x-request-id": `req_list_${runId}`,
                    },
                },
            );

            const listRes = await getWorkOrders(listReq);
            expect(listRes.status).toBe(200);
            expect(listRes.headers.get("x-request-id")).toBe(`req_list_${runId}`);

            const listBody = await listRes.json();
            expect(listBody.success).toBe(true);
            expect(Array.isArray(listBody.data)).toBe(true);
            expect(listBody.data.length).toBe(1);
            expect(listBody.data[0].priority).toBe("HIGH");
            expect(listBody.data[0].customerId).toBe(customerId);
            expect(listBody.meta).toBeDefined();
            expect(listBody.meta.pagination).toBeDefined();
            expect(listBody.meta.pagination.hasMore).toBeDefined();

            // --- Step 6: Scope Enforcement (Read-Only key attempting mutation) ---
            const writeAttemptReq = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${readOnlyKeySecret}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    customerId,
                    locationId,
                    workTypeId,
                    title: "Forbidden Work Order",
                }),
            });

            const writeRes = await createWorkOrders(writeAttemptReq);
            expect(writeRes.status).toBe(403);
            const writeErr = await writeRes.json();
            expect(writeErr.success).toBe(false);
            expect(writeErr.error.code).toBe("FORBIDDEN");
            expect(writeErr.error.message).toContain("Missing required API scope");
        }, 30000);
    });

    describe("2. DTO Whitelist Immutability & Anti-Regression Contract", () => {
        it("verifies all public DTO serializers strictly strip internal properties and contain only approved keys", () => {
            // 1. Work Order DTO
            const mockWorkOrder: any = {
                id: "wo_1",
                workspaceId: "ws_internal_secret",
                workOrderNumber: "WO-2026-001",
                customerId: "cust_1",
                locationId: "loc_1",
                workTypeId: "wt_1",
                workTypeName: "Repair",
                status: "OPEN",
                priority: "HIGH",
                title: "Title",
                description: "Desc",
                tags: ["tag1"],
                internalNotes: "DO NOT LEAK",
                unapprovedAdminField: "LEAKED",
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const woDto = toPublicWorkOrderDto(mockWorkOrder);
            const woDtoKeys = Object.keys(woDto);
            expect(woDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_WORK_ORDER_DTO_KEYS].sort());
            expect((woDto as any).internalNotes).toBeUndefined();
            expect((woDto as any).unapprovedAdminField).toBeUndefined();
            expect((woDto as any).workspaceId).toBeUndefined();

            // 2. Customer DTO
            const mockCustomer: any = {
                id: "cust_1",
                workspaceId: "ws_secret",
                customerNumber: "CUST-001",
                name: "Customer Name",
                email: "cust@example.com",
                phone: "123",
                website: "https://example.com",
                addressLine1: "123 St",
                addressLine2: null,
                city: "City",
                state: "ST",
                postalCode: "12345",
                country: "USA",
                status: "ACTIVE",
                notes: "Secret Notes",
                internalBillingId: "SECRET_BILLING_ID",
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const custDto = toPublicCustomerDto(mockCustomer);
            const custDtoKeys = Object.keys(custDto);
            expect(custDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_CUSTOMER_DTO_KEYS].sort());
            expect((custDto as any).internalBillingId).toBeUndefined();
            expect((custDto as any).workspaceId).toBeUndefined();

            // 3. Service Location DTO
            const mockLocation: any = {
                id: "loc_1",
                customerId: "cust_1",
                name: "Building A",
                addressLine1: "123 St",
                addressLine2: null,
                city: "City",
                state: "ST",
                postalCode: "12345",
                country: "USA",
                isPrimary: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const locDto = toPublicServiceLocationDto(mockLocation);
            const locDtoKeys = Object.keys(locDto);
            expect(locDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_SERVICE_LOCATION_DTO_KEYS].sort());

            // 4. Asset DTO
            const mockAsset: any = {
                id: "ast_1",
                workspaceId: "ws_secret",
                assetNumber: "AST-001",
                name: "Unit 1",
                status: "IN_STORAGE",
                serialNumber: "SN-123",
                modelNumber: "MD-456",
                manufacturer: "Trane",
                customerId: null,
                locationId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const astDto = toPublicAssetDto(mockAsset);
            const astDtoKeys = Object.keys(astDto);
            expect(astDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_ASSET_DTO_KEYS].sort());
            expect((astDto as any).workspaceId).toBeUndefined();

            // 5. Quote DTO
            const mockQuote: any = {
                id: "q_1",
                workspaceId: "ws_secret",
                quoteNumber: "Q-001",
                customerId: "cust_1",
                locationId: "loc_1",
                title: "Quote Title",
                status: "DRAFT",
                subtotal: 100,
                total: 100,
                validUntil: null,
                notes: "Notes",
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const quoteDto = toPublicQuoteDto(mockQuote);
            const quoteDtoKeys = Object.keys(quoteDto);
            expect(quoteDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_QUOTE_DTO_KEYS].sort());
            expect((quoteDto as any).workspaceId).toBeUndefined();

            // 6. Invoice DTO
            const mockInvoice: any = {
                id: "inv_1",
                workspaceId: "ws_secret",
                invoiceNumber: "INV-001",
                customerId: "cust_1",
                locationId: "loc_1",
                title: "Invoice Title",
                issueDate: new Date(),
                dueDate: new Date(),
                status: "ISSUED",
                subtotal: 100,
                total: 100,
                amountPaid: 0,
                balanceDue: 100,
                notes: "Notes",
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const invDto = toPublicInvoiceDto(mockInvoice);
            const invDtoKeys = Object.keys(invDto);
            expect(invDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_INVOICE_DTO_KEYS].sort());
            expect((invDto as any).workspaceId).toBeUndefined();

            // 7. Part DTO
            const mockPart: any = {
                id: "prt_1",
                workspaceId: "ws_secret",
                name: "Part Name",
                sku: "SKU-001",
                description: "Part Desc",
                unitOfMeasure: "EACH",
                unitCost: 10,
                minimumStockLevel: 5,
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const partDto = toPublicPartDto(mockPart);
            const partDtoKeys = Object.keys(partDto);
            expect(partDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_PART_DTO_KEYS].sort());
            expect((partDto as any).workspaceId).toBeUndefined();

            // 8. Inventory Balance DTO
            const mockBalance: any = {
                id: "inv_bal_1",
                workspaceId: "ws_secret",
                partId: "prt_1",
                locationId: "loc_1",
                onHand: 10,
                allocated: 2,
                available: 8,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const balDto = toPublicInventoryBalanceDto(mockBalance);
            const balDtoKeys = Object.keys(balDto);
            expect(balDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_INVENTORY_BALANCE_DTO_KEYS].sort());
            expect((balDto as any).workspaceId).toBeUndefined();

            // 9. Technician Profile DTO
            const mockTech: any = {
                id: "mem_1",
                workspaceId: "ws_secret",
                userId: "usr_1",
                role: "TECHNICIAN",
                status: "ACTIVE",
                user: {
                    id: "usr_1",
                    name: "Tech Name",
                    email: "tech@example.com",
                    status: "ACTIVE",
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const techDto = toPublicTechnicianDto(mockTech);
            const techDtoKeys = Object.keys(techDto);
            expect(techDtoKeys.sort()).toEqual([...APPROVED_PUBLIC_TECHNICIAN_DTO_KEYS].sort());
            expect((techDto as any).workspaceId).toBeUndefined();
        });
    });

    describe("3. API Versioning & Compatibility Contract", () => {
        it("verifies canonical version 'v1' is active and supported", () => {
            expect(SUPPORTED_API_VERSIONS).toEqual(["v1"]);
            expect(DEFAULT_API_VERSION).toBe("v1");
        });

        it("correctly identifies version paths and rejects unsupported versions", () => {
            const v1Path = parseApiVersionFromPath("/api/v1/work-orders");
            expect(v1Path.isPublicApi).toBe(true);
            expect(v1Path.version).toBe("v1");
            expect(v1Path.isSupported).toBe(true);
            expect(v1Path.subPath).toBe("/work-orders");

            const v2Path = parseApiVersionFromPath("/api/v2/customers");
            expect(v2Path.isPublicApi).toBe(true);
            expect(v2Path.version).toBe("v2");
            expect(v2Path.isSupported).toBe(false);

            const nonPublicPath = parseApiVersionFromPath("/api/vendors");
            expect(nonPublicPath.isPublicApi).toBe(false);
        });

        it("returns HTTP 404 API_VERSION_UNSUPPORTED with X-Aforden-Supported-Versions header for unsupported version request", async () => {
            const req = new Request("http://localhost:3000/api/v2/work-orders", {
                method: "GET",
                headers: {
                    "x-request-id": "req_v2_unsupported_test",
                },
            });
            const res = handleApiVersionDispatch(req);
            expect(res).not.toBeNull();
            expect(res!.status).toBe(404);
            expect(res!.headers.get(SUPPORTED_VERSIONS_HEADER_NAME)).toBe("v1");
            const body = await res!.json();
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("API_VERSION_UNSUPPORTED");
            expect(body.error.requestId).toBe("req_v2_unsupported_test");
        });

        it("confirms unknown client headers or forward-compatible optional fields do not break the gateway contract", async () => {
            const req = new NextRequest("http://localhost:3000/api/v1/work-orders", {
                headers: {
                    authorization: `Bearer ${fullKeySecret}`,
                    "x-future-client-header": "2027-client-extension",
                    "x-custom-analytics-id": "client_analytics_999",
                },
            });
            const res = await getWorkOrders(req);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
        });
    });
});
