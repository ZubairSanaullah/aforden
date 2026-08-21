import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    resolveTechnicianContext: vi.fn(),
    listTechnicianWorkOrders: vi.fn(),
    getTechnicianWorkOrderDetail: vi.fn(),
    acknowledgeTechnicianDispatch: vi.fn(),
    startTechnicianTravel: vi.fn(),
    startTechnicianWorkOrder: vi.fn(),
    holdTechnicianWorkOrder: vi.fn(),
    resumeTechnicianWorkOrder: vi.fn(),
    completeTechnicianWorkOrder: vi.fn(),
    listTechnicianTimeEntries: vi.fn(),
    recordTechnicianTimeEntry: vi.fn(),
    updateTechnicianTimeEntry: vi.fn(),
    completeWorkOrderAdmin: vi.fn(),
    listTechnicianTimeEntriesAdmin: vi.fn(),
    updateTechnicianTimeEntryAdmin: vi.fn(),
}));

vi.mock("@/lib/services/technicianOperations", () => ({
    resolveTechnicianContext: mocks.resolveTechnicianContext,
    listTechnicianWorkOrders: mocks.listTechnicianWorkOrders,
    getTechnicianWorkOrderDetail: mocks.getTechnicianWorkOrderDetail,
    acknowledgeTechnicianDispatch: mocks.acknowledgeTechnicianDispatch,
    startTechnicianTravel: mocks.startTechnicianTravel,
    startTechnicianWorkOrder: mocks.startTechnicianWorkOrder,
    holdTechnicianWorkOrder: mocks.holdTechnicianWorkOrder,
    resumeTechnicianWorkOrder: mocks.resumeTechnicianWorkOrder,
    completeTechnicianWorkOrder: mocks.completeTechnicianWorkOrder,
    listTechnicianTimeEntries: mocks.listTechnicianTimeEntries,
    recordTechnicianTimeEntry: mocks.recordTechnicianTimeEntry,
    updateTechnicianTimeEntry: mocks.updateTechnicianTimeEntry,
    completeWorkOrderAdmin: mocks.completeWorkOrderAdmin,
    listTechnicianTimeEntriesAdmin: mocks.listTechnicianTimeEntriesAdmin,
    updateTechnicianTimeEntryAdmin: mocks.updateTechnicianTimeEntryAdmin,
}));

import { GET as listWorkOrdersRoute } from "@/app/api/technician/work-orders/route";
import { GET as getWorkOrderDetailRoute } from "@/app/api/technician/work-orders/[workOrderId]/route";
import { POST as acknowledgeRoute } from "@/app/api/technician/work-orders/[workOrderId]/acknowledge/route";
import { POST as travelRoute } from "@/app/api/technician/work-orders/[workOrderId]/travel/route";
import { POST as startRoute } from "@/app/api/technician/work-orders/[workOrderId]/start/route";
import { POST as holdRoute } from "@/app/api/technician/work-orders/[workOrderId]/hold/route";
import { POST as resumeRoute } from "@/app/api/technician/work-orders/[workOrderId]/resume/route";
import { POST as completeRoute } from "@/app/api/technician/work-orders/[workOrderId]/complete/route";
import {
    GET as listTimeEntriesRoute,
    POST as recordTimeEntryRoute,
} from "@/app/api/technician/work-orders/[workOrderId]/time/route";
import { PATCH as updateTimeEntryRoute } from "@/app/api/technician/work-orders/[workOrderId]/time/[id]/route";

import { POST as adminCompleteRoute } from "@/app/api/work-orders/[workOrderId]/complete/route";
import { GET as adminListTimeEntriesRoute } from "@/app/api/work-orders/[workOrderId]/time/route";
import { PATCH as adminUpdateTimeEntryRoute } from "@/app/api/work-orders/[workOrderId]/time/[id]/route";

import {
    TechnicianProfileNotFoundError,
    TechnicianNotAssignedToWorkOrderError,
    ActiveTimeEntryExistsError,
    TimeEntryNotFoundError,
    TimeEntryImmutableError,
} from "@/lib/services/technicianOperations/technicianOperationsErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderCompletionPreconditionFailedError,
} from "@/lib/services/workOrder/workOrderErrors";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { TechnicianExecutionContext, TechnicianTimeEntryReadModel } from "@/lib/services/technicianOperations/technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

