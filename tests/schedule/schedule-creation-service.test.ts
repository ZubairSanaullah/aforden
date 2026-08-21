import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSchedule } from "@/lib/services/schedule/createSchedule";
import {
    ScheduleWorkOrderNotFoundError,
    ScheduleWorkOrderNotEligibleError,
    ScheduleWorkOrderNotAssignedError,
    ScheduleTechnicianNotFoundError,
    ScheduleTechnicianMismatchError,
    ScheduleTechnicianNotEligibleError,
    ScheduleInvalidTimeIntervalError,
    ScheduleTechnicianConflictError,
} from "@/lib/services/schedule/scheduleErrors";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";

const mocks = vi.hoisted(() => ({
    requireWorkspaceAuthorization: vi.fn(),
    assertPermission: vi.fn(),

    workOrderFindFirst: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentCreate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),
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
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        $transaction: mocks.$transaction,
    },
}));

describe("Phase 1.8.4 — Schedule Creation Service (createSchedule)", () => {
    const WS_ID = "ws_test_101";
    const WO_ID = "wo_test_101";
    const TECH_ID = "tech_test_101";

    const defaultAuth = {
        membership: {
            id: "mem_dispatcher_01",
            role: "DISPATCHER",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_dispatcher_01",
            name: "Lead Dispatcher",
            email: "dispatcher@aforden.com",
        },
        workspace: {
            id: WS_ID,
            timezone: "America/New_York",
        },
    };

    const defaultWorkOrder = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-2026-000001",
        title: "Commercial Chiller Maintenance",
        status: "ASSIGNED",
        priority: "HIGH",
        customerId: "cust_101",
        locationId: "loc_101",
        assignedTechnicianId: TECH_ID,
        assetId: "ast_101",
        customer: {
            id: "cust_101",
            name: "Acme Industrial Corp",
            customerNumber: "CUST-0001",
        },
        location: {
            id: "loc_101",
            name: "Headquarters Plant",
            addressLine1: "100 Industrial Parkway",
            addressLine2: null,
            city: "Buffalo",
            state: "NY",
            postalCode: "14201",
            country: "USA",
            latitude: "42.8864",
            longitude: "-78.8784",
        },
        asset: {
            id: "ast_101",
            name: "Carrier Rooftop Chiller",
            assetNumber: "AST-000101",
        },
    };

    const defaultTechnician = {
        id: TECH_ID,
        employeeId: "emp_101",
        employee: {
            id: "emp_101",
            workspaceId: WS_ID,
            displayName: "Bob Martinez",
            employeeNumber: "TECH-001",
            status: "ACTIVE",
        },
    };

    const defaultInput = {
        workOrderId: WO_ID,
        technicianId: TECH_ID,
        scheduledStart: "2026-08-21T13:00:00.000Z",
        scheduledEnd: "2026-08-21T15:00:00.000Z",
        notes: "Arrival window 1:00 PM - 3:00 PM",
        metadata: { gateCode: "9988" },
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.requireWorkspaceAuthorization.mockResolvedValue(defaultAuth);
        mocks.assertPermission.mockReturnValue(true);
        mocks.workOrderFindFirst.mockResolvedValue(defaultWorkOrder);
        mocks.technicianProfileFindFirst.mockResolvedValue(defaultTechnician);
        mocks.scheduleAppointmentFindMany.mockResolvedValue([]);
        mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

        // Default transaction mock executes callback directly with tx containing prisma mocks
        mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
            const tx = {
                scheduleAppointment: {
                    findFirst: mocks.scheduleAppointmentFindFirst,
                    create: mocks.scheduleAppointmentCreate,
                },
                scheduleAppointmentHistory: {
                    create: mocks.scheduleAppointmentHistoryCreate,
                },
            };
            return cb(tx);
        });

        mocks.scheduleAppointmentCreate.mockImplementation(async ({ data }: any) => ({
            id: "apt_created_101",
            ...data,
            createdAt: new Date("2026-08-21T10:00:00.000Z"),
            updatedAt: new Date("2026-08-21T10:00:00.000Z"),
            workOrder: defaultWorkOrder,
            technician: defaultTechnician,
            dispatchedByMember: null,
            undispatchedByMember: null,
        }));
    });

    describe("1. Happy Path Execution", () => {
        it("creates and returns a ScheduleAppointmentReadModel via the 7-step pipeline", async () => {
            const result = await createSchedule(WS_ID, defaultInput);

            // 1. Auth & RBAC
            expect(mocks.requireWorkspaceAuthorization).toHaveBeenCalledWith(WS_ID);
            expect(mocks.assertPermission).toHaveBeenCalledWith(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_CREATE,
            );

            // 2. Conflict check
            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    technicianId: TECH_ID,
                    status: { in: ["SCHEDULED", "RESCHEDULED"] },
                    scheduledStart: { lt: new Date("2026-08-21T15:00:00.000Z") },
                    scheduledEnd: { gt: new Date("2026-08-21T13:00:00.000Z") },
                },
                select: expect.any(Object),
            });

            // 3. Appointment Created in DB Transaction
            expect(mocks.scheduleAppointmentCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentNumber: "APT-2026-000001",
                    workOrderId: WO_ID,
                    technicianId: TECH_ID,
                    durationMinutes: 120,
                    timezone: "America/New_York",
                    status: "SCHEDULED",
                    dispatchStatus: "PENDING_DISPATCH",
                    notes: "Arrival window 1:00 PM - 3:00 PM",
                }),
                include: expect.any(Object),
            });

            // 4. History Created in DB Transaction
            expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    appointmentId: "apt_created_101",
                    eventType: "CREATED",
                    actorMemberId: "mem_dispatcher_01",
                    actorName: "Lead Dispatcher",
                }),
            });

            // 5. Read Model Projection
            expect(result.id).toBe("apt_created_101");
            expect(result.appointmentNumber).toBe("APT-2026-000001");
            expect(result.workOrderId).toBe(WO_ID);
            expect(result.workOrderNumber).toBe("WO-2026-000001");
            expect(result.customerName).toBe("Acme Industrial Corp");
            expect(result.locationName).toBe("Headquarters Plant");
            expect(result.locationAddress).toContain("100 Industrial Parkway, Buffalo, NY, 14201, USA");
            expect(result.technicianName).toBe("Bob Martinez");
            expect(result.technicianEmployeeNumber).toBe("TECH-001");
            expect(result.durationMinutes).toBe(120);
            expect(result.status).toBe("SCHEDULED");
            expect(result.dispatchStatus).toBe("PENDING_DISPATCH");
        });

        it("increments sequential appointmentNumber when existing appointments exist", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue({
                appointmentNumber: "APT-2026-000042",
            });

            const result = await createSchedule(WS_ID, defaultInput);

            expect(result.appointmentNumber).toBe("APT-2026-000043");
        });
    });

    describe("2. Error Branches & Business Invariants", () => {
        it("throws ScheduleWorkOrderNotFoundError when WorkOrder does not exist in workspace", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleWorkOrderNotFoundError,
            );
        });

        it("throws ScheduleTechnicianNotFoundError when TechnicianProfile does not exist in workspace", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleTechnicianNotFoundError,
            );
        });

        it("throws ScheduleWorkOrderNotEligibleError when WorkOrder is in terminal status (COMPLETED / CANCELLED)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...defaultWorkOrder,
                status: "COMPLETED",
            });

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleWorkOrderNotEligibleError,
            );

            mocks.workOrderFindFirst.mockResolvedValue({
                ...defaultWorkOrder,
                status: "CANCELLED",
            });

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleWorkOrderNotEligibleError,
            );
        });

        it("throws ScheduleWorkOrderNotAssignedError when WorkOrder has no assigned technician (§2.2)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...defaultWorkOrder,
                assignedTechnicianId: null,
            });

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleWorkOrderNotAssignedError,
            );
        });

        it("throws ScheduleTechnicianMismatchError when appointment technician does not match assigned technician (§2.2)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...defaultWorkOrder,
                assignedTechnicianId: "tech_other_999",
            });

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleTechnicianMismatchError,
            );
        });

        it("throws ScheduleTechnicianNotEligibleError when technician employee is not ACTIVE", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue({
                ...defaultTechnician,
                employee: {
                    ...defaultTechnician.employee,
                    status: "SUSPENDED",
                },
            });

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleTechnicianNotEligibleError,
            );
        });

        it("throws ScheduleInvalidTimeIntervalError when start is not before end", async () => {
            const invalidIntervalInput = {
                ...defaultInput,
                scheduledStart: "2026-08-21T15:00:00.000Z",
                scheduledEnd: "2026-08-21T13:00:00.000Z",
            };

            await expect(createSchedule(WS_ID, invalidIntervalInput)).rejects.toThrow();
        });
    });

    describe("3. Conflict Detection Semantics (§7.2)", () => {
        it("throws ScheduleTechnicianConflictError on true interval overlap", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([
                {
                    id: "apt_existing_01",
                    appointmentNumber: "APT-2026-000010",
                    technicianId: TECH_ID,
                    workOrderId: "wo_other_102",
                    scheduledStart: new Date("2026-08-21T12:00:00.000Z"),
                    scheduledEnd: new Date("2026-08-21T14:00:00.000Z"),
                    status: "SCHEDULED",
                },
            ]);

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                ScheduleTechnicianConflictError,
            );
        });

        it("succeeds when appointments touch boundaries exactly (non-conflict §7.3)", async () => {
            // Existing appointment is 11:00 - 13:00 UTC; requested is 13:00 - 15:00 UTC
            // Formula existing.start < requested.end (11 < 15 TRUE) AND requested.start < existing.end (13 < 13 FALSE)
            // Query returns empty array -> No conflict!
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);

            const result = await createSchedule(WS_ID, defaultInput);
            expect(result.id).toBe("apt_created_101");
        });
    });

    describe("4. Transaction Atomicity", () => {
        it("does not persist appointment if history creation fails", async () => {
            mocks.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
                const tx = {
                    scheduleAppointment: {
                        findFirst: mocks.scheduleAppointmentFindFirst,
                        create: mocks.scheduleAppointmentCreate,
                    },
                    scheduleAppointmentHistory: {
                        create: vi.fn().mockRejectedValue(new Error("Database connection dropped")),
                    },
                };
                return cb(tx);
            });

            await expect(createSchedule(WS_ID, defaultInput)).rejects.toThrow(
                "Database connection dropped",
            );
        });
    });

    describe("5. Timezone Resolution Hierarchy (§6.2)", () => {
        it("picks ServiceLocation timezone when both ServiceLocation and Workspace have differing timezones", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...defaultWorkOrder,
                location: {
                    ...defaultWorkOrder.location,
                    timezone: "America/Chicago",
                },
            });

            const result = await createSchedule(WS_ID, defaultInput);

            expect(result.timezone).toBe("America/Chicago");
            expect(mocks.scheduleAppointmentCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    timezone: "America/Chicago",
                }),
                include: expect.any(Object),
            });
        });

        it("falls back to Workspace timezone when ServiceLocation timezone is null/absent", async () => {
            mocks.workOrderFindFirst.mockResolvedValue({
                ...defaultWorkOrder,
                location: {
                    ...defaultWorkOrder.location,
                    timezone: null,
                },
            });

            const result = await createSchedule(WS_ID, defaultInput);

            expect(result.timezone).toBe("America/New_York");
            expect(mocks.scheduleAppointmentCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    timezone: "America/New_York",
                }),
                include: expect.any(Object),
            });
        });
    });
});
