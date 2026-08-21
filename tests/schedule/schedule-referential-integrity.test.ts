import { describe, expect, it, vi, beforeEach } from "vitest";
import { deleteWorkOrder } from "@/lib/services/workOrder/deleteWorkOrder";
import { deleteTechnicianProfile } from "@/lib/services/technicianProfile/deleteTechnicianProfile";
import { toScheduleAppointmentReadModel } from "@/lib/services/schedule/scheduleReadModel";
import { dispatchAppointment } from "@/lib/services/schedule/dispatchAppointment";
import { rescheduleSchedule } from "@/lib/services/schedule/rescheduleSchedule";
import { assertTechnicianEligibleForDeactivation } from "@/lib/services/schedule/assertTechnicianEligibleForDeactivation";
import {
    ScheduleTechnicianNotEligibleError,
    ScheduleTechnicianActiveBookingsError,
    ScheduleDeletionNotAllowedError,
} from "@/lib/services/schedule/scheduleErrors";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";

const mocks = vi.hoisted(() => ({
    requireWorkspaceAuthorization: vi.fn(),
    assertPermission: vi.fn(),

    workOrderFindFirst: vi.fn(),
    workOrderDelete: vi.fn(),
    workOrderHistoryCreate: vi.fn(),

    technicianProfileFindFirst: vi.fn(),
    technicianProfileDelete: vi.fn(),

    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),

    workspaceMemberDelete: vi.fn(),

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
            delete: mocks.workOrderDelete,
        },
        workOrderHistory: {
            create: mocks.workOrderHistoryCreate,
        },
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
            delete: mocks.technicianProfileDelete,
        },
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
            findMany: mocks.scheduleAppointmentFindMany,
            update: mocks.scheduleAppointmentUpdate,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        workspaceMember: {
            delete: mocks.workspaceMemberDelete,
        },
        $transaction: mocks.$transaction,
    },
}));

