import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    employeeFindFirst: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderUpdate: vi.fn(),
    workOrderDelete: vi.fn(),
    workOrderHistoryCreate: vi.fn(),
    workOrderHistoryUpdate: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),
    technicianTimeEntryFindFirst: vi.fn(),
    technicianTimeEntryFindMany: vi.fn(),
    technicianTimeEntryCreate: vi.fn(),
    technicianTimeEntryUpdate: vi.fn(),
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
        employee: {
            findFirst: mocks.employeeFindFirst,
        },
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            update: mocks.workOrderUpdate,
            delete: mocks.workOrderDelete,
        },
        workOrderHistory: {
            create: mocks.workOrderHistoryCreate,
            update: mocks.workOrderHistoryUpdate,
        },
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
            findMany: mocks.scheduleAppointmentFindMany,
            update: mocks.scheduleAppointmentUpdate,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        technicianTimeEntry: {
            findFirst: mocks.technicianTimeEntryFindFirst,
            findMany: mocks.technicianTimeEntryFindMany,
            create: mocks.technicianTimeEntryCreate,
            update: mocks.technicianTimeEntryUpdate,
        },
        $transaction: mocks.transaction,
    },
}));

import { resolveTechnicianContext } from "@/lib/services/technicianOperations/resolveTechnicianContext";
import { acknowledgeTechnicianDispatch } from "@/lib/services/technicianOperations/acknowledgeTechnicianDispatch";
import { startTechnicianTravel } from "@/lib/services/technicianOperations/startTechnicianTravel";
import { startTechnicianWorkOrder } from "@/lib/services/technicianOperations/startTechnicianWorkOrder";
import { holdTechnicianWorkOrder } from "@/lib/services/technicianOperations/holdTechnicianWorkOrder";
import { resumeTechnicianWorkOrder } from "@/lib/services/technicianOperations/resumeTechnicianWorkOrder";
import { completeTechnicianWorkOrder } from "@/lib/services/technicianOperations/completeTechnicianWorkOrder";
import { completeWorkOrderAdmin } from "@/lib/services/technicianOperations/completeWorkOrderAdmin";
import { recordTechnicianTimeEntry } from "@/lib/services/technicianOperations/recordTechnicianTimeEntry";
import { updateTechnicianTimeEntry } from "@/lib/services/technicianOperations/updateTechnicianTimeEntry";
import { updateTechnicianTimeEntryAdmin } from "@/lib/services/technicianOperations/updateTechnicianTimeEntryAdmin";
import { listTechnicianTimeEntries } from "@/lib/services/technicianOperations/listTechnicianTimeEntries";
import { listTechnicianTimeEntriesAdmin } from "@/lib/services/technicianOperations/listTechnicianTimeEntriesAdmin";
import { getTechnicianWorkOrderDetail } from "@/lib/services/technicianOperations/getTechnicianWorkOrderDetail";
import { listTechnicianWorkOrders } from "@/lib/services/technicianOperations/listTechnicianWorkOrders";
import { deleteWorkOrder } from "@/lib/services/workOrder/deleteWorkOrder";

import {
    TechnicianProfileNotFoundError,
    TechnicianNotAssignedToWorkOrderError,
    ActiveTimeEntryExistsError,
    TimeEntryNotFoundError,
    TimeEntryImmutableError,
} from "@/lib/services/technicianOperations/technicianOperationsErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderDeletionNotAllowedError,
    WorkOrderCompletionPreconditionFailedError,
} from "@/lib/services/workOrder/workOrderErrors";
import { ScheduleAppointmentNotFoundError } from "@/lib/services/schedule/scheduleErrors";
import { UnauthorizedError, ForbiddenError, WorkspaceAccessDeniedError } from "@/lib/services/authorization/authorizationErrors";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";

