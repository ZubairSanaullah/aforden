import { describe, expect, it } from "vitest";
import {
    createScheduleAppointmentSchema,
    rescheduleAppointmentSchema,
    cancelAppointmentSchema,
    updateScheduleAppointmentSchema,
    dispatchAppointmentSchema,
    undispatchAppointmentSchema,
    acknowledgeDispatchSchema,
    listSchedulesQuerySchema,
} from "@/lib/services/schedule/schedule.schemas";

describe("Phase 1.8.3 — Scheduling & Dispatch Validation Schemas", () => {
    describe("1. createScheduleAppointmentSchema", () => {
        const validPayload = {
            workOrderId: "wo_101",
            technicianId: "tech_101",
            scheduledStart: "2026-08-21T09:00:00.000Z",
            scheduledEnd: "2026-08-21T11:00:00.000Z",
            timezone: "America/New_York",
            notes: "Please check filter replacement",
            metadata: { priorityTier: "GOLD" },
        };

        it("parses and coerces valid appointment creation payload", () => {
            const parsed = createScheduleAppointmentSchema.parse(validPayload);
            expect(parsed.workOrderId).toBe("wo_101");
            expect(parsed.technicianId).toBe("tech_101");
            expect(parsed.scheduledStart).toBeInstanceOf(Date);
            expect(parsed.scheduledEnd).toBeInstanceOf(Date);
            expect(parsed.timezone).toBe("America/New_York");
            expect(parsed.notes).toBe("Please check filter replacement");
            expect(parsed.metadata).toEqual({ priorityTier: "GOLD" });
        });

        it("fails when scheduledStart is equal to scheduledEnd", () => {
            const payload = {
                ...validPayload,
                scheduledStart: "2026-08-21T09:00:00.000Z",
                scheduledEnd: "2026-08-21T09:00:00.000Z",
            };
            expect(() => createScheduleAppointmentSchema.parse(payload)).toThrowError(
                /Scheduled start time must be strictly earlier than end time/
            );
        });

        it("fails when scheduledStart is later than scheduledEnd", () => {
            const payload = {
                ...validPayload,
                scheduledStart: "2026-08-21T10:00:00.000Z",
                scheduledEnd: "2026-08-21T09:00:00.000Z",
            };
            expect(() => createScheduleAppointmentSchema.parse(payload)).toThrowError(
                /Scheduled start time must be strictly earlier than end time/
            );
        });

        it("fails when duration is less than 5 minutes", () => {
            const payload = {
                ...validPayload,
                scheduledStart: "2026-08-21T09:00:00.000Z",
                scheduledEnd: "2026-08-21T09:04:00.000Z", // 4 minutes
            };
            expect(() => createScheduleAppointmentSchema.parse(payload)).toThrowError(
                /Appointment duration must be at least 5 minutes/
            );
        });

        it("fails when duration exceeds 14 days", () => {
            const payload = {
                ...validPayload,
                scheduledStart: "2026-08-01T09:00:00.000Z",
                scheduledEnd: "2026-08-16T09:00:00.000Z", // 15 days
            };
            expect(() => createScheduleAppointmentSchema.parse(payload)).toThrowError(
                /Appointment duration cannot exceed 14 days/
            );
        });

        it("fails when workOrderId or technicianId is empty", () => {
            expect(() =>
                createScheduleAppointmentSchema.parse({
                    ...validPayload,
                    workOrderId: "   ",
                })
            ).toThrowError(/Work order ID is required/);

            expect(() =>
                createScheduleAppointmentSchema.parse({
                    ...validPayload,
                    technicianId: "",
                })
            ).toThrowError(/Technician ID is required/);
        });

        it("rejects unrecognized properties (.strict())", () => {
            expect(() =>
                createScheduleAppointmentSchema.parse({
                    ...validPayload,
                    unknownProperty: "malicious",
                })
            ).toThrow();
        });
    });

    describe("2. rescheduleAppointmentSchema", () => {
        const validReschedule = {
            scheduledStart: "2026-08-22T10:00:00.000Z",
            scheduledEnd: "2026-08-22T12:00:00.000Z",
            reason: "Customer requested morning slot",
            timezone: "America/Chicago",
        };

        it("parses valid reschedule payload with mandatory reason", () => {
            const parsed = rescheduleAppointmentSchema.parse(validReschedule);
            expect(parsed.scheduledStart).toBeInstanceOf(Date);
            expect(parsed.scheduledEnd).toBeInstanceOf(Date);
            expect(parsed.reason).toBe("Customer requested morning slot");
            expect(parsed.timezone).toBe("America/Chicago");
        });

        it("fails when reason is missing or empty", () => {
            expect(() =>
                rescheduleAppointmentSchema.parse({
                    ...validReschedule,
                    reason: "   ",
                })
            ).toThrowError(/Reschedule reason is required/);
        });

        it("enforces start < end on reschedule", () => {
            expect(() =>
                rescheduleAppointmentSchema.parse({
                    ...validReschedule,
                    scheduledStart: "2026-08-22T14:00:00.000Z",
                    scheduledEnd: "2026-08-22T12:00:00.000Z",
                })
            ).toThrowError(/Scheduled start time must be strictly earlier than end time/);
        });
    });

    describe("3. cancelAppointmentSchema", () => {
        it("parses valid cancellation payload with non-empty reason", () => {
            const parsed = cancelAppointmentSchema.parse({
                cancellationReason: "Parts unavailable on site",
            });
            expect(parsed.cancellationReason).toBe("Parts unavailable on site");
        });

        it("fails when cancellationReason is empty or whitespace", () => {
            expect(() =>
                cancelAppointmentSchema.parse({
                    cancellationReason: "    ",
                })
            ).toThrowError(/Cancellation reason is required/);
        });

        it("rejects unknown properties (.strict())", () => {
            expect(() =>
                cancelAppointmentSchema.parse({
                    cancellationReason: "Valid reason",
                    extraField: 123,
                })
            ).toThrow();
        });
    });

    describe("4. updateScheduleAppointmentSchema", () => {
        it("parses valid partial metadata updates", () => {
            const parsed = updateScheduleAppointmentSchema.parse({
                notes: "Updated gate access code: #4491",
                metadata: { accessCode: "4491" },
            });
            expect(parsed.notes).toBe("Updated gate access code: #4491");
            expect(parsed.metadata).toEqual({ accessCode: "4491" });
        });

        it("allows clearing notes with null", () => {
            const parsed = updateScheduleAppointmentSchema.parse({
                notes: null,
            });
            expect(parsed.notes).toBeNull();
        });
    });

    describe("5. dispatch, undispatch & acknowledge schemas", () => {
        it("parses dispatch payload with optional notes", () => {
            const parsed = dispatchAppointmentSchema.parse({
                notes: "Urgent emergency dispatch",
            });
            expect(parsed.notes).toBe("Urgent emergency dispatch");

            const emptyParsed = dispatchAppointmentSchema.parse({});
            expect(emptyParsed.notes).toBeUndefined();
        });

        it("parses undispatch payload with optional reason", () => {
            const parsed = undispatchAppointmentSchema.parse({
                reason: "Technician reassignment required",
            });
            expect(parsed.reason).toBe("Technician reassignment required");
        });

        it("parses acknowledge payload with optional notes", () => {
            const parsed = acknowledgeDispatchSchema.parse({
                notes: "Received and confirmed via mobile",
            });
            expect(parsed.notes).toBe("Received and confirmed via mobile");
        });
    });

    describe("6. listSchedulesQuerySchema", () => {
        it("applies defaults for pagination and sorting", () => {
            const parsed = listSchedulesQuerySchema.parse({});
            expect(parsed.page).toBe(1);
            expect(parsed.limit).toBe(20);
            expect(parsed.sortBy).toBe("scheduledStart");
            expect(parsed.sortOrder).toBe("asc");
        });

        it("parses valid filters and date ranges", () => {
            const parsed = listSchedulesQuerySchema.parse({
                technicianId: "tech_01",
                workOrderId: "wo_01",
                customerId: "cust_01",
                locationId: "loc_01",
                status: "SCHEDULED",
                dispatchStatus: "DISPATCHED",
                startDate: "2026-08-21T00:00:00.000Z",
                endDate: "2026-08-21T23:59:59.000Z",
                search: "chiller",
                page: "2",
                limit: "50",
                sortBy: "createdAt",
                sortOrder: "desc",
            });

            expect(parsed.technicianId).toBe("tech_01");
            expect(parsed.status).toBe("SCHEDULED");
            expect(parsed.dispatchStatus).toBe("DISPATCHED");
            expect(parsed.startDate).toBeInstanceOf(Date);
            expect(parsed.endDate).toBeInstanceOf(Date);
            expect(parsed.page).toBe(2);
            expect(parsed.limit).toBe(50);
            expect(parsed.sortBy).toBe("createdAt");
            expect(parsed.sortOrder).toBe("desc");
        });

        it("rejects invalid status or invalid sortBy values", () => {
            expect(() =>
                listSchedulesQuerySchema.parse({
                    status: "INVALID_STATUS",
                })
            ).toThrow();

            expect(() =>
                listSchedulesQuerySchema.parse({
                    sortBy: "nonExistentField",
                })
            ).toThrow();
        });
    });
});
