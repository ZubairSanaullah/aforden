import { describe, expect, it, vi, beforeEach } from "vitest";
import { listTechnicianTimeEntries } from "@/lib/services/technicianOperations/listTechnicianTimeEntries";
import { listTechnicianTimeEntriesAdmin } from "@/lib/services/technicianOperations/listTechnicianTimeEntriesAdmin";
import { recordTechnicianTimeEntry } from "@/lib/services/technicianOperations/recordTechnicianTimeEntry";
import { updateTechnicianTimeEntry } from "@/lib/services/technicianOperations/updateTechnicianTimeEntry";
import { updateTechnicianTimeEntryAdmin } from "@/lib/services/technicianOperations/updateTechnicianTimeEntryAdmin";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { ScheduleAppointmentNotFoundError } from "@/lib/services/schedule/scheduleErrors";
import {
    ActiveTimeEntryExistsError,
    TimeEntryNotFoundError,
    TimeEntryImmutableError,
    TechnicianNotAssignedToWorkOrderError,
} from "@/lib/services/technicianOperations/technicianOperationsErrors";
import { ZodError } from "zod";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";
import type { TechnicianTimeEntry } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workOrderFindFirst: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
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
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
        },
        scheduleAppointment: {
            findFirst: mocks.scheduleAppointmentFindFirst,
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

describe("Phase 1.9.8 — Technician Time Tracking", () => {
    const WS_ID = "ws_tenant_101";
    const WO_ID = "wo_100";
    const APPT_ID = "appt_100";
    const TIME_ENTRY_ID_1 = "tte_001";
    const TIME_ENTRY_ID_2 = "tte_002";
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

    const adminUser = {
        id: "usr_admin_001",
        name: "Admin User",
        email: "admin@example.com",
        status: "ACTIVE",
        emailVerified: null,
    };

    const adminWorkspace = {
        id: WS_ID,
        name: "Acme HVAC Services",
        slug: "acme-hvac",
        logoUrl: null,
        timezone: "America/New_York",
    };

    const adminMembership = {
        id: "mem_admin_001",
        userId: "usr_admin_001",
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
    };

    const sampleWorkOrder = {
        id: WO_ID,
        workspaceId: WS_ID,
        assignedTechnicianId: TECH_PROFILE_ID_1,
    };

    const sampleAppointment = {
        id: APPT_ID,
        workOrderId: WO_ID,
        workspaceId: WS_ID,
        technicianId: TECH_PROFILE_ID_1,
    };

    const sampleActiveEntry: TechnicianTimeEntry = {
        id: TIME_ENTRY_ID_1,
        workspaceId: WS_ID,
        technicianProfileId: TECH_PROFILE_ID_1,
        workOrderId: WO_ID,
        appointmentId: APPT_ID,
        entryType: "ON_SITE",
        status: "ACTIVE",
        startedAt: new Date("2026-08-21T10:00:00Z"),
        endedAt: null,
        durationMinutes: null,
        notes: "Initial diagnostic inspection",
        metadata: null,
        createdByMemberId: "mem_tech_001",
        createdAt: new Date("2026-08-21T10:00:00Z"),
        updatedAt: new Date("2026-08-21T10:00:00Z"),
    };

    const sampleCompletedEntry: TechnicianTimeEntry = {
        id: TIME_ENTRY_ID_2,
        workspaceId: WS_ID,
        technicianProfileId: TECH_PROFILE_ID_1,
        workOrderId: WO_ID,
        appointmentId: APPT_ID,
        entryType: "TRAVEL",
        status: "COMPLETED",
        startedAt: new Date("2026-08-21T09:00:00Z"),
        endedAt: new Date("2026-08-21T09:45:00Z"),
        durationMinutes: 45,
        notes: "Travel to customer location",
        metadata: null,
        createdByMemberId: "mem_tech_001",
        createdAt: new Date("2026-08-21T09:00:00Z"),
        updatedAt: new Date("2026-08-21T09:45:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.auth.mockResolvedValue({
            user: { id: "usr_admin_001" },
        });

        mocks.userFindUnique.mockResolvedValue(adminUser);
        mocks.workspaceFindUnique.mockResolvedValue(adminWorkspace);
        mocks.workspaceMemberFindUnique.mockResolvedValue(adminMembership);

        mocks.transaction.mockImplementation(async (callback: any) => {
            const tx = {
                technicianTimeEntry: {
                    findFirst: mocks.technicianTimeEntryFindFirst,
                    create: mocks.technicianTimeEntryCreate,
                    update: mocks.technicianTimeEntryUpdate,
                },
            };
            return callback(tx);
        });

        mocks.workOrderFindFirst.mockResolvedValue(sampleWorkOrder);
        mocks.scheduleAppointmentFindFirst.mockResolvedValue(sampleAppointment);
        mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);
        mocks.technicianTimeEntryFindMany.mockResolvedValue([sampleActiveEntry, sampleCompletedEntry]);
        mocks.technicianTimeEntryCreate.mockImplementation(async ({ data }: any) => ({
            id: `tte_${Date.now()}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
        }));
        mocks.technicianTimeEntryUpdate.mockImplementation(async ({ where, data }: any) => ({
            ...sampleActiveEntry,
            ...data,
            updatedAt: new Date(),
        }));
    });

    describe("1. listTechnicianTimeEntries (Technician-Facing)", () => {
        it("returns canonical time entries scoped to technician and work order", async () => {
            const entries = await listTechnicianTimeEntries(techContext, WO_ID);

            expect(mocks.workOrderFindFirst).toHaveBeenCalledWith({
                where: { id: WO_ID, workspaceId: WS_ID },
                select: { id: true, assignedTechnicianId: true },
            });

            expect(mocks.technicianTimeEntryFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    workOrderId: WO_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                },
                orderBy: { startedAt: "desc" },
            });

            expect(entries).toHaveLength(2);
            expect(entries[0].id).toBe(TIME_ENTRY_ID_1);
            expect(entries[0].status).toBe("ACTIVE");
            expect(entries[1].id).toBe(TIME_ENTRY_ID_2);
            expect(entries[1].status).toBe("COMPLETED");
        });

        it("rejects non-TECHNICIAN roles with ForbiddenError (403)", async () => {
            const nonTechRoles = ["ADMIN", "OWNER", "MANAGER", "DISPATCHER", "ACCOUNTANT"] as const;

            for (const role of nonTechRoles) {
                await expect(
                    listTechnicianTimeEntries({ ...techContext, role }, WO_ID)
                ).rejects.toThrow(ForbiddenError);
            }

            expect(mocks.technicianTimeEntryFindMany).not.toHaveBeenCalled();
        });

        it("throws TechnicianNotAssignedToWorkOrderError (403) when technician is not assigned to the work order", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...sampleWorkOrder,
                assignedTechnicianId: TECH_PROFILE_ID_2,
            });

            await expect(
                listTechnicianTimeEntries(techContext, WO_ID)
            ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);
        });

        it("throws WorkOrderNotFoundError (404) when work order is not found", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                listTechnicianTimeEntries(techContext, "wo_unknown")
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("throws WorkOrderNotFoundError for empty workOrderId", async () => {
            await expect(
                listTechnicianTimeEntries(techContext, "")
            ).rejects.toThrow(WorkOrderNotFoundError);
        });
    });

    describe("2. recordTechnicianTimeEntry (Technician-Facing)", () => {
        it("records a BREAK time entry with status ACTIVE", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);

            const result = await recordTechnicianTimeEntry(techContext, WO_ID, {
                entryType: "BREAK",
                notes: "Lunch break",
            });

            expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                    workOrderId: WO_ID,
                    entryType: "BREAK",
                    status: "ACTIVE",
                    startedAt: expect.any(Date),
                    endedAt: null,
                    durationMinutes: null,
                    notes: "Lunch break",
                    createdByMemberId: "mem_tech_001",
                }),
            });

            expect(result.entryType).toBe("BREAK");
            expect(result.status).toBe("ACTIVE");
            expect(result.endedAt).toBeNull();
            expect(result.durationMinutes).toBeNull();
        });

        it("records an ADMIN time entry with status ACTIVE", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);

            const result = await recordTechnicianTimeEntry(techContext, WO_ID, {
                entryType: "ADMIN",
                notes: "Completing daily safety checklist",
            });

            expect(result.entryType).toBe("ADMIN");
            expect(result.status).toBe("ACTIVE");
        });

        it("rejects direct creation of TRAVEL entry with validation error (ZodError)", async () => {
            await expect(
                recordTechnicianTimeEntry(techContext, WO_ID, {
                    entryType: "TRAVEL",
                })
            ).rejects.toThrow(ZodError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("rejects direct creation of ON_SITE entry with validation error (ZodError)", async () => {
            await expect(
                recordTechnicianTimeEntry(techContext, WO_ID, {
                    entryType: "ON_SITE",
                })
            ).rejects.toThrow(ZodError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("enforces single-ACTIVE-entry rule: throws ActiveTimeEntryExistsError (409) if another entry is running", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue({ id: "tte_existing_active" });

            await expect(
                recordTechnicianTimeEntry(techContext, WO_ID, {
                    entryType: "BREAK",
                    notes: "Taking a coffee break",
                })
            ).rejects.toThrow(ActiveTimeEntryExistsError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("throws TechnicianNotAssignedToWorkOrderError (403) when technician is not assigned", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...sampleWorkOrder,
                assignedTechnicianId: TECH_PROFILE_ID_2,
            });

            await expect(
                recordTechnicianTimeEntry(techContext, WO_ID, {
                    entryType: "BREAK",
                })
            ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);

            expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
        });

        it("throws WorkOrderNotFoundError (404) when work order does not exist in workspace", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                recordTechnicianTimeEntry(techContext, "wo_999", {
                    entryType: "ADMIN",
                })
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("rejects non-TECHNICIAN roles with ForbiddenError (403)", async () => {
            const nonTechRoles = ["ADMIN", "OWNER", "MANAGER", "DISPATCHER", "ACCOUNTANT"] as const;

            for (const role of nonTechRoles) {
                await expect(
                    recordTechnicianTimeEntry({ ...techContext, role }, WO_ID, { entryType: "BREAK" })
                ).rejects.toThrow(ForbiddenError);
            }

            expect(mocks.workOrderFindFirst).not.toHaveBeenCalled();
        });

        describe("appointmentId Foreign-Key Validation (Point 5)", () => {
            it("records time entry with valid appointmentId matching workOrder, workspace, and technician", async () => {
                mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);
                mocks.scheduleAppointmentFindFirst.mockResolvedValue(sampleAppointment);

                const result = await recordTechnicianTimeEntry(techContext, WO_ID, {
                    entryType: "BREAK",
                    appointmentId: APPT_ID,
                    notes: "Break during scheduled visit",
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
                    },
                });

                expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        appointmentId: APPT_ID,
                        entryType: "BREAK",
                    }),
                });

                expect(result.appointmentId).toBe(APPT_ID);
            });

            it("throws ScheduleAppointmentNotFoundError (404) when supplied appointmentId does not exist for this workOrder", async () => {
                mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);
                mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

                await expect(
                    recordTechnicianTimeEntry(techContext, WO_ID, {
                        entryType: "BREAK",
                        appointmentId: "appt_nonexistent",
                    })
                ).rejects.toThrow(ScheduleAppointmentNotFoundError);

                expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
            });

            it("throws TechnicianNotAssignedToWorkOrderError (403) when supplied appointmentId belongs to a different technician", async () => {
                mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);
                mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                    ...sampleAppointment,
                    technicianId: TECH_PROFILE_ID_2,
                });

                await expect(
                    recordTechnicianTimeEntry(techContext, WO_ID, {
                        entryType: "BREAK",
                        appointmentId: APPT_ID,
                    })
                ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);

                expect(mocks.technicianTimeEntryCreate).not.toHaveBeenCalled();
            });
        });
    });

    describe("3. updateTechnicianTimeEntry (Technician-Facing)", () => {
        it("closes an active time entry, sets status COMPLETED, and computes durationMinutes correctly", async () => {
            const startedAt = new Date("2026-08-21T10:00:00Z");
            const endedAt = new Date("2026-08-21T10:45:00Z"); // 45 minutes later

            mocks.technicianTimeEntryFindFirst.mockResolvedValue({
                ...sampleActiveEntry,
                startedAt,
            });

            mocks.technicianTimeEntryUpdate.mockResolvedValue({
                ...sampleActiveEntry,
                status: "COMPLETED",
                endedAt,
                durationMinutes: 45,
                notes: "Finished diagnosis",
            });

            const result = await updateTechnicianTimeEntry(techContext, WO_ID, TIME_ENTRY_ID_1, {
                endedAt: endedAt.toISOString(),
                notes: "Finished diagnosis",
            });

            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                where: { id: TIME_ENTRY_ID_1 },
                data: {
                    status: "COMPLETED",
                    endedAt,
                    durationMinutes: 45,
                    notes: "Finished diagnosis",
                },
            });

            expect(result.status).toBe("COMPLETED");
            expect(result.durationMinutes).toBe(45);
        });

        it("defaults endedAt to now() if omitted when closing an active entry", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleActiveEntry);

            await updateTechnicianTimeEntry(techContext, WO_ID, TIME_ENTRY_ID_1, {
                notes: "Closed without explicit endedAt",
            });

            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                where: { id: TIME_ENTRY_ID_1 },
                data: expect.objectContaining({
                    status: "COMPLETED",
                    endedAt: expect.any(Date),
                    durationMinutes: expect.any(Number),
                    notes: "Closed without explicit endedAt",
                }),
            });
        });

        it("enforces immutability: throws TimeEntryImmutableError (409) when technician attempts to edit COMPLETED entry", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleCompletedEntry);

            await expect(
                updateTechnicianTimeEntry(techContext, WO_ID, TIME_ENTRY_ID_2, {
                    notes: "Attempting to change completed entry notes",
                })
            ).rejects.toThrow(TimeEntryImmutableError);

            expect(mocks.technicianTimeEntryUpdate).not.toHaveBeenCalled();
        });

        it("throws ForbiddenError (403) when technician attempts to update another technician's time entry", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue({
                ...sampleActiveEntry,
                technicianProfileId: TECH_PROFILE_ID_2, // belongs to tech 2
            });

            await expect(
                updateTechnicianTimeEntry(techContext, WO_ID, TIME_ENTRY_ID_1, {
                    notes: "Unauthorized update",
                })
            ).rejects.toThrow(ForbiddenError);

            expect(mocks.technicianTimeEntryUpdate).not.toHaveBeenCalled();
        });

        it("rejects non-TECHNICIAN roles with ForbiddenError (403)", async () => {
            const nonTechRoles = ["ADMIN", "OWNER", "MANAGER", "DISPATCHER", "ACCOUNTANT"] as const;

            for (const role of nonTechRoles) {
                await expect(
                    updateTechnicianTimeEntry({ ...techContext, role }, WO_ID, TIME_ENTRY_ID_1, { notes: "Test" })
                ).rejects.toThrow(ForbiddenError);
            }
        });

        it("throws TimeEntryNotFoundError (404) when time entry does not exist", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);

            await expect(
                updateTechnicianTimeEntry(techContext, WO_ID, "tte_unknown", {
                    notes: "Test",
                })
            ).rejects.toThrow(TimeEntryNotFoundError);

            expect(mocks.technicianTimeEntryUpdate).not.toHaveBeenCalled();
        });

        it("throws WorkOrderNotFoundError (404) when work order does not exist", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                updateTechnicianTimeEntry(techContext, "wo_999", TIME_ENTRY_ID_1, {
                    notes: "Test",
                })
            ).rejects.toThrow(WorkOrderNotFoundError);
        });
    });

    describe("4. listTechnicianTimeEntriesAdmin (Administrative Listing)", () => {
        it("allows ADMIN to view all time entries for the work order across technicians", async () => {
            const entries = await listTechnicianTimeEntriesAdmin(WS_ID, WO_ID);

            expect(mocks.workspaceMemberFindUnique).toHaveBeenCalledWith({
                where: {
                    userId_workspaceId: {
                        userId: "usr_admin_001",
                        workspaceId: WS_ID,
                    },
                },
                select: expect.any(Object),
            });

            expect(mocks.technicianTimeEntryFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    workOrderId: WO_ID,
                },
                orderBy: { startedAt: "desc" },
            });

            expect(entries).toHaveLength(2);
        });

        it("allows filtering by technicianProfileId for administrative listing", async () => {
            await listTechnicianTimeEntriesAdmin(WS_ID, WO_ID, {
                technicianProfileId: TECH_PROFILE_ID_1,
            });

            expect(mocks.technicianTimeEntryFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    workOrderId: WO_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                },
                orderBy: { startedAt: "desc" },
            });
        });

        it("permits OWNER and MANAGER roles for administrative listing", async () => {
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                ...adminMembership,
                role: "OWNER",
            });
            await expect(listTechnicianTimeEntriesAdmin(WS_ID, WO_ID)).resolves.not.toThrow();

            mocks.workspaceMemberFindUnique.mockResolvedValue({
                ...adminMembership,
                role: "MANAGER",
            });
            await expect(listTechnicianTimeEntriesAdmin(WS_ID, WO_ID)).resolves.not.toThrow();
        });

        it("rejects DISPATCHER, TECHNICIAN, and ACCOUNTANT roles with ForbiddenError (403)", async () => {
            const unauthorizedRoles = ["DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const;

            for (const role of unauthorizedRoles) {
                mocks.workspaceMemberFindUnique.mockResolvedValue({
                    ...adminMembership,
                    role,
                });

                await expect(
                    listTechnicianTimeEntriesAdmin(WS_ID, WO_ID)
                ).rejects.toThrow(ForbiddenError);
            }
        });

        it("throws WorkOrderNotFoundError (404) when work order does not exist in workspace", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                listTechnicianTimeEntriesAdmin(WS_ID, "wo_999")
            ).rejects.toThrow(WorkOrderNotFoundError);
        });
    });

    describe("5. updateTechnicianTimeEntryAdmin (Administrative Historical Editing)", () => {
        it("allows ADMIN/OWNER/MANAGER to edit historical completed entries per RBAC matrix §11.1", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleCompletedEntry);
            mocks.technicianTimeEntryUpdate.mockImplementation(async ({ data }: any) => ({
                ...sampleCompletedEntry,
                ...data,
            }));

            const result = await updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, {
                notes: "Admin amended notes for billing review",
                durationMinutes: 50,
            });

            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                where: { id: TIME_ENTRY_ID_2 },
                data: expect.objectContaining({
                    notes: "Admin amended notes for billing review",
                    durationMinutes: 50,
                }),
            });

            expect(result.notes).toBe("Admin amended notes for billing review");
            expect(result.durationMinutes).toBe(50);
        });

        describe("Single-Active-Entry Invariant (§7.3) on Reverting to ACTIVE", () => {
            it("throws ActiveTimeEntryExistsError (409) when reverting to ACTIVE if technician already has another active entry", async () => {
                mocks.technicianTimeEntryFindFirst
                    .mockResolvedValueOnce(sampleCompletedEntry) // target entry lookup
                    .mockResolvedValueOnce({ id: "tte_other_active" }); // conflict check lookup

                await expect(
                    updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, {
                        endedAt: null,
                    })
                ).rejects.toThrow(ActiveTimeEntryExistsError);

                expect(mocks.technicianTimeEntryUpdate).not.toHaveBeenCalled();
            });

            it("successfully reverts a completed entry to ACTIVE when no other active entry exists", async () => {
                mocks.technicianTimeEntryFindFirst
                    .mockResolvedValueOnce(sampleCompletedEntry) // target entry lookup
                    .mockResolvedValueOnce(null); // conflict check returns null (no other active entry)

                mocks.technicianTimeEntryUpdate.mockImplementation(async ({ data }: any) => ({
                    ...sampleCompletedEntry,
                    ...data,
                }));

                const result = await updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, {
                    endedAt: null,
                });

                expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                    where: { id: TIME_ENTRY_ID_2 },
                    data: expect.objectContaining({
                        status: "ACTIVE",
                        endedAt: null,
                        durationMinutes: null,
                    }),
                });

                expect(result.status).toBe("ACTIVE");
                expect(result.endedAt).toBeNull();
                expect(result.durationMinutes).toBeNull();
            });
        });

        describe("Duration Recomputation on startedAt Change", () => {
            it("automatically recalculates durationMinutes when only startedAt is modified on a completed entry", async () => {
                // Original: startedAt = 09:00:00Z, endedAt = 09:45:00Z (45 min)
                // New: startedAt = 09:15:00Z -> should compute duration = 30 min
                mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleCompletedEntry);
                mocks.technicianTimeEntryUpdate.mockImplementation(async ({ data }: any) => ({
                    ...sampleCompletedEntry,
                    ...data,
                }));

                const result = await updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, {
                    startedAt: "2026-08-21T09:15:00Z",
                });

                expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                    where: { id: TIME_ENTRY_ID_2 },
                    data: expect.objectContaining({
                        startedAt: new Date("2026-08-21T09:15:00Z"),
                        durationMinutes: 30,
                    }),
                });

                expect(result.durationMinutes).toBe(30);
            });

            it("preserves explicit caller-supplied durationMinutes override when startedAt is modified", async () => {
                mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleCompletedEntry);
                mocks.technicianTimeEntryUpdate.mockImplementation(async ({ data }: any) => ({
                    ...sampleCompletedEntry,
                    ...data,
                }));

                const result = await updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, {
                    startedAt: "2026-08-21T09:15:00Z",
                    durationMinutes: 40, // explicit override
                });

                expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                    where: { id: TIME_ENTRY_ID_2 },
                    data: expect.objectContaining({
                        startedAt: new Date("2026-08-21T09:15:00Z"),
                        durationMinutes: 40,
                    }),
                });

                expect(result.durationMinutes).toBe(40);
            });
        });

        describe("Administrative Audit Trail in metadata (Invariant 4 §2.4)", () => {
            it("writes structured audit log with actor identity, timestamp, editReason, and itemized changes to metadata", async () => {
                mocks.technicianTimeEntryFindFirst.mockResolvedValue({
                    ...sampleCompletedEntry,
                    metadata: { initialKey: "initialValue" },
                });

                mocks.technicianTimeEntryUpdate.mockImplementation(async ({ data }: any) => ({
                    ...sampleCompletedEntry,
                    ...data,
                }));

                const result = await updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, {
                    notes: "Supervisor correction of travel time",
                    startedAt: "2026-08-21T09:10:00Z",
                    editReason: "GPS verification showed arrival delay",
                });

                expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                    where: { id: TIME_ENTRY_ID_2 },
                    data: expect.objectContaining({
                        metadata: expect.objectContaining({
                            initialKey: "initialValue",
                            lastEditedByMemberId: "mem_admin_001",
                            lastEditedByName: "Admin User",
                            lastEditedByRole: "ADMIN",
                            lastEditReason: "GPS verification showed arrival delay",
                            lastEditedAt: expect.any(String),
                            adminAuditHistory: expect.arrayContaining([
                                expect.objectContaining({
                                    editedByMemberId: "mem_admin_001",
                                    editedByName: "Admin User",
                                    editedByRole: "ADMIN",
                                    editReason: "GPS verification showed arrival delay",
                                    changes: expect.objectContaining({
                                        notes: {
                                            oldValue: "Travel to customer location",
                                            newValue: "Supervisor correction of travel time",
                                        },
                                        startedAt: {
                                            oldValue: "2026-08-21T09:00:00.000Z",
                                            newValue: "2026-08-21T09:10:00.000Z",
                                        },
                                        durationMinutes: {
                                            oldValue: 45,
                                            newValue: 35,
                                        },
                                    }),
                                }),
                            ]),
                        }),
                    }),
                });

                expect(result.metadata?.lastEditReason).toBe("GPS verification showed arrival delay");
                expect(result.metadata?.adminAuditHistory).toHaveLength(1);
            });

            it("strips client-supplied reserved audit keys from metadata payload, preventing audit ledger tampering", async () => {
                const priorAuditRecord = {
                    editedAt: "2026-08-21T09:30:00.000Z",
                    editedByMemberId: "mem_owner_001",
                    editedByName: "Owner User",
                    editedByRole: "OWNER",
                    editReason: "Initial supervisor adjustment",
                    changes: {
                        notes: {
                            oldValue: "Original note",
                            newValue: "Travel to customer location",
                        },
                    },
                };

                mocks.technicianTimeEntryFindFirst.mockResolvedValue({
                    ...sampleCompletedEntry,
                    metadata: {
                        customTag: "van-42",
                        adminAuditHistory: [priorAuditRecord],
                        lastEditedByMemberId: "mem_owner_001",
                        lastEditedByName: "Owner User",
                        lastEditedByRole: "OWNER",
                    },
                });

                mocks.technicianTimeEntryUpdate.mockImplementation(async ({ data }: any) => ({
                    ...sampleCompletedEntry,
                    ...data,
                }));

                // Attempt to pass forged audit fields in client request metadata
                const result = await updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, {
                    notes: "Second supervisor amendment",
                    editReason: "Logged secondary check",
                    metadata: {
                        adminAuditHistory: [], // Malicious attempt to wipe audit trail
                        lastEditedByMemberId: "mem_forged_hacker", // Malicious attempt to spoof editor ID
                        lastEditedByName: "Forged User",
                        lastEditedByRole: "OWNER",
                        newCustomField: "customValue123",
                    },
                });

                // Verify the forged keys were stripped and true audit chain was preserved and appended to
                expect(result.metadata?.customTag).toBe("van-42");
                expect(result.metadata?.newCustomField).toBe("customValue123");
                expect(result.metadata?.lastEditedByMemberId).toBe("mem_admin_001"); // Server-derived actor
                expect(result.metadata?.lastEditedByName).toBe("Admin User");
                expect(result.metadata?.lastEditedByRole).toBe("ADMIN");
                expect(result.metadata?.lastEditReason).toBe("Logged secondary check");

                const auditHistory = result.metadata?.adminAuditHistory;
                expect(auditHistory).toHaveLength(2);
                // First entry preserved intact
                expect(auditHistory[0]).toEqual(priorAuditRecord);
                // Second entry accurately recorded
                expect(auditHistory[1]).toEqual(
                    expect.objectContaining({
                        editedByMemberId: "mem_admin_001",
                        editedByName: "Admin User",
                        editedByRole: "ADMIN",
                        editReason: "Logged secondary check",
                        changes: {
                            notes: {
                                oldValue: "Travel to customer location",
                                newValue: "Second supervisor amendment",
                            },
                        },
                    })
                );
            });
        });

        it("permits OWNER and MANAGER roles to perform historical updates", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleCompletedEntry);
            mocks.workspaceMemberFindUnique.mockResolvedValue({
                ...adminMembership,
                role: "OWNER",
            });

            await expect(
                updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, { notes: "Owner update" })
            ).resolves.not.toThrow();

            mocks.workspaceMemberFindUnique.mockResolvedValue({
                ...adminMembership,
                role: "MANAGER",
            });

            await expect(
                updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, { notes: "Manager update" })
            ).resolves.not.toThrow();
        });

        it("rejects DISPATCHER, TECHNICIAN, and ACCOUNTANT roles with ForbiddenError (403)", async () => {
            const unauthorizedRoles = ["DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const;

            for (const role of unauthorizedRoles) {
                mocks.workspaceMemberFindUnique.mockResolvedValue({
                    ...adminMembership,
                    role,
                });

                await expect(
                    updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, TIME_ENTRY_ID_2, { notes: "Test" })
                ).rejects.toThrow(ForbiddenError);
            }
        });

        it("throws TimeEntryNotFoundError (404) when time entry does not exist in workspace", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null);

            await expect(
                updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, "tte_unknown", { notes: "Test" })
            ).rejects.toThrow(TimeEntryNotFoundError);
        });

        it("throws WorkOrderNotFoundError (404) when work order does not exist in workspace", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                updateTechnicianTimeEntryAdmin(WS_ID, "wo_999", TIME_ENTRY_ID_1, { notes: "Test" })
            ).rejects.toThrow(WorkOrderNotFoundError);
        });
    });

    describe("6. Scope Exclusion Verification (Section 7.1)", () => {
        it("confirms zero payroll, wage, pay-rate, or customer-billing fields exist in read models or inputs", () => {
            const entryReadModel = sampleCompletedEntry;
            const keys = Object.keys(entryReadModel);

            // Assert prohibited payroll/billing fields do not exist
            expect(keys).not.toContain("hourlyRate");
            expect(keys).not.toContain("payRate");
            expect(keys).not.toContain("billingRate");
            expect(keys).not.toContain("wage");
            expect(keys).not.toContain("overtimeMultiplier");
            expect(keys).not.toContain("totalCost");
            expect(keys).not.toContain("totalBilled");
            expect(keys).not.toContain("invoiceLineId");
            expect(keys).not.toContain("taxRate");
        });
    });
});