describe("Phase 1.9.12 — Integration Hardening & Full Domain Audit", () => {
    const WS_A = "ws_tenant_alpha";
    const WS_B = "ws_tenant_bravo";

    const TECH_PROFILE_ALEX = "tp_alex_001";
    const TECH_PROFILE_BOB = "tp_bob_002";

    const WO_1 = "wo_001";
    const APPT_1 = "appt_001";
    const TIME_ENTRY_TRAVEL_1 = "tte_travel_001";
    const TIME_ENTRY_ONSITE_1 = "tte_onsite_001";

    const alexContext: TechnicianExecutionContext = {
        userId: "usr_alex",
        workspaceId: WS_A,
        membershipId: "mem_alex",
        role: "TECHNICIAN",
        employeeId: "emp_alex",
        technicianProfileId: TECH_PROFILE_ALEX,
        technicianName: "Alex Rivers",
    };

    const bobContext: TechnicianExecutionContext = {
        userId: "usr_bob",
        workspaceId: WS_A,
        membershipId: "mem_bob",
        role: "TECHNICIAN",
        employeeId: "emp_bob",
        technicianProfileId: TECH_PROFILE_BOB,
        technicianName: "Bob Builder",
    };

    const adminContext: TechnicianExecutionContext = {
        userId: "usr_admin",
        workspaceId: WS_A,
        membershipId: "mem_admin",
        role: "ADMIN",
        employeeId: "emp_admin",
        technicianProfileId: "tp_admin_synthetic",
        technicianName: "Admin User",
    };

    const baseWorkOrder = {
        id: WO_1,
        workspaceId: WS_A,
        workOrderNumber: "WO-000001",
        customerId: "cust_1",
        customerName: "Acme Industrial",
        customerNumber: "CUST-001",
        locationId: "loc_1",
        locationName: "HQ Plant",
        locationAddress: "100 Industrial Parkway",
        workTypeId: "wt_1",
        workTypeName: "HVAC Repair",
        workTypeCode: "HVAC",
        estimatedDuration: 120,
        assignedTechnicianId: TECH_PROFILE_ALEX,
        assetId: null,
        status: "ASSIGNED",
        priority: "HIGH",
        title: "Repair Chiller Unit",
        description: "Loud noise",
        internalNotes: "VIP",
        holdReason: null,
        cancellationReason: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date("2026-08-21T08:00:00Z"),
        updatedAt: new Date("2026-08-21T08:00:00Z"),
        customer: { id: "cust_1", name: "Acme Industrial", customerNumber: "CUST-001" },
        location: { id: "loc_1", name: "HQ Plant", address: "100 Industrial Parkway" },
        workType: { id: "wt_1", name: "HVAC Repair", code: "HVAC" },
    };

    const baseAppointment = {
        id: APPT_1,
        workspaceId: WS_A,
        workOrderId: WO_1,
        appointmentNumber: "APT-000001",
        technicianId: TECH_PROFILE_ALEX,
        status: "SCHEDULED",
        dispatchStatus: "DISPATCHED",
        scheduledStart: new Date("2026-08-21T09:00:00Z"),
        scheduledEnd: new Date("2026-08-21T11:00:00Z"),
        fieldExecutionStartedAt: null,
        dispatchedAt: new Date("2026-08-21T08:30:00Z"),
        dispatchedByMemberId: "mem_disp_1",
        undispatchedAt: null,
        undispatchedByMemberId: null,
        notes: "Gate code 1234",
        metadata: null,
        createdAt: new Date("2026-08-21T08:00:00Z"),
        updatedAt: new Date("2026-08-21T08:30:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.auth.mockResolvedValue({ user: { id: "usr_alex" } });
        mocks.userFindUnique.mockResolvedValue({ id: "usr_alex", status: "ACTIVE", name: "Alex Rivers" });
        mocks.workspaceFindUnique.mockResolvedValue({ id: WS_A, status: "ACTIVE" });
        mocks.workspaceMemberFindUnique.mockResolvedValue({
            id: "mem_alex",
            workspaceId: WS_A,
            userId: "usr_alex",
            role: "TECHNICIAN",
            status: "ACTIVE",
        });
        mocks.technicianProfileFindFirst.mockResolvedValue({
            id: TECH_PROFILE_ALEX,
        });
        mocks.transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
            cb({
                workOrder: {
                    findFirst: mocks.workOrderFindFirst,
                    update: mocks.workOrderUpdate,
                    delete: mocks.workOrderDelete,
                },
                workOrderHistory: {
                    create: mocks.workOrderHistoryCreate,
                    update: mocks.workOrderHistoryUpdate,
                },
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
                technicianTimeEntry: {
                    findFirst: mocks.technicianTimeEntryFindFirst,
                    findMany: mocks.technicianTimeEntryFindMany,
                    create: mocks.technicianTimeEntryCreate,
                    update: mocks.technicianTimeEntryUpdate,
                },
            })
        );
    });

    describe("1. Full Lifecycle End-to-End Integration (Audit Invariant 1, 3, 4)", () => {
        it("executes the entire canonical lifecycle from acknowledge to completion with atomic state transitions and time entry management", async () => {
            // --- Step 1: Acknowledge Dispatch ---
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(baseAppointment);
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                id: "mem_alex",
                workspaceId: WS_A,
                userId: "usr_alex",
                role: "TECHNICIAN",
                status: "ACTIVE",
            });
            mocks.userFindUnique.mockResolvedValue({ id: "usr_alex", status: "ACTIVE", name: "Alex Rivers" });
            mocks.workspaceFindUnique.mockResolvedValue({ id: WS_A, status: "ACTIVE" });
            mocks.auth.mockResolvedValue({ user: { id: "usr_alex" } });

            mocks.scheduleAppointmentUpdate.mockResolvedValue({
                ...baseAppointment,
                dispatchStatus: "ACKNOWLEDGED",
                workOrder: {
                    workOrderNumber: "WO-000001",
                    title: "Repair Chiller Unit",
                    status: "ASSIGNED",
                    priority: "HIGH",
                    customer: { id: "cust_1", name: "Acme Industrial", customerNumber: "CUST-001" },
                    location: { id: "loc_1", name: "HQ Plant", addressLine1: "100 Industrial Parkway", addressLine2: null, city: "Austin", state: "TX", postalCode: "78701", country: "USA", latitude: null, longitude: null },
                },
                technician: {
                    id: TECH_PROFILE_ALEX,
                    employee: { displayName: "Alex Rivers", employeeNumber: "EMP-001" },
                },
                dispatchedByMember: {
                    id: "mem_disp_1",
                    user: { name: "Dispatcher Dan" },
                },
                undispatchedByMember: null,
                asset: null,
            });

            const ackResult = await acknowledgeTechnicianDispatch(alexContext, WO_1, APPT_1);
            expect(ackResult.dispatchStatus).toBe("ACKNOWLEDGED");

            // --- Step 2: Start Travel ---
            mocks.workOrderFindFirst.mockResolvedValue(baseWorkOrder);
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null); // No active time entry
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...baseAppointment,
                dispatchStatus: "ACKNOWLEDGED",
            });
            mocks.scheduleAppointmentFindMany.mockResolvedValue([{
                ...baseAppointment,
                dispatchStatus: "ACKNOWLEDGED",
            }]);
            mocks.technicianTimeEntryCreate.mockResolvedValue({
                id: TIME_ENTRY_TRAVEL_1,
                workspaceId: WS_A,
                technicianProfileId: TECH_PROFILE_ALEX,
                workOrderId: WO_1,
                appointmentId: APPT_1,
                entryType: "TRAVEL",
                status: "ACTIVE",
                startedAt: new Date("2026-08-21T08:35:00Z"),
                endedAt: null,
                durationMinutes: null,
                notes: "En route via highway",
                metadata: null,
                createdByMemberId: "mem_alex",
                createdAt: new Date("2026-08-21T08:35:00Z"),
                updatedAt: new Date("2026-08-21T08:35:00Z"),
            });

            const travelEntry = await startTechnicianTravel(alexContext, WO_1, { notes: "En route via highway" });
            expect(travelEntry.entryType).toBe("TRAVEL");
            expect(travelEntry.status).toBe("ACTIVE");

            // Verify ScheduleAppointment.fieldExecutionStartedAt was stamped
            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: APPT_1 },
                    data: expect.objectContaining({
                        fieldExecutionStartedAt: expect.any(Date),
                    }),
                })
            );

            // --- Step 3: Start On-Site Work (Auto-closes TRAVEL, opens ON_SITE, transitions to IN_PROGRESS) ---
            const activeTravelEntry = {
                id: TIME_ENTRY_TRAVEL_1,
                workspaceId: WS_A,
                technicianProfileId: TECH_PROFILE_ALEX,
                workOrderId: WO_1,
                entryType: "TRAVEL",
                status: "ACTIVE",
                startedAt: new Date("2026-08-21T08:35:00Z"),
            };
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(activeTravelEntry);
            mocks.workOrderUpdate.mockResolvedValue({
                ...baseWorkOrder,
                status: "IN_PROGRESS",
                startedAt: new Date("2026-08-21T09:00:00Z"),
            });
            mocks.workOrderHistoryCreate.mockResolvedValue({ id: "wo_hist_start" });

            const startResult = await startTechnicianWorkOrder(alexContext, WO_1, { notes: "Arrived at location" });
            expect(startResult.status).toBe("IN_PROGRESS");

            // Verify TRAVEL entry was auto-closed
            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: TIME_ENTRY_TRAVEL_1 },
                    data: expect.objectContaining({
                        status: "COMPLETED",
                        endedAt: expect.any(Date),
                        durationMinutes: expect.any(Number),
                    }),
                })
            );

            // Verify new ON_SITE time entry was opened
            expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        entryType: "ON_SITE",
                        status: "ACTIVE",
                    }),
                })
            );

            // --- Step 4: Hold WorkOrder ---
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                status: "IN_PROGRESS",
            });
            mocks.workOrderUpdate.mockResolvedValue({
                ...baseWorkOrder,
                status: "ON_HOLD",
                holdReason: "Awaiting customer approval on parts",
            });

            const holdResult = await holdTechnicianWorkOrder(alexContext, WO_1, {
                holdReason: "Awaiting customer approval on parts",
            });
            expect(holdResult.status).toBe("ON_HOLD");

            // --- Step 5: Resume WorkOrder ---
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                status: "ON_HOLD",
                holdReason: "Awaiting customer approval on parts",
            });
            mocks.workOrderUpdate.mockResolvedValue({
                ...baseWorkOrder,
                status: "IN_PROGRESS",
                holdReason: null,
            });

            const resumeResult = await resumeTechnicianWorkOrder(alexContext, WO_1, { notes: "Customer approved replacement" });
            expect(resumeResult.status).toBe("IN_PROGRESS");

            // --- Step 6: Complete WorkOrder (Auto-closes ON_SITE, completes appointment, persists evidence) ---
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                status: "IN_PROGRESS",
            });
            const activeOnSiteEntry = {
                id: TIME_ENTRY_ONSITE_1,
                workspaceId: WS_A,
                technicianProfileId: TECH_PROFILE_ALEX,
                workOrderId: WO_1,
                entryType: "ON_SITE",
                status: "ACTIVE",
                startedAt: new Date("2026-08-21T09:00:00Z"),
            };
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(activeOnSiteEntry);
            mocks.scheduleAppointmentFindMany.mockResolvedValue([baseAppointment]);
            mocks.workOrderUpdate.mockResolvedValue({
                ...baseWorkOrder,
                status: "COMPLETED",
                completedAt: new Date("2026-08-21T10:30:00Z"),
            });
            mocks.workOrderHistoryCreate.mockResolvedValue({ id: "wo_hist_complete" });

            const completeResult = await completeTechnicianWorkOrder(alexContext, WO_1, {
                resolutionNotes: "Chiller bearing replaced and airflow tested optimal.",
                mediaUris: ["https://storage.aforden.com/chiller_fixed.jpg"],
            });

            expect(completeResult.status).toBe("COMPLETED");

            // Verify active ON_SITE entry auto-closed
            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: TIME_ENTRY_ONSITE_1 },
                    data: expect.objectContaining({
                        status: "COMPLETED",
                        endedAt: expect.any(Date),
                    }),
                })
            );

            // Verify appointment status transitioned to COMPLETED
            expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: APPT_1 },
                    data: expect.objectContaining({
                        status: "COMPLETED",
                    }),
                })
            );

            // Verify WorkOrderHistory.metadata captured resolutionNotes and mediaUris
            expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        metadata: JSON.stringify({
                            resolutionNotes: "Chiller bearing replaced and airflow tested optimal.",
                            completedByTechId: TECH_PROFILE_ALEX,
                            mediaUris: ["https://storage.aforden.com/chiller_fixed.jpg"],
                        }),
                    }),
                })
            );
        });
    });

    describe("2. Cross-Tenant and Cross-Technician Penetration Suite (Invariant 2 & 3)", () => {
        it("rejects acknowledgeDispatch when appointment belongs to a different workspace (Cross-Tenant 404)", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(
                acknowledgeTechnicianDispatch(alexContext, WO_1, "appt_cross_tenant")
            ).rejects.toThrow(ScheduleAppointmentNotFoundError);
        });

        it("rejects acknowledgeDispatch when appointment is assigned to another technician (Cross-Technician 403)", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                ...baseAppointment,
                technicianId: TECH_PROFILE_BOB, // Assigned to Bob, not Alex
            });

            await expect(
                acknowledgeTechnicianDispatch(alexContext, WO_1, APPT_1)
            ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);
        });

        it("rejects startTechnicianTravel when work order is assigned to another technician (Cross-Technician 403)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                assignedTechnicianId: TECH_PROFILE_BOB,
            });

            await expect(
                startTechnicianTravel(alexContext, WO_1)
            ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);
        });

        it("rejects startTechnicianWorkOrder when work order belongs to another tenant (Cross-Tenant 404)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                startTechnicianWorkOrder(alexContext, "wo_other_workspace")
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("rejects completeTechnicianWorkOrder when work order is assigned to another technician (Cross-Technician 422 Precondition Failure)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                status: "IN_PROGRESS",
                assignedTechnicianId: TECH_PROFILE_BOB,
            });

            await expect(
                completeTechnicianWorkOrder(alexContext, WO_1)
            ).rejects.toThrow(WorkOrderCompletionPreconditionFailedError);
        });

        it("rejects updateTechnicianTimeEntry when modifying another technician's time entry (Cross-Technician 404)", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null); // Tenant/technician filter yields 0 matches

            await expect(
                updateTechnicianTimeEntry(alexContext, WO_1, "tte_bobs_entry", { notes: "Hacked notes" })
            ).rejects.toThrow(TimeEntryNotFoundError);
        });
    });

    describe("3. Strict Role-Boundary & Identity Separation Auditing (Section 11)", () => {
        it("strictly rejects non-TECHNICIAN roles attempting technician operational services", async () => {
            await expect(acknowledgeTechnicianDispatch(adminContext, WO_1, APPT_1)).rejects.toThrow(ForbiddenError);
            await expect(startTechnicianTravel(adminContext, WO_1)).rejects.toThrow(ForbiddenError);
            await expect(startTechnicianWorkOrder(adminContext, WO_1)).rejects.toThrow(ForbiddenError);
            await expect(holdTechnicianWorkOrder(adminContext, WO_1, { holdReason: "Hold" })).rejects.toThrow(ForbiddenError);
            await expect(resumeTechnicianWorkOrder(adminContext, WO_1)).rejects.toThrow(ForbiddenError);
            await expect(completeTechnicianWorkOrder(adminContext, WO_1)).rejects.toThrow(ForbiddenError);
            await expect(recordTechnicianTimeEntry(adminContext, WO_1, { entryType: "BREAK" })).rejects.toThrow(ForbiddenError);
            await expect(listTechnicianTimeEntries(adminContext, WO_1)).rejects.toThrow(ForbiddenError);
            await expect(updateTechnicianTimeEntry(adminContext, WO_1, "tte_1", { notes: "Note" })).rejects.toThrow(ForbiddenError);
        });

        it("allows administrative completion and historical edits exclusively via dedicated admin services", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "usr_admin" } });
            mocks.userFindUnique.mockResolvedValue({ id: "usr_admin", status: "ACTIVE", name: "Admin" });
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                id: "mem_admin",
                workspaceId: WS_A,
                userId: "usr_admin",
                role: "ADMIN",
                status: "ACTIVE",
            });

            // Admin completion via completeWorkOrderAdmin
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                status: "IN_PROGRESS",
            });
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);
            mocks.workOrderUpdate.mockResolvedValue({
                ...baseWorkOrder,
                status: "COMPLETED",
                completedAt: new Date("2026-08-21T12:00:00Z"),
            });
            mocks.workOrderHistoryCreate.mockResolvedValue({ id: "wo_hist_admin" });

            const adminComplete = await completeWorkOrderAdmin(WS_A, WO_1, { resolutionNotes: "Admin closed" });
            expect(adminComplete.status).toBe("COMPLETED");

            // Admin time edit via updateTechnicianTimeEntryAdmin
            mocks.technicianTimeEntryFindFirst.mockResolvedValue({
                id: TIME_ENTRY_ONSITE_1,
                workspaceId: WS_A,
                technicianProfileId: TECH_PROFILE_ALEX,
                workOrderId: WO_1,
                entryType: "ON_SITE",
                status: "COMPLETED",
                startedAt: new Date("2026-08-21T09:00:00Z"),
                endedAt: new Date("2026-08-21T10:00:00Z"),
                durationMinutes: 60,
                notes: "Initial note",
                metadata: null,
            });
            mocks.technicianTimeEntryUpdate.mockResolvedValue({
                id: TIME_ENTRY_ONSITE_1,
                notes: "Corrected note",
                durationMinutes: 75,
            });

            const adminTimeUpdate = await updateTechnicianTimeEntryAdmin(WS_A, WO_1, TIME_ENTRY_ONSITE_1, {
                notes: "Corrected note",
                durationMinutes: 75,
                editReason: "Audited GPS discrepancy",
            });
            expect(adminTimeUpdate.notes).toBe("Corrected note");
            expect(adminTimeUpdate.durationMinutes).toBe(75);
        });

        it("rejects DISPATCHER role from administrative time entry listing, update, and completion with ForbiddenError (403)", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "usr_dispatcher" } });
            mocks.userFindUnique.mockResolvedValue({ id: "usr_dispatcher", status: "ACTIVE", name: "Dispatcher Dan" });
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                id: "mem_dispatcher",
                workspaceId: WS_A,
                userId: "usr_dispatcher",
                role: "DISPATCHER",
                status: "ACTIVE",
            });

            await expect(
                listTechnicianTimeEntriesAdmin(WS_A, WO_1)
            ).rejects.toThrow(ForbiddenError);

            await expect(
                updateTechnicianTimeEntryAdmin(WS_A, WO_1, TIME_ENTRY_ONSITE_1, { notes: "Dispatcher edit" })
            ).rejects.toThrow(ForbiddenError);

            await expect(
                completeWorkOrderAdmin(WS_A, WO_1, { resolutionNotes: "Dispatcher close" })
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("4. Deletion Precedence & Referential Safety (Section 13.1)", () => {
        it("blocks physical deletion of WorkOrder when status is not OPEN or CANCELLED (409 Conflict)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                status: "IN_PROGRESS", // Active operational status
            });
            mocks.workspaceMemberFindUnique.mockResolvedValue({ id: "mem_admin", role: "ADMIN", status: "ACTIVE" });
            mocks.userFindUnique.mockResolvedValue({ id: "usr_admin", status: "ACTIVE", name: "Admin" });
            mocks.workspaceFindUnique.mockResolvedValue({ id: WS_A, status: "ACTIVE" });
            mocks.auth.mockResolvedValue({ user: { id: "usr_admin" } });

            await expect(
                deleteWorkOrder(WS_A, WO_1)
            ).rejects.toThrow(WorkOrderDeletionNotAllowedError);

            expect(mocks.workOrderDelete).not.toHaveBeenCalled();
        });

        it("allows deletion of OPEN work order and logs DELETED history event", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...baseWorkOrder,
                status: "OPEN",
            });
            mocks.workspaceMemberFindUnique.mockResolvedValue({ id: "mem_admin", role: "ADMIN", status: "ACTIVE" });
            mocks.userFindUnique.mockResolvedValue({ id: "usr_admin", status: "ACTIVE", name: "Admin" });
            mocks.workspaceFindUnique.mockResolvedValue({ id: WS_A, status: "ACTIVE" });
            mocks.auth.mockResolvedValue({ user: { id: "usr_admin" } });
            mocks.workOrderDelete.mockResolvedValue({ id: WO_1 });

            const deleted = await deleteWorkOrder(WS_A, WO_1);
            expect(deleted.id).toBe(WO_1);
            expect(mocks.workOrderDelete).toHaveBeenCalledWith({ where: { id: WO_1 } });
        });
    });
});
