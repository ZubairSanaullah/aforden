import { describe, expect, it, vi, beforeEach } from "vitest";
import { startTechnicianWorkOrder } from "@/lib/services/technicianOperations/startTechnicianWorkOrder";
import { holdTechnicianWorkOrder } from "@/lib/services/technicianOperations/holdTechnicianWorkOrder";
import { resumeTechnicianWorkOrder } from "@/lib/services/technicianOperations/resumeTechnicianWorkOrder";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
} from "@/lib/services/workOrder/workOrderErrors";
import { ZodError } from "zod";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    transitionWorkOrderStatus: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),
    technicianTimeEntryFindFirst: vi.fn(),
    technicianTimeEntryUpdate: vi.fn(),
    technicianTimeEntryCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/services/workOrder/transitionWorkOrderStatus", () => ({
    transitionWorkOrderStatus: mocks.transitionWorkOrderStatus,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
            update: mocks.scheduleAppointmentUpdate,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        technicianTimeEntry: {
            findFirst: mocks.technicianTimeEntryFindFirst,
            update: mocks.technicianTimeEntryUpdate,
            create: mocks.technicianTimeEntryCreate,
        },
        $transaction: vi.fn(async (callback) => {
            return callback({
                scheduleAppointment: {
                    findFirst: mocks.scheduleAppointmentFindFirst,
                    update: mocks.scheduleAppointmentUpdate,
                },
                scheduleAppointmentHistory: {
                    create: mocks.scheduleAppointmentHistoryCreate,
                },
                technicianTimeEntry: {
                    findFirst: mocks.technicianTimeEntryFindFirst,
                    update: mocks.technicianTimeEntryUpdate,
                    create: mocks.technicianTimeEntryCreate,
                },
            });
        }),
    },
}));

