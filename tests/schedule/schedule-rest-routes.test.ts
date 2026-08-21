import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    listSchedules: vi.fn(),
    createSchedule: vi.fn(),
    getSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    rescheduleSchedule: vi.fn(),
    cancelSchedule: vi.fn(),
    dispatchAppointment: vi.fn(),
    undispatchAppointment: vi.fn(),
    acknowledgeDispatch: vi.fn(),
    getAppointmentHistory: vi.fn(),
    getTechnicianSchedule: vi.fn(),
    getWorkOrderSchedule: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/services/schedule", () => ({
    listSchedules: mocks.listSchedules,
    createSchedule: mocks.createSchedule,
    getSchedule: mocks.getSchedule,
    updateSchedule: mocks.updateSchedule,
    rescheduleSchedule: mocks.rescheduleSchedule,
    cancelSchedule: mocks.cancelSchedule,
    dispatchAppointment: mocks.dispatchAppointment,
    undispatchAppointment: mocks.undispatchAppointment,
    acknowledgeDispatch: mocks.acknowledgeDispatch,
    getAppointmentHistory: mocks.getAppointmentHistory,
    getTechnicianSchedule: mocks.getTechnicianSchedule,
    getWorkOrderSchedule: mocks.getWorkOrderSchedule,
}));

import { GET as listSchedulesHandler, POST as createScheduleHandler } from "@/app/api/schedules/route";
import { GET as getScheduleHandler, PATCH as updateScheduleHandler } from "@/app/api/schedules/[scheduleId]/route";
import { POST as rescheduleHandler } from "@/app/api/schedules/[scheduleId]/reschedule/route";
import { POST as cancelHandler } from "@/app/api/schedules/[scheduleId]/cancel/route";
import { POST as dispatchHandler } from "@/app/api/schedules/[scheduleId]/dispatch/route";
import { POST as undispatchHandler } from "@/app/api/schedules/[scheduleId]/undispatch/route";
import { POST as acknowledgeHandler } from "@/app/api/schedules/[scheduleId]/acknowledge/route";
import { GET as historyHandler } from "@/app/api/schedules/[scheduleId]/history/route";
import { GET as techScheduleHandler } from "@/app/api/technicians/[technicianId]/schedule/route";
import { GET as woScheduleHandler } from "@/app/api/work-orders/[workOrderId]/schedule/route";

import {
    ScheduleAppointmentNotFoundError,
    ScheduleTechnicianConflictError,
    ScheduleTechnicianNotEligibleError,
    ScheduleTechnicianOnLeaveError,
    ScheduleOutsideWorkingHoursError,
    DispatchNotAllowedError,
    UndispatchNotAllowedError,
    ScheduleImmutableError,
} from "@/lib/services/schedule/scheduleErrors";
import { ZodError } from "zod";

