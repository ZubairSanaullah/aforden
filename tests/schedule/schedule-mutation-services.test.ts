import { describe, expect, it, vi, beforeEach } from "vitest";
import { rescheduleSchedule } from "@/lib/services/schedule/rescheduleSchedule";
import { cancelSchedule } from "@/lib/services/schedule/cancelSchedule";
import { updateSchedule } from "@/lib/services/schedule/updateSchedule";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleImmutableError,
    ScheduleMissingCancellationReasonError,
    ScheduleWorkOrderNotEligibleError,
    ScheduleInvalidTimeIntervalError,
    ScheduleTechnicianConflictError,
} from "@/lib/services/schedule/scheduleErrors";
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

describe("Phase 1.8.5 — Controlled Mutation Services (reschedule, cancel, update)", () => {
    const WS_ID = "ws_mutation_101";
    const APPT_ID = "apt_mutation_101";
    const WO_ID = "wo_mutation_101";
    const TECH_ID = "tech_mutation_101";

    const defaultAuth = {
        membership: {
            id: "mem_dispatcher_01",
            role: "DISPATCHER",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_dispatcher_01",
            name: "Dispatcher Jane",
            email: "jane@aforden.com",
        },
        workspace: {
            id: WS_ID,
            timezone: "America/New_York",
        },
    };

    const defaultWorkOrder = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-2026-000050",
        title: "HVAC Seasonal Overhaul",
        status: "ASSIGNED",
        priority: "MEDIUM",
        customerId: "cust_101",
        locationId: "loc_101",
        assignedTechnicianId: TECH_ID,
        assetId: "ast_101",
        customer: {
            id: "cust_101",
            name: "Metro Facilities Group",
            customerNumber: "CUST-0050",
        },
        location: {
            id: "loc_101",
            name: "North Tower",
            addressLine1: "500 Main Street",
            addressLine2: null,
            city: "New York",
            state: "NY",
            postalCode: "10001",
            country: "USA",
            latitude: "40.7128",
            longitude: "-74.0060",
            timezone: "America/New_York",
        },
        asset: {
            id: "ast_101",
            name: "Main Air Handler",
            assetNumber: "AST-000050",
        },
    };

    const defaultTechnician = {
        id: TECH_ID,
        employeeId: "emp_101",
        employee: {
            id: "emp_101",
            workspaceId: WS_ID,
            displayName: "Sarah Connor",
            employeeNumber: "TECH-050",
            status: "ACTIVE",
        },
    };

    const defaultAppointment = {
        id: APPT_ID,
        workspaceId: WS_ID,
        appointmentNumber: "APT-2026-000050",
        workOrderId: WO_ID,
        technicianId: TECH_ID,
        scheduledStart: new Date("2026-08-21T09:00:00.000Z"),
        scheduledEnd: new Date("2026-08-21T11:00:00.000Z"),
        durationMinutes: 120,
        timezone: "America/New_York",
        status: "SCHEDULED",
        dispatchStatus: "DISPATCHED",
        dispatchedAt: new Date("2026-08-21T08:00:00.000Z"),
        dispatchedByMemberId: "mem_dispatcher_01",
        undispatchedAt: null,
        undispatchedByMemberId: null,
        fieldExecutionStartedAt: null,
        cancellationReason: null,
        notes: "Initial gate code #1234",
        metadata: { gateCode: "1234" },
        createdAt: new Date("2026-08-21T07:00:00.000Z"),
        updatedAt: new Date("2026-08-21T07:00:00.000Z"),
        workOrder: defaultWorkOrder,
        technician: defaultTechnician,
        dispatchedByMember: {
            user: { name: "Dispatcher Jane" },
        },
        undispatchedByMember: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.requireWorkspaceAuthorization.mockResolvedValue(defaultAuth);
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
            updatedAt: new Date("2026-08-21T10:00:00.000Z"),
        }));
    });

    // =========================================================================
    // 1. rescheduleSchedule() Tests
    // =========================================================================
    describe("1. rescheduleSchedule()", () => {
        const rescheduleInput = {
            scheduledStart: "2026-08-21T14:00:00.000Z",
            scheduledEnd: "2026-08-21T16:30:00.000Z",
            reason: "Customer requested afternoon window",
        };

        it("happy path: reschedules appointment, resets dispatchStatus to PENDING_DISPATCH, and creates audit entry", async () => {
            const result = await rescheduleSchedule(WS_ID, APPT_ID, rescheduleInput);

            expect(mocks.requireWorkspaceAuthorization).toHaveBeenCalledWith(WS_ID);
            expect(mocks.assertPermission).toHaveBeenCalledWith(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_UPDATE,
            );

            // Reuses conflict detection query with excludeAppointmentId
            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    technicianId: TECH_ID,
                    status: { in: ["SCHEDULED", "RESCHEDULED"] },
                    scheduledStart: { lt: new Date("2026-08-21T16:30:00.000Z") },
                    scheduledEnd: { gt: new Date("2026-08-21T14:00:00.000Z") },
                    id: { not: APPT_ID },
                },
                select: expect.any(Object),
            });

            // Update in DB transaction
            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: {
                    scheduledStart: new Date("2026-08-21T14:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-21T16:30:00.000Z"),
                    durationMinutes: 150,
                    timezone: "America/New_York",
                    status: "RESCHEDULED",
                    dispatchStatus: "PENDING_DISPATCH",
                },
                include: expect.any(Object),
            });

            // History created with reason and old/new interval
            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "RESCHEDULED",
                    field: "scheduledInterval",
                    metadata: expect.objectContaining({
                        reason: "Customer requested afternoon window",
                        previousStatus: "SCHEDULED",
                        previousDispatchStatus: "DISPATCHED",
                    }),
                }),
            });

            expect(result.status).toBe("RESCHEDULED");
            expect(result.dispatchStatus).toBe("PENDING_DISPATCH");
            expect(result.durationMinutes).toBe(150);
        });

        it("rescheduling when already PENDING_DISPATCH remains PENDING_DISPATCH and still writes a RESCHEDULED history record", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                dispatchStatus: "PENDING_DISPATCH",
            });

            const result = await rescheduleSchedule(WS_ID, APPT_ID, rescheduleInput);

            expect(result.status).toBe("RESCHEDULED");
            expect(result.dispatchStatus).toBe("PENDING_DISPATCH");

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "RESCHEDULED",
                    field: "scheduledInterval",
                    metadata: expect.objectContaining({
                        reason: "Customer requested afternoon window",
                        previousDispatchStatus: "PENDING_DISPATCH",
                    }),
                }),
            });
        });

        it("reassignment-flow integration test (§9.4): rescheduling a DISPATCHED appointment with populated dispatchedAt/dispatchedByMemberId resets dispatchStatus to PENDING_DISPATCH and preserves sane dispatch fields", async () => {
            const dispatchedDate = new Date("2026-08-21T08:30:00.000Z");
            const dispatcherMemberId = "mem_dispatcher_99";

            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                dispatchStatus: "DISPATCHED",
                dispatchedAt: dispatchedDate,
                dispatchedByMemberId: dispatcherMemberId,
                dispatchedByMember: {
                    id: dispatcherMemberId,
                    userId: "usr_dispatcher_99",
                    workspaceId: WS_ID,
                    role: "DISPATCHER",
                    status: "ACTIVE",
                    user: {
                        id: "usr_dispatcher_99",
                        name: "Dispatcher Pro",
                        email: "dispatcher@aforden.com",
                    },
                },
            });

            const result = await rescheduleSchedule(WS_ID, APPT_ID, {
                scheduledStart: "2026-08-21T16:00:00.000Z",
                scheduledEnd: "2026-08-21T18:00:00.000Z",
                reason: "Emergency tech reassignment by dispatch lead",
            });

            expect(result.status).toBe("RESCHEDULED");
            expect(result.dispatchStatus).toBe("PENDING_DISPATCH");

            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: expect.objectContaining({
                    status: "RESCHEDULED",
                    dispatchStatus: "PENDING_DISPATCH",
                    scheduledStart: new Date("2026-08-21T16:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-21T18:00:00.000Z"),
                }),
                include: expect.any(Object),
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "RESCHEDULED",
                    field: "scheduledInterval",
                    metadata: expect.objectContaining({
                        reason: "Emergency tech reassignment by dispatch lead",
                        previousDispatchStatus: "DISPATCHED",
                    }),
                }),
            });
        });

        it("throws ScheduleAppointmentNotFoundError if appointment is not found in workspace", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                rescheduleSchedule(WS_ID, "non_existent_id", rescheduleInput),
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);
        });

        it("throws ScheduleImmutableError when appointment is CANCELLED or COMPLETED", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                status: "CANCELLED",
            });

            await expect(
                rescheduleSchedule(WS_ID, APPT_ID, rescheduleInput),
            ).rejects.toThrow(ScheduleImmutableError);

            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                status: "COMPLETED",
            });

            await expect(
                rescheduleSchedule(WS_ID, APPT_ID, rescheduleInput),
            ).rejects.toThrow(ScheduleImmutableError);
        });

        it("throws ScheduleTechnicianConflictError on overlap with other appointments", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "other_appt_102",
                    appointmentNumber: "APT-2026-000051",
                    technicianId: TECH_ID,
                    workOrderId: "wo_other_102",
                    scheduledStart: new Date("2026-08-21T15:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-21T17:00:00.000Z"),
                    status: "SCHEDULED",
                },
            ]);

            await expect(
                rescheduleSchedule(WS_ID, APPT_ID, rescheduleInput),
            ).rejects.toThrow(ScheduleTechnicianConflictError);
        });

        it("rolls back transaction if history creation fails", async () => {
            mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
                const tx = {
                    scheduleAppointment: {
                        update: mocks.scheduleAppointmentUpdate,
                    },
                    scheduleAppointmentHistory: {
                        create: vi.fn().mockRejectedValue(new Error("History write failed")),
                    },
                };
                return cb(tx);
            });

            await expect(
                rescheduleSchedule(WS_ID, APPT_ID, rescheduleInput),
            ).rejects.toThrow("History write failed");
        });
    });

    // =========================================================================
    // 2. cancelSchedule() Tests
    // =========================================================================
    describe("2. cancelSchedule()", () => {
        const cancelInput = {
            cancellationReason: "Parts backordered indefinitely by manufacturer",
        };

        it("happy path: cancels appointment, sets dispatchStatus to PENDING_DISPATCH, and creates audit history", async () => {
            const result = await cancelSchedule(WS_ID, APPT_ID, cancelInput);

            expect(mocks.assertPermission).toHaveBeenCalledWith(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_DELETE,
            );

            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: {
                    status: "CANCELLED",
                    dispatchStatus: "PENDING_DISPATCH",
                    cancellationReason: "Parts backordered indefinitely by manufacturer",
                },
                include: expect.any(Object),
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "CANCELLED",
                    field: "status",
                    oldValue: "SCHEDULED",
                    newValue: "CANCELLED",
                    metadata: {
                        cancellationReason: "Parts backordered indefinitely by manufacturer",
                        previousDispatchStatus: "DISPATCHED",
                    },
                }),
            });

            expect(result.status).toBe("CANCELLED");
            expect(result.dispatchStatus).toBe("PENDING_DISPATCH");
        });

        it("throws ScheduleImmutableError when appointment is already CANCELLED or COMPLETED", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                status: "CANCELLED",
            });

            await expect(cancelSchedule(WS_ID, APPT_ID, cancelInput)).rejects.toThrow(
                ScheduleImmutableError,
            );

            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                status: "COMPLETED",
            });

            await expect(cancelSchedule(WS_ID, APPT_ID, cancelInput)).rejects.toThrow(
                ScheduleImmutableError,
            );
        });

        it("throws ScheduleMissingCancellationReasonError when cancellationReason is missing or whitespace", async () => {
            await expect(
                cancelSchedule(WS_ID, APPT_ID, { cancellationReason: "   " }),
            ).rejects.toThrow();
        });

        it("throws ScheduleWorkOrderNotEligibleError when parent WorkOrder is COMPLETED", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                workOrder: {
                    ...defaultWorkOrder,
                    status: "COMPLETED",
                },
            });

            await expect(cancelSchedule(WS_ID, APPT_ID, cancelInput)).rejects.toThrow(
                ScheduleWorkOrderNotEligibleError,
            );
        });

        it("rolls back transaction if history creation fails", async () => {
            mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
                const tx = {
                    scheduleAppointment: {
                        update: mocks.scheduleAppointmentUpdate,
                    },
                    scheduleAppointmentHistory: {
                        create: vi.fn().mockRejectedValue(new Error("History write failed")),
                    },
                };
                return cb(tx);
            });

            await expect(cancelSchedule(WS_ID, APPT_ID, cancelInput)).rejects.toThrow(
                "History write failed",
            );
        });
    });

    // =========================================================================
    // 3. updateSchedule() Tests
    // =========================================================================
    describe("3. updateSchedule()", () => {
        const updateInput = {
            notes: "Updated gate code: #9999",
            metadata: { gateCode: "9999", lockbox: "Left porch" },
        };

        it("happy path: updates notes and metadata without mutating interval or status", async () => {
            const result = await updateSchedule(WS_ID, APPT_ID, updateInput);

            expect(mocks.assertPermission).toHaveBeenCalledWith(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_UPDATE,
            );

            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: {
                    notes: "Updated gate code: #9999",
                    metadata: { gateCode: "9999", lockbox: "Left porch" },
                },
                include: expect.any(Object),
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "UPDATED",
                    field: "notes",
                }),
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "UPDATED",
                    field: "metadata",
                }),
            });

            expect(result.notes).toBe("Updated gate code: #9999");
            // Temporal fields remain unmodified
            expect(result.scheduledStart).toEqual(defaultAppointment.scheduledStart);
            expect(result.scheduledEnd).toEqual(defaultAppointment.scheduledEnd);
            expect(result.status).toBe("SCHEDULED");
        });

        it("throws ScheduleImmutableError when appointment is CANCELLED or COMPLETED", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...defaultAppointment,
                status: "COMPLETED",
            });

            await expect(updateSchedule(WS_ID, APPT_ID, updateInput)).rejects.toThrow(
                ScheduleImmutableError,
            );
        });

        it("throws ScheduleAppointmentNotFoundError if appointment is not found", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                updateSchedule(WS_ID, "non_existent_id", updateInput),
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);
        });
    });
});