describe("Phase 1.9.7 — WorkOrder Start / Hold / Resume", () => {
    const WS_ID = "ws_tenant_101";
    const WO_ID = "wo_100";
    const APPT_ID = "appt_100";
    const TECH_PROFILE_ID_1 = "tech_prof_001";

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

    const sampleWorkOrderReadModel: WorkOrderReadModel = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-000100",
        customerId: "cust_1",
        customerName: "Acme Corp",
        customerNumber: "CUST-001",
        locationId: "loc_1",
        locationName: "HQ",
        locationAddress: "123 Main St",
        workTypeId: "wt_1",
        workTypeName: "HVAC Repair",
        workTypeCode: "HVAC",
        estimatedDuration: 120,
        assignedTechnicianId: TECH_PROFILE_ID_1,
        assetId: null,
        status: "IN_PROGRESS",
        priority: "HIGH",
        title: "Fix AC",
        description: null,
        internalNotes: null,
        holdReason: null,
        cancellationReason: null,
        startedAt: new Date("2026-08-21T10:30:00Z"),
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date("2026-08-21T09:00:00Z"),
        updatedAt: new Date("2026-08-21T10:30:00Z"),
    };

    const activeTravelEntry = {
        id: "tte_travel_001",
        workspaceId: WS_ID,
        technicianProfileId: TECH_PROFILE_ID_1,
        workOrderId: WO_ID,
        appointmentId: APPT_ID,
        entryType: "TRAVEL" as const,
        status: "ACTIVE" as const,
        startedAt: new Date("2026-08-21T10:00:00Z"),
        endedAt: null,
        durationMinutes: null,
        notes: "Driving",
        createdByMemberId: "mem_tech_001",
    };

    const activeOnSiteEntry = {
        id: "tte_onsite_001",
        workspaceId: WS_ID,
        technicianProfileId: TECH_PROFILE_ID_1,
        workOrderId: WO_ID,
        appointmentId: APPT_ID,
        entryType: "ON_SITE" as const,
        status: "ACTIVE" as const,
        startedAt: new Date("2026-08-21T10:30:00Z"),
        endedAt: null,
        durationMinutes: null,
        notes: "On site work",
        createdByMemberId: "mem_tech_001",
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.transitionWorkOrderStatus.mockResolvedValue(sampleWorkOrderReadModel);
        mocks.scheduleAppointmentFindFirst.mockResolvedValue({
            id: APPT_ID,
            fieldExecutionStartedAt: null,
        });
        mocks.scheduleAppointmentUpdate.mockResolvedValue({});
        mocks.scheduleAppointmentHistoryCreate.mockResolvedValue({});
        mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);
        mocks.technicianTimeEntryUpdate.mockResolvedValue({});
        mocks.technicianTimeEntryCreate.mockResolvedValue({});
    });

    describe("1. startTechnicianWorkOrder", () => {
        it("starts work order, auto-closes active travel entry, stamps appointment, and opens on-site entry", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(activeTravelEntry);

            const result = await startTechnicianWorkOrder(techContext, WO_ID, {
                notes: "Arrived at location",
            });

            // 1. Verifies delegation to Phase 1.6 transitionWorkOrderStatus (Invariant 1)
            expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(
                WS_ID,
                WO_ID,
                { toStatus: "IN_PROGRESS" }
            );

            // 2. Verifies appointment execution lock stamping
            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                where: { id: APPT_ID },
                data: { fieldExecutionStartedAt: expect.any(Date) },
            });
            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: APPT_ID,
                    eventType: "UPDATED",
                    actorMemberId: "mem_tech_001",
                    field: "fieldExecutionStartedAt",
                }),
            });

            // 3. Verifies automatic travel entry closure (§4.1.4, §7.3)
            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                where: { id: "tte_travel_001" },
                data: {
                    endedAt: expect.any(Date),
                    durationMinutes: expect.any(Number),
                    status: "COMPLETED",
                },
            });

            // 4. Verifies creation of new ACTIVE ON_SITE time entry
            expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                    workOrderId: WO_ID,
                    appointmentId: APPT_ID,
                    entryType: "ON_SITE",
                    status: "ACTIVE",
                    startedAt: expect.any(Date),
                    endedAt: null,
                    durationMinutes: null,
                    notes: "Arrived at location",
                    createdByMemberId: "mem_tech_001",
                }),
            });

            expect(result).toEqual(sampleWorkOrderReadModel);
        });

        it("operates successfully when no prior travel entry existed (direct start)", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);

            await startTechnicianWorkOrder(techContext, WO_ID);

            expect(mocks.technicianTimeEntryUpdate).not.toHaveBeenCalled();
            expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    entryType: "ON_SITE",
                    status: "ACTIVE",
                }),
            });
        });

        it("propagates Phase 1.6 status machine errors when transition is illegal", async () => {
            mocks.transitionWorkOrderStatus.mockRejectedValue(
                new WorkOrderInvalidStatusTransitionError()
            );

            await expect(
                startTechnicianWorkOrder(techContext, WO_ID)
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("rejects non-TECHNICIAN role with ForbiddenError (403)", async () => {
            await expect(
                startTechnicianWorkOrder(adminContext, WO_ID)
            ).rejects.toThrow(ForbiddenError);

            expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
        });
    });

    describe("2. holdTechnicianWorkOrder", () => {
        it("requires holdReason and delegates transition to ON_HOLD and closes active on-site time entry", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(activeOnSiteEntry);
            const onHoldReadModel = {
                ...sampleWorkOrderReadModel,
                status: "ON_HOLD" as const,
                holdReason: "Waiting for replacement motor",
            };
            mocks.transitionWorkOrderStatus.mockResolvedValue(onHoldReadModel);

            const result = await holdTechnicianWorkOrder(techContext, WO_ID, {
                holdReason: "Waiting for replacement motor",
            });

            // 1. Verifies delegation to Phase 1.6 transitionWorkOrderStatus
            expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(
                WS_ID,
                WO_ID,
                {
                    toStatus: "ON_HOLD",
                    holdReason: "Waiting for replacement motor",
                }
            );

            // 2. Verifies closing the active on-site entry
            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                where: { id: "tte_onsite_001" },
                data: {
                    endedAt: expect.any(Date),
                    durationMinutes: expect.any(Number),
                    status: "COMPLETED",
                },
            });

            expect(result.status).toBe("ON_HOLD");
            expect(result.holdReason).toBe("Waiting for replacement motor");
        });

        it("rejects when holdReason is missing or empty", async () => {
            await expect(
                holdTechnicianWorkOrder(techContext, WO_ID, {})
            ).rejects.toThrow(ZodError);

            await expect(
                holdTechnicianWorkOrder(techContext, WO_ID, { holdReason: "   " })
            ).rejects.toThrow(ZodError);

            expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
        });

        it("rejects non-TECHNICIAN role with ForbiddenError (403)", async () => {
            await expect(
                holdTechnicianWorkOrder(adminContext, WO_ID, { holdReason: "Parts delay" })
            ).rejects.toThrow(ForbiddenError);

            expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
        });
    });

    describe("3. resumeTechnicianWorkOrder", () => {
        it("resumes work order, delegates transition to IN_PROGRESS, and opens new active on-site time entry", async () => {
            const resumedReadModel = {
                ...sampleWorkOrderReadModel,
                status: "IN_PROGRESS" as const,
                holdReason: null,
            };
            mocks.transitionWorkOrderStatus.mockResolvedValue(resumedReadModel);

            const result = await resumeTechnicianWorkOrder(techContext, WO_ID, {
                notes: "Resuming work with new parts",
            });

            // 1. Verifies delegation to Phase 1.6 transitionWorkOrderStatus
            expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(
                WS_ID,
                WO_ID,
                { toStatus: "IN_PROGRESS" }
            );

            // 2. Verifies opening new active ON_SITE time entry
            expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                    workOrderId: WO_ID,
                    entryType: "ON_SITE",
                    status: "ACTIVE",
                    startedAt: expect.any(Date),
                    endedAt: null,
                    durationMinutes: null,
                    notes: "Resuming work with new parts",
                    createdByMemberId: "mem_tech_001",
                }),
            });

            expect(result.status).toBe("IN_PROGRESS");
            expect(result.holdReason).toBeNull();
        });

        it("propagates Phase 1.6 status machine errors when resume transition is illegal", async () => {
            mocks.transitionWorkOrderStatus.mockRejectedValue(
                new WorkOrderInvalidStatusTransitionError()
            );

            await expect(
                resumeTechnicianWorkOrder(techContext, WO_ID)
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("rejects non-TECHNICIAN role with ForbiddenError (403)", async () => {
            await expect(
                resumeTechnicianWorkOrder(adminContext, WO_ID)
            ).rejects.toThrow(ForbiddenError);

            expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
        });

        it("throws WorkOrderNotFoundError for empty workOrderId", async () => {
            await expect(
                resumeTechnicianWorkOrder(techContext, "")
            ).rejects.toThrow(WorkOrderNotFoundError);
        });
    });
});
