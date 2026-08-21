import { describe, expect, it, vi, beforeEach } from "vitest";
import { acknowledgeTechnicianDispatch } from "@/lib/services/technicianOperations/acknowledgeTechnicianDispatch";
import { TechnicianNotAssignedToWorkOrderError } from "@/lib/services/technicianOperations/technicianOperationsErrors";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleInvalidStatusTransitionError,
} from "@/lib/services/schedule/scheduleErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";
import type { ScheduleAppointmentReadModel } from "@/lib/services/schedule/schedule.types";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    acknowledgeDispatch: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
        },
    },
}));

vi.mock("@/lib/services/schedule/acknowledgeDispatch", () => ({
    acknowledgeDispatch: mocks.acknowledgeDispatch,
}));

describe("Phase 1.9.5 — Dispatch Acknowledgment (acknowledgeTechnicianDispatch)", () => {
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

    const nonTechContext: TechnicianExecutionContext = {
        userId: "usr_non_tech_001",
        workspaceId: WS_ID,
        membershipId: "mem_non_tech_001",
        role: "ADMIN",
        employeeId: "emp_non_tech_001",
        technicianProfileId: "tech_prof_non_tech",
        technicianName: "Non-Tech User",
    };

    const sampleAcknowledgedReadModel: ScheduleAppointmentReadModel = {
        id: APPT_ID,
        workspaceId: WS_ID,
        appointmentNumber: "APT-000100",
        workOrderId: WO_ID,
        workOrderNumber: "WO-000100",
        workOrderTitle: "Annual HVAC Preventative Maintenance",
        workOrderStatus: "ASSIGNED",
        workOrderPriority: "HIGH",
        customerId: "cust_1",
        customerName: "Acme Industrial",
        customerNumber: "CUST-001",
        locationId: "loc_1",
        locationName: "Headquarters Plant",
        locationAddress: "100 Industrial Parkway, Suite 400, Metropolis, NY, 10001, USA",
        locationLatitude: null,
        locationLongitude: null,
        assetId: null,
        assetName: null,
        assetNumber: null,
        technicianId: TECH_PROFILE_ID_1,
        technicianName: "Alex Rivers",
        technicianEmployeeNumber: "EMP-001",
        scheduledStart: new Date("2026-08-21T10:00:00Z"),
        scheduledEnd: new Date("2026-08-21T12:00:00Z"),
        durationMinutes: 120,
        timezone: "America/New_York",
        status: "SCHEDULED",
        dispatchStatus: "ACKNOWLEDGED",
        dispatchedAt: new Date("2026-08-21T09:30:00Z"),
        dispatchedByMemberId: "mem_dispatcher_001",
        dispatchedByName: "Dispatcher Dan",
        undispatchedAt: null,
        undispatchedByMemberId: null,
        fieldExecutionStartedAt: null,
        cancellationReason: null,
        notes: null,
        metadata: null,
        createdAt: new Date("2026-08-21T09:00:00Z"),
        updatedAt: new Date("2026-08-21T09:45:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Default: Found dispatched appointment assigned to TECH_PROFILE_ID_1
        mocks.scheduleAppointmentFindFirst.mockResolvedValue({
            id: APPT_ID,
            technicianId: TECH_PROFILE_ID_1,
            dispatchStatus: "DISPATCHED",
        });

        // Default: Phase 1.8 service returns acknowledged read model
        mocks.acknowledgeDispatch.mockResolvedValue(sampleAcknowledgedReadModel);
    });

    describe("1. Successful Acknowledgment & Delegation", () => {
        it("validates technician assignment and delegates to Phase 1.8 acknowledgeDispatch", async () => {
            const result = await acknowledgeTechnicianDispatch(techContext, WO_ID, APPT_ID, {
                notes: "En route shortly",
            });

            expect(mocks.scheduleAppointmentFindFirst).toHaveBeenCalledWith({
                where: {
                    id: APPT_ID,
                    workOrderId: WO_ID,
                    workspaceId: WS_ID,
                },
                select: {
                    id: true,
                    technicianId: true,
                    dispatchStatus: true,
                },
            });

            // Confirms exact delegation to Phase 1.8 service with tenant workspaceId and appointmentId
            expect(mocks.acknowledgeDispatch).toHaveBeenCalledWith(WS_ID, APPT_ID, {
                notes: "En route shortly",
            });

            expect(result).toEqual(sampleAcknowledgedReadModel);
            expect(result.dispatchStatus).toBe("ACKNOWLEDGED");
            expect(result.workOrderStatus).toBe("ASSIGNED"); // Invariant: WO status remains ASSIGNED
        });
    });

    describe("2. Technician Identity & Assignment Guards", () => {
        it("throws TechnicianNotAssignedToWorkOrderError (403) when caller is not the assigned technician", async () => {
            // Appointment is assigned to TECH_PROFILE_ID_2, but caller is TECH_PROFILE_ID_1
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                id: APPT_ID,
                technicianId: TECH_PROFILE_ID_2,
                dispatchStatus: "DISPATCHED",
            });

            await expect(
                acknowledgeTechnicianDispatch(techContext, WO_ID, APPT_ID)
            ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);

            expect(mocks.acknowledgeDispatch).not.toHaveBeenCalled();
        });

        it("rejects non-TECHNICIAN roles with ForbiddenError (403)", async () => {
            // Administrative users acknowledge dispatch via Phase 1.8 administrative path, not technician operations
            await expect(
                acknowledgeTechnicianDispatch(nonTechContext, WO_ID, APPT_ID)
            ).rejects.toThrow(ForbiddenError);

            expect(mocks.scheduleAppointmentFindFirst).not.toHaveBeenCalled();
            expect(mocks.acknowledgeDispatch).not.toHaveBeenCalled();
        });
    });

    describe("3. Entity Resolution, Linkage & Tenant Isolation", () => {
        it("throws ScheduleAppointmentNotFoundError (404) when appointment does not exist in workspace", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                acknowledgeTechnicianDispatch(techContext, WO_ID, "non_existent_appt")
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);

            expect(mocks.acknowledgeDispatch).not.toHaveBeenCalled();
        });

        it("throws ScheduleAppointmentNotFoundError (404) when appointment does not match workOrderId", async () => {
            // Prisma findFirst returns null because workOrderId condition doesn't match
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                acknowledgeTechnicianDispatch(techContext, "wrong_wo_id", APPT_ID)
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);

            expect(mocks.acknowledgeDispatch).not.toHaveBeenCalled();
        });

        it("throws ScheduleAppointmentNotFoundError (404) for empty or whitespace IDs", async () => {
            await expect(
                acknowledgeTechnicianDispatch(techContext, "", APPT_ID)
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);

            await expect(
                acknowledgeTechnicianDispatch(techContext, WO_ID, "   ")
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);

            expect(mocks.scheduleAppointmentFindFirst).not.toHaveBeenCalled();
        });
    });

    describe("4. State Machine Invariants & Downstream Delegation Errors", () => {
        it("propagates ScheduleInvalidStatusTransitionError (409) if appointment is not DISPATCHED", async () => {
            mocks.acknowledgeDispatch.mockRejectedValue(
                new ScheduleInvalidStatusTransitionError(
                    "Appointment must be in DISPATCHED status to acknowledge receipt.",
                    "ACKNOWLEDGED",
                    "ACKNOWLEDGED"
                )
            );

            await expect(
                acknowledgeTechnicianDispatch(techContext, WO_ID, APPT_ID)
            ).rejects.toThrow(ScheduleInvalidStatusTransitionError);
        });
    });
});