describe("Phase 1.8.11 — Scheduling REST API Routes", () => {
    const WS_ID = "ws_api_test_01";
    const APPT_ID = "apt_api_test_01";
    const TECH_ID = "tech_api_test_01";
    const WO_ID = "wo_api_test_01";

    const mockAppointment = {
        id: APPT_ID,
        workspaceId: WS_ID,
        appointmentNumber: "APT-2026-000100",
        workOrderId: WO_ID,
        technicianId: TECH_ID,
        status: "SCHEDULED",
        dispatchStatus: "PENDING_DISPATCH",
        scheduledStart: new Date("2026-08-26T14:00:00.000Z"),
        scheduledEnd: new Date("2026-08-26T16:00:00.000Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createRequest = (url: string, method = "GET", body?: any, headers: Record<string, string> = {}) => {
        const reqHeaders = new Headers({
            "x-workspace-id": WS_ID,
            "content-type": "application/json",
            ...headers,
        });

        const init: RequestInit = {
            method,
            headers: reqHeaders,
        };

        if (body !== undefined) {
            init.body = typeof body === "string" ? body : JSON.stringify(body);
        }

        return new Request(url, init);
    };

    // =========================================================================
    // 1. Happy Path Handler Tests (All 12 Routes)
    // =========================================================================
    describe("1. Happy Path Route Handlers", () => {
        it("1. GET /api/schedules → listSchedules", async () => {
            vi.mocked(mocks.listSchedules).mockResolvedValue({
                items: [mockAppointment as any],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
            });

            const req = createRequest("http://localhost/api/schedules?status=SCHEDULED&page=1&limit=10");
            const res = await listSchedulesHandler(req);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data.items).toHaveLength(1);
            expect(mocks.listSchedules).toHaveBeenCalledWith(WS_ID, expect.objectContaining({
                status: "SCHEDULED",
                page: "1",
                limit: "10",
            }));
        });

        it("2. POST /api/schedules → createSchedule", async () => {
            vi.mocked(mocks.createSchedule).mockResolvedValue(mockAppointment as any);

            const payload = {
                workOrderId: WO_ID,
                technicianId: TECH_ID,
                scheduledStart: "2026-08-26T14:00:00.000Z",
                scheduledEnd: "2026-08-26T16:00:00.000Z",
            };

            const req = createRequest("http://localhost/api/schedules", "POST", payload);
            const res = await createScheduleHandler(req);
            const json = await res.json();

            expect(res.status).toBe(201);
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(APPT_ID);
            expect(mocks.createSchedule).toHaveBeenCalledWith(WS_ID, payload);
        });

        it("3. GET /api/schedules/[scheduleId] → getSchedule", async () => {
            vi.mocked(mocks.getSchedule).mockResolvedValue(mockAppointment as any);

            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}`);
            const res = await getScheduleHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(APPT_ID);
            expect(mocks.getSchedule).toHaveBeenCalledWith(WS_ID, APPT_ID);
        });

        it("4. PATCH /api/schedules/[scheduleId] → updateSchedule", async () => {
            const updatedAppt = { ...mockAppointment, notes: "Updated notes" };
            vi.mocked(mocks.updateSchedule).mockResolvedValue(updatedAppt as any);

            const payload = { notes: "Updated notes" };
            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}`, "PATCH", payload);
            const res = await updateScheduleHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data.notes).toBe("Updated notes");
            expect(mocks.updateSchedule).toHaveBeenCalledWith(WS_ID, APPT_ID, payload);
        });

        it("5. POST /api/schedules/[scheduleId]/reschedule → rescheduleSchedule", async () => {
            const rescheduledAppt = { ...mockAppointment, status: "RESCHEDULED" };
            vi.mocked(mocks.rescheduleSchedule).mockResolvedValue(rescheduledAppt as any);

            const payload = {
                scheduledStart: "2026-08-26T15:00:00.000Z",
                scheduledEnd: "2026-08-26T17:00:00.000Z",
                reason: "Customer request",
            };

            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}/reschedule`, "POST", payload);
            const res = await rescheduleHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(mocks.rescheduleSchedule).toHaveBeenCalledWith(WS_ID, APPT_ID, payload);
        });

        it("6. POST /api/schedules/[scheduleId]/cancel → cancelSchedule", async () => {
            const cancelledAppt = { ...mockAppointment, status: "CANCELLED" };
            vi.mocked(mocks.cancelSchedule).mockResolvedValue(cancelledAppt as any);

            const payload = { cancellationReason: "Customer canceled order" };
            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}/cancel`, "POST", payload);
            const res = await cancelHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(mocks.cancelSchedule).toHaveBeenCalledWith(WS_ID, APPT_ID, payload);
        });

        it("7. POST /api/schedules/[scheduleId]/dispatch → dispatchAppointment", async () => {
            const dispatchedAppt = { ...mockAppointment, dispatchStatus: "DISPATCHED" };
            vi.mocked(mocks.dispatchAppointment).mockResolvedValue(dispatchedAppt as any);

            const payload = { notes: "Urgent dispatch" };
            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}/dispatch`, "POST", payload);
            const res = await dispatchHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(mocks.dispatchAppointment).toHaveBeenCalledWith(WS_ID, APPT_ID, payload);
        });

        it("8. POST /api/schedules/[scheduleId]/undispatch → undispatchAppointment", async () => {
            const undispatchedAppt = { ...mockAppointment, dispatchStatus: "PENDING_DISPATCH" };
            vi.mocked(mocks.undispatchAppointment).mockResolvedValue(undispatchedAppt as any);

            const payload = { reason: "Reassigned" };
            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}/undispatch`, "POST", payload);
            const res = await undispatchHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(mocks.undispatchAppointment).toHaveBeenCalledWith(WS_ID, APPT_ID, payload);
        });

        it("9. POST /api/schedules/[scheduleId]/acknowledge → acknowledgeDispatch", async () => {
            const ackAppt = { ...mockAppointment, dispatchStatus: "ACKNOWLEDGED" };
            vi.mocked(mocks.acknowledgeDispatch).mockResolvedValue(ackAppt as any);

            const payload = { notes: "Acknowledged receipt" };
            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}/acknowledge`, "POST", payload);
            const res = await acknowledgeHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(mocks.acknowledgeDispatch).toHaveBeenCalledWith(WS_ID, APPT_ID, payload);
        });

        it("10. GET /api/schedules/[scheduleId]/history → getAppointmentHistory", async () => {
            vi.mocked(mocks.getAppointmentHistory).mockResolvedValue({
                items: [{ id: "hist_1", eventType: "CREATED" } as any],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
            });

            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}/history?page=1&limit=20`);
            const res = await historyHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data.items).toHaveLength(1);
            expect(mocks.getAppointmentHistory).toHaveBeenCalledWith(WS_ID, APPT_ID, { page: "1", limit: "20" });
        });

        it("11. GET /api/technicians/[technicianId]/schedule → getTechnicianSchedule", async () => {
            vi.mocked(mocks.getTechnicianSchedule).mockResolvedValue([mockAppointment as any]);

            const req = createRequest(`http://localhost/api/technicians/${TECH_ID}/schedule?startDate=2026-08-26T00:00:00.000Z&endDate=2026-08-26T23:59:59.000Z`);
            const res = await techScheduleHandler(req, { params: Promise.resolve({ technicianId: TECH_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data).toHaveLength(1);
            expect(mocks.getTechnicianSchedule).toHaveBeenCalledWith(WS_ID, TECH_ID, expect.objectContaining({
                startDate: "2026-08-26T00:00:00.000Z",
                endDate: "2026-08-26T23:59:59.000Z",
            }));
        });

        it("12. GET /api/work-orders/[workOrderId]/schedule → getWorkOrderSchedule", async () => {
            vi.mocked(mocks.getWorkOrderSchedule).mockResolvedValue([mockAppointment as any]);

            const req = createRequest(`http://localhost/api/work-orders/${WO_ID}/schedule`);
            const res = await woScheduleHandler(req, { params: Promise.resolve({ workOrderId: WO_ID }) });
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.success).toBe(true);
            expect(json.data).toHaveLength(1);
            expect(mocks.getWorkOrderSchedule).toHaveBeenCalledWith(WS_ID, WO_ID);
        });
    });

    // =========================================================================
    // 2. Representative Error Mapping Tests (400, 404, 409, 422, 500)
    // =========================================================================
    describe("2. Standardized Error Response Mapping", () => {
        it("returns 400 MISSING_WORKSPACE when workspace header/param is absent", async () => {
            const req = new Request("http://localhost/api/schedules", { method: "GET" });
            const res = await listSchedulesHandler(req);
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("returns 400 INVALID_REQUEST on malformed JSON body", async () => {
            const req = createRequest("http://localhost/api/schedules", "POST", "{ malformed json ");
            const res = await createScheduleHandler(req);
            const json = await res.json();

            expect(res.status).toBe(400);
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("returns 404 on ScheduleAppointmentNotFoundError", async () => {
            vi.mocked(mocks.getSchedule).mockRejectedValue(new ScheduleAppointmentNotFoundError());

            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}`);
            const res = await getScheduleHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(404);
            expect(json.error.code).toBe("SCHEDULE_APPOINTMENT_NOT_FOUND");
        });

        it("returns 409 on ScheduleTechnicianConflictError with conflicts payload", async () => {
            const conflicts = [{ id: "apt_other", scheduledStart: new Date(), scheduledEnd: new Date() }];
            vi.mocked(mocks.rescheduleSchedule).mockRejectedValue(
                new ScheduleTechnicianConflictError("Conflict", conflicts),
            );

            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}/reschedule`, "POST", {
                scheduledStart: "2026-08-26T15:00:00.000Z",
                scheduledEnd: "2026-08-26T17:00:00.000Z",
                reason: "Move slot",
            });
            const res = await rescheduleHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(409);
            expect(json.error.code).toBe("SCHEDULE_TECHNICIAN_CONFLICT");
            expect(json.error.conflicts).toHaveLength(1);
        });

        it("returns 409 on DispatchNotAllowedError and UndispatchNotAllowedError", async () => {
            vi.mocked(mocks.dispatchAppointment).mockRejectedValue(new DispatchNotAllowedError());
            const reqDispatch = createRequest(`http://localhost/api/schedules/${APPT_ID}/dispatch`, "POST", {});
            const resDispatch = await dispatchHandler(reqDispatch, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            expect(resDispatch.status).toBe(409);

            vi.mocked(mocks.undispatchAppointment).mockRejectedValue(new UndispatchNotAllowedError());
            const reqUndispatch = createRequest(`http://localhost/api/schedules/${APPT_ID}/undispatch`, "POST", { reason: "test" });
            const resUndispatch = await undispatchHandler(reqUndispatch, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            expect(resUndispatch.status).toBe(409);
        });

        it("returns 422 on ScheduleTechnicianNotEligibleError with blockers payload", async () => {
            vi.mocked(mocks.createSchedule).mockRejectedValue(
                new ScheduleTechnicianNotEligibleError("Technician inactive", ["STATUS_INACTIVE"]),
            );

            const req = createRequest("http://localhost/api/schedules", "POST", {
                workOrderId: WO_ID,
                technicianId: TECH_ID,
                scheduledStart: "2026-08-26T14:00:00.000Z",
                scheduledEnd: "2026-08-26T16:00:00.000Z",
            });
            const res = await createScheduleHandler(req);
            const json = await res.json();

            expect(res.status).toBe(422);
            expect(json.error.code).toBe("SCHEDULE_TECHNICIAN_NOT_ELIGIBLE");
            expect(json.error.blockers).toEqual(["STATUS_INACTIVE"]);
        });

        it("returns 422 on ScheduleTechnicianOnLeaveError and ScheduleOutsideWorkingHoursError", async () => {
            vi.mocked(mocks.createSchedule).mockRejectedValue(
                new ScheduleTechnicianOnLeaveError("On leave", [{ id: "exc_1" }]),
            );

            const req = createRequest("http://localhost/api/schedules", "POST", {});
            const res = await createScheduleHandler(req);
            expect(res.status).toBe(422);

            vi.mocked(mocks.createSchedule).mockRejectedValue(
                new ScheduleOutsideWorkingHoursError(),
            );
            const req2 = createRequest("http://localhost/api/schedules", "POST", {});
            const res2 = await createScheduleHandler(req2);
            expect(res2.status).toBe(422);
        });

        it("returns 422 on ZodError validation failure", async () => {
            const zodErr = new ZodError([
                {
                    code: "custom",
                    path: ["scheduledEnd"],
                    message: "Scheduled start must be earlier than end",
                },
            ]);
            vi.mocked(mocks.createSchedule).mockRejectedValue(zodErr);

            const req = createRequest("http://localhost/api/schedules", "POST", {});
            const res = await createScheduleHandler(req);
            const json = await res.json();

            expect(res.status).toBe(422);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields.scheduledEnd).toBeTruthy();
        });

        it("sanitizes unexpected errors to a generic 500 without leaking stack or prisma details", async () => {
            vi.mocked(mocks.getSchedule).mockRejectedValue(
                new Error("PrismaClientInitializationError: Connection to postgres://secret:password@db:5432 failed"),
            );

            const req = createRequest(`http://localhost/api/schedules/${APPT_ID}`);
            const res = await getScheduleHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });
            const json = await res.json();

            expect(res.status).toBe(500);
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(json.error.message).toBe("An unexpected error occurred. Please try again later.");
            expect(JSON.stringify(json)).not.toContain("postgres://");
            expect(JSON.stringify(json)).not.toContain("PrismaClient");
        });
    });

    // =========================================================================
    // 3. Architectural Invariants (Thin Adapter, Zero Business Logic / Prisma / Zod in Routes)
    // =========================================================================
    describe("3. Thin Adapter Invariants (§11.4)", () => {
        it("verifies acknowledgeDispatch passes caller body without accepting or requiring spoofed technicianId", async () => {
            mocks.acknowledgeDispatch.mockResolvedValue(mockAppointment as any);

            const req = createRequest(
                `http://localhost/api/schedules/${APPT_ID}/acknowledge`,
                "POST",
                { notes: "Direct technician acknowledgment" },
            );
            const res = await acknowledgeHandler(req, { params: Promise.resolve({ scheduleId: APPT_ID }) });

            expect(res.status).toBe(200);
            expect(mocks.acknowledgeDispatch).toHaveBeenCalledWith(
                WS_ID,
                APPT_ID,
                { notes: "Direct technician acknowledgment" },
            );
        });
    });
});