describe("Phase 1.9.11 — REST API / Thin Adapters", () => {
    const WS_ID = "ws_tenant_101";
    const WO_ID = "wo_100";
    const TIME_ENTRY_ID = "tte_001";
    const TECH_PROFILE_ID = "tp_alex_01";

    const techContext: TechnicianExecutionContext = {
        userId: "usr_alex",
        workspaceId: WS_ID,
        membershipId: "mem_alex",
        role: "TECHNICIAN",
        employeeId: "emp_alex",
        technicianProfileId: TECH_PROFILE_ID,
        technicianName: "Alex Rivers",
    };

    const sampleWorkOrderReadModel: WorkOrderReadModel = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-000100",
        customerId: "cust_1",
        customerName: "Acme Corp",
        customerNumber: "CUST-001",
        locationId: "loc_1",
        locationName: "HQ",
        locationAddress: "123 Main St, Austin, TX",
        workTypeId: "wt_1",
        workTypeName: "HVAC Repair",
        workTypeCode: "HVAC",
        estimatedDuration: 120,
        assignedTechnicianId: TECH_PROFILE_ID,
        assetId: null,
        status: "IN_PROGRESS",
        priority: "HIGH",
        title: "Fix AC unit",
        description: "Banging noise",
        internalNotes: "VIP customer",
        holdReason: null,
        cancellationReason: null,
        startedAt: new Date("2026-08-21T10:00:00Z"),
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date("2026-08-21T09:00:00Z"),
        updatedAt: new Date("2026-08-21T10:00:00Z"),
    };

    const sampleTimeEntryReadModel: TechnicianTimeEntryReadModel = {
        id: TIME_ENTRY_ID,
        workspaceId: WS_ID,
        technicianProfileId: TECH_PROFILE_ID,
        workOrderId: WO_ID,
        appointmentId: "appt_1",
        entryType: "ON_SITE",
        status: "ACTIVE",
        startedAt: new Date("2026-08-21T10:00:00Z"),
        endedAt: null,
        durationMinutes: null,
        notes: "Diagnosing unit",
        metadata: null,
        createdByMemberId: "mem_alex",
        createdAt: new Date("2026-08-21T10:00:00Z"),
        updatedAt: new Date("2026-08-21T10:00:00Z"),
    };

    function createRequest(
        url: string,
        method = "GET",
        headers: Record<string, string> = { "x-workspace-id": WS_ID },
        body?: unknown
    ): Request {
        return new Request(url, {
            method,
            headers: {
                "content-type": "application/json",
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveTechnicianContext.mockResolvedValue(techContext);
    });

    describe("1. Technician Work Queue & Detail Routes", () => {
        it("GET /api/technician/work-orders -> returns 200 with paginated queue", async () => {
            mocks.listTechnicianWorkOrders.mockResolvedValue({
                items: [sampleWorkOrderReadModel],
                pagination: {
                    page: 1,
                    pageSize: 20,
                    total: 1,
                    totalPages: 1,
                },
            });

            const req = createRequest("https://api.aforden.com/api/technician/work-orders?page=1&pageSize=20");
            const res = await listWorkOrdersRoute(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toHaveLength(1);
            expect(json.data[0].id).toBe(WO_ID);
            expect(json.pagination.total).toBe(1);
        });

        it("GET /api/technician/work-orders -> returns 400 when workspace header is missing", async () => {
            const req = createRequest("https://api.aforden.com/api/technician/work-orders", "GET", {});
            const res = await listWorkOrdersRoute(req);

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("GET /api/technician/work-orders -> returns 401 on unauthenticated session", async () => {
            mocks.resolveTechnicianContext.mockRejectedValue(new UnauthorizedError());

            const req = createRequest("https://api.aforden.com/api/technician/work-orders");
            const res = await listWorkOrdersRoute(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/technician/work-orders -> returns 404 when user lacks active technician profile", async () => {
            mocks.resolveTechnicianContext.mockRejectedValue(new TechnicianProfileNotFoundError());

            const req = createRequest("https://api.aforden.com/api/technician/work-orders");
            const res = await listWorkOrdersRoute(req);

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("TECHNICIAN_PROFILE_NOT_FOUND");
        });

        it("GET /api/technician/work-orders/[workOrderId] -> returns 200 with operational detail", async () => {
            mocks.getTechnicianWorkOrderDetail.mockResolvedValue(sampleWorkOrderReadModel);

            const req = createRequest(`https://api.aforden.com/api/technician/work-orders/${WO_ID}`);
            const res = await getWorkOrderDetailRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(WO_ID);
        });

        it("GET /api/technician/work-orders/[workOrderId] -> returns 403 when technician is not assigned", async () => {
            mocks.getTechnicianWorkOrderDetail.mockRejectedValue(new TechnicianNotAssignedToWorkOrderError());

            const req = createRequest(`https://api.aforden.com/api/technician/work-orders/${WO_ID}`);
            const res = await getWorkOrderDetailRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("TECHNICIAN_NOT_ASSIGNED_TO_WORK_ORDER");
        });
    });

    describe("2. Operational Lifecycle Transition Routes", () => {
        it("POST /api/technician/work-orders/[workOrderId]/acknowledge -> returns 200 with acknowledged appointment", async () => {
            mocks.acknowledgeTechnicianDispatch.mockResolvedValue({ id: "appt_1", dispatchStatus: "ACKNOWLEDGED" });

            const req = createRequest(`https://api.aforden.com/api/technician/work-orders/${WO_ID}/acknowledge`, "POST");
            const res = await acknowledgeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.dispatchStatus).toBe("ACKNOWLEDGED");
        });

        it("POST /api/technician/work-orders/[workOrderId]/travel -> returns 201 with travel time entry", async () => {
            mocks.startTechnicianTravel.mockResolvedValue({
                ...sampleTimeEntryReadModel,
                entryType: "TRAVEL",
            });

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/travel`,
                "POST",
                { "x-workspace-id": WS_ID },
                { notes: "Driving via I-35" }
            );
            const res = await travelRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.entryType).toBe("TRAVEL");
        });

        it("POST /api/technician/work-orders/[workOrderId]/travel -> returns 409 when active time entry exists", async () => {
            mocks.startTechnicianTravel.mockRejectedValue(new ActiveTimeEntryExistsError());

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/travel`,
                "POST"
            );
            const res = await travelRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("ACTIVE_TIME_ENTRY_EXISTS");
        });

        it("POST /api/technician/work-orders/[workOrderId]/start -> returns 200 with IN_PROGRESS work order", async () => {
            mocks.startTechnicianWorkOrder.mockResolvedValue({
                ...sampleWorkOrderReadModel,
                status: "IN_PROGRESS",
            });

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/start`,
                "POST"
            );
            const res = await startRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.status).toBe("IN_PROGRESS");
        });

        it("POST /api/technician/work-orders/[workOrderId]/hold -> returns 200 with ON_HOLD work order", async () => {
            mocks.holdTechnicianWorkOrder.mockResolvedValue({
                ...sampleWorkOrderReadModel,
                status: "ON_HOLD",
                holdReason: "Waiting for replacement valve",
            });

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/hold`,
                "POST",
                { "x-workspace-id": WS_ID },
                { holdReason: "Waiting for replacement valve" }
            );
            const res = await holdRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.status).toBe("ON_HOLD");
            expect(json.data.holdReason).toBe("Waiting for replacement valve");
        });

        it("POST /api/technician/work-orders/[workOrderId]/hold -> returns 422 when holdReason is missing", async () => {
            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/hold`,
                "POST",
                { "x-workspace-id": WS_ID },
                {} // Missing holdReason
            );
            const res = await holdRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });

        it("POST /api/technician/work-orders/[workOrderId]/resume -> returns 200 with IN_PROGRESS work order", async () => {
            mocks.resumeTechnicianWorkOrder.mockResolvedValue({
                ...sampleWorkOrderReadModel,
                status: "IN_PROGRESS",
                holdReason: null,
            });

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/resume`,
                "POST"
            );
            const res = await resumeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.status).toBe("IN_PROGRESS");
        });
    });

    describe("3. Completion Route & Comprehensive 6-Status Coverage (§14 Step 7 & Section 10)", () => {
        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 200 on happy path and sanitizes _historyRecordId from JSON response", async () => {
            mocks.completeTechnicianWorkOrder.mockResolvedValue({
                ...sampleWorkOrderReadModel,
                status: "COMPLETED",
                completedAt: new Date("2026-08-21T11:00:00Z"),
                _historyRecordId: "hist_should_not_leak_123", // Simulated internal plumbing property
            } as any);

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST",
                { "x-workspace-id": WS_ID },
                {
                    resolutionNotes: "Fixed motor bearing",
                    mediaUris: ["https://storage.aforden.com/photo.jpg"],
                }
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.status).toBe("COMPLETED");

            // Explicit DTO hygiene assertion: internal audit plumbing property must NEVER leak into JSON response
            expect(json.data._historyRecordId).toBeUndefined();
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 401 on unauthenticated session", async () => {
            mocks.resolveTechnicianContext.mockRejectedValue(new UnauthorizedError());

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 403 when technician is not assigned to work order", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new TechnicianNotAssignedToWorkOrderError()
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("TECHNICIAN_NOT_ASSIGNED_TO_WORK_ORDER");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 404 when work order is not found", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new WorkOrderNotFoundError()
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_NOT_FOUND");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 409 on invalid status transition conflict", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new WorkOrderInvalidStatusTransitionError("Invalid transition from DRAFT to COMPLETED")
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_INVALID_STATUS_TRANSITION");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 422 on completion precondition failure", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new WorkOrderCompletionPreconditionFailedError("Cannot complete: work order not IN_PROGRESS")
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_COMPLETION_PRECONDITION_FAILED");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 422 on malformed media URI", async () => {
            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST",
                { "x-workspace-id": WS_ID },
                {
                    mediaUris: ["malformed-uri-string"],
                }
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("4. Technician Time Tracking Routes & Identity Override Protection (Invariant 2, §2.2)", () => {
        it("GET /api/technician/work-orders/[workOrderId]/time -> returns 200 with time entries", async () => {
            mocks.listTechnicianTimeEntries.mockResolvedValue([sampleTimeEntryReadModel]);

            const req = createRequest(`https://api.aforden.com/api/technician/work-orders/${WO_ID}/time`);
            const res = await listTimeEntriesRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toHaveLength(1);
        });

        it("POST /api/technician/work-orders/[workOrderId]/time -> returns 201 for valid BREAK/ADMIN time entry", async () => {
            mocks.recordTechnicianTimeEntry.mockResolvedValue({
                ...sampleTimeEntryReadModel,
                entryType: "BREAK",
            });

            const validPayload = {
                entryType: "BREAK",
                notes: "Lunch break",
            };

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/time`,
                "POST",
                { "x-workspace-id": WS_ID },
                validPayload
            );
            const res = await recordTimeEntryRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);

            // Verify service was called with the server-derived techContext ONLY
            expect(mocks.recordTechnicianTimeEntry).toHaveBeenCalledWith(
                techContext,
                WO_ID,
                validPayload
            );
        });

        it("POST /api/technician/work-orders/[workOrderId]/time -> returns 422 when client supplies fraudulent technicianId or workspaceId in body (.strict() schema rejection)", async () => {
            // Client attempts to pass fraudulent identity override keys in body
            const payloadWithFraudulentKeys = {
                entryType: "BREAK",
                notes: "Lunch break",
                technicianId: "fraudulent_tech_999",
                technicianProfileId: "fraudulent_tp_999",
                workspaceId: "fraudulent_ws_999",
            };

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/time`,
                "POST",
                { "x-workspace-id": WS_ID },
                payloadWithFraudulentKeys
            );
            const res = await recordTimeEntryRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            // Must reject at schema level with 422 Unprocessable Entity
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");

            // Service must NEVER be called when schema validation fails
            expect(mocks.recordTechnicianTimeEntry).not.toHaveBeenCalled();
        });

        it("POST /api/technician/work-orders/[workOrderId]/time -> returns 422 when attempting direct TRAVEL entry type", async () => {
            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/time`,
                "POST",
                { "x-workspace-id": WS_ID },
                { entryType: "TRAVEL" } // Prohibited manual entry type
            );
            const res = await recordTimeEntryRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });

        it("PATCH /api/technician/work-orders/[workOrderId]/time/[id] -> returns 200 with updated entry", async () => {
            mocks.updateTechnicianTimeEntry.mockResolvedValue({
                ...sampleTimeEntryReadModel,
                notes: "Updated diagnostics",
            });

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/time/${TIME_ENTRY_ID}`,
                "PATCH",
                { "x-workspace-id": WS_ID },
                { notes: "Updated diagnostics" }
            );
            const res = await updateTimeEntryRoute(req, {
                params: Promise.resolve({ workOrderId: WO_ID, id: TIME_ENTRY_ID }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.notes).toBe("Updated diagnostics");
        });

        it("PATCH /api/technician/work-orders/[workOrderId]/time/[id] -> returns 409 when entry is COMPLETED (immutable)", async () => {
            mocks.updateTechnicianTimeEntry.mockRejectedValue(new TimeEntryImmutableError());

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/time/${TIME_ENTRY_ID}`,
                "PATCH",
                { "x-workspace-id": WS_ID },
                { notes: "Attempted edit" }
            );
            const res = await updateTimeEntryRoute(req, {
                params: Promise.resolve({ workOrderId: WO_ID, id: TIME_ENTRY_ID }),
            });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("TIME_ENTRY_IMMUTABLE");
        });
    });

    describe("5. Separate Admin Routes (Requirement 5)", () => {
        it("POST /api/work-orders/[workOrderId]/complete -> returns 200 for administrative completion and sanitizes _historyRecordId", async () => {
            mocks.completeWorkOrderAdmin.mockResolvedValue({
                ...sampleWorkOrderReadModel,
                status: "COMPLETED",
                _historyRecordId: "hist_admin_secret_999",
            } as any);

            const req = createRequest(
                `https://api.aforden.com/api/work-orders/${WO_ID}/complete`,
                "POST",
                { "x-workspace-id": WS_ID },
                { resolutionNotes: "Manager verified job" }
            );
            const res = await adminCompleteRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data._historyRecordId).toBeUndefined();
            expect(mocks.completeWorkOrderAdmin).toHaveBeenCalledWith(WS_ID, WO_ID, {
                resolutionNotes: "Manager verified job",
            });
        });

        it("POST /api/work-orders/[workOrderId]/complete -> returns 403 when caller is DISPATCHER", async () => {
            mocks.completeWorkOrderAdmin.mockRejectedValue(
                new ForbiddenError("Dispatchers are not authorized to complete work orders.")
            );

            const req = createRequest(
                `https://api.aforden.com/api/work-orders/${WO_ID}/complete`,
                "POST",
                { "x-workspace-id": WS_ID }
            );
            const res = await adminCompleteRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("GET /api/work-orders/[workOrderId]/time -> returns 200 with admin workspace-wide entries", async () => {
            mocks.listTechnicianTimeEntriesAdmin.mockResolvedValue([sampleTimeEntryReadModel]);

            const req = createRequest(`https://api.aforden.com/api/work-orders/${WO_ID}/time`);
            const res = await adminListTimeEntriesRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(mocks.listTechnicianTimeEntriesAdmin).toHaveBeenCalledWith(WS_ID, WO_ID);
        });

        it("PATCH /api/work-orders/[workOrderId]/time/[id] -> returns 200 for admin historical time entry edit", async () => {
            mocks.updateTechnicianTimeEntryAdmin.mockResolvedValue({
                ...sampleTimeEntryReadModel,
                notes: "Admin edited note",
                durationMinutes: 45,
            });

            const req = createRequest(
                `https://api.aforden.com/api/work-orders/${WO_ID}/time/${TIME_ENTRY_ID}`,
                "PATCH",
                { "x-workspace-id": WS_ID },
                {
                    notes: "Admin edited note",
                    durationMinutes: 45,
                    editReason: "Corrected duration per GPS log",
                }
            );
            const res = await adminUpdateTimeEntryRoute(req, {
                params: Promise.resolve({ workOrderId: WO_ID, id: TIME_ENTRY_ID }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.durationMinutes).toBe(45);
        });
    });
});
