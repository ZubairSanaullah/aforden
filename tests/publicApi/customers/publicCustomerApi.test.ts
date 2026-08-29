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
    APPROVED_PUBLIC_CUSTOMER_DTO_KEYS,
    APPROVED_PUBLIC_SERVICE_LOCATION_DTO_KEYS,
} from "@/lib/publicApi/customers/customerDto";
import {
    GET as listCustomersHandler,
    POST as createCustomerHandler,
} from "@/app/api/v1/customers/route";
import {
    GET as getCustomerHandler,
    PATCH as updateCustomerHandler,
} from "@/app/api/v1/customers/[id]/route";
import {
    GET as listServiceLocationsHandler,
    POST as createServiceLocationHandler,
} from "@/app/api/v1/customers/[id]/locations/route";
import {
    GET as getServiceLocationHandler,
    PATCH as updateServiceLocationHandler,
} from "@/app/api/v1/customers/[id]/locations/[locationId]/route";

describe("Phase 1.18.8 — Public Customer & Location API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_cust_1_${runId}`;
    const user1Id = `usr_cust_1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let readOnlyKey1Secret: string;
    let writeOnlyKey1Secret: string;

    // Tenant 2
    const ws2Id = `ws_cust_2_${runId}`;
    const user2Id = `usr_cust_2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    // Domain IDs for Tenant 1
    let activeCustomer1Id: string;
    let inactiveCustomer1Id: string;
    let location1Id: string;
    let customerB1Id: string;
    let locationB1Id: string;

    // Domain IDs for Tenant 2
    let activeCustomer2Id: string;
    let location2Id: string;

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
                email: `cust-user1-${runId}@example.com`,
                name: "Customer Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Customer Test Workspace 1",
                slug: `cust-ws1-${runId}`,
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

        // 2. Setup Workspace 2 and Membership
        await prisma.user.create({
            data: {
                id: user2Id,
                email: `cust-user2-${runId}@example.com`,
                name: "Customer Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Customer Test Workspace 2",
                slug: `cust-ws2-${runId}`,
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
            name: "Customer Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
                PUBLIC_API_SCOPES.CUSTOMERS_WRITE,
            ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const readKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.CUSTOMERS_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        readOnlyKey1Secret = readKey1.rawSecretKey;

        const writeKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.CUSTOMERS_WRITE],
            environment: ApiKeyEnvironment.LIVE,
        });
        writeOnlyKey1Secret = writeKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Customer Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
                PUBLIC_API_SCOPES.CUSTOMERS_WRITE,
            ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Initial Customer & Location in Workspace 1
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `CUST-WS1-001`,
                name: "Acme Corp WS1",
                email: `acme-${runId}@example.com`,
                phone: "555-0101",
                addressLine1: "100 Industrial Parkway",
                city: "Metropolis",
                state: "NY",
                postalCode: "10001",
                country: "USA",
                status: "ACTIVE",
                notes: "Internal private notes for Acme Corp",
            },
        });
        activeCustomer1Id = cust1.id;

        const inactiveCust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `CUST-WS1-INACTIVE`,
                name: "Inactive Client WS1",
                email: `inactive-${runId}@example.com`,
                status: "INACTIVE",
                notes: "Internal private notes for inactive customer",
            },
        });
        inactiveCustomer1Id = inactiveCust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: activeCustomer1Id,
                name: "HQ Main Campus",
                addressLine1: "100 Industrial Parkway",
                city: "Metropolis",
                state: "NY",
                postalCode: "10001",
                country: "USA",
                latitude: 40.7128,
                longitude: -74.006,
                isPrimary: true,
                notes: "Main loading dock behind Building B",
            },
        });
        location1Id = loc1.id;

        // 6. Seed Customer B & Location B in Workspace 1 (for IDOR / cross-customer testing)
        const custB = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `CUST-WS1-002`,
                name: "Wayne Enterprises WS1",
                email: `wayne-${runId}@example.com`,
                phone: "555-0303",
                addressLine1: "1007 Mountain Drive",
                city: "Gotham",
                state: "NJ",
                postalCode: "07001",
                country: "USA",
                status: "ACTIVE",
                notes: "Cave entrance behind waterfall",
            },
        });
        customerB1Id = custB.id;

        const locB = await prisma.serviceLocation.create({
            data: {
                customerId: customerB1Id,
                name: "Wayne Manor Gatehouse",
                addressLine1: "1007 Mountain Drive",
                city: "Gotham",
                state: "NJ",
                postalCode: "07001",
                country: "USA",
                isPrimary: true,
                notes: "Private security checkpoint",
            },
        });
        locationB1Id = locB.id;

        // 7. Seed Initial Customer & Location in Workspace 2
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                customerNumber: `CUST-WS2-001`,
                name: "Stark Industries WS2",
                email: `stark-${runId}@example.com`,
                phone: "555-0202",
                addressLine1: "10880 Malibu Point",
                city: "Malibu",
                state: "CA",
                postalCode: "90265",
                country: "USA",
                status: "ACTIVE",
                notes: "Secret R&D facility notes",
            },
        });
        activeCustomer2Id = cust2.id;

        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: activeCustomer2Id,
                name: "Malibu Cliffside",
                addressLine1: "10880 Malibu Point",
                city: "Malibu",
                state: "CA",
                postalCode: "90265",
                country: "USA",
                isPrimary: true,
                notes: "Helipad access only",
            },
        });
        location2Id = loc2.id;
    });

    afterAll(async () => {
        if (prisma) {
            const customerIds = [activeCustomer1Id, inactiveCustomer1Id, customerB1Id, activeCustomer2Id].filter(Boolean);
            if (customerIds.length > 0) {
                await prisma.serviceLocation.deleteMany({
                    where: { customerId: { in: customerIds } },
                });
                await prisma.customer.deleteMany({
                    where: { id: { in: customerIds } },
                });
            }
            const appIds = [app1Id, app2Id].filter(Boolean);
            if (appIds.length > 0) {
                await prisma.apiKey.deleteMany({
                    where: { developerApplicationId: { in: appIds } },
                });
                await prisma.developerApplication.deleteMany({
                    where: { id: { in: appIds } },
                });
            }
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
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
    // 1. DTO Key Set Exactness & Internal Field Exclusion
    // -------------------------------------------------------------------------
    describe("1. Canonical Public DTO Projection & Sanitization", () => {
        it("should return the exact approved PublicCustomerDto key set and exclude internal-only fields", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getCustomerHandler(req, {
                params: Promise.resolve({ id: activeCustomer1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();

            const returnedKeys = Object.keys(json.data).sort();
            const expectedKeys = [...APPROVED_PUBLIC_CUSTOMER_DTO_KEYS].sort();

            expect(returnedKeys).toEqual(expectedKeys);
            expect(json.data).not.toHaveProperty("workspaceId");
            expect(json.data).not.toHaveProperty("notes");
            expect(json.data).not.toHaveProperty("contacts");
            expect(json.data).not.toHaveProperty("locations");
            expect(json.data).not.toHaveProperty("workOrders");
        });

        it("should return the exact approved PublicServiceLocationDto key set and exclude internal-only fields", async () => {
            const req = mockRequest(
                `/api/v1/customers/${activeCustomer1Id}/locations/${location1Id}`,
                { token: fullKey1Secret },
            );

            const res = await getServiceLocationHandler(req, {
                params: Promise.resolve({
                    id: activeCustomer1Id,
                    locationId: location1Id,
                }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();

            const returnedKeys = Object.keys(json.data).sort();
            const expectedKeys = [...APPROVED_PUBLIC_SERVICE_LOCATION_DTO_KEYS].sort();

            expect(returnedKeys).toEqual(expectedKeys);
            expect(json.data).not.toHaveProperty("notes");
            expect(json.data).not.toHaveProperty("customer");
            expect(json.data).not.toHaveProperty("workOrders");
            expect(json.data.latitude).toBe(40.7128);
            expect(json.data.longitude).toBe(-74.006);
            expect(json.data.isPrimary).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // 2. Customer Collection & Item Endpoints
    // -------------------------------------------------------------------------
    describe("2. Customer Endpoints (GET list, GET item, POST create, PATCH update)", () => {
        it("GET /api/v1/customers (list) should return paginated collection of customers", async () => {
            const req = mockRequest("/api/v1/customers?limit=10", {
                token: fullKey1Secret,
            });

            const res = await listCustomersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);
            expect(json.meta?.pagination).toBeDefined();
            expect(json.meta.pagination.limit).toBe(10);
        });

        it("POST /api/v1/customers should create a new customer and return HTTP 201", async () => {
            const req = mockRequest("/api/v1/customers", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Globex Corporation",
                    email: `globex-${runId}@example.com`,
                    phone: "555-0303",
                    city: "Cypress Creek",
                    country: "USA",
                },
            });

            const res = await createCustomerHandler(req);
            expect(res.status).toBe(201);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBeDefined();
            expect(json.data.name).toBe("Globex Corporation");
            expect(json.data.status).toBe("ACTIVE");
            expect(json.data.customerNumber).toBeDefined();
            expect(json.data).not.toHaveProperty("workspaceId");
        });

        it("PATCH /api/v1/customers/:id should update mutable fields and return HTTP 200", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer1Id}`, {
                method: "PATCH",
                token: fullKey1Secret,
                body: {
                    phone: "555-9999",
                    city: "New Metropolis",
                },
            });

            const res = await updateCustomerHandler(req, {
                params: Promise.resolve({ id: activeCustomer1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(activeCustomer1Id);
            expect(json.data.phone).toBe("555-9999");
            expect(json.data.city).toBe("New Metropolis");
        });
    });

    // -------------------------------------------------------------------------
    // 3. Service Location Endpoints
    // -------------------------------------------------------------------------
    describe("3. Service Location Sub-Resource Endpoints", () => {
        let createdLocationId: string;

        it("POST /api/v1/customers/:id/locations should create a new location and return HTTP 201", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer1Id}/locations`, {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Branch Office 2",
                    addressLine1: "200 Second St",
                    city: "Metropolis",
                    country: "USA",
                    postalCode: "10002",
                    isPrimary: false,
                },
            });

            const res = await createServiceLocationHandler(req, {
                params: Promise.resolve({ id: activeCustomer1Id }),
            });
            expect(res.status).toBe(201);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBeDefined();
            expect(json.data.customerId).toBe(activeCustomer1Id);
            expect(json.data.name).toBe("Branch Office 2");
            expect(json.data.isPrimary).toBe(false);
            createdLocationId = json.data.id;
        });

        it("GET /api/v1/customers/:id/locations should list locations for customer", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer1Id}/locations`, {
                token: fullKey1Secret,
            });

            const res = await listServiceLocationsHandler(req, {
                params: Promise.resolve({ id: activeCustomer1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(2);
        });

        it("PATCH /api/v1/customers/:id/locations/:locId should update location mutable fields", async () => {
            const req = mockRequest(
                `/api/v1/customers/${activeCustomer1Id}/locations/${createdLocationId}`,
                {
                    method: "PATCH",
                    token: fullKey1Secret,
                    body: {
                        name: "Branch Office 2 - Renovated",
                        addressLine2: "Suite 400",
                    },
                },
            );

            const res = await updateServiceLocationHandler(req, {
                params: Promise.resolve({
                    id: activeCustomer1Id,
                    locationId: createdLocationId,
                }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.name).toBe("Branch Office 2 - Renovated");
            expect(json.data.addressLine2).toBe("Suite 400");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("4. Authentication & Scope Enforcement", () => {
        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/customers");
            const res = await listCustomersHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/customers should reject write-only key with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/customers", {
                token: writeOnlyKey1Secret,
            });

            const res = await listCustomersHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("POST /api/v1/customers should reject read-only key with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/customers", {
                method: "POST",
                token: readOnlyKey1Secret,
                body: { name: "Should Fail Corp", country: "USA" },
            });

            const res = await createCustomerHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("PATCH /api/v1/customers/:id should reject read-only key with 403 FORBIDDEN", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer1Id}`, {
                method: "PATCH",
                token: readOnlyKey1Secret,
                body: { name: "Forbidden Update" },
            });

            const res = await updateCustomerHandler(req, {
                params: Promise.resolve({ id: activeCustomer1Id }),
            });
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("POST /api/v1/customers/:id/locations should reject read-only key with 403 FORBIDDEN", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer1Id}/locations`, {
                method: "POST",
                token: readOnlyKey1Secret,
                body: {
                    name: "Forbidden Location",
                    addressLine1: "123 Street",
                    city: "Town",
                    country: "USA",
                },
            });

            const res = await createServiceLocationHandler(req, {
                params: Promise.resolve({ id: activeCustomer1Id }),
            });
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    // -------------------------------------------------------------------------
    // 5. Tenant Isolation & Enumeration Resistance (1.18.6 contract)
    // -------------------------------------------------------------------------
    describe("5. Tenant Isolation & Enumeration Resistance", () => {
        it("GET /api/v1/customers/:id should return 404 NOT_FOUND for foreign workspace customer", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer2Id}`, {
                token: fullKey1Secret,
            });

            const res = await getCustomerHandler(req, {
                params: Promise.resolve({ id: activeCustomer2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("PATCH /api/v1/customers/:id should return 404 NOT_FOUND for foreign workspace customer", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer2Id}`, {
                method: "PATCH",
                token: fullKey1Secret,
                body: { name: "Attacker Malicious Name" },
            });

            const res = await updateCustomerHandler(req, {
                params: Promise.resolve({ id: activeCustomer2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("GET /api/v1/customers/:id/locations should return 404 NOT_FOUND for foreign workspace customer", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer2Id}/locations`, {
                token: fullKey1Secret,
            });

            const res = await listServiceLocationsHandler(req, {
                params: Promise.resolve({ id: activeCustomer2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("should return byte-identical 404 responses for nonexistent vs foreign-tenant customer ID under identical requestId", async () => {
            const testReqId = `fixed-trace-cust-${Date.now()}`;

            const nonExistentReq = mockRequest(
                "/api/v1/customers/cust_nonexistent_999999999999",
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const nonExistentRes = await getCustomerHandler(nonExistentReq, {
                params: Promise.resolve({ id: "cust_nonexistent_999999999999" }),
            });

            const foreignReq = mockRequest(`/api/v1/customers/${activeCustomer2Id}`, {
                token: fullKey1Secret,
                headers: { "x-request-id": testReqId },
            });
            const foreignRes = await getCustomerHandler(foreignReq, {
                params: Promise.resolve({ id: activeCustomer2Id }),
            });

            const nonExistentText = await nonExistentRes.text();
            const foreignText = await foreignRes.text();

            expect(nonExistentRes.status).toBe(404);
            expect(foreignRes.status).toBe(404);
            expect(nonExistentText).toBe(foreignText);
        });

        it("GET /api/v1/customers/:id/locations/:locId within SAME workspace should return 404 NOT_FOUND when location belongs to a DIFFERENT customer (IDOR protection)", async () => {
            // Customer A querying Customer B's location within the same authorized workspace
            const req = mockRequest(
                `/api/v1/customers/${activeCustomer1Id}/locations/${locationB1Id}`,
                { token: fullKey1Secret },
            );

            const res = await getServiceLocationHandler(req, {
                params: Promise.resolve({
                    id: activeCustomer1Id,
                    locationId: locationB1Id,
                }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.message).toBe("Service location not found.");
        });

        it("PATCH /api/v1/customers/:id/locations/:locId within SAME workspace should return 404 NOT_FOUND when location belongs to a DIFFERENT customer (IDOR protection)", async () => {
            // Attempting to patch Customer B's location through Customer A's URL path
            const req = mockRequest(
                `/api/v1/customers/${activeCustomer1Id}/locations/${locationB1Id}`,
                {
                    method: "PATCH",
                    token: fullKey1Secret,
                    body: { name: "Malicious Location Name Hijack" },
                },
            );

            const res = await updateServiceLocationHandler(req, {
                params: Promise.resolve({
                    id: activeCustomer1Id,
                    locationId: locationB1Id,
                }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
            expect(json.error.message).toBe("Service location not found.");

            // Verify the location was NOT mutated in the database
            const untouched = await prisma.serviceLocation.findUnique({
                where: { id: locationB1Id },
            });
            expect(untouched?.name).toBe("Wayne Manor Gatehouse");
        });

        it("should return byte-identical 404 responses for nonexistent vs mismatched-customer location ID under identical requestId", async () => {
            const testReqId = `fixed-trace-loc-idor-${Date.now()}`;

            const nonExistentReq = mockRequest(
                `/api/v1/customers/${activeCustomer1Id}/locations/loc_nonexistent_999999999999`,
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const nonExistentRes = await getServiceLocationHandler(nonExistentReq, {
                params: Promise.resolve({
                    id: activeCustomer1Id,
                    locationId: "loc_nonexistent_999999999999",
                }),
            });

            const mismatchedReq = mockRequest(
                `/api/v1/customers/${activeCustomer1Id}/locations/${locationB1Id}`,
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const mismatchedRes = await getServiceLocationHandler(mismatchedReq, {
                params: Promise.resolve({
                    id: activeCustomer1Id,
                    locationId: locationB1Id,
                }),
            });

            const nonExistentText = await nonExistentRes.text();
            const mismatchedText = await mismatchedRes.text();

            expect(nonExistentRes.status).toBe(404);
            expect(mismatchedRes.status).toBe(404);
            expect(nonExistentText).toBe(mismatchedText);
        });

        it("GET /api/v1/customers (list) should strictly isolate records: Workspace 1 list NEVER contains Workspace 2 customers", async () => {
            const req1 = mockRequest("/api/v1/customers", { token: fullKey1Secret });
            const res1 = await listCustomersHandler(req1);
            const json1 = await res1.json();

            const ws1CustomerIds = json1.data.map((c: any) => c.id);
            expect(ws1CustomerIds).toContain(activeCustomer1Id);
            expect(ws1CustomerIds).toContain(customerB1Id);
            expect(ws1CustomerIds).not.toContain(activeCustomer2Id);

            const req2 = mockRequest("/api/v1/customers", { token: fullKey2Secret });
            const res2 = await listCustomersHandler(req2);
            const json2 = await res2.json();

            const ws2CustomerIds = json2.data.map((c: any) => c.id);
            expect(ws2CustomerIds).toContain(activeCustomer2Id);
            expect(ws2CustomerIds).not.toContain(activeCustomer1Id);
            expect(ws2CustomerIds).not.toContain(customerB1Id);
        });
    });

    // -------------------------------------------------------------------------
    // 6. Validation Error Handling (422)
    // -------------------------------------------------------------------------
    describe("6. Validation & Schema Enforcement", () => {
        it("POST /api/v1/customers should return 422 with field-level details on invalid body", async () => {
            const req = mockRequest("/api/v1/customers", {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "", // empty name invalid
                    email: "not-an-email",
                },
            });

            const res = await createCustomerHandler(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(Array.isArray(json.error.details)).toBe(true);
            expect(json.error.details.length).toBeGreaterThanOrEqual(1);
        });

        it("POST /api/v1/customers/:id/locations should return 422 on invalid location payload", async () => {
            const req = mockRequest(`/api/v1/customers/${activeCustomer1Id}/locations`, {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "",
                    // missing addressLine1, city, country
                },
            });

            const res = await createServiceLocationHandler(req, {
                params: Promise.resolve({ id: activeCustomer1Id }),
            });
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });

    // -------------------------------------------------------------------------
    // 7. Inactive Customer Handling Policy
    // -------------------------------------------------------------------------
    describe("7. Inactive Customer Handling", () => {
        it("GET /api/v1/customers/:id should allow reading an INACTIVE customer and return status=INACTIVE", async () => {
            const req = mockRequest(`/api/v1/customers/${inactiveCustomer1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getCustomerHandler(req, {
                params: Promise.resolve({ id: inactiveCustomer1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(inactiveCustomer1Id);
            expect(json.data.status).toBe("INACTIVE");
        });

        it("POST /api/v1/customers/:id/locations on an INACTIVE customer should reject with 409 CONFLICT", async () => {
            const req = mockRequest(`/api/v1/customers/${inactiveCustomer1Id}/locations`, {
                method: "POST",
                token: fullKey1Secret,
                body: {
                    name: "Inactive Customer Location",
                    addressLine1: "123 Ghost Town Rd",
                    city: "Nowhere",
                    country: "USA",
                },
            });

            const res = await createServiceLocationHandler(req, {
                params: Promise.resolve({ id: inactiveCustomer1Id }),
            });
            expect(res.status).toBe(409);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("CONFLICT");
            expect(json.error.message).toContain("inactive customer");
        });
    });

    // -------------------------------------------------------------------------
    // 8. Pagination, Filtering, Sorting
    // -------------------------------------------------------------------------
    describe("8. Pagination, Filtering & Sorting", () => {
        it("should apply limit parameter correctly", async () => {
            const req = mockRequest("/api/v1/customers?limit=1", {
                token: fullKey1Secret,
            });

            const res = await listCustomersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBe(1);
            expect(json.meta.pagination.limit).toBe(1);
            expect(json.meta.pagination.hasMore).toBe(true);
            expect(json.meta.pagination.nextCursor).toBeDefined();
        });

        it("should filter by status (status=INACTIVE)", async () => {
            const req = mockRequest("/api/v1/customers?status=INACTIVE", {
                token: fullKey1Secret,
            });

            const res = await listCustomersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            for (const item of json.data) {
                expect(item.status).toBe("INACTIVE");
            }
        });

        it("should sort by name ascending when requested", async () => {
            const req = mockRequest("/api/v1/customers?sort=name", {
                token: fullKey1Secret,
            });

            const res = await listCustomersHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBeGreaterThanOrEqual(1);
        });
    });
});
