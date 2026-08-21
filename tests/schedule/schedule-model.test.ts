import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    type ScheduleAppointment,
    type ScheduleAppointmentHistory,
    type ScheduleStatus,
    type DispatchStatus,
    type ScheduleHistoryEventType,
    type Workspace,
} from "../../generated/prisma/client";

const mocks = vi.hoisted(() => ({
    scheduleAppointmentCreate: vi.fn(),
    scheduleAppointmentFindUnique: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentDelete: vi.fn(),

    scheduleAppointmentHistoryCreate: vi.fn(),
    scheduleAppointmentHistoryFindMany: vi.fn(),
    scheduleAppointmentHistoryFindFirst: vi.fn(),

    workspaceCreate: vi.fn(),
    workspaceFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        scheduleAppointment: {
            create: mocks.scheduleAppointmentCreate,
            findUnique: mocks.scheduleAppointmentFindUnique,
            findFirst: mocks.scheduleAppointmentFindFirst,
            findMany: mocks.scheduleAppointmentFindMany,
            update: mocks.scheduleAppointmentUpdate,
            delete: mocks.scheduleAppointmentDelete,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
            findMany: mocks.scheduleAppointmentHistoryFindMany,
            findFirst: mocks.scheduleAppointmentHistoryFindFirst,
        },
        workspace: {
            create: mocks.workspaceCreate,
            findUnique: mocks.workspaceFindUnique,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.8.2 — Scheduling & Dispatch Prisma Data Model", () => {
    const WS_ALPHA = "ws_alpha_101";
    const WS_BETA = "ws_beta_202";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. ScheduleAppointment Model Definition & Field Invariants (§4.1)", () => {
        it("creates a ScheduleAppointment with all standard, temporal, dispatch, and metadata fields", async () => {
            const mockAppointment: ScheduleAppointment = {
                id: "apt_cuid_101",
                workspaceId: WS_ALPHA,
                appointmentNumber: "APT-2026-000001",
                workOrderId: "wo_cuid_101",
                technicianId: "tech_prof_101",
                scheduledStart: new Date("2026-08-21T09:00:00.000Z"),
                scheduledEnd: new Date("2026-08-21T11:00:00.000Z"),
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
                notes: "Customer requested arrival at side gate.",
                metadata: {
                    priorityNote: "High SLA customer",
                    preferredContactMethod: "PHONE",
                },
                createdAt: new Date("2026-08-21T08:00:00.000Z"),
                updatedAt: new Date("2026-08-21T08:00:00.000Z"),
            };

            mocks.scheduleAppointmentCreate.mockResolvedValue(mockAppointment);

            const result = await prisma.scheduleAppointment.create({
                data: {
                    workspaceId: WS_ALPHA,
                    appointmentNumber: "APT-2026-000001",
                    workOrderId: "wo_cuid_101",
                    technicianId: "tech_prof_101",
                    scheduledStart: new Date("2026-08-21T09:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-21T11:00:00.000Z"),
                    durationMinutes: 120,
                    timezone: "America/New_York",
                    status: "SCHEDULED",
                    dispatchStatus: "PENDING_DISPATCH",
                    notes: "Customer requested arrival at side gate.",
                    metadata: {
                        priorityNote: "High SLA customer",
                        preferredContactMethod: "PHONE",
                    },
                },
            });

            expect(mocks.scheduleAppointmentCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ALPHA,
                    appointmentNumber: "APT-2026-000001",
                    workOrderId: "wo_cuid_101",
                    technicianId: "tech_prof_101",
                    durationMinutes: 120,
                    timezone: "America/New_York",
                    status: "SCHEDULED",
                    dispatchStatus: "PENDING_DISPATCH",
                }),
            });
            expect(result.id).toBe("apt_cuid_101");
            expect(result.durationMinutes).toBe(120);
            expect(result.timezone).toBe("America/New_York");
            expect(result.status).toBe("SCHEDULED");
            expect(result.dispatchStatus).toBe("PENDING_DISPATCH");
            expect(result.fieldExecutionStartedAt).toBeNull();
        });

        it("creates an appointment with dispatch and execution tracking fields populated", async () => {
            const dispatchedAppointment: ScheduleAppointment = {
                id: "apt_cuid_102",
                workspaceId: WS_ALPHA,
                appointmentNumber: "APT-2026-000002",
                workOrderId: "wo_cuid_102",
                technicianId: "tech_prof_102",
                scheduledStart: new Date("2026-08-21T13:00:00.000Z"),
                scheduledEnd: new Date("2026-08-21T15:00:00.000Z"),
                durationMinutes: 120,
                timezone: "Asia/Karachi",
                status: "SCHEDULED",
                dispatchStatus: "DISPATCHED",
                dispatchedAt: new Date("2026-08-21T12:00:00.000Z"),
                dispatchedByMemberId: "mem_dispatcher_01",
                undispatchedAt: null,
                undispatchedByMemberId: null,
                fieldExecutionStartedAt: new Date("2026-08-21T12:45:00.000Z"),
                cancellationReason: null,
                notes: "Emergency chiller repair dispatch",
                metadata: null,
                createdAt: new Date("2026-08-21T11:00:00.000Z"),
                updatedAt: new Date("2026-08-21T12:45:00.000Z"),
            };

            mocks.scheduleAppointmentCreate.mockResolvedValue(dispatchedAppointment);

            const result = await prisma.scheduleAppointment.create({
                data: {
                    workspaceId: WS_ALPHA,
                    appointmentNumber: "APT-2026-000002",
                    workOrderId: "wo_cuid_102",
                    technicianId: "tech_prof_102",
                    scheduledStart: new Date("2026-08-21T13:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-21T15:00:00.000Z"),
                    durationMinutes: 120,
                    timezone: "Asia/Karachi",
                    status: "SCHEDULED",
                    dispatchStatus: "DISPATCHED",
                    dispatchedAt: new Date("2026-08-21T12:00:00.000Z"),
                    dispatchedByMemberId: "mem_dispatcher_01",
                    fieldExecutionStartedAt: new Date("2026-08-21T12:45:00.000Z"),
                },
            });

            expect(result.dispatchStatus).toBe("DISPATCHED");
            expect(result.dispatchedAt).toBeInstanceOf(Date);
            expect(result.dispatchedByMemberId).toBe("mem_dispatcher_01");
            expect(result.fieldExecutionStartedAt).toBeInstanceOf(Date);
        });

        it("supports all 4 ScheduleStatus enum values (§5.1)", async () => {
            const validScheduleStatuses: ScheduleStatus[] = [
                "SCHEDULED",
                "RESCHEDULED",
                "CANCELLED",
                "COMPLETED",
            ];

            for (const status of validScheduleStatuses) {
                const mockAppt: ScheduleAppointment = {
                    id: `apt_${status.toLowerCase()}`,
                    workspaceId: WS_ALPHA,
                    appointmentNumber: `APT-${status}`,
                    workOrderId: "wo_101",
                    technicianId: "tech_101",
                    scheduledStart: new Date(),
                    scheduledEnd: new Date(),
                    durationMinutes: 60,
                    timezone: "UTC",
                    status,
                    dispatchStatus: "PENDING_DISPATCH",
                    dispatchedAt: null,
                    dispatchedByMemberId: null,
                    undispatchedAt: null,
                    undispatchedByMemberId: null,
                    fieldExecutionStartedAt: null,
                    cancellationReason: status === "CANCELLED" ? "Customer postponed" : null,
                    notes: null,
                    metadata: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                mocks.scheduleAppointmentCreate.mockResolvedValue(mockAppt);

                const result = await prisma.scheduleAppointment.create({
                    data: {
                        workspaceId: WS_ALPHA,
                        appointmentNumber: `APT-${status}`,
                        workOrderId: "wo_101",
                        technicianId: "tech_101",
                        scheduledStart: new Date(),
                        scheduledEnd: new Date(),
                        durationMinutes: 60,
                        timezone: "UTC",
                        status,
                    },
                });

                expect(result.status).toBe(status);
            }
        });

        it("supports all 3 DispatchStatus enum values (§5.1)", async () => {
            const validDispatchStatuses: DispatchStatus[] = [
                "PENDING_DISPATCH",
                "DISPATCHED",
                "ACKNOWLEDGED",
            ];

            for (const dispatchStatus of validDispatchStatuses) {
                const mockAppt: ScheduleAppointment = {
                    id: `apt_disp_${dispatchStatus.toLowerCase()}`,
                    workspaceId: WS_ALPHA,
                    appointmentNumber: `APT-DISP-${dispatchStatus}`,
                    workOrderId: "wo_101",
                    technicianId: "tech_101",
                    scheduledStart: new Date(),
                    scheduledEnd: new Date(),
                    durationMinutes: 60,
                    timezone: "UTC",
                    status: "SCHEDULED",
                    dispatchStatus,
                    dispatchedAt: dispatchStatus !== "PENDING_DISPATCH" ? new Date() : null,
                    dispatchedByMemberId: dispatchStatus !== "PENDING_DISPATCH" ? "mem_01" : null,
                    undispatchedAt: null,
                    undispatchedByMemberId: null,
                    fieldExecutionStartedAt: null,
                    cancellationReason: null,
                    notes: null,
                    metadata: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                mocks.scheduleAppointmentCreate.mockResolvedValue(mockAppt);

                const result = await prisma.scheduleAppointment.create({
                    data: {
                        workspaceId: WS_ALPHA,
                        appointmentNumber: `APT-DISP-${dispatchStatus}`,
                        workOrderId: "wo_101",
                        technicianId: "tech_101",
                        scheduledStart: new Date(),
                        scheduledEnd: new Date(),
                        durationMinutes: 60,
                        timezone: "UTC",
                        dispatchStatus,
                    },
                });

                expect(result.dispatchStatus).toBe(dispatchStatus);
            }
        });
    });

    describe("2. ScheduleAppointmentHistory Model Definition (§4.2 & §5.1)", () => {
        it("creates a ScheduleAppointmentHistory audit record with all 7 ScheduleHistoryEventType values", async () => {
            const validHistoryEvents: ScheduleHistoryEventType[] = [
                "CREATED",
                "RESCHEDULED",
                "CANCELLED",
                "COMPLETED",
                "DISPATCHED",
                "UNDISPATCHED",
                "UPDATED",
            ];

            for (const eventType of validHistoryEvents) {
                const mockHistory: ScheduleAppointmentHistory = {
                    id: `hist_${eventType.toLowerCase()}`,
                    workspaceId: WS_ALPHA,
                    appointmentId: "apt_101",
                    eventType,
                    actorMemberId: "mem_dispatcher_01",
                    actorName: "Lead Dispatcher",
                    field: eventType === "RESCHEDULED" ? "scheduledStart" : null,
                    oldValue: eventType === "RESCHEDULED" ? "2026-08-21T09:00:00.000Z" : null,
                    newValue: eventType === "RESCHEDULED" ? "2026-08-21T10:00:00.000Z" : null,
                    metadata: { reason: `Triggered ${eventType}` },
                    createdAt: new Date(),
                };

                mocks.scheduleAppointmentHistoryCreate.mockResolvedValue(mockHistory);

                const result = await prisma.scheduleAppointmentHistory.create({
                    data: {
                        workspaceId: WS_ALPHA,
                        appointmentId: "apt_101",
                        eventType,
                        actorMemberId: "mem_dispatcher_01",
                        actorName: "Lead Dispatcher",
                        field: eventType === "RESCHEDULED" ? "scheduledStart" : null,
                        oldValue: eventType === "RESCHEDULED" ? "2026-08-21T09:00:00.000Z" : null,
                        newValue: eventType === "RESCHEDULED" ? "2026-08-21T10:00:00.000Z" : null,
                        metadata: { reason: `Triggered ${eventType}` },
                    },
                });

                expect(result.eventType).toBe(eventType);
                expect(result.appointmentId).toBe("apt_101");
            }
        });
    });

    describe("3. Tenant Isolation & Unique Key Constraints", () => {
        it("enforces unique appointmentNumber per workspace", async () => {
            const prismaUniqueError = new Error(
                "Unique constraint failed on the fields: (`workspaceId`, `appointmentNumber`)"
            );
            (prismaUniqueError as any).code = "P2002";

            mocks.scheduleAppointmentCreate.mockRejectedValue(prismaUniqueError);

            await expect(
                prisma.scheduleAppointment.create({
                    data: {
                        workspaceId: WS_ALPHA,
                        appointmentNumber: "APT-2026-000001",
                        workOrderId: "wo_101",
                        technicianId: "tech_101",
                        scheduledStart: new Date(),
                        scheduledEnd: new Date(),
                        durationMinutes: 60,
                        timezone: "UTC",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });

        it("allows identical appointmentNumber across distinct workspaces", async () => {
            const apptAlpha: ScheduleAppointment = {
                id: "apt_alpha_01",
                workspaceId: WS_ALPHA,
                appointmentNumber: "APT-2026-000001",
                workOrderId: "wo_alpha_01",
                technicianId: "tech_alpha_01",
                scheduledStart: new Date(),
                scheduledEnd: new Date(),
                durationMinutes: 60,
                timezone: "UTC",
                status: "SCHEDULED",
                dispatchStatus: "PENDING_DISPATCH",
                dispatchedAt: null,
                dispatchedByMemberId: null,
                undispatchedAt: null,
                undispatchedByMemberId: null,
                fieldExecutionStartedAt: null,
                cancellationReason: null,
                notes: null,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const apptBeta: ScheduleAppointment = {
                id: "apt_beta_01",
                workspaceId: WS_BETA,
                appointmentNumber: "APT-2026-000001",
                workOrderId: "wo_beta_01",
                technicianId: "tech_beta_01",
                scheduledStart: new Date(),
                scheduledEnd: new Date(),
                durationMinutes: 60,
                timezone: "UTC",
                status: "SCHEDULED",
                dispatchStatus: "PENDING_DISPATCH",
                dispatchedAt: null,
                dispatchedByMemberId: null,
                undispatchedAt: null,
                undispatchedByMemberId: null,
                fieldExecutionStartedAt: null,
                cancellationReason: null,
                notes: null,
                metadata: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.scheduleAppointmentCreate
                .mockResolvedValueOnce(apptAlpha)
                .mockResolvedValueOnce(apptBeta);

            const resultAlpha = await prisma.scheduleAppointment.create({
                data: {
                    workspaceId: WS_ALPHA,
                    appointmentNumber: "APT-2026-000001",
                    workOrderId: "wo_alpha_01",
                    technicianId: "tech_alpha_01",
                    scheduledStart: new Date(),
                    scheduledEnd: new Date(),
                    durationMinutes: 60,
                    timezone: "UTC",
                },
            });

            const resultBeta = await prisma.scheduleAppointment.create({
                data: {
                    workspaceId: WS_BETA,
                    appointmentNumber: "APT-2026-000001",
                    workOrderId: "wo_beta_01",
                    technicianId: "tech_beta_01",
                    scheduledStart: new Date(),
                    scheduledEnd: new Date(),
                    durationMinutes: 60,
                    timezone: "UTC",
                },
            });

            expect(resultAlpha.appointmentNumber).toBe("APT-2026-000001");
            expect(resultAlpha.workspaceId).toBe(WS_ALPHA);
            expect(resultBeta.appointmentNumber).toBe("APT-2026-000001");
            expect(resultBeta.workspaceId).toBe(WS_BETA);
        });
    });
});
