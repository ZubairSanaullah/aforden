import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderFindMany: vi.fn(),
    workOrderCount: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        workspace: { findUnique: mocks.workspaceFindUnique },
        workspaceMember: { findUnique: mocks.workspaceMemberFindUnique },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            findMany: mocks.workOrderFindMany,
            count: mocks.workOrderCount,
        },
    },
}));

import { getWorkOrder, getWorkOrders, listWorkOrders } from "@/lib/services/workOrder";
import { GET as listWorkOrdersRoute } from "@/app/api/work-orders/route";
import { GET as getWorkOrderRoute } from "@/app/api/work-orders/[workOrderId]/route";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type {
    Customer,
    ServiceLocation,
    WorkType,
    WorkOrder,
    User,
    Workspace,
    WorkspaceMember,
    TechnicianProfile,
    Employee,
} from "@/generated/prisma/client";

describe("Phase 1.6.10 — WorkOrder Directory & Query Architecture Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let workOrdersList: WorkOrder[];

    const WS_ID = "ws_query_100";
    const WS_ID_2 = "ws_query_200";

    const USER_ADMIN: User = {
        id: "user_adm_query",
        name: "Admin Query",
        email: "admin@query.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "user_tech_query",
        name: "Tech Query",
        email: "tech@query.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Query Workspace",
        slug: "query-ws",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_query",
        userId: USER_ADMIN.id,
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_query",
        userId: USER_TECH.id,
        workspaceId: WS_ID,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_query_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-100",
        name: "Acme Industrial",
        email: "acme@query.com",
        phone: "+1-555-1000",
        website: null,
        addressLine1: "100 Industrial Way",
        addressLine2: "Suite 1",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER_2: Customer = {
        id: "cust_query_2",
        workspaceId: WS_ID,
        customerNumber: "CUST-200",
        name: "Beta Corp",
        email: "beta@query.com",
        phone: "+1-555-2000",
        website: null,
        addressLine1: "200 Tech Blvd",
        addressLine2: null,
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        country: "US",
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_LOCATION: ServiceLocation = {
        id: "loc_query_1",
        customerId: FIXTURE_CUSTOMER.id,
        name: "Main Plant",
        addressLine1: "100 Industrial Way",
        addressLine2: "Suite 1",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
        latitude: null,
        longitude: null,
        notes: null,
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_WORK_TYPE: WorkType = {
        id: "wt_query_1",
        workspaceId: WS_ID,
        catalogId: "cat_query_1",
        name: "HVAC Inspection",
        code: "HVAC-01",
        description: "Routine inspection",
        estimatedDuration: 90,
        status: "ACTIVE",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_TECH_ID = "tech_prof_1";

    function createMockRequest(url: string, headers: Record<string, string> = {}): Request {
        return new Request(url, {
            method: "GET",
            headers: new Headers(headers),
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_TECH.id, USER_TECH],
        ]);
        workspacesMap = new Map([[WS_ID, WS_ALPHA]]);
        membersMap = new Map([
            [`${USER_ADMIN.id}_${WS_ID}`, MEMBER_ADMIN],
            [`${USER_TECH.id}_${WS_ID}`, MEMBER_TECH],
        ]);

        workOrdersList = [];

        mocks.auth.mockResolvedValue({
            user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
        });

        mocks.userFindUnique.mockImplementation(async ({ where }: any) => {
            return usersMap.get(where.id) || null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: any) => {
            return workspacesMap.get(where.id) || null;
        });

        mocks.workspaceMemberFindUnique.mockImplementation(async ({ where }: any) => {
            if (where.userId_workspaceId) {
                const key = `${where.userId_workspaceId.userId}_${where.userId_workspaceId.workspaceId}`;
                return membersMap.get(key) || null;
            }
            if (where.id) return membersMap.get(where.id) || null;
            return null;
        });

        mocks.workOrderFindFirst.mockImplementation(async ({ where }: any) => {
            const found = workOrdersList.find((wo) => {
                if (where.id && wo.id !== where.id) return false;
                if (where.workspaceId && wo.workspaceId !== where.workspaceId) return false;
                if (where.assignedTechnician) {
                    if (wo.assignedTechnicianId !== FIXTURE_TECH_ID) return false;
                }
                return true;
            });
            if (!found) return null;
            return {
                ...found,
                customer: found.customerId === FIXTURE_CUSTOMER_2.id ? FIXTURE_CUSTOMER_2 : FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORK_TYPE,
            };
        });

        mocks.workOrderFindMany.mockImplementation(async ({ where, orderBy, skip = 0, take = 20 }: any) => {
            let filtered = workOrdersList.filter((wo) => {
                if (where.workspaceId && wo.workspaceId !== where.workspaceId) return false;
                if (where.customerId && wo.customerId !== where.customerId) return false;
                if (where.locationId && wo.locationId !== where.locationId) return false;
                if (where.workTypeId && wo.workTypeId !== where.workTypeId) return false;
                if (where.assignedTechnicianId && wo.assignedTechnicianId !== where.assignedTechnicianId) return false;
                if (where.status && wo.status !== where.status) return false;
                if (where.priority && wo.priority !== where.priority) return false;
                if (where.assignedTechnician) {
                    if (wo.assignedTechnicianId !== FIXTURE_TECH_ID) return false;
                }
                if (where.OR && Array.isArray(where.OR)) {
                    const matchesOr = where.OR.some((clause: any) => {
                        if (clause.workOrderNumber?.contains) {
                            return wo.workOrderNumber.toLowerCase().includes(clause.workOrderNumber.contains.toLowerCase());
                        }
                        if (clause.title?.contains) {
                            return wo.title.toLowerCase().includes(clause.title.contains.toLowerCase());
                        }
                        if (clause.description?.contains && wo.description) {
                            return wo.description.toLowerCase().includes(clause.description.contains.toLowerCase());
                        }
                        if (clause.customer?.name?.contains) {
                            const cust = wo.customerId === FIXTURE_CUSTOMER_2.id ? FIXTURE_CUSTOMER_2 : FIXTURE_CUSTOMER;
                            return cust.name.toLowerCase().includes(clause.customer.name.contains.toLowerCase());
                        }
                        if (clause.customer?.customerNumber?.contains) {
                            const cust = wo.customerId === FIXTURE_CUSTOMER_2.id ? FIXTURE_CUSTOMER_2 : FIXTURE_CUSTOMER;
                            return cust.customerNumber?.toLowerCase().includes(clause.customer.customerNumber.contains.toLowerCase());
                        }
                        return false;
                    });
                    if (!matchesOr) return false;
                }
                return true;
            });

            // Sorting
            if (orderBy && Array.isArray(orderBy)) {
                filtered.sort((a, b) => {
                    for (const sortObj of orderBy) {
                        const [key, direction] = Object.entries(sortObj)[0];
                        const valA = (a as any)[key];
                        const valB = (b as any)[key];
                        if (valA === valB) continue;
                        if (direction === "asc") {
                            return valA > valB ? 1 : -1;
                        } else {
                            return valA < valB ? 1 : -1;
                        }
                    }
                    return 0;
                });
            }

            const paged = filtered.slice(skip, skip + take);
            return paged.map((wo) => ({
                ...wo,
                customer: wo.customerId === FIXTURE_CUSTOMER_2.id ? FIXTURE_CUSTOMER_2 : FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORK_TYPE,
            }));
        });

        mocks.workOrderCount.mockImplementation(async ({ where }: any) => {
            const results = await mocks.workOrderFindMany({ where, skip: 0, take: 999999 });
            return results.length;
        });
    });

    function seedWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
        const wo: WorkOrder = {
            id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId: WS_ID,
            workOrderNumber: `WO-2026-${String(workOrdersList.length + 1).padStart(6, "0")}`,
            customerId: FIXTURE_CUSTOMER.id,
            locationId: FIXTURE_LOCATION.id,
            workTypeId: FIXTURE_WORK_TYPE.id,
            assignedTechnicianId: null,
            assetId: null,
                sourceQuoteId: null,
            workTypeName: FIXTURE_WORK_TYPE.name,
            workTypeCode: FIXTURE_WORK_TYPE.code,
            estimatedDuration: FIXTURE_WORK_TYPE.estimatedDuration,
            priority: "MEDIUM",
            status: "OPEN",
            title: "Test WorkOrder",
            description: null,
            internalNotes: null,
            holdReason: null,
            cancellationReason: null,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        };
        workOrdersList.push(wo);
        return wo;
    }

    describe("1. Single WorkOrder Query (getWorkOrder)", () => {
        it("retrieves a single WorkOrder by ID with complete canonical read model", async () => {
            const created = seedWorkOrder({
                title: "Emergency Pump Repair",
                priority: "URGENT",
                status: "OPEN",
            });

            const result = await getWorkOrder(WS_ID, created.id);

            expect(result).toBeDefined();
            expect(result.id).toBe(created.id);
            expect(result.title).toBe("Emergency Pump Repair");
            expect(result.priority).toBe("URGENT");
            expect(result.customerName).toBe(FIXTURE_CUSTOMER.name);
            expect(result.customerNumber).toBe(FIXTURE_CUSTOMER.customerNumber);
            expect(result.locationName).toBe(FIXTURE_LOCATION.name);
            expect(result.locationAddress).toContain("100 Industrial Way");
            expect(result.workTypeName).toBe(FIXTURE_WORK_TYPE.name);
            expect(result.workTypeCode).toBe(FIXTURE_WORK_TYPE.code);
        });

        it("throws WorkOrderNotFoundError (404) for non-existent WorkOrder ID", async () => {
            await expect(getWorkOrder(WS_ID, "wo_non_existent")).rejects.toThrow(
                WorkOrderNotFoundError,
            );
        });

        it("throws WorkOrderNotFoundError (404) for cross-tenant WorkOrder (IDOR protection)", async () => {
            const crossTenantWo = seedWorkOrder({ workspaceId: WS_ID_2 });

            await expect(getWorkOrder(WS_ID, crossTenantWo.id)).rejects.toThrow(
                WorkOrderNotFoundError,
            );
        });

        it("enforces TECHNICIAN role scope (technician can only view assigned WorkOrders)", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            const assignedWo = seedWorkOrder({
                assignedTechnicianId: FIXTURE_TECH_ID,
                title: "Assigned To Tech",
            });
            const unassignedWo = seedWorkOrder({
                assignedTechnicianId: null,
                title: "Unassigned Order",
            });
            const otherTechWo = seedWorkOrder({
                assignedTechnicianId: "tech_prof_other",
                title: "Other Tech Order",
            });

            // Assigned to this tech -> succeeds
            const result = await getWorkOrder(WS_ID, assignedWo.id);
            expect(result.id).toBe(assignedWo.id);

            // Unassigned or assigned to other tech -> 404
            await expect(getWorkOrder(WS_ID, unassignedWo.id)).rejects.toThrow(
                WorkOrderNotFoundError,
            );
            await expect(getWorkOrder(WS_ID, otherTechWo.id)).rejects.toThrow(
                WorkOrderNotFoundError,
            );
        });
    });

    describe("2. Directory Listing & Pagination (getWorkOrders / listWorkOrders)", () => {
        it("returns an empty list with total=0 and totalPages=0 when no WorkOrders match", async () => {
            const result = await getWorkOrders(WS_ID);

            expect(result.items).toEqual([]);
            expect(result.pagination).toEqual({
                page: 1,
                pageSize: 20,
                total: 0,
                totalPages: 0,
                hasNextPage: false,
                hasPreviousPage: false,
            });
        });

        it("returns paginated WorkOrders for authorized workspace", async () => {
            for (let i = 1; i <= 25; i++) {
                seedWorkOrder({ title: `Order ${i}` });
            }

            const page1 = await getWorkOrders(WS_ID, { page: 1, pageSize: 10 });
            expect(page1.items.length).toBe(10);
            expect(page1.pagination.total).toBe(25);
            expect(page1.pagination.totalPages).toBe(3);
            expect(page1.pagination.hasNextPage).toBe(true);
            expect(page1.pagination.hasPreviousPage).toBe(false);

            const page2 = await getWorkOrders(WS_ID, { page: 2, pageSize: 10 });
            expect(page2.items.length).toBe(10);
            expect(page2.pagination.hasNextPage).toBe(true);
            expect(page2.pagination.hasPreviousPage).toBe(true);

            const page3 = await getWorkOrders(WS_ID, { page: 3, pageSize: 10 });
            expect(page3.items.length).toBe(5);
            expect(page3.pagination.hasNextPage).toBe(false);
            expect(page3.pagination.hasPreviousPage).toBe(true);
        });

        it("never returns cross-tenant records in directory query", async () => {
            seedWorkOrder({ title: "Workspace Alpha 1", workspaceId: WS_ID });
            seedWorkOrder({ title: "Workspace Beta 1", workspaceId: WS_ID_2 });

            const result = await getWorkOrders(WS_ID);
            expect(result.items.length).toBe(1);
            expect(result.items[0].title).toBe("Workspace Alpha 1");
            expect(result.pagination.total).toBe(1);
        });
    });

    describe("3. Filtering Capabilities", () => {
        beforeEach(() => {
            seedWorkOrder({
                title: "WO 1",
                status: "OPEN",
                priority: "HIGH",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORK_TYPE.id,
                assignedTechnicianId: FIXTURE_TECH_ID,
            });
            seedWorkOrder({
                title: "WO 2",
                status: "IN_PROGRESS",
                priority: "URGENT",
                customerId: FIXTURE_CUSTOMER_2.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORK_TYPE.id,
                assignedTechnicianId: null,
            });
            seedWorkOrder({
                title: "WO 3",
                status: "COMPLETED",
                priority: "LOW",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORK_TYPE.id,
                assignedTechnicianId: null,
            });
        });

        it("filters by status", async () => {
            const openOrders = await getWorkOrders(WS_ID, { status: "OPEN" });
            expect(openOrders.items.length).toBe(1);
            expect(openOrders.items[0].status).toBe("OPEN");

            const completedOrders = await getWorkOrders(WS_ID, { status: "COMPLETED" });
            expect(completedOrders.items.length).toBe(1);
            expect(completedOrders.items[0].status).toBe("COMPLETED");
        });

        it("filters by priority", async () => {
            const urgentOrders = await getWorkOrders(WS_ID, { priority: "URGENT" });
            expect(urgentOrders.items.length).toBe(1);
            expect(urgentOrders.items[0].priority).toBe("URGENT");
        });

        it("filters by customerId", async () => {
            const customerOrders = await getWorkOrders(WS_ID, { customerId: FIXTURE_CUSTOMER_2.id });
            expect(customerOrders.items.length).toBe(1);
            expect(customerOrders.items[0].customerId).toBe(FIXTURE_CUSTOMER_2.id);
        });

        it("filters by assignedTechnicianId", async () => {
            const techOrders = await getWorkOrders(WS_ID, { assignedTechnicianId: FIXTURE_TECH_ID });
            expect(techOrders.items.length).toBe(1);
            expect(techOrders.items[0].assignedTechnicianId).toBe(FIXTURE_TECH_ID);
        });

        it("filters by multiple combined criteria", async () => {
            const combined = await getWorkOrders(WS_ID, {
                status: "OPEN",
                priority: "HIGH",
                customerId: FIXTURE_CUSTOMER.id,
            });
            expect(combined.items.length).toBe(1);
            expect(combined.items[0].title).toBe("WO 1");
        });
    });

    describe("4. Search Capabilities", () => {
        beforeEach(() => {
            seedWorkOrder({
                workOrderNumber: "WO-2026-000101",
                title: "HVAC Condenser Unit 5 Fix",
                description: "Leaking coolant valve",
                customerId: FIXTURE_CUSTOMER.id, // Acme Industrial, CUST-100
            });
            seedWorkOrder({
                workOrderNumber: "WO-2026-000102",
                title: "Electrical Panel Upgrade",
                description: "Breaker panel replacement",
                customerId: FIXTURE_CUSTOMER_2.id, // Beta Corp, CUST-200
            });
        });

        it("searches by workOrderNumber", async () => {
            const res = await getWorkOrders(WS_ID, { search: "000101" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].workOrderNumber).toBe("WO-2026-000101");
        });

        it("searches by title", async () => {
            const res = await getWorkOrders(WS_ID, { search: "Condenser" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].title).toContain("Condenser");
        });

        it("searches by description", async () => {
            const res = await getWorkOrders(WS_ID, { search: "coolant" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].description).toContain("coolant");
        });

        it("searches by customer name", async () => {
            const res = await getWorkOrders(WS_ID, { search: "Beta Corp" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].customerName).toBe("Beta Corp");
        });

        it("searches by customer number", async () => {
            const res = await getWorkOrders(WS_ID, { search: "CUST-100" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].customerNumber).toBe("CUST-100");
        });
    });

    describe("5. Sorting & Order By Allowlist", () => {
        beforeEach(() => {
            seedWorkOrder({ workOrderNumber: "WO-001", title: "Alpha", priority: "LOW", createdAt: new Date("2026-01-01") });
            seedWorkOrder({ workOrderNumber: "WO-002", title: "Beta", priority: "URGENT", createdAt: new Date("2026-01-02") });
            seedWorkOrder({ workOrderNumber: "WO-003", title: "Gamma", priority: "HIGH", createdAt: new Date("2026-01-03") });
        });

        it("sorts by createdAt asc and desc", async () => {
            const asc = await getWorkOrders(WS_ID, { sortBy: "createdAt", sortOrder: "asc" });
            expect(asc.items[0].workOrderNumber).toBe("WO-001");
            expect(asc.items[2].workOrderNumber).toBe("WO-003");

            const desc = await getWorkOrders(WS_ID, { sortBy: "createdAt", sortOrder: "desc" });
            expect(desc.items[0].workOrderNumber).toBe("WO-003");
            expect(desc.items[2].workOrderNumber).toBe("WO-001");
        });

        it("sorts by title asc", async () => {
            const res = await getWorkOrders(WS_ID, { sortBy: "title", sortOrder: "asc" });
            expect(res.items[0].title).toBe("Alpha");
            expect(res.items[1].title).toBe("Beta");
            expect(res.items[2].title).toBe("Gamma");
        });

        it("rejects non-allowlisted sort fields via Zod validation", async () => {
            await expect(getWorkOrders(WS_ID, { sortBy: "hackedField" as any })).rejects.toThrow();
        });

        it("rejects invalid sort direction via Zod validation", async () => {
            await expect(getWorkOrders(WS_ID, { sortOrder: "sideways" as any })).rejects.toThrow();
        });
    });

    describe("6. REST API Boundary Contracts (GET routes)", () => {
        it("GET /api/work-orders returns 200 with paginated directory response", async () => {
            seedWorkOrder({ title: "API Directory Test" });
            const req = createMockRequest("http://localhost:3000/api/work-orders?page=1&pageSize=10", {
                "x-workspace-id": WS_ID,
            });

            const res = await listWorkOrdersRoute(req);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.items.length).toBe(1);
            expect(json.data.items[0].title).toBe("API Directory Test");
            expect(json.data.pagination.total).toBe(1);
        });

        it("GET /api/work-orders returns 400 MISSING_WORKSPACE when header is absent", async () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders");
            const res = await listWorkOrdersRoute(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("GET /api/work-orders/[workOrderId] returns 200 with canonical WorkOrderReadModel", async () => {
            const wo = seedWorkOrder({ title: "API Single Test" });
            const context = { params: Promise.resolve({ workOrderId: wo.id }) };
            const req = createMockRequest(`http://localhost:3000/api/work-orders/${wo.id}`, {
                "x-workspace-id": WS_ID,
            });

            const res = await getWorkOrderRoute(req, context);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(wo.id);
            expect(json.data.title).toBe("API Single Test");
        });

        it("GET /api/work-orders/[workOrderId] returns 404 WORK_ORDER_NOT_FOUND when record is missing", async () => {
            const context = { params: Promise.resolve({ workOrderId: "wo_not_found" }) };
            const req = createMockRequest("http://localhost:3000/api/work-orders/wo_not_found", {
                "x-workspace-id": WS_ID,
            });

            const res = await getWorkOrderRoute(req, context);
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_NOT_FOUND");
        });
    });

    describe("7. Locked Service Execution Order (Auth -> Permission -> Validation)", () => {
        const USER_NON_MEMBER: User = {
            id: "user_non_member",
            name: "Non Member",
            email: "nonmember@test.com",
            emailVerified: new Date(),
            passwordHash: "hash",
            avatarUrl: null,
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        it("getWorkOrders: rejects unauthenticated caller with UnauthorizedError BEFORE query validation", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            // Passing completely invalid input that would fail validation (invalid sortBy)
            await expect(
                getWorkOrders(WS_ID, { sortBy: "invalid_unsupported_field" as any }),
            ).rejects.toThrow(UnauthorizedError);
        });

        it("getWorkOrders: rejects non-member with ForbiddenError BEFORE query validation", async () => {
            usersMap.set(USER_NON_MEMBER.id, USER_NON_MEMBER);
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_NON_MEMBER.id, email: USER_NON_MEMBER.email },
            });

            await expect(
                getWorkOrders(WS_ID, { sortBy: "invalid_unsupported_field" as any }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("getWorkOrder: rejects unauthenticated caller with UnauthorizedError BEFORE record lookup", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(getWorkOrder(WS_ID, "wo_any_id")).rejects.toThrow(
                UnauthorizedError,
            );
        });

        it("getWorkOrder: rejects non-member with ForbiddenError BEFORE record lookup", async () => {
            usersMap.set(USER_NON_MEMBER.id, USER_NON_MEMBER);
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_NON_MEMBER.id, email: USER_NON_MEMBER.email },
            });

            await expect(getWorkOrder(WS_ID, "wo_any_id")).rejects.toThrow(
                ForbiddenError,
            );
        });
    });
});

