import { describe, expect, it, vi, beforeEach } from "vitest";
import { startTechnicianTravel } from "@/lib/services/technicianOperations/startTechnicianTravel";
import { undispatchAppointment } from "@/lib/services/schedule/undispatchAppointment";
import {
    ActiveTimeEntryExistsError,
    TechnicianNotAssignedToWorkOrderError,
} from "@/lib/services/technicianOperations/technicianOperationsErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleInvalidStatusTransitionError,
    UndispatchNotAllowedError,
} from "@/lib/services/schedule/scheduleErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    workOrderFindFirst: vi.fn(),
    technicianTimeEntryFindFirst: vi.fn(),
    technicianTimeEntryCreate: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
        },
        technicianTimeEntry: {
            findFirst: mocks.technicianTimeEntryFindFirst,
            create: mocks.technicianTimeEntryCreate,
        },
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
            update: mocks.scheduleAppointmentUpdate,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
        },
        user: {
            findUnique: mocks.userFindUnique,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        $transaction: vi.fn(async (callback) => {
            return callback({
                scheduleAppointment: {
                    update: mocks.scheduleAppointmentUpdate,
                },
                scheduleAppointmentHistory: {
                    create: mocks.scheduleAppointmentHistoryCreate,
                },
                technicianTimeEntry: {
                    create: mocks.technicianTimeEntryCreate,
                },
            });
        }),
    },
}));