describe("Phase 1.8.9 — Scheduling Referential Integrity & Historical Safety", () => {
    const WS_ID = "ws_safety_test";
    const WO_ID = "wo_safety_01";
    const TECH_ID = "tech_safety_01";
    const APPT_ID = "apt_safety_01";
    const MEMBER_ID = "mem_dispatcher_01";

    const adminAuth = {
        membership: {
            id: MEMBER_ID,
            role: "ADMIN",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_admin_01",
            name: "Admin User",
            email: "admin@aforden.com",
        },
        workspace: {
            id: WS_ID,
            timezone: "America/New_York",
        },
    };

    const baseWorkOrder = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-2026-000900",
        title: "Generator Overhaul",
        status: "CANCELLED",
        priority: "HIGH",
        customerId: "cust_01",
        locationId: "loc_01",
        assignedTechnicianId: TECH_ID,
        customer: {
            id: "cust_01",
            name: "Alpha Corp",
            customerNumber: "CUST-001",
        },
        location: {
            id: "loc_01",
            name: "Alpha HQ",
            addressLine1: "100 Tech Blvd",
            addressLine2: null,
            city: "New York",
            state: "NY",
            postalCode: "10001",
            country: "USA",
            latitude: "40.7128",
            longitude: "-74.0060",
            timezone: "America/New_York",
        },
        asset: null,
    };

    const baseTechnician = {
        id: TECH_ID,
        employeeId: "emp_01",
        employee: {
            id: "emp_01",
            workspaceId: WS_ID,
            displayName: "Mark Technician",
            employeeNumber: "TECH-001",
            status: "ACTIVE",
        },
        technicianAvailabilities: [],
        technicianAvailabilityExceptions: [],
    };

    const baseAppointment: any = {
        id: APPT_ID,
        workspaceId: WS_ID,
        appointmentNumber: "APT-2026-000900",
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
        notes: "Safety inspection",
        metadata: null,
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

        mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
            const tx = {
                workOrder: {
                    delete: mocks.workOrderDelete,
                },
                workOrderHistory: {
                    create: mocks.workOrderHistoryCreate,
                },
                technicianProfile: {
                    delete: mocks.technicianProfileDelete,
                },
                scheduleAppointment: {
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
    // 1. WorkOrder & Technician Restrict Deletion Verification
    // =========================================================================
    describe("1. Referential Action Verification (Restrict)", () => {
        it("rejects WorkOrder deletion via deleteWorkOrder() service when ScheduleAppointment rows exist (Restrict)", async () => {
            // deleteWorkOrder calls requireWorkspaceAuthorization, assertPermission, findFirst, and inside transaction tx.workOrder.delete
            mocks.workOrderDelete.mockRejectedValue(
                new Error("Foreign key constraint violated: ScheduleAppointment (Restrict)"),
            );

            await expect(deleteWorkOrder(WS_ID, WO_ID)).rejects.toThrow(
                "Foreign key constraint violated",
            );
        });

        it("rejects TechnicianProfile deletion via deleteTechnicianProfile() service when ScheduleAppointment rows exist (Restrict)", async () => {
            // deleteTechnicianProfile calls requireWorkspaceAuthorization, assertPermission, findFirst, and prisma.technicianProfile.delete
            mocks.technicianProfileDelete.mockRejectedValue(
                new Error("Foreign key constraint violated: ScheduleAppointment.technicianId (Restrict)"),
            );

            await expect(
                deleteTechnicianProfile(WS_ID, TECH_ID),
            ).rejects.toThrow("Foreign key constraint violated");
        });
    });

    // =========================================================================
    // 2. Member Deletion SetNull & Read Model Safety
    // =========================================================================
    describe("2. WorkspaceMember Deletion & SetNull Read Safety", () => {
        it("ScheduleAppointment read model safely projects when dispatchedByMember has been deleted (SetNull)", () => {
            const apptWithDeletedMember: any = {
                ...baseAppointment,
                dispatchStatus: "DISPATCHED",
                dispatchedAt: new Date("2026-08-26T09:00:00.000Z"),
                dispatchedByMemberId: null, // Nullified by SetNull
                dispatchedByMember: null,   // Relation null
            };

            const readModel = toScheduleAppointmentReadModel(apptWithDeletedMember);

            expect(readModel.dispatchStatus).toBe("DISPATCHED");
            expect(readModel.dispatchedAt).toEqual(new Date("2026-08-26T09:00:00.000Z"));
            expect(readModel.dispatchedByMemberId).toBeNull();
            expect(readModel.dispatchedByName).toBeNull();
        });
    });

    // =========================================================================
    // 3. Technician Deactivation Safety & Downstream Operation Protection
    // =========================================================================
    describe("3. Technician Deactivation Safety & Downstream Integrity", () => {
        it("assertTechnicianEligibleForDeactivation: blocks deactivation when technician has future active appointments", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "apt_future_01",
                    appointmentNumber: "APT-2026-000901",
                    scheduledStart: new Date("2026-08-27T10:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-27T12:00:00.000Z"),
                },
                {
                    id: "apt_future_02",
                    appointmentNumber: "APT-2026-000902",
                    scheduledStart: new Date("2026-08-28T14:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-28T16:00:00.000Z"),
                },
            ]);

            await expect(
                assertTechnicianEligibleForDeactivation(
                    prisma,
                    WS_ID,
                    TECH_ID,
                    new Date("2026-08-26T00:00:00.000Z"),
                ),
            ).rejects.toThrow(ScheduleTechnicianActiveBookingsError);
        });

        it("assertTechnicianEligibleForDeactivation: permits deactivation when technician has 0 future active appointments", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);

            const result = await assertTechnicianEligibleForDeactivation(
                prisma,
                WS_ID,
                TECH_ID,
                new Date("2026-08-26T00:00:00.000Z"),
            );

            expect(result.eligible).toBe(true);
            expect(result.activeCount).toBe(0);
        });

        it("blocks dispatch of existing appointment if technician employee status became INACTIVE", async () => {
            // Appointment was scheduled when technician was active, but technician is now INACTIVE
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...baseAppointment,
                workOrder: {
                    ...baseWorkOrder,
                    status: "ASSIGNED",
                },
            });

            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...baseTechnician,
                employee: {
                    ...baseTechnician.employee,
                    status: "INACTIVE",
                },
            });

            await expect(dispatchAppointment(WS_ID, APPT_ID)).rejects.toThrow(
                ScheduleTechnicianNotEligibleError,
            );
        });

        it("blocks reschedule of appointment if technician employee status became INACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...baseTechnician,
                employee: {
                    ...baseTechnician.employee,
                    status: "INACTIVE",
                },
            });

            await expect(
                rescheduleSchedule(WS_ID, APPT_ID, {
                    scheduledStart: "2026-08-26T15:00:00.000Z",
                    scheduledEnd: "2026-08-26T17:00:00.000Z",
                    reason: "Attempted reschedule with inactive technician",
                }),
            ).rejects.toThrow(ScheduleTechnicianNotEligibleError);
        });
    });

    // =========================================================================
    // 4. Parent WorkOrder Mutation & Timezone Frozen Snapshot (3NF Tradeoff)
    // =========================================================================
    describe("4. Historical Timezone Snapshotting vs Live 3NF Traversal", () => {
        it("preserves creation-time snapshot timezone on ScheduleAppointment when parent location changes", () => {
            // Parent WorkOrder location changed from America/New_York to Europe/London
            const modifiedParentAppointment: any = {
                ...baseAppointment,
                timezone: "America/New_York", // Creation snapshot remains frozen
                workOrder: {
                    ...baseWorkOrder,
                    location: {
                        ...baseWorkOrder.location,
                        name: "London Facility",
                        timezone: "Europe/London", // Live location timezone altered later
                    },
                },
            };

            const readModel = toScheduleAppointmentReadModel(modifiedParentAppointment);

            // Read model preserves frozen appointment timezone for calendar stability
            expect(readModel.timezone).toBe("America/New_York");
            // Live customer and location attributes project updated values in 3NF
            expect(readModel.locationName).toBe("London Facility");
        });
    });

    // =========================================================================
    // 5. Historical Audit Permanence & Deletion Invariants
    // =========================================================================
    describe("5. Historical Audit Permanence & Deletion Invariants", () => {
        it("ScheduleDeletionNotAllowedError exists in error taxonomy for deferred physical deletion", () => {
            const error = new ScheduleDeletionNotAllowedError();
            expect(error.code).toBe("SCHEDULE_DELETION_NOT_ALLOWED");
            expect(error.statusCode).toBe(409);
        });
    });
});
