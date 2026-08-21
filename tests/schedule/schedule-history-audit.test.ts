import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSchedule } from "@/lib/services/schedule/createSchedule";
import { rescheduleSchedule } from "@/lib/services/schedule/rescheduleSchedule";
import { cancelSchedule } from "@/lib/services/schedule/cancelSchedule";
import { updateSchedule } from "@/lib/services/schedule/updateSchedule";
import { dispatchAppointment } from "@/lib/services/schedule/dispatchAppointment";
import { undispatchAppointment } from "@/lib/services/schedule/undispatchAppointment";
import { acknowledgeDispatch } from "@/lib/services/schedule/acknowledgeDispatch";
import { getAppointmentHistory } from "@/lib/services/schedule/getAppointmentHistory";
import { recordScheduleHistory } from "@/lib/services/schedule/recordScheduleHistory";
import { ScheduleAppointmentNotFoundError } from "@/lib/services/schedule/scheduleErrors";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";

const mocks = vi.hoisted(() => ({
    requireWorkspaceAuthorization: vi.fn(),
    assertPermission: vi.fn(),

    workOrderFindFirst: vi.fn(),
    technicianProfileFindFirst: vi.fn(),

    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentCreate: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentCount: vi.fn(),

    scheduleAppointmentHistoryCreate: vi.fn(),
    scheduleAppointmentHistoryFindMany: vi.fn(),
    scheduleAppointmentHistoryCount: vi.fn(),

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
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
        },
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
            findMany: mocks.scheduleAppointmentFindMany,
            create: mocks.scheduleAppointmentCreate,
            update: mocks.scheduleAppointmentUpdate,
            count: mocks.scheduleAppointmentCount,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
            findMany: mocks.scheduleAppointmentHistoryFindMany,
            count: mocks.scheduleAppointmentHistoryCount,
        },
        $transaction: mocks.$transaction,
    },
}));