describe("Phase 1.9.6 — Travel / Field Execution Start (startTechnicianTravel)", () => {
    const WS_ID = "ws_tenant_101";
    const WO_ID = "wo_100";
    const APPT_ID = "appt_100";
    const TECH_PROFILE_ID_1 = "tech_prof_001";
    const TECH_PROFILE_ID_2 = "tech_prof_002";

    const techContext: TechnicianExecutionContext = {
        userId: "usr_tech_001",
        workspaceId: WS_ID,
        membershipId: "mem_tech_001",
        role: "TECHNICIAN",
        employeeId: "emp_001",
        technicianProfileId: TECH_PROFILE_ID_1,
        technicianName: "Alex Rivers",
    };

    const adminContext: TechnicianExecutionContext = {
        userId: "usr_admin_001",
        workspaceId: WS_ID,
        membershipId: "mem_admin_001",
        role: "ADMIN",
        employeeId: "emp_admin_001",
        technicianProfileId: "tech_prof_admin",
        technicianName: "Admin User",
    };

    const sampleWorkOrder = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-000100",
        status: "ASSIGNED",
        assignedTechnicianId: TECH_PROFILE_ID_1,
    };

    const sampleAppointment = {
        id: APPT_ID,
        workspaceId: WS_ID,
        workOrderId: WO_ID,
        technicianId: TECH_PROFILE_ID_1,
        status: "SCHEDULED",
        dispatchStatus: "ACKNOWLEDGED",
        fieldExecutionStartedAt: null,
    };

    const sampleCreatedTimeEntry = {
        id: "tte_001",
        workspaceId: WS_ID,
        technicianProfileId: TECH_PROFILE_ID_1,
        workOrderId: WO_ID,
        appointmentId: APPT_ID,
        entryType: "TRAVEL" as const,
        status: "ACTIVE" as const,
        startedAt: new Date("2026-08-21T10:00:00Z"),
        endedAt: null,
        durationMinutes: null,
        notes: "En route via highway 101",
        metadata: null,
        createdByMemberId: "mem_tech_001",
        createdAt: new Date("2026-08-21T10:00:00Z"),
        updatedAt: new Date("2026-08-21T10:00:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.workOrderFindFirst.mockResolvedValue(sampleWorkOrder);
        mocks.technicianTimeEntryFindFirst.mockResolvedValue(null); // No active entry
        mocks.scheduleAppointmentFindFirst.mockResolvedValue(sampleAppointment);
        mocks.scheduleAppointmentUpdate.mockResolvedValue({
            ...sampleAppointment,
            fieldExecutionStartedAt: new Date("2026-08-21T10:00:00Z"),
        });
        mocks.scheduleAppointmentHistoryCreate.mockResolvedValue({});
        mocks.technicianTimeEntryCreate.mockResolvedValue(sampleCreatedTimeEntry);
    });

    describe("1. Successful Travel Start & Execution Lock", () => {
        it("starts travel, creates ACTIVE travel time entry, and stamps fieldExecutionStartedAt inside atomic transaction", async () => {
            const result = await startTechnicianTravel(techContext, WO_ID, {
                notes: "En route via highway 101",
            });

            // 1. Precondition checks
            expect(mocks.workOrderFindFirst).toHaveBeenCalledWith({
                where: {
                    id: WO_ID,
                    workspaceId: WS_ID,
                },
                select: {
                    id: true,
                    status: true,
                    assignedTechnicianId: true,
                },
            });

            expect(mocks.technicianTimeEntryFindFirst).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                    status: "ACTIVE",
                },
                select: { id: true },
            });

            // 2. Appointment resolution & state guard
            expect(mocks.scheduleAppointmentFindFirst).toHaveBeenCalledWith({
                where: {
                    workOrderId: WO_ID,
                    workspaceId: WS_ID,
                    technicianId: TECH_PROFILE_ID_1,
                    status: { not: "CANCELLED" },
                },
                select: {
                    id: true,
                    dispatchStatus: true,
                    fieldExecutionStartedAt: true,
                },
            });

            // 3. Appointment execution stamping (§4.1.2)
            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: {
                    fieldExecutionStartedAt: expect.any(Date),
                },
            });

            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "UPDATED",
                    actorMemberId: "mem_tech_001",
                    actorName: "Alex Rivers",
                    field: "fieldExecutionStartedAt",
                    oldValue: null,
                    newValue: expect.any(String),
                }),
            });

            // 4. Time Entry Creation (§7.2)
            expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                    workOrderId: WO_ID,
                    appointmentId: APPT_ID,
                    entryType: "TRAVEL",
                    status: "ACTIVE",
                    startedAt: expect.any(Date),
                    endedAt: null,
                    durationMinutes: null,
                    notes: "En route via highway 101",
                    createdByMemberId: "mem_tech_001",
                }),
            });

            // 5. Return DTO
            expect(result).toEqual({
                id: "tte_001",
                workspaceId: WS_ID,
                technicianProfileId: TECH_PROFILE_ID_1,
                workOrderId: WO_ID,
                appointmentId: APPT_ID,
                entryType: "TRAVEL",
                status: "ACTIVE",
                startedAt: sampleCreatedTimeEntry.startedAt,
                endedAt: null,
                durationMinutes: null,
                notes: "En route via highway 101",
                metadata: null,
                createdByMemberId: "mem_tech_001",
                createdAt: sampleCreatedTimeEntry.createdAt,
                updatedAt: sampleCreatedTimeEntry.updatedAt,
            });
        });
    });

    describe("2. Appointment Resolution & Dispatch Status Preconditions (§4)", () => {
        it("throws ScheduleAppointmentNotFoundError (404) if no scheduled appointment exists for the work order", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                startTechnicianTravel(techContext, WO_ID)
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
            expect(mocks.scheduleAppointmentUpdate).not.toHaveBeenCalled();
        });

        it("throws ScheduleInvalidStatusTransitionError (409) if appointment dispatchStatus is not ACKNOWLEDGED", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...sampleAppointment,
                dispatchStatus: "DISPATCHED", // not yet acknowledged
            });

            await expect(
                startTechnicianTravel(techContext, WO_ID)
            ).rejects.toThrow(ScheduleInvalidStatusTransitionError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
            expect(mocks.scheduleAppointmentUpdate).not.toHaveBeenCalled();
        });
    });

    describe("3. Single Active Time Entry Rule (§7.3)", () => {
        it("throws ActiveTimeEntryExistsError (409) if technician already has an active entry", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue({ id: "tte_existing_active" });

            await expect(
                startTechnicianTravel(techContext, WO_ID)
            ).rejects.toThrow(ActiveTimeEntryExistsError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
            expect(mocks.scheduleAppointmentUpdate).not.toHaveBeenCalled();
        });
    });

    describe("4. WorkOrder Preconditions & Assignment Guards", () => {
        it("throws WorkOrderInvalidStatusTransitionError (409) if WorkOrder is not in ASSIGNED status", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...sampleWorkOrder,
                status: "IN_PROGRESS",
            });

            await expect(
                startTechnicianTravel(techContext, WO_ID)
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("throws TechnicianNotAssignedToWorkOrderError (403) if WorkOrder is assigned to another technician", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...sampleWorkOrder,
                assignedTechnicianId: TECH_PROFILE_ID_2,
            });

            await expect(
                startTechnicianTravel(techContext, WO_ID)
            ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("throws WorkOrderNotFoundError (404) if WorkOrder does not exist in workspace", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                startTechnicianTravel(techContext, "non_existent_wo")
            ).rejects.toThrow(WorkOrderNotFoundError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("rejects non-TECHNICIAN role with ForbiddenError (403)", async () => {
            await expect(
                startTechnicianTravel(adminContext, WO_ID)
            ).rejects.toThrow(ForbiddenError);

            expect(mocks.workOrderFindFirst).not.toHaveBeenCalled();
        });
    });

    describe("5. Integration: Field Execution Stamping Locks Undispatch", () => {
        it("proves fieldExecutionStartedAt locks undispatchAppointment with UndispatchNotAllowedError", async () => {
            // Mock auth for Phase 1.8 undispatchAppointment
            mocks.auth.mockResolvedValue({
                user: { id: "usr_dispatcher", email: "dispatcher@acme.com" },
            });
            mocks.userFindUnique.mockResolvedValue({
                id: "usr_dispatcher",
                status: "ACTIVE",
            });
            mocks.workspaceFindUnique.mockResolvedValue({
                id: WS_ID,
            });
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                id: "mem_dispatcher",
                userId: "usr_dispatcher",
                workspaceId: WS_ID,
                role: "DISPATCHER",
                status: "ACTIVE",
            });

            // Appointment now has fieldExecutionStartedAt set because technician started travel
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                id: APPT_ID,
                workspaceId: WS_ID,
                dispatchStatus: "ACKNOWLEDGED",
                fieldExecutionStartedAt: new Date("2026-08-21T10:00:00Z"),
                workOrder: { id: WO_ID, workOrderNumber: "WO-100", title: "WO Title", status: "ASSIGNED", priority: "HIGH" },
                technician: { id: TECH_PROFILE_ID_1, employee: { user: { name: "Alex Rivers" }, employeeNumber: "EMP-001" } },
                customer: { id: "cust_1", name: "Customer", customerNumber: "C-1" },
                location: { id: "loc_1", name: "Location", addressLine1: "123 St", addressLine2: null, city: "City", state: "ST", postalCode: "12345", country: "US", latitude: null, longitude: null },
            });

            await expect(
                undispatchAppointment(WS_ID, APPT_ID, { reason: "Customer reschedule" })
            ).rejects.toThrow(UndispatchNotAllowedError);
        });
    });
});
