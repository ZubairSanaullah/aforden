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
import {
    extractWorkspaceId,
    handleWorkOrderApiError,
} from "@/lib/utils/workOrderApiError";

import {
    WorkOrderNotFoundError,
    WorkOrderCustomerNotFoundError,
    WorkOrderCustomerInactiveError,
    WorkOrderLocationNotFoundError,
    WorkOrderTechnicianNotFoundError,
    WorkOrderTechnicianNotEligibleError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderMissingHoldReasonError,
    WorkOrderMissingCancellationReasonError,
    WorkOrderAssignmentNotAllowedError,
    WorkOrderCompletionPreconditionFailedError,
    WorkOrderCancellationNotAllowedError,
    WorkOrderImmutableError,
    WorkOrderDeletionNotAllowedError,
    DuplicateWorkOrderReferenceError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    WorkTypeNotFoundError,
    WorkTypeUnavailableForWorkOrderError,
} from "@/lib/services/workType/workTypeErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";

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

describe("Phase 1.6.9 — WorkOrder API Contract Hardening Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let workOrdersList: WorkOrder[];

    const WS_ID = "ws_contract_100";
    const WS_ID_2 = "ws_contract_200";

    const USER_ADMIN: User = {
        id: "user_adm_contract",
        name: "Contract Admin",
        email: "admin@contract.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Contract WS",
        slug: "contract-ws",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_BETA: Workspace = {
        id: WS_ID_2,
        name: "Second WS",
        slug: "second-ws",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_contract_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-100",
        name: "Contract Customer",
        email: "cust@contract.com",
        phone: "+1-555-0001",
        website: null,
        addressLine1: "123 Main St",
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
        id: "loc_contract_1",
        customerId: FIXTURE_CUSTOMER.id,
        name: "HQ Office",
        addressLine1: "123 Main St",
        addressLine2: null,
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
        id: "wt_contract_1",
        workspaceId: WS_ID,
        catalogId: "cat_contract_1",
        name: "Standard Maintenance",
        code: "MAINT-01",
        description: "Standard HVAC maintenance",
        estimatedDuration: 60,
        status: "ACTIVE",
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_EMPLOYEE: Employee = {
        id: "emp_contract_1",
        workspaceId: WS_ID,
        workspaceMemberId: "mem_tech_contract",
        departmentId: null,
        jobTitleId: null,
        employeeNumber: "EMP-100",
        displayName: "Tech One",
        phone: null,
        hireDate: new Date(),
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_TECH_PROFILE: TechnicianProfile = {
        id: "tech_contract_1",
        employeeId: FIXTURE_EMPLOYEE.id,
        licenseNumber: "LIC-001",
        yearsExperience: 5,
        emergencyContact: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_EMPLOYEE_2: Employee = {
        id: "emp_contract_2",
        workspaceId: WS_ID,
        workspaceMemberId: "mem_tech_contract_2",
        departmentId: null,
        jobTitleId: null,
        employeeNumber: "EMP-200",
        displayName: "Tech Two",
        phone: null,
        hireDate: new Date(),
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_TECH_PROFILE_2: TechnicianProfile = {
        id: "tech_contract_2",
        employeeId: FIXTURE_EMPLOYEE_2.id,
        licenseNumber: "LIC-002",
        yearsExperience: 3,
        emergencyContact: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    function createMockRequest(
        url: string,
        options: {
            method?: string;
            headers?: Record<string, string>;
            body?: any;
            rawBody?: string;
        } = {},
    ): Request {
        const headers = new Headers(options.headers || {});
        let body: string | undefined;
        if (options.rawBody !== undefined) {
            body = options.rawBody;
        } else if (options.body !== undefined) {
            body = JSON.stringify(options.body);
            if (!headers.has("content-type")) {
                headers.set("content-type", "application/json");
            }
        }

        return new Request(url, {
            method: options.method || "GET",
            headers,
            body,
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([[USER_ADMIN.id, USER_ADMIN]]);
        workspacesMap = new Map([
            [WS_ID, WS_ALPHA],
            [WS_ID_2, WS_BETA],
        ]);
        membersMap = new Map();

        const memAdmin: WorkspaceMember = {
            id: "mem_adm_contract",
            userId: USER_ADMIN.id,
            workspaceId: WS_ID,
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        membersMap.set(`${USER_ADMIN.id}_${WS_ID}`, memAdmin);

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
            if (where.id === FIXTURE_WORK_TYPE.id && where.workspaceId === WS_ID) {
                return {
                    ...FIXTURE_WORK_TYPE,
                    catalog: { id: "cat_contract_1", status: "ACTIVE" },
                };
            }
            return null;
        });

        mocks.technicianProfileFindFirst.mockImplementation(async ({ where }: any) => {
            if (where.id === FIXTURE_TECH_PROFILE.id) {
                return { ...FIXTURE_TECH_PROFILE, employee: FIXTURE_EMPLOYEE };
            }
            if (where.id === FIXTURE_TECH_PROFILE_2.id) {
                return { ...FIXTURE_TECH_PROFILE_2, employee: FIXTURE_EMPLOYEE_2 };
            }
            return null;
        });

        mocks.workOrderFindFirst.mockImplementation(async ({ where }: any) => {
            const found = workOrdersList.find((wo) => {
                if (where.id && wo.id !== where.id) return false;
                if (where.workspaceId && wo.workspaceId !== where.workspaceId) return false;
                if (where.workOrderNumber && wo.workOrderNumber !== where.workOrderNumber) return false;
                return true;
            });
            if (!found) return null;
            return {
                ...found,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORK_TYPE,
            };
        });

        mocks.workOrderCreate.mockImplementation(async ({ data }: any) => {
            const newRecord: WorkOrder = {
                id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
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
                priority: data.priority ?? "MEDIUM",
                status: data.status ?? "OPEN",
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
            workOrdersList.push(newRecord);
            return {
                ...newRecord,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORK_TYPE,
            };
        });

        mocks.workOrderUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = workOrdersList.findIndex((wo) => wo.id === where.id);
            if (index === -1) throw new Error("Record not found for update");
            const existing = workOrdersList[index];
            const updated: WorkOrder = {
                ...existing,
                ...data,
                updatedAt: new Date(),
            };
            workOrdersList[index] = updated;
            return {
                ...updated,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORK_TYPE,
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
                    customer: { findFirst: mocks.customerFindFirst },
                    serviceLocation: { findFirst: mocks.serviceLocationFindFirst },
                    workType: { findFirst: mocks.workTypeFindFirst },
                    technicianProfile: { findFirst: mocks.technicianProfileFindFirst },
                });
            }
            return callback;
        });
    });

    describe("1. Workspace Context Contract", () => {
        it("resolves workspace from x-workspace-id header", () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders", {
                headers: { "x-workspace-id": "ws_x_header" },
            });
            expect(extractWorkspaceId(req)).toBe("ws_x_header");
        });

        it("resolves workspace from workspace-id header when x-workspace-id is absent", () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders", {
                headers: { "workspace-id": "ws_standard_header" },
            });
            expect(extractWorkspaceId(req)).toBe("ws_standard_header");
        });

        it("resolves workspace from query param ?workspaceId= when headers are absent", () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders?workspaceId=ws_query_param");
            expect(extractWorkspaceId(req)).toBe("ws_query_param");
        });

        it("preserves strict deterministic precedence (x-workspace-id > workspace-id > query param)", () => {
            const reqAll = createMockRequest("http://localhost:3000/api/work-orders?workspaceId=ws_3", {
                headers: {
                    "x-workspace-id": "ws_1",
                    "workspace-id": "ws_2",
                },
            });
            expect(extractWorkspaceId(reqAll)).toBe("ws_1");

            const reqTwo = createMockRequest("http://localhost:3000/api/work-orders?workspaceId=ws_3", {
                headers: {
                    "workspace-id": "ws_2",
                },
            });
            expect(extractWorkspaceId(reqTwo)).toBe("ws_2");
        });

        it("handles whitespace-only values safely and falls through to next candidate", () => {
            const reqWhitespace = createMockRequest("http://localhost:3000/api/work-orders?workspaceId=ws_valid_query", {
                headers: {
                    "x-workspace-id": "   ",
                    "workspace-id": "",
                },
            });
            expect(extractWorkspaceId(reqWhitespace)).toBe("ws_valid_query");
        });

        it("returns null if all sources are missing or only whitespace", () => {
            const reqEmpty = createMockRequest("http://localhost:3000/api/work-orders", {
                headers: {
                    "x-workspace-id": "   ",
                    "workspace-id": " ",
                },
            });
            expect(extractWorkspaceId(reqEmpty)).toBeNull();
        });

        it("returns 400 MISSING_WORKSPACE on all routes when workspace context is missing", async () => {
            const context = { params: Promise.resolve({ workOrderId: "wo_123" }) };

            // 1. POST create
            const reqCreate = createMockRequest("http://localhost:3000/api/work-orders", {
                method: "POST",
                body: { title: "Test" },
            });
            const resCreate = await createWorkOrderRoute(reqCreate);
            expect(resCreate.status).toBe(400);
            const jsonCreate = await resCreate.json();
            expect(jsonCreate).toEqual({
                success: false,
                error: { code: "MISSING_WORKSPACE", message: "Workspace ID is required." },
            });

            // 2. PATCH update
            const reqUpdate = createMockRequest("http://localhost:3000/api/work-orders/wo_123", {
                method: "PATCH",
                body: { title: "Updated" },
            });
            const resUpdate = await updateWorkOrderRoute(reqUpdate, context);
            expect(resUpdate.status).toBe(400);
            expect(await resUpdate.json()).toEqual({
                success: false,
                error: { code: "MISSING_WORKSPACE", message: "Workspace ID is required." },
            });

            // 3. POST / PATCH status
            const reqStatus = createMockRequest("http://localhost:3000/api/work-orders/wo_123/status", {
                method: "POST",
                body: { toStatus: "IN_PROGRESS" },
            });
            const resStatus = await transitionStatusPostRoute(reqStatus, context);
            expect(resStatus.status).toBe(400);
            expect(await resStatus.json()).toEqual({
                success: false,
                error: { code: "MISSING_WORKSPACE", message: "Workspace ID is required." },
            });

            // 4. POST assign
            const reqAssign = createMockRequest("http://localhost:3000/api/work-orders/wo_123/assignment", {
                method: "POST",
                body: { technicianId: "tech_1" },
            });
            const resAssign = await assignWorkOrderRoute(reqAssign, context);
            expect(resAssign.status).toBe(400);
            expect(await resAssign.json()).toEqual({
                success: false,
                error: { code: "MISSING_WORKSPACE", message: "Workspace ID is required." },
            });

            // 5. DELETE unassign
            const reqUnassign = createMockRequest("http://localhost:3000/api/work-orders/wo_123/assignment", {
                method: "DELETE",
            });
            const resUnassign = await unassignWorkOrderRoute(reqUnassign, context);
            expect(resUnassign.status).toBe(400);
            expect(await resUnassign.json()).toEqual({
                success: false,
                error: { code: "MISSING_WORKSPACE", message: "Workspace ID is required." },
            });

            // 6. POST reassign
            const reqReassign = createMockRequest("http://localhost:3000/api/work-orders/wo_123/assignment/reassign", {
                method: "POST",
                body: { technicianId: "tech_2" },
            });
            const resReassign = await reassignWorkOrderRoute(reqReassign, context);
            expect(resReassign.status).toBe(400);
            expect(await resReassign.json()).toEqual({
                success: false,
                error: { code: "MISSING_WORKSPACE", message: "Workspace ID is required." },
            });
        });
    });

    describe("2. Request Body & JSON Contract", () => {
        const context = { params: Promise.resolve({ workOrderId: "wo_123" }) };

        it("returns 400 INVALID_REQUEST for malformed JSON syntax on POST create", async () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders", {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                rawBody: "{ bad json",
            });
            const res = await createWorkOrderRoute(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json).toEqual({
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid JSON in request body.",
                },
            });
        });

        it("returns 400 INVALID_REQUEST for malformed JSON syntax on PATCH update", async () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders/wo_123", {
                method: "PATCH",
                headers: { "x-workspace-id": WS_ID },
                rawBody: "not json",
            });
            const res = await updateWorkOrderRoute(req, context);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid JSON in request body.",
                },
            });
        });

        it("returns 400 INVALID_REQUEST for malformed JSON syntax on status transition", async () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders/wo_123/status", {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                rawBody: "{ invalid json: 123",
            });
            const res = await transitionStatusPostRoute(req, context);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid JSON in request body.",
                },
            });
        });

        it("returns 400 INVALID_REQUEST for malformed JSON syntax on assignment", async () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders/wo_123/assignment", {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                rawBody: "{ corrupt",
            });
            const res = await assignWorkOrderRoute(req, context);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid JSON in request body.",
                },
            });
        });

        it("returns 422 VALIDATION_ERROR with stable field errors for schema validation failure", async () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders", {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                body: {
                    // missing customerId, locationId, workTypeId, title
                },
            });
            const res = await createWorkOrderRoute(req);
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.message).toBe("Invalid request data.");
            expect(json.error.fields).toBeDefined();
            expect(json.error.fields.customerId).toBeDefined();
            expect(json.error.fields.title).toBeDefined();
        });

        it("returns 422 VALIDATION_ERROR when unknown fields fail strict validation", async () => {
            // Seed fixture in state
            workOrdersList.push({
                id: "wo_123",
                workspaceId: WS_ID,
                workOrderNumber: "WO-0001",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORK_TYPE.id,
                assignedTechnicianId: null,
                assetId: null,
                sourceQuoteId: null,
                workTypeName: FIXTURE_WORK_TYPE.name,
                workTypeCode: FIXTURE_WORK_TYPE.code,
                estimatedDuration: 60,
                priority: "MEDIUM",
                status: "OPEN",
                title: "Test WO",
                description: null,
                internalNotes: null,
                holdReason: null,
                cancellationReason: null,
                startedAt: null,
                completedAt: null,
                cancelledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createMockRequest("http://localhost:3000/api/work-orders/wo_123", {
                method: "PATCH",
                headers: { "x-workspace-id": WS_ID },
                body: {
                    unknownField: "malicious_injection",
                },
            });

            const res = await updateWorkOrderRoute(req, context);
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("3. HTTP Method & Success Response Contracts", () => {
        function seedWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
            const wo: WorkOrder = {
                id: "wo_contract_fixture",
                workspaceId: WS_ID,
                workOrderNumber: "WO-CONTRACT-001",
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
                title: "Contract Fixture WorkOrder",
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

        it("POST /api/work-orders returns 201 with standard success envelope and canonical read model", async () => {
            const req = createMockRequest("http://localhost:3000/api/work-orders", {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                body: {
                    customerId: FIXTURE_CUSTOMER.id,
                    locationId: FIXTURE_LOCATION.id,
                    workTypeId: FIXTURE_WORK_TYPE.id,
                    title: "Brand New WorkOrder",
                    priority: "HIGH",
                },
            });
            const res = await createWorkOrderRoute(req);
            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();
            expect(json.data.title).toBe("Brand New WorkOrder");
            expect(json.data.status).toBe("OPEN");
            expect(json.data.priority).toBe("HIGH");
            expect(json.data.customerName).toBe(FIXTURE_CUSTOMER.name);
            expect(json.data.locationName).toBe(FIXTURE_LOCATION.name);
            expect(json.data.workTypeName).toBe(FIXTURE_WORK_TYPE.name);
        });

        it("PATCH /api/work-orders/[workOrderId] returns 200 with updated WorkOrderReadModel", async () => {
            const wo = seedWorkOrder();
            const context = { params: Promise.resolve({ workOrderId: wo.id }) };
            const req = createMockRequest(`http://localhost:3000/api/work-orders/${wo.id}`, {
                method: "PATCH",
                headers: { "x-workspace-id": WS_ID },
                body: {
                    title: "Updated Title Operational",
                    priority: "URGENT",
                },
            });
            const res = await updateWorkOrderRoute(req, context);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.title).toBe("Updated Title Operational");
            expect(json.data.priority).toBe("URGENT");
        });

        it("POST /api/work-orders/[workOrderId]/assignment returns 200 with assigned technician ID", async () => {
            const wo = seedWorkOrder();
            const context = { params: Promise.resolve({ workOrderId: wo.id }) };
            const req = createMockRequest(`http://localhost:3000/api/work-orders/${wo.id}/assignment`, {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                body: {
                    technicianId: FIXTURE_TECH_PROFILE.id,
                },
            });
            const res = await assignWorkOrderRoute(req, context);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE.id);
        });

        it("POST /api/work-orders/[workOrderId]/assignment/reassign returns 200 with new technician", async () => {
            const wo = seedWorkOrder({ assignedTechnicianId: FIXTURE_TECH_PROFILE.id, status: "ASSIGNED" });
            const context = { params: Promise.resolve({ workOrderId: wo.id }) };
            const req = createMockRequest(`http://localhost:3000/api/work-orders/${wo.id}/assignment/reassign`, {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                body: {
                    technicianId: FIXTURE_TECH_PROFILE_2.id,
                },
            });
            const res = await reassignWorkOrderRoute(req, context);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE_2.id);
        });

        it("DELETE /api/work-orders/[workOrderId]/assignment returns 200 with unassigned status", async () => {
            const wo = seedWorkOrder({ assignedTechnicianId: FIXTURE_TECH_PROFILE.id, status: "ASSIGNED" });
            const context = { params: Promise.resolve({ workOrderId: wo.id }) };
            const req = createMockRequest(`http://localhost:3000/api/work-orders/${wo.id}/assignment`, {
                method: "DELETE",
                headers: { "x-workspace-id": WS_ID },
            });
            const res = await unassignWorkOrderRoute(req, context);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.assignedTechnicianId).toBeNull();
        });

        it("POST & PATCH /api/work-orders/[workOrderId]/status return 200 for lifecycle transitions", async () => {
            const wo = seedWorkOrder({ assignedTechnicianId: FIXTURE_TECH_PROFILE.id, status: "ASSIGNED" });
            const context = { params: Promise.resolve({ workOrderId: wo.id }) };

            // Transition ASSIGNED -> IN_PROGRESS via POST
            const reqPost = createMockRequest(`http://localhost:3000/api/work-orders/${wo.id}/status`, {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                body: { toStatus: "IN_PROGRESS" },
            });
            const resPost = await transitionStatusPostRoute(reqPost, context);
            expect(resPost.status).toBe(200);
            expect((await resPost.json()).data.status).toBe("IN_PROGRESS");

            // Transition IN_PROGRESS -> ON_HOLD via PATCH
            const reqPatch = createMockRequest(`http://localhost:3000/api/work-orders/${wo.id}/status`, {
                method: "PATCH",
                headers: { "x-workspace-id": WS_ID },
                body: { toStatus: "ON_HOLD", holdReason: "Waiting for parts delivery" },
            });
            const resPatch = await transitionStatusPatchRoute(reqPatch, context);
            expect(resPatch.status).toBe(200);
            expect((await resPatch.json()).data.status).toBe("ON_HOLD");
        });
    });

    describe("4. Compatibility Aliases Contract", () => {
        it("/assign POST and DELETE alias handlers behave identically to /assignment", async () => {
            const wo: WorkOrder = {
                id: "wo_alias_test",
                workspaceId: WS_ID,
                workOrderNumber: "WO-ALIAS-01",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORK_TYPE.id,
                assignedTechnicianId: null,
                assetId: null,
                sourceQuoteId: null,
                workTypeName: FIXTURE_WORK_TYPE.name,
                workTypeCode: FIXTURE_WORK_TYPE.code,
                estimatedDuration: 60,
                priority: "MEDIUM",
                status: "OPEN",
                title: "Alias Test",
                description: null,
                internalNotes: null,
                holdReason: null,
                cancellationReason: null,
                startedAt: null,
                completedAt: null,
                cancelledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workOrdersList.push(wo);

            const context = { params: Promise.resolve({ workOrderId: "wo_alias_test" }) };

            // POST /assign
            const reqAssign = createMockRequest("http://localhost:3000/api/work-orders/wo_alias_test/assign", {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                body: { technicianId: FIXTURE_TECH_PROFILE.id },
            });
            const resAssign = await assignAliasRoute(reqAssign, context);
            expect(resAssign.status).toBe(200);
            const jsonAssign = await resAssign.json();
            expect(jsonAssign.success).toBe(true);
            expect(jsonAssign.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE.id);

            // DELETE /assign
            const reqUnassign = createMockRequest("http://localhost:3000/api/work-orders/wo_alias_test/assign", {
                method: "DELETE",
                headers: { "x-workspace-id": WS_ID },
            });
            const resUnassign = await unassignAliasRoute(reqUnassign, context);
            expect(resUnassign.status).toBe(200);
            const jsonUnassign = await resUnassign.json();
            expect(jsonUnassign.success).toBe(true);
            expect(jsonUnassign.data.assignedTechnicianId).toBeNull();
        });

        it("/assign/reassign POST alias handler behaves identically to /assignment/reassign", async () => {
            const wo: WorkOrder = {
                id: "wo_alias_reassign",
                workspaceId: WS_ID,
                workOrderNumber: "WO-ALIAS-02",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORK_TYPE.id,
                assignedTechnicianId: FIXTURE_TECH_PROFILE.id,
                assetId: null,
                sourceQuoteId: null,
                workTypeName: FIXTURE_WORK_TYPE.name,
                workTypeCode: FIXTURE_WORK_TYPE.code,
                estimatedDuration: 60,
                priority: "MEDIUM",
                status: "ASSIGNED",
                title: "Alias Reassign Test",
                description: null,
                internalNotes: null,
                holdReason: null,
                cancellationReason: null,
                startedAt: null,
                completedAt: null,
                cancelledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workOrdersList.push(wo);

            const context = { params: Promise.resolve({ workOrderId: "wo_alias_reassign" }) };

            const req = createMockRequest("http://localhost:3000/api/work-orders/wo_alias_reassign/assign/reassign", {
                method: "POST",
                headers: { "x-workspace-id": WS_ID },
                body: { technicianId: FIXTURE_TECH_PROFILE_2.id },
            });
            const res = await reassignAliasRoute(req, context);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.assignedTechnicianId).toBe(FIXTURE_TECH_PROFILE_2.id);
        });
    });

    describe("5. Tenant Isolation & Route Boundary Security", () => {
        it("returns 404 for resource belonging to another workspace (no existence leakage)", async () => {
            const woCrossTenant: WorkOrder = {
                id: "wo_other_tenant",
                workspaceId: WS_ID_2,
                workOrderNumber: "WO-TENANT-2",
                customerId: FIXTURE_CUSTOMER.id,
                locationId: FIXTURE_LOCATION.id,
                workTypeId: FIXTURE_WORK_TYPE.id,
                assignedTechnicianId: null,
                assetId: null,
                sourceQuoteId: null,
                workTypeName: FIXTURE_WORK_TYPE.name,
                workTypeCode: FIXTURE_WORK_TYPE.code,
                estimatedDuration: 60,
                priority: "MEDIUM",
                status: "OPEN",
                title: "Other Tenant Secret WO",
                description: null,
                internalNotes: null,
                holdReason: null,
                cancellationReason: null,
                startedAt: null,
                completedAt: null,
                cancelledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workOrdersList.push(woCrossTenant);

            const context = { params: Promise.resolve({ workOrderId: "wo_other_tenant" }) };

            // Try to patch it using WS_ID (where user is member)
            const req = createMockRequest("http://localhost:3000/api/work-orders/wo_other_tenant", {
                method: "PATCH",
                headers: { "x-workspace-id": WS_ID },
                body: { title: "Attempting cross-tenant takeover" },
            });
            const res = await updateWorkOrderRoute(req, context);
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json).toEqual({
                success: false,
                error: {
                    code: "WORK_ORDER_NOT_FOUND",
                    message: "Work order not found.",
                },
            });
        });
    });

    describe("6. Complete Error Taxonomy Mapping & Sanitization", () => {
        it("maps UnauthorizedError to 401 UNAUTHORIZED", () => {
            const res = handleWorkOrderApiError(new UnauthorizedError("Custom auth message"));
            expect(res.status).toBe(401);
            expect(res.headers.get("content-type")).toContain("application/json");
        });

        it("maps ForbiddenError to 403 FORBIDDEN", () => {
            const res = handleWorkOrderApiError(new ForbiddenError());
            expect(res.status).toBe(403);
        });

        it("maps WorkspaceAccessDeniedError to 403 FORBIDDEN", () => {
            const res = handleWorkOrderApiError(new WorkspaceAccessDeniedError());
            expect(res.status).toBe(403);
        });

        it("maps 404 domain errors correctly", () => {
            const errs = [
                { err: new WorkOrderNotFoundError(), code: "WORK_ORDER_NOT_FOUND" },
                { err: new WorkOrderCustomerNotFoundError(), code: "WORK_ORDER_CUSTOMER_NOT_FOUND" },
                { err: new WorkOrderLocationNotFoundError(), code: "WORK_ORDER_LOCATION_NOT_FOUND" },
                { err: new WorkTypeNotFoundError(), code: "WORK_TYPE_NOT_FOUND" },
                { err: new WorkOrderTechnicianNotFoundError(), code: "WORK_ORDER_TECHNICIAN_NOT_FOUND" },
            ];

            for (const { err, code } of errs) {
                const res = handleWorkOrderApiError(err);
                expect(res.status).toBe(404);
            }
        });

        it("maps 400 bad request domain errors correctly", () => {
            const errs = [
                { err: new WorkOrderCustomerInactiveError(), code: "WORK_ORDER_CUSTOMER_INACTIVE" },
                { err: new WorkOrderMissingHoldReasonError(), code: "WORK_ORDER_MISSING_HOLD_REASON" },
                { err: new WorkOrderMissingCancellationReasonError(), code: "WORK_ORDER_MISSING_CANCELLATION_REASON" },
            ];

            for (const { err, code } of errs) {
                const res = handleWorkOrderApiError(err);
                expect(res.status).toBe(400);
            }
        });

        it("maps 422 precondition / eligibility domain errors correctly", () => {
            const errs = [
                { err: new WorkOrderTechnicianNotEligibleError(), code: "WORK_ORDER_TECHNICIAN_NOT_ELIGIBLE" },
                { err: new WorkOrderCompletionPreconditionFailedError(), code: "WORK_ORDER_COMPLETION_PRECONDITION_FAILED" },
            ];

            for (const { err, code } of errs) {
                const res = handleWorkOrderApiError(err);
                expect(res.status).toBe(422);
            }
        });

        it("maps 409 conflict / lifecycle domain errors correctly", () => {
            const errs = [
                { err: new WorkOrderInvalidStatusTransitionError(), code: "WORK_ORDER_INVALID_STATUS_TRANSITION" },
                { err: new WorkOrderAssignmentNotAllowedError(), code: "WORK_ORDER_ASSIGNMENT_NOT_ALLOWED" },
                { err: new WorkOrderCancellationNotAllowedError(), code: "WORK_ORDER_CANCELLATION_NOT_ALLOWED" },
                { err: new WorkOrderImmutableError(), code: "WORK_ORDER_IMMUTABLE" },
                { err: new WorkOrderDeletionNotAllowedError(), code: "WORK_ORDER_DELETION_NOT_ALLOWED" },
                { err: new DuplicateWorkOrderReferenceError(), code: "DUPLICATE_WORK_ORDER_REFERENCE" },
                { err: new WorkTypeUnavailableForWorkOrderError(), code: "WORK_TYPE_UNAVAILABLE_FOR_WORK_ORDER" },
            ];

            for (const { err, code } of errs) {
                const res = handleWorkOrderApiError(err);
                expect(res.status).toBe(409);
            }
        });

        it("sanitizes unexpected errors to 500 INTERNAL_SERVER_ERROR without leaking internal error details or stack traces", async () => {
            const sensitiveDbError = new Error("FATAL: relation \"work_orders\" does not exist at postgres://admin:secret@db:5432/aforden");
            const res = handleWorkOrderApiError(sensitiveDbError, "Sensitive query context");
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json).toEqual({
                success: false,
                error: {
                    code: "INTERNAL_SERVER_ERROR",
                    message: "An unexpected error occurred.",
                },
            });
            // Ensure sensitive text is not serialized
            expect(JSON.stringify(json)).not.toContain("FATAL");
            expect(JSON.stringify(json)).not.toContain("secret");
            expect(JSON.stringify(json)).not.toContain("postgres");
        });
    });
});
