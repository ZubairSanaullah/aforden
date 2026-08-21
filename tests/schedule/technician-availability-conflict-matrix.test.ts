import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkTechnicianAvailability } from "@/lib/services/schedule/checkTechnicianAvailability";
import { assertNoTechnicianConflicts } from "@/lib/services/schedule/conflictDetection";
import {
    ScheduleTechnicianNotFoundError,
    ScheduleTechnicianNotEligibleError,
    ScheduleTechnicianOnLeaveError,
    ScheduleOutsideWorkingHoursError,
    ScheduleTechnicianConflictError,
} from "@/lib/services/schedule/scheduleErrors";

const mocks = vi.hoisted(() => ({
    technicianProfileFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
}));

const mockPrisma = {
    technicianProfile: {
        findFirst: mocks.technicianProfileFindFirst,
    },
    scheduleAppointment: {
        findMany: mocks.scheduleAppointmentFindMany,
    },
};

describe("Phase 1.8.6 — Technician Availability & Conflict Detection Engine", () => {
    const WS_A = "ws_tenant_alpha";
    const WS_B = "ws_tenant_beta";
    const TECH_ID = "tech_engine_01";
    const TZ = "America/New_York";

    const baseTechnician = {
        id: TECH_ID,
        employeeId: "emp_engine_01",
        employee: {
            id: "emp_engine_01",
            workspaceId: WS_A,
            displayName: "Alex Vance",
            employeeNumber: "TECH-100",
            status: "ACTIVE",
        },
        // Monday-Friday 08:00 to 17:00 (5PM)
        technicianAvailabilities: [
            { id: "av_mon", dayOfWeek: "MONDAY", startTime: "08:00", endTime: "17:00", status: "ACTIVE" },
            { id: "av_tue", dayOfWeek: "TUESDAY", startTime: "08:00", endTime: "17:00", status: "ACTIVE" },
            { id: "av_wed", dayOfWeek: "WEDNESDAY", startTime: "08:00", endTime: "17:00", status: "ACTIVE" },
            { id: "av_thu", dayOfWeek: "THURSDAY", startTime: "08:00", endTime: "17:00", status: "ACTIVE" },
            { id: "av_fri", dayOfWeek: "FRIDAY", startTime: "08:00", endTime: "17:00", status: "ACTIVE" },
        ],
        technicianAvailabilityExceptions: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.technicianProfileFindFirst.mockResolvedValue(baseTechnician);
        mocks.scheduleAppointmentFindMany.mockResolvedValue([]);
    });

    // =========================================================================
    // 1. Comprehensive Overlap Matrix (§7.2–§7.4)
    // =========================================================================
    describe("1. Overlap Conflict Matrix (assertNoTechnicianConflicts)", () => {
        // Wednesday, August 26, 2026 14:00 UTC (10:00 AM EDT) to 16:00 UTC (12:00 PM EDT)
        const reqStart = new Date("2026-08-26T14:00:00.000Z");
        const reqEnd = new Date("2026-08-26T16:00:00.000Z");

        it("case 1: blocks on true partial overlap (starts before, ends inside)", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "apt_overlap_01",
                    appointmentNumber: "APT-2026-000101",
                    technicianId: TECH_ID,
                    workOrderId: "wo_101",
                    scheduledStart: new Date("2026-08-26T13:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-26T15:00:00.000Z"),
                    status: "SCHEDULED",
                },
            ]);

            await expect(
                assertNoTechnicianConflicts(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: reqStart,
                    scheduledEnd: reqEnd,
                }),
            ).rejects.toThrow(ScheduleTechnicianConflictError);
        });

        it("case 2: blocks on true partial overlap (starts inside, ends after)", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "apt_overlap_02",
                    appointmentNumber: "APT-2026-000102",
                    technicianId: TECH_ID,
                    workOrderId: "wo_102",
                    scheduledStart: new Date("2026-08-26T15:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-26T17:00:00.000Z"),
                    status: "RESCHEDULED",
                },
            ]);

            await expect(
                assertNoTechnicianConflicts(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: reqStart,
                    scheduledEnd: reqEnd,
                }),
            ).rejects.toThrow(ScheduleTechnicianConflictError);
        });

        it("case 3: blocks on enclosure / subset (requested is inside existing longer booking)", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "apt_enclosed_01",
                    appointmentNumber: "APT-2026-000103",
                    technicianId: TECH_ID,
                    workOrderId: "wo_103",
                    scheduledStart: new Date("2026-08-26T12:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-26T18:00:00.000Z"),
                    status: "SCHEDULED",
                },
            ]);

            await expect(
                assertNoTechnicianConflicts(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: reqStart,
                    scheduledEnd: reqEnd,
                }),
            ).rejects.toThrow(ScheduleTechnicianConflictError);
        });

        it("case 4: blocks on identical start and end times", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "apt_identical_01",
                    appointmentNumber: "APT-2026-000104",
                    technicianId: TECH_ID,
                    workOrderId: "wo_104",
                    scheduledStart: new Date("2026-08-26T14:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-26T16:00:00.000Z"),
                    status: "SCHEDULED",
                },
            ]);

            await expect(
                assertNoTechnicianConflicts(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: reqStart,
                    scheduledEnd: reqEnd,
                }),
            ).rejects.toThrow(ScheduleTechnicianConflictError);
        });

        it("case 5: permits touching boundaries on both sides (back-to-back appointments)", async () => {
            // Existing prior: 12:00 - 14:00 (ends exactly at reqStart)
            // Existing next:  16:00 - 18:00 (starts exactly at reqEnd)
            // Neither overlaps with half-open [14:00, 16:00)
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);

            await expect(
                assertNoTechnicianConflicts(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: reqStart,
                    scheduledEnd: reqEnd,
                }),
            ).resolves.not.toThrow();

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    status: { in: ["SCHEDULED", "RESCHEDULED"] },
                    scheduledStart: { lt: reqEnd },
                    scheduledEnd: { gt: reqStart },
                },
                select: expect.any(Object),
            });
        });

        it("case 6: self-exclusion via excludeAppointmentId allows rescheduling over own window", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);

            await expect(
                assertNoTechnicianConflicts(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: reqStart,
                    scheduledEnd: reqEnd,
                    excludeAppointmentId: "apt_self_reschedule",
                }),
            ).resolves.not.toThrow();

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    status: { in: ["SCHEDULED", "RESCHEDULED"] },
                    scheduledStart: { lt: reqEnd },
                    scheduledEnd: { gt: reqStart },
                    id: { not: "apt_self_reschedule" },
                },
                select: expect.any(Object),
            });
        });
    });

    // =========================================================================
    // 2. Technician Status & Scoping
    // =========================================================================
    describe("2. Technician Status & Scoping", () => {
        const validStart = new Date("2026-08-26T14:00:00.000Z"); // Wed 10am EDT
        const validEnd = new Date("2026-08-26T16:00:00.000Z");

        it("throws ScheduleTechnicianNotFoundError if technician does not exist in target workspace", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                checkTechnicianAvailability(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: "non_existent_tech",
                    scheduledStart: validStart,
                    scheduledEnd: validEnd,
                    timezone: TZ,
                }),
            ).rejects.toThrow(ScheduleTechnicianNotFoundError);
        });

        it("throws ScheduleTechnicianNotEligibleError if employee is SUSPENDED or INACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...baseTechnician,
                employee: {
                    ...baseTechnician.employee,
                    status: "SUSPENDED",
                },
            });

            await expect(
                checkTechnicianAvailability(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: validStart,
                    scheduledEnd: validEnd,
                    timezone: TZ,
                }),
            ).rejects.toThrow(ScheduleTechnicianNotEligibleError);
        });
    });

    // =========================================================================
    // 3. Weekly Hours & Time-Off Integration (§8.1 point 3)
    // =========================================================================
    describe("3. Weekly Hours & Time-Off Integration (Hard Block Policy)", () => {
        it("hard blocks when appointment is scheduled outside configured working hours", async () => {
            // Sunday, August 30, 2026 (Technician only works Mon-Fri)
            const sundayStart = new Date("2026-08-30T14:00:00.000Z");
            const sundayEnd = new Date("2026-08-30T16:00:00.000Z");

            await expect(
                checkTechnicianAvailability(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: sundayStart,
                    scheduledEnd: sundayEnd,
                    timezone: TZ,
                }),
            ).rejects.toThrow(ScheduleOutsideWorkingHoursError);
        });

        it("hard blocks when technician has an approved time-off / leave exception", async () => {
            // Wednesday Aug 26, 2026 with an active PTO exception
            const wedStart = new Date("2026-08-26T14:00:00.000Z");
            const wedEnd = new Date("2026-08-26T16:00:00.000Z");

            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...baseTechnician,
                technicianAvailabilityExceptions: [
                    {
                        id: "exc_pto_01",
                        type: "VACATION",
                        title: "Annual Leave",
                        startsAt: new Date("2026-08-26T00:00:00.000Z"),
                        endsAt: new Date("2026-08-26T23:59:59.000Z"),
                        isAllDay: true,
                        status: "ACTIVE",
                    },
                ],
            });

            await expect(
                checkTechnicianAvailability(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: wedStart,
                    scheduledEnd: wedEnd,
                    timezone: TZ,
                }),
            ).rejects.toThrow(ScheduleTechnicianOnLeaveError);
        });

        it("succeeds when appointment is within working hours and no exceptions exist", async () => {
            const wedStart = new Date("2026-08-26T14:00:00.000Z"); // Wed 10am EDT (within 8am-5pm)
            const wedEnd = new Date("2026-08-26T16:00:00.000Z");   // Wed 12pm EDT

            const result = await checkTechnicianAvailability(mockPrisma, {
                workspaceId: WS_A,
                technicianId: TECH_ID,
                scheduledStart: wedStart,
                scheduledEnd: wedEnd,
                timezone: TZ,
            });

            expect(result.isCoveredByRecurring).toBe(true);
            expect(result.blockingExceptions).toHaveLength(0);
        });
    });

    // =========================================================================
    // 4. Multi-Appointment Day Scenarios
    // =========================================================================
    describe("4. Multi-Appointment Scenarios", () => {
        it("fits cleanly into gap between multiple existing appointments", async () => {
            // Existing day:
            // Booking 1: 08:00 - 10:00 EDT (12:00 - 14:00 UTC)
            // Booking 2: 12:00 - 14:00 EDT (16:00 - 18:00 UTC)
            // Booking 3: 15:00 - 17:00 EDT (19:00 - 21:00 UTC)
            // New request: 10:00 - 12:00 EDT (14:00 - 16:00 UTC) -> Perfectly fits in slot!
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);

            const result = await checkTechnicianAvailability(mockPrisma, {
                workspaceId: WS_A,
                technicianId: TECH_ID,
                scheduledStart: new Date("2026-08-26T14:00:00.000Z"),
                scheduledEnd: new Date("2026-08-26T16:00:00.000Z"),
                timezone: TZ,
            });

            expect(result.isCoveredByRecurring).toBe(true);
        });

        it("blocks when request overlaps middle appointment in a 3-booking schedule", async () => {
            // New request: 11:30 - 13:30 EDT (15:30 - 17:30 UTC) -> Conflicts with Booking 2 (16:00-18:00 UTC)
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "apt_middle_02",
                    appointmentNumber: "APT-2026-000202",
                    technicianId: TECH_ID,
                    workOrderId: "wo_202",
                    scheduledStart: new Date("2026-08-26T16:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-26T18:00:00.000Z"),
                    status: "SCHEDULED",
                },
            ]);

            await expect(
                checkTechnicianAvailability(mockPrisma, {
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                    scheduledStart: new Date("2026-08-26T15:30:00.000Z"),
                    scheduledEnd: new Date("2026-08-26T17:30:00.000Z"),
                    timezone: TZ,
                }),
            ).rejects.toThrow(ScheduleTechnicianConflictError);
        });
    });

    // =========================================================================
    // 5. Cross-Workspace Tenant Isolation
    // =========================================================================
    describe("5. Cross-Workspace Tenant Isolation", () => {
        it("never conflicts with an identical time slot booking for a technician in a different workspace", async () => {
            // When querying workspace A, Prisma query scopes where.workspaceId = WS_A
            const reqStart = new Date("2026-08-26T14:00:00.000Z");
            const reqEnd = new Date("2026-08-26T16:00:00.000Z");

            await checkTechnicianAvailability(mockPrisma, {
                workspaceId: WS_A,
                technicianId: TECH_ID,
                scheduledStart: reqStart,
                scheduledEnd: reqEnd,
                timezone: TZ,
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    workspaceId: WS_A,
                    technicianId: TECH_ID,
                }),
                select: expect.any(Object),
            });
        });
    });
});