describe("Phase 1.8.10 — Scheduling Operational History & Audit Architecture", () => {
    const WS_ID = "ws_audit_test";
    const WO_ID = "wo_audit_01";
    const TECH_ID = "tech_audit_01";
    const APPT_ID = "apt_audit_01";
    const MEMBER_ID = "mem_auditor_01";

    const adminAuth = {
        membership: {
            id: MEMBER_ID,
            role: "ADMIN",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_auditor_01",
            name: "Audit Dispatcher",
            email: "auditor@aforden.com",
        },
        workspace: {
            id: WS_ID,
            timezone: "America/New_York",
        },
    };

    const techAuth = {
        membership: {
            id: MEMBER_ID,
            role: "TECHNICIAN",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_tech_01",
            name: "Sarah Technician",
            email: "tech@aforden.com",
        },
        workspace: {
            id: WS_ID,
            timezone: "America/New_York",
        },
    };

    const baseWorkOrder = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-2026-000999",
        title: "HVAC Audit Service",
        status: "ASSIGNED",
        priority: "HIGH",
        customerId: "cust_01",
        locationId: "loc_01",
        assignedTechnicianId: TECH_ID,
        customer: { id: "cust_01", name: "Audit Corp" },
        location: { id: "loc_01", name: "HQ", timezone: "America/New_York" },
        asset: null,
    };

    const baseTechnician = {
        id: TECH_ID,
        employeeId: "emp_tech_01",
        employee: {
            id: "emp_tech_01",
            workspaceId: WS_ID,
            displayName: "Sarah Technician",
            employeeNumber: "TECH-99",
            status: "ACTIVE",
        },
        technicianAvailabilities: [
            {
                id: "avail_1",
                dayOfWeek: 3, // Wednesday
                startTime: "08:00",
                endTime: "18:00",
            },
        ],
        technicianAvailabilityExceptions: [],
    };

    const baseAppointment: any = {
        id: APPT_ID,
        workspaceId: WS_ID,
        appointmentNumber: "APT-2026-000999",
        workOrderId: WO_ID,
        technicianId: TECH_ID,
        scheduledStart: new Date("2026-08-26T14:00:00.000Z"),
        scheduledEnd: new Date("2026-08-26T16:00:00.000Z"),
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
        notes: "Initial note",
        metadata: { priority: "normal" },
        createdAt: new Date("2026-08-26T08:00:00.000Z"),
        updatedAt: new Date("2026-08-26T08:00:00.000Z"),
        workOrder: baseWorkOrder,
        technician: baseTechnician,
        dispatchedByMember: null,
        undispatchedByMember: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.requireWorkspaceAuthorization.mockResolvedValue(adminAuth);
        mocks.assertPermission.mockReturnValue(true);
        mocks.workOrderFindFirst.mockResolvedValue(baseWorkOrder);
        mocks.technicianProfileFindFirst.mockResolvedValue(baseTechnician);
        mocks.scheduleAppointmentFindFirst.mockResolvedValue(baseAppointment);
        mocks.scheduleAppointmentFindMany.mockResolvedValue([]);
        mocks.scheduleAppointmentCreate.mockResolvedValue(baseAppointment);
        mocks.scheduleAppointmentUpdate.mockResolvedValue(baseAppointment);
        mocks.scheduleAppointmentCount.mockResolvedValue(1);

        mocks.scheduleAppointmentHistoryCreate.mockResolvedValue({
            id: "hist_01",
            workspaceId: WS_ID,
            appointmentId: APPT_ID,
            eventType: "CREATED",
            actorMemberId: MEMBER_ID,
            actorName: "Audit Dispatcher",
            createdAt: new Date("2026-08-26T08:00:00.000Z"),
        });

        mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
            const tx = {
                scheduleAppointment: {
                    findFirst: mocks.scheduleAppointmentFindFirst,
                    create: mocks.scheduleAppointmentCreate,
                    update: mocks.scheduleAppointmentUpdate,
                },
                scheduleAppointmentHistory: {
                    create: mocks.scheduleAppointmentHistoryCreate,
                },
            };
            return cb(tx);
        });
    });

    // =========================================================================
    // 1. Canonical Writer & Transactional Atomicity (§12 Step 6, §15)
    // =========================================================================
    describe("1. Canonical Writer & Transactional Atomicity", () => {
        it("recordScheduleHistory writes canonical fields with transactional client", async () => {
            const fakeTx = {
                scheduleAppointmentHistory: {
                    create: vi.fn().mockResolvedValue({ id: "hist_test" }),
                },
            };

            await recordScheduleHistory(fakeTx as any, {
                workspaceId: WS_ID,
                appointmentId: APPT_ID,
                eventType: "CREATED",
                actorMemberId: MEMBER_ID,
                actorName: "Audit Dispatcher",
                field: "scheduledInterval",
                oldValue: "old",
                newValue: "new",
                metadata: { key: "val" },
            });

            expect(fakeTx.scheduleAppointmentHistory.create).toHaveBeenCalledWith({
                data: {
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "CREATED",
                    actorMemberId: MEMBER_ID,
                    actorName: "Audit Dispatcher",
                    field: "scheduledInterval",
                    oldValue: "old",
                    newValue: "new",
                    metadata: { key: "val" },
                },
            });
        });

        it("recordScheduleHistory throws an error when passed a null or malformed transaction client", async () => {
            await expect(
                recordScheduleHistory(null as any, {
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "CREATED",
                }),
            ).rejects.toThrow("recordScheduleHistory requires a valid Prisma transaction client");

            await expect(
                recordScheduleHistory({} as any, {
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "CREATED",
                }),
            ).rejects.toThrow("recordScheduleHistory requires a valid Prisma transaction client");
        });

        it("createSchedule: history-write failure causes transaction rollback and service rejection", async () => {
            // Mock history creation throwing inside transaction
            mocks.scheduleAppointmentHistoryCreate.mockRejectedValue(
                new Error("Database disk full during audit write"),
            );

            await expect(
                createSchedule(WS_ID, {
                    workOrderId: WO_ID,
                    technicianId: TECH_ID,
                    scheduledStart: "2026-08-26T14:00:00.000Z",
                    scheduledEnd: "2026-08-26T16:00:00.000Z",
                }),
            ).rejects.toThrow("Database disk full during audit write");
        });

        it("rescheduleSchedule: history-write failure causes transaction rollback and service rejection", async () => {
            mocks.scheduleAppointmentHistoryCreate.mockRejectedValue(
                new Error("Audit history constraint violation"),
            );

            await expect(
                rescheduleSchedule(WS_ID, APPT_ID, {
                    scheduledStart: "2026-08-26T15:00:00.000Z",
                    scheduledEnd: "2026-08-26T17:00:00.000Z",
                    reason: "Customer request",
                }),
            ).rejects.toThrow("Audit history constraint violation");
        });

        it("dispatchAppointment: history-write failure causes transaction rollback and service rejection", async () => {
            mocks.scheduleAppointmentHistoryCreate.mockRejectedValue(
                new Error("Audit write failed"),
            );

            await expect(dispatchAppointment(WS_ID, APPT_ID)).rejects.toThrow(
                "Audit write failed",
            );
        });
    });

    // =========================================================================
    // 2. ScheduleHistoryEventType Reachability Across All Mutation Paths
    // =========================================================================
    describe("2. ScheduleHistoryEventType Reachability Across All Mutation Paths", () => {
        it("exercises CREATED event in createSchedule()", async () => {
            await createSchedule(WS_ID, {
                workOrderId: WO_ID,
                technicianId: TECH_ID,
                scheduledStart: "2026-08-26T14:00:00.000Z",
                scheduledEnd: "2026-08-26T16:00:00.000Z",
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "CREATED",
                        actorMemberId: MEMBER_ID,
                        actorName: "Audit Dispatcher",
                    }),
                }),
            );
        });

        it("exercises RESCHEDULED event in rescheduleSchedule()", async () => {
            await rescheduleSchedule(WS_ID, APPT_ID, {
                scheduledStart: "2026-08-26T15:00:00.000Z",
                scheduledEnd: "2026-08-26T17:00:00.000Z",
                reason: "Weather delay",
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "RESCHEDULED",
                        field: "scheduledInterval",
                        actorMemberId: MEMBER_ID,
                    }),
                }),
            );
        });

        it("exercises CANCELLED event in cancelSchedule()", async () => {
            await cancelSchedule(WS_ID, APPT_ID, {
                cancellationReason: "Customer canceled service request",
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "CANCELLED",
                        field: "status",
                        oldValue: "SCHEDULED",
                        newValue: "CANCELLED",
                    }),
                }),
            );
        });

        it("exercises UPDATED event in updateSchedule() — single and multi-field updates emit one row per field", async () => {
            await updateSchedule(WS_ID, APPT_ID, {
                notes: "Updated safety precautions",
                metadata: { priority: "critical", hazard: "high" },
            });

            // Expect two distinct history creates, one for notes and one for metadata
            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "UPDATED",
                        field: "notes",
                        oldValue: "Initial note",
                        newValue: "Updated safety precautions",
                    }),
                }),
            );

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "UPDATED",
                        field: "metadata",
                        oldValue: JSON.stringify({ priority: "normal" }),
                        newValue: JSON.stringify({ priority: "critical", hazard: "high" }),
                    }),
                }),
            );
        });

        it("exercises DISPATCHED event in dispatchAppointment()", async () => {
            await dispatchAppointment(WS_ID, APPT_ID, {
                notes: "Priority dispatch",
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "DISPATCHED",
                        field: "dispatchStatus",
                        newValue: "DISPATCHED",
                    }),
                }),
            );
        });

        it("exercises UNDISPATCHED event in undispatchAppointment()", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...baseAppointment,
                dispatchStatus: "DISPATCHED",
            });

            await undispatchAppointment(WS_ID, APPT_ID, {
                reason: "Emergency call reassignment",
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "UNDISPATCHED",
                        field: "dispatchStatus",
                        newValue: "PENDING_DISPATCH",
                    }),
                }),
            );
        });

        it("exercises UPDATED event in acknowledgeDispatch()", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue(techAuth);
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...baseAppointment,
                dispatchStatus: "DISPATCHED",
            });

            await acknowledgeDispatch(WS_ID, APPT_ID, {
                notes: "En route to location",
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "UPDATED",
                        field: "dispatchStatus",
                        newValue: "ACKNOWLEDGED",
                    }),
                }),
            );
        });
    });

    // =========================================================================
    // 3. getAppointmentHistory() Query Service Tests
    // =========================================================================
    describe("3. getAppointmentHistory() Query Service", () => {
        it("happy path: returns chronological audit history with complete pagination metadata", async () => {
            const auditEntries = [
                {
                    id: "hist_1",
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "CREATED",
                    actorMemberId: MEMBER_ID,
                    actorName: "Audit Dispatcher",
                    field: null,
                    oldValue: null,
                    newValue: null,
                    metadata: { duration: 120 },
                    createdAt: new Date("2026-08-26T08:00:00.000Z"),
                },
                {
                    id: "hist_2",
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "DISPATCHED",
                    actorMemberId: MEMBER_ID,
                    actorName: "Audit Dispatcher",
                    field: "dispatchStatus",
                    oldValue: "PENDING_DISPATCH",
                    newValue: "DISPATCHED",
                    metadata: null,
                    createdAt: new Date("2026-08-26T08:30:00.000Z"),
                },
            ];

            mocks.scheduleAppointmentHistoryFindMany.mockResolvedValue(auditEntries);
            mocks.scheduleAppointmentHistoryCount.mockResolvedValue(2);

            const result = await getAppointmentHistory(WS_ID, APPT_ID, {
                page: 1,
                limit: 10,
            });

            expect(mocks.scheduleAppointmentFindFirst).toHaveBeenCalledWith({
                where: { id: APPT_ID, workspaceId: WS_ID },
                select: { id: true },
            });

            expect(mocks.scheduleAppointmentHistoryFindMany).toHaveBeenCalledWith({
                where: { workspaceId: WS_ID, appointmentId: APPT_ID },
                orderBy: { createdAt: "asc" },
                skip: 0,
                take: 10,
            });

            expect(result.items).toHaveLength(2);
            expect(result.items[0].eventType).toBe("CREATED");
            expect(result.items[1].eventType).toBe("DISPATCHED");
            expect(result.pagination.total).toBe(2);
            expect(result.pagination.totalPages).toBe(1);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("throws ScheduleAppointmentNotFoundError if appointment does not exist in workspace (Tenant Isolation)", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                getAppointmentHistory(WS_ID, "non_existent_or_cross_tenant_appt"),
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);
        });

        it("rejects invalid pagination parameters via schema validation", async () => {
            await expect(
                getAppointmentHistory(WS_ID, APPT_ID, {
                    page: 0, // min 1
                }),
            ).rejects.toThrow();
        });
    });
});
