import { describe, expect, it, vi, beforeEach } from "vitest";
import { dispatchAppointment } from "@/lib/services/schedule/dispatchAppointment";
import { undispatchAppointment } from "@/lib/services/schedule/undispatchAppointment";
import { acknowledgeDispatch } from "@/lib/services/schedule/acknowledgeDispatch";
import { rescheduleSchedule } from "@/lib/services/schedule/rescheduleSchedule";
import {
    ScheduleAppointmentNotFoundError,
    DispatchNotAllowedError,
    UndispatchNotAllowedError,
    ScheduleInvalidStatusTransitionError,
} from "@/lib/services/schedule/scheduleErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";

const mocks = vi.hoisted(() => ({
    requireWorkspaceAuthorization: vi.fn(),
    assertPermission: vi.fn(),

    technicianProfileFindFirst: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),
    $transaction: vi.fn(),
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: mocks.requireWorkspaceAuthorization,
}));

vi.mock("@/lib/services/authorization/permissionService", () => ({
    assertPermission: mocks.assertPermission,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
            findMany: mocks.scheduleAppointmentFindMany,
            update: mocks.scheduleAppointmentUpdate,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        $transaction: mocks.$transaction,
    },
}));

describe("Phase 1.8.7 — Dispatch Assignment Architecture", () => {
    const WS_ID = "ws_dispatch_test";
    const APPT_ID = "apt_dispatch_test";
    const WO_ID = "wo_dispatch_test";
    const TECH_ID = "tech_dispatch_test";
    const CALLER_MEMBER_ID = "mem_dispatcher_01";
    const TECH_MEMBER_ID = "mem_tech_01";

    const dispatcherAuth = {
        membership: {
            id: CALLER_MEMBER_ID,
            role: "DISPATCHER",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_dispatcher_01",
            name: "Dispatcher Lead",
            email: "lead@aforden.com",
        },
        workspace: {
            id: WS_ID,
            timezone: "America/New_York",
        },
    };

    const technicianAuth = {
        membership: {
            id: TECH_MEMBER_ID,
            role: "TECHNICIAN",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_tech_01",
            name: "Sam FieldTech",
            email: "sam@aforden.com",
        },
        workspace: {
            id: WS_ID,
            timezone: "America/New_York",
        },
    };

    const defaultWorkOrder = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-2026-000700",
        title: "Emergency Water Pipe Repair",
        status: "ASSIGNED",
        priority: "URGENT",
        customerId: "cust_700",
        locationId: "loc_700",
        assignedTechnicianId: TECH_ID,
        assetId: null,
        customer: {
            id: "cust_700",
            name: "Metropolitan Utilities",
            customerNumber: "CUST-0700",
        },
        location: {
            id: "loc_700",
            name: "Central Station",
            addressLine1: "100 Rail Way",
            addressLine2: null,
            city: "New York",
            state: "NY",
            postalCode: "10001",
            country: "USA",
            latitude: "40.7505",
            longitude: "-73.9934",
            timezone: "America/New_York",
        },
        asset: null,
    };

    const defaultTechnician = {
        id: TECH_ID,
        employeeId: "emp_700",
        employee: {
            id: "emp_700",
            workspaceId: WS_ID,
            workspaceMemberId: TECH_MEMBER_ID,
            displayName: "Sam FieldTech",
            employeeNumber: "TECH-700",
            status: "ACTIVE",
        },
        technicianAvailabilities: [
            { id: "av_mon", dayOfWeek: "MONDAY", startTime: "08:00", endTime: "18:00", status: "ACTIVE" },
            { id: "av_tue", dayOfWeek: "TUESDAY", startTime: "08:00", endTime: "18:00", status: "ACTIVE" },
            { id: "av_wed", dayOfWeek: "WEDNESDAY", startTime: "08:00", endTime: "18:00", status: "ACTIVE" },
            { id: "av_thu", dayOfWeek: "THURSDAY", startTime: "08:00", endTime: "18:00", status: "ACTIVE" },
            { id: "av_fri", dayOfWeek: "FRIDAY", startTime: "08:00", endTime: "18:00", status: "ACTIVE" },
        ],
        technicianAvailabilityExceptions: [],
    };

    const defaultAppointment = {
        id: APPT_ID,
        workspaceId: WS_ID,
        appointmentNumber: "APT-2026-000700",
        workOrderId: WO_ID,
        technicianId: TECH_ID,
        scheduledStart: new Date("2026-08-26T14:00:00.000Z"), // Wed 10am EDT
        scheduledEnd: new Date("2026-08-26T16:00:00.000Z"),   // Wed 12pm EDT
        durationMinutes: 120,
        timezone: "America/New_York",
        status: "SCHEDULED",
        dispatchStatus: "PENDING_DISPATCH",
        dispatchedAt: null,
        dispatchedByMemberId: null,
        undispatchedAt: null,
        undispatchedByMemberId: null,
        fieldExecutionStartedAt: null,
        cancellationReason: null,
        notes: "Urgent dispatch requested",
        metadata: null,
        createdAt: new Date("2026-08-26T08:00:00.000Z"),
        updatedAt: new Date("2026-08-26T08:00:00.000Z"),
        workOrder: defaultWorkOrder,
        technician: defaultTechnician,
        dispatchedByMember: null,
        undispatchedByMember: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.requireWorkspaceAuthorization.mockResolvedValue(dispatcherAuth);
        mocks.assertPermission.mockReturnValue(true);
        mocks.technicianProfileFindFirst.mockResolvedValue(defaultTechnician);
        mocks.scheduleAppointmentFindFirst.mockResolvedValue(defaultAppointment);
        mocks.scheduleAppointmentFindMany.mockResolvedValue([]);

        mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
            const tx = {
                scheduleAppointment: {
                    update: mocks.scheduleAppointmentUpdate,
                },
                scheduleAppointmentHistory: {
                    create: mocks.scheduleAppointmentHistoryCreate,
                },
            };
            return cb(tx);
        });

        mocks.scheduleAppointmentUpdate.mockImplementation(async ({ data }: any) => ({
            ...defaultAppointment,
            ...data,
            updatedAt: new Date("2026-08-26T09:00:00.000Z"),
        }));
    });

    // =========================================================================
    // 1. dispatchAppointment()
    // =========================================================================
    describe("1. dispatchAppointment()", () => {
        it("happy path: dispatches appointment to technician and writes history audit record", async () => {
            const result = await dispatchAppointment(WS_ID, APPT_ID, {
                notes: "Tools loaded in vehicle",
            });

            expect(mocks.requireWorkspaceAuthorization).toHaveBeenCalledWith(WS_ID);
            expect(mocks.assertPermission).toHaveBeenCalledWith(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_UPDATE,
            );

            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: expect.objectContaining({
                    dispatchStatus: "DISPATCHED",
                    dispatchedByMemberId: CALLER_MEMBER_ID,
                    undispatchedAt: null,
                    undispatchedByMemberId: null,
                }),
                include: expect.any(Object),
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "DISPATCHED",
                    field: "dispatchStatus",
                    oldValue: "PENDING_DISPATCH",
                    newValue: "DISPATCHED",
                    metadata: {
                        notes: "Tools loaded in vehicle",
                    },
                }),
            });

            expect(result.dispatchStatus).toBe("DISPATCHED");
        });

        it("throws ScheduleAppointmentNotFoundError if appointment is missing", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                dispatchAppointment(WS_ID, "non_existent_id"),
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);
        });

        it("throws DispatchNotAllowedError if appointment status is CANCELLED or COMPLETED", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                status: "CANCELLED",
            });

            await expect(dispatchAppointment(WS_ID, APPT_ID)).rejects.toThrow(
                DispatchNotAllowedError,
            );
        });

        it("throws DispatchNotAllowedError if parent WorkOrder is ON_HOLD or terminal", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                workOrder: {
                    ...defaultWorkOrder,
                    status: "ON_HOLD",
                },
            });

            await expect(dispatchAppointment(WS_ID, APPT_ID)).rejects.toThrow(
                DispatchNotAllowedError,
            );
        });
    });

    // =========================================================================
    // 2. undispatchAppointment()
    // =========================================================================
    describe("2. undispatchAppointment()", () => {
        const dispatchedAppt = {
            ...defaultAppointment,
            dispatchStatus: "DISPATCHED",
            dispatchedAt: new Date("2026-08-26T08:30:00.000Z"),
            dispatchedByMemberId: CALLER_MEMBER_ID,
        };

        it("happy path: recalls appointment back to PENDING_DISPATCH and writes audit history", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(dispatchedAppt);

            const result = await undispatchAppointment(WS_ID, APPT_ID, {
                reason: "Emergency rerouting of technician",
            });

            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: expect.objectContaining({
                    dispatchStatus: "PENDING_DISPATCH",
                    undispatchedByMemberId: CALLER_MEMBER_ID,
                }),
                include: expect.any(Object),
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "UNDISPATCHED",
                    field: "dispatchStatus",
                    oldValue: "DISPATCHED",
                    newValue: "PENDING_DISPATCH",
                    metadata: {
                        reason: "Emergency rerouting of technician",
                    },
                }),
            });

            expect(result.dispatchStatus).toBe("PENDING_DISPATCH");
        });

        it("throws UndispatchNotAllowedError if appointment is already PENDING_DISPATCH", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(defaultAppointment);

            await expect(undispatchAppointment(WS_ID, APPT_ID)).rejects.toThrow(
                UndispatchNotAllowedError,
            );
        });

        it("throws UndispatchNotAllowedError if technician has already started field execution", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...dispatchedAppt,
                fieldExecutionStartedAt: new Date("2026-08-26T09:15:00.000Z"),
            });

            await expect(undispatchAppointment(WS_ID, APPT_ID)).rejects.toThrow(
                UndispatchNotAllowedError,
            );
        });
    });

    // =========================================================================
    // 3. acknowledgeDispatch() (Phase 1.9 Boundary Contract)
    // =========================================================================
    describe("3. acknowledgeDispatch() (Phase 1.9 Boundary)", () => {
        const dispatchedAppt = {
            ...defaultAppointment,
            dispatchStatus: "DISPATCHED",
            dispatchedAt: new Date("2026-08-26T08:30:00.000Z"),
            dispatchedByMemberId: CALLER_MEMBER_ID,
        };

        it("happy path: assigned technician acknowledges receipt of dispatch", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue(technicianAuth);
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(dispatchedAppt);

            const result = await acknowledgeDispatch(WS_ID, APPT_ID, {
                notes: "En route to site",
            });

            expect(mocks.assertPermission).toHaveBeenCalledWith(
                "TECHNICIAN",
                PERMISSIONS.SCHEDULER_VIEW,
            );

            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: {
                    dispatchStatus: "ACKNOWLEDGED",
                },
                include: expect.any(Object),
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "UPDATED",
                    field: "dispatchStatus",
                    oldValue: "DISPATCHED",
                    newValue: "ACKNOWLEDGED",
                    metadata: {
                        notes: "En route to site",
                    },
                }),
            });

            expect(result.dispatchStatus).toBe("ACKNOWLEDGED");
        });

        it("throws AuthorizationError if caller is a technician assigned to a different profile", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue(technicianAuth);
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(dispatchedAppt);

            // Caller's technician profile id does not match appointment's technicianId
            mocks.technicianProfileFindFirst.mockResolvedValue({
                id: "tech_other_different_999",
            });

            await expect(acknowledgeDispatch(WS_ID, APPT_ID)).rejects.toThrow(
                ForbiddenError,
            );
        });

        it("throws ScheduleInvalidStatusTransitionError if appointment is not DISPATCHED (e.g. PENDING_DISPATCH)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue(technicianAuth);
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(defaultAppointment); // PENDING_DISPATCH

            await expect(acknowledgeDispatch(WS_ID, APPT_ID)).rejects.toThrow(
                ScheduleInvalidStatusTransitionError,
            );
        });
    });

    // =========================================================================
    // 4. Reassignment-Flow Integration Test (§9.4)
    // =========================================================================
    describe("4. Reassignment & Reschedule Flow (§9.4)", () => {
        it("rescheduling an already DISPATCHED appointment resets dispatchStatus to PENDING_DISPATCH", async () => {
            const previouslyDispatched = {
                ...defaultAppointment,
                dispatchStatus: "DISPATCHED",
                dispatchedAt: new Date("2026-08-26T08:00:00.000Z"),
                dispatchedByMemberId: CALLER_MEMBER_ID,
            };

            mocks.scheduleAppointmentFindFirst.mockResolvedValue(previouslyDispatched);

            const rescheduleResult = await rescheduleSchedule(WS_ID, APPT_ID, {
                scheduledStart: "2026-08-26T15:00:00.000Z",
                scheduledEnd: "2026-08-26T17:00:00.000Z",
                reason: "Customer asked to delay arrival by 1 hour",
            });

            // Reschedule must reset dispatchStatus to PENDING_DISPATCH
            expect(rescheduleResult.dispatchStatus).toBe("PENDING_DISPATCH");
            expect(rescheduleResult.status).toBe("RESCHEDULED");

            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: expect.objectContaining({
                    status: "RESCHEDULED",
                    dispatchStatus: "PENDING_DISPATCH",
                }),
                include: expect.any(Object),
            });
        });
    });
});
