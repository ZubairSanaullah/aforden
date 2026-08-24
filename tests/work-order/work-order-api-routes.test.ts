import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderCreate: vi.fn(),
    workOrderUpdate: vi.fn(),
    workOrderHistoryCreate: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
        },
        customer: {
            findFirst: mocks.customerFindFirst,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
        },
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            create: mocks.workOrderCreate,
            update: mocks.workOrderUpdate,
        },
        workOrderHistory: {
            create: mocks.workOrderHistoryCreate,
        },
        $transaction: mocks.transaction,
    },
}));

import { POST as createWorkOrderRoute } from "@/app/api/work-orders/route";
import { PATCH as updateWorkOrderRoute } from "@/app/api/work-orders/[workOrderId]/route";
import {
    POST as transitionStatusPostRoute,
    PATCH as transitionStatusPatchRoute,
} from "@/app/api/work-orders/[workOrderId]/status/route";
import {
    POST as assignWorkOrderRoute,
    DELETE as unassignWorkOrderRoute,
} from "@/app/api/work-orders/[workOrderId]/assignment/route";
import { POST as reassignWorkOrderRoute } from "@/app/api/work-orders/[workOrderId]/assignment/reassign/route";
import {
    POST as assignAliasRoute,
    DELETE as unassignAliasRoute,
} from "@/app/api/work-orders/[workOrderId]/assign/route";
import { POST as reassignAliasRoute } from "@/app/api/work-orders/[workOrderId]/assign/reassign/route";

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

describe("Phase 1.6.8 — WorkOrder REST API Routes Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let workOrdersList: WorkOrder[];

    const WS_ID = "ws_api_100";
    const WS_ID_2 = "ws_api_200";

    const USER_ADMIN: User = {
        id: "user_adm_api",
        name: "Admin Api",
        email: "admin@api.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_DISPATCHER: User = {
        id: "user_disp_api",
        name: "Dispatcher Api",
        email: "disp@api.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_ACCOUNTANT: User = {
        id: "user_acct_api",
        name: "Accountant Api",
        email: "acct@api.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "API Workspaces",
        slug: "api-ws",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_api_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-100",
        name: "Facility Corp",
        email: "facility@api.com",
        phone: "+1-555-9000",
        website: null,
        addressLine1: "123 Industrial Pkwy",
        addressLine2: null,
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_LOCATION: ServiceLocation = {
        id: "loc_api_1",
        customerId: FIXTURE_CUSTOMER.id,
        name: "Building A",
        addressLine1: "123 Industrial Pkwy",
        addressLine2: "Suite 400",
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

    const FIXTURE_WORKTYPE: WorkType = {
        id: "wt_api_1",
        workspaceId: WS_ID,
        catalogId: "sc_api_1",
        name: "Commercial Electrical Service",
        code: "ELEC-COM-01",
        description: "Standard diagnostic",
        estimatedDuration: 120,
        status: "ACTIVE",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_EMPLOYEE: Employee = {
        id: "emp_api_1",
        workspaceId: WS_ID,
        workspaceMemberId: "mem_tech_api",
        departmentId: null,
        jobTitleId: null,
        employeeNumber: "EMP-001",
        displayName: "Tech Bob",
        phone: null,
        hireDate: new Date(),
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_TECH_PROFILE: TechnicianProfile = {
        id: "tp_api_1",
        employeeId: FIXTURE_EMPLOYEE.id,
        licenseNumber: "LIC-001",
        yearsExperience: 5,
        emergencyContact: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        workOrdersList = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
        usersMap.set(USER_DISPATCHER.id, USER_DISPATCHER);
        usersMap.set(USER_ACCOUNTANT.id, USER_ACCOUNTANT);

        workspacesMap.set(WS_ALPHA.id, WS_ALPHA);

        const memAdmin: WorkspaceMember = {
            id: "mem_adm_api",
            userId: USER_ADMIN.id,
            workspaceId: WS_ALPHA.id,
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memDisp: WorkspaceMember = {
            id: "mem_disp_api",
            userId: USER_DISPATCHER.id,
            workspaceId: WS_ALPHA.id,
            role: "DISPATCHER",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memAcct: WorkspaceMember = {
            id: "mem_acct_api",
            userId: USER_ACCOUNTANT.id,
            workspaceId: WS_ALPHA.id,
            role: "ACCOUNTANT",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        membersMap.set(`${USER_ADMIN.id}_${WS_ALPHA.id}`, memAdmin);
        membersMap.set(`${USER_DISPATCHER.id}_${WS_ALPHA.id}`, memDisp);
        membersMap.set(`${USER_ACCOUNTANT.id}_${WS_ALPHA.id}`, memAcct);

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
            if (where.id) {
                return membersMap.get(where.id) || null;
            }
            return null;
        });

        mocks.customerFindFirst.mockImplementation(async ({ where }: any) => {
            if (where.id === FIXTURE_CUSTOMER.id && where.workspaceId === WS_ID) {
                return FIXTURE_CUSTOMER;
            }
            return null;
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            if (where.id === FIXTURE_LOCATION.id && where.customerId === FIXTURE_CUSTOMER.id) {
                return FIXTURE_LOCATION;
            }
            return null;
        });

        mocks.workTypeFindFirst.mockImplementation(async ({ where }: any) => {
            if (where.id === FIXTURE_WORKTYPE.id && where.workspaceId === WS_ID) {
                return {
                    ...FIXTURE_WORKTYPE,
                    catalog: {
                        id: FIXTURE_WORKTYPE.catalogId,
                        status: "ACTIVE",
                    },
                };
            }
            return null;
        });

        mocks.technicianProfileFindFirst.mockImplementation(async ({ where }: any) => {
            if (where.id === FIXTURE_TECH_PROFILE.id) {
                return {
                    ...FIXTURE_TECH_PROFILE,
                    employee: FIXTURE_EMPLOYEE,
                };
            }
            return null;
        });

        mocks.workOrderFindFirst.mockImplementation(async ({ where }: any) => {
            const found = workOrdersList.find((wo) => {
                if (where.id && wo.id !== where.id) return false;
                if (where.workspaceId && wo.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;
            return {
                ...found,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORKTYPE,
            };
        });

        mocks.workOrderCreate.mockImplementation(async ({ data }: any) => {
            const created: WorkOrder = {
                id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                workspaceId: data.workspaceId,
                workOrderNumber: data.workOrderNumber,
                customerId: data.customerId,
                locationId: data.locationId,
                workTypeId: data.workTypeId,
                assignedTechnicianId: data.assignedTechnicianId ?? null,
                assetId: data.assetId ?? null,
                sourceQuoteId: data.sourceQuoteId ?? null,
                workTypeName: data.workTypeName,
                workTypeCode: data.workTypeCode ?? null,
                estimatedDuration: data.estimatedDuration ?? null,
                status: data.status ?? "OPEN",
                priority: data.priority ?? "MEDIUM",
                title: data.title,
                description: data.description ?? null,
                internalNotes: data.internalNotes ?? null,
                holdReason: data.holdReason ?? null,
                cancellationReason: data.cancellationReason ?? null,
                startedAt: data.startedAt ?? null,
                completedAt: data.completedAt ?? null,
                cancelledAt: data.cancelledAt ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workOrdersList.push(created);
            return {
                ...created,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORKTYPE,
            };
        });

        mocks.workOrderUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = workOrdersList.findIndex((wo) => wo.id === where.id);
            if (index === -1) throw new Error("Record not found");

            const updated: WorkOrder = {
                ...workOrdersList[index],
                ...data,
                updatedAt: new Date(),
            };
            workOrdersList[index] = updated;

            return {
                ...updated,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORKTYPE,
            };
        });

        mocks.transaction.mockImplementation(async (callback: any) => {
            if (typeof callback === "function") {
                return callback({
                    workOrder: {
                        findFirst: mocks.workOrderFindFirst,
                        create: mocks.workOrderCreate,
                        update: mocks.workOrderUpdate,
                    },
                    workOrderHistory: {
                        create: mocks.workOrderHistoryCreate,
                    },
                });
            }
            return callback;
        });
    });

    function createRequest(
        method: string,
        url: string,
        body?: any,
        headers: Record<string, string> = { "x-workspace-id": WS_ID },
    ): Request {
        return new Request(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        });
    }

    function createFixtureWorkOrder(status = "OPEN", assignedTechId: string | null = null): WorkOrder {
        const wo: WorkOrder = {
            id: `wo_fix_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId: WS_ID,
            workOrderNumber: `WO-2026-000001`,
            customerId: FIXTURE_CUSTOMER.id,
            locationId: FIXTURE_LOCATION.id,
            workTypeId: FIXTURE_WORKTYPE.id,
            assignedTechnicianId: assignedTechId,
            assetId: null,
            sourceQuoteId: null,
            workTypeName: FIXTURE_WORKTYPE.name,
            workTypeCode: FIXTURE_WORKTYPE.code,
            estimatedDuration: FIXTURE_WORKTYPE.estimatedDuration,
            status: status as any,
            priority: "MEDIUM",
            title: "Fixture Work Order",
            description: "Diagnostic required",
            internalNotes: "Notes",
            holdReason: null,
            cancellationReason: null,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        workOrdersList.push(wo);
        return wo;
    }

    describe("1. Workspace Context & Authentication Boundaries", () => {
        it("returns 400 Bad Request if workspace header/param is missing", async () => {
            const req = createRequest("POST", "http://localhost/api/work-orders", {}, {});
            const res = await createWorkOrderRoute(req);
            const body = await res.json();

            expect(res.status).toBe(400);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("MISSING_WORKSPACE");
        });

        it("returns 401 Unauthorized if caller has no active session", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = createRequest("POST", "http://localhost/api/work-orders", {
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORKTYPE.id,
                title: "Test Work Order",
            });
            const res = await createWorkOrderRoute(req);
            const body = await res.json();

            expect(res.status).toBe(401);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("UNAUTHORIZED");
        });

        it("returns 403 Forbidden if caller lacks permission (e.g. ACCOUNTANT)", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_ACCOUNTANT.id } });
            const req = createRequest("POST", "http://localhost/api/work-orders", {
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORKTYPE.id,
                title: "Test Work Order",
            });
            const res = await createWorkOrderRoute(req);
            const body = await res.json();

            expect(res.status).toBe(403);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("FORBIDDEN");
        });
    });

    describe("2. POST /api/work-orders (Creation Route)", () => {
        it("creates a WorkOrder and returns 201 Created with WorkOrderReadModel", async () => {
            const req = createRequest("POST", "http://localhost/api/work-orders", {
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORKTYPE.id,
                title: "HVAC Urgent Inspection",
                priority: "HIGH",
            });
            const res = await createWorkOrderRoute(req);
            const body = await res.json();

            expect(res.status).toBe(201);
            expect(body.success).toBe(true);
            expect(body.data.title).toBe("HVAC Urgent Inspection");
            expect(body.data.priority).toBe("HIGH");
            expect(body.data.status).toBe("OPEN");
            expect(body.data.workTypeName).toBe(FIXTURE_WORKTYPE.name);
        });

        it("returns 422 Unprocessable Entity on validation error", async () => {
            const req = createRequest("POST", "http://localhost/api/work-orders", {
                customerId: FIXTURE_CUSTOMER.id,
                // Missing required locationId, workTypeId, and title
            });
            const res = await createWorkOrderRoute(req);
            const body = await res.json();

            expect(res.status).toBe(422);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });

        it("returns 400 Bad Request on malformed JSON payload", async () => {
            const req = createRequest("POST", "http://localhost/api/work-orders", "invalid-json-body{");
            const res = await createWorkOrderRoute(req);
            const body = await res.json();

            expect(res.status).toBe(400);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("INVALID_REQUEST");
        });
    });

    describe("3. PATCH /api/work-orders/[workOrderId] (Update Route)", () => {
        it("updates operational fields and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder();
            const req = createRequest("PATCH", `http://localhost/api/work-orders/${wo.id}`, {
                title: "Updated Title via REST",
                priority: "URGENT",
            });
            const res = await updateWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.title).toBe("Updated Title via REST");
            expect(body.data.priority).toBe("URGENT");
        });

        it("returns 404 Not Found if WorkOrder does not exist in workspace", async () => {
            const req = createRequest("PATCH", `http://localhost/api/work-orders/wo_nonexistent_99`, {
                title: "Should Fail",
            });
            const res = await updateWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_nonexistent_99" }),
            });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("WORK_ORDER_NOT_FOUND");
        });

        it("returns 409 Conflict if WorkOrder is in terminal state", async () => {
            const wo = createFixtureWorkOrder("COMPLETED");
            const req = createRequest("PATCH", `http://localhost/api/work-orders/${wo.id}`, {
                title: "Terminal Edit Attempt",
            });
            const res = await updateWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(409);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("WORK_ORDER_IMMUTABLE");
        });
    });

    describe("4. POST / PATCH /api/work-orders/[workOrderId]/status (Status Transition Route)", () => {
        it("transitions status via POST and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", FIXTURE_TECH_PROFILE.id);
            const req = createRequest("POST", `http://localhost/api/work-orders/${wo.id}/status`, {
                toStatus: "ASSIGNED",
            });
            const res = await transitionStatusPostRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.status).toBe("ASSIGNED");
        });

        it("transitions status via PATCH and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", FIXTURE_TECH_PROFILE.id);
            const req = createRequest("PATCH", `http://localhost/api/work-orders/${wo.id}/status`, {
                toStatus: "ASSIGNED",
            });
            const res = await transitionStatusPatchRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.status).toBe("ASSIGNED");
        });

        it("returns 409 Conflict when attempting an invalid status transition", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            const req = createRequest("POST", `http://localhost/api/work-orders/${wo.id}/status`, {
                toStatus: "COMPLETED", // Invalid transition directly from OPEN
            });
            const res = await transitionStatusPostRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(409);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("WORK_ORDER_INVALID_STATUS_TRANSITION");
        });
    });

    describe("5. POST / DELETE /api/work-orders/[workOrderId]/assignment (Assignment Routes)", () => {
        it("assigns technician via POST /assignment and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            const req = createRequest("POST", `http://localhost/api/work-orders/${wo.id}/assignment`, {
                technicianId: FIXTURE_TECH_PROFILE.id,
            });
            const res = await assignWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE.id);
        });

        it("assigns technician via alias POST /assign and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            const req = createRequest("POST", `http://localhost/api/work-orders/${wo.id}/assign`, {
                technicianId: FIXTURE_TECH_PROFILE.id,
            });
            const res = await assignAliasRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE.id);
        });

        it("unassigns technician via DELETE /assignment and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", FIXTURE_TECH_PROFILE.id);
            const req = createRequest("DELETE", `http://localhost/api/work-orders/${wo.id}/assignment`);
            const res = await unassignWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.assignedTechnicianId).toBeNull();
        });

        it("unassigns technician via alias DELETE /assign and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", FIXTURE_TECH_PROFILE.id);
            const req = createRequest("DELETE", `http://localhost/api/work-orders/${wo.id}/assign`);
            const res = await unassignAliasRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.assignedTechnicianId).toBeNull();
        });

        it("returns 409 Conflict when unassigning an already unassigned WorkOrder", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            const req = createRequest("DELETE", `http://localhost/api/work-orders/${wo.id}/assignment`);
            const res = await unassignWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(409);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("WORK_ORDER_ASSIGNMENT_NOT_ALLOWED");
        });
    });

    describe("6. POST /api/work-orders/[workOrderId]/assignment/reassign (Reassignment Routes)", () => {
        it("reassigns technician via POST /assignment/reassign and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", "tp_old_worker");
            const req = createRequest("POST", `http://localhost/api/work-orders/${wo.id}/assignment/reassign`, {
                technicianId: FIXTURE_TECH_PROFILE.id,
            });
            const res = await reassignWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE.id);
        });

        it("reassigns technician via alias POST /assign/reassign and returns 200 OK", async () => {
            const wo = createFixtureWorkOrder("OPEN", "tp_old_worker");
            const req = createRequest("POST", `http://localhost/api/work-orders/${wo.id}/assign/reassign`, {
                technicianId: FIXTURE_TECH_PROFILE.id,
            });
            const res = await reassignAliasRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE.id);
        });

        it("returns 409 Conflict when reassigning an unassigned WorkOrder", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            const req = createRequest("POST", `http://localhost/api/work-orders/${wo.id}/assignment/reassign`, {
                technicianId: FIXTURE_TECH_PROFILE.id,
            });
            const res = await reassignWorkOrderRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });
            const body = await res.json();

            expect(res.status).toBe(409);
            expect(body.success).toBe(false);
            expect(body.error.code).toBe("WORK_ORDER_ASSIGNMENT_NOT_ALLOWED");
        });
    });
});
