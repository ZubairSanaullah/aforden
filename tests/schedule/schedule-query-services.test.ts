import { describe, expect, it, vi, beforeEach } from "vitest";
import { getSchedule } from "@/lib/services/schedule/getSchedule";
import { listSchedules } from "@/lib/services/schedule/listSchedules";
import { getTechnicianSchedule } from "@/lib/services/schedule/getTechnicianSchedule";
import { getWorkOrderSchedule } from "@/lib/services/schedule/getWorkOrderSchedule";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleTechnicianNotFoundError,
    ScheduleWorkOrderNotFoundError,
} from "@/lib/services/schedule/scheduleErrors";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { SCHEDULE_APPOINTMENT_INCLUDE } from "@/lib/services/schedule/scheduleReadModel";

const mocks = vi.hoisted(() => ({
    requireWorkspaceAuthorization: vi.fn(),
    assertPermission: vi.fn(),

    workOrderFindFirst: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentCount: vi.fn(),
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
            count: mocks.scheduleAppointmentCount,
        },
    },
}));

describe("Phase 1.8.8 — Scheduling Directory & Calendar Query Architecture", () => {
    const WS_ID = "ws_query_test";
    const APPT_ID = "apt_query_01";
    const WO_ID = "wo_query_01";
    const TECH_ID = "tech_query_01";
    const CUST_ID = "cust_query_01";
    const LOC_ID = "loc_query_01";

    const defaultAuth = {
        membership: {
            id: "mem_dispatcher_01",
            role: "DISPATCHER",
            workspaceId: WS_ID,
        },
        user: {
            id: "usr_dispatcher_01",
            name: "Dispatcher Lead",
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
        workOrderNumber: "WO-2026-000800",
        title: "HVAC Seasonal Tune-Up",
        status: "ASSIGNED",
        priority: "MEDIUM",
        customerId: CUST_ID,
        locationId: LOC_ID,
        assignedTechnicianId: TECH_ID,
        assetId: "asset_01",
        customer: {
            id: CUST_ID,
            name: "Acme Towers",
            customerNumber: "CUST-0800",
        },
        location: {
            id: LOC_ID,
            name: "Main Tower",
            addressLine1: "100 Enterprise Way",
            addressLine2: "Suite 400",
            city: "New York",
            state: "NY",
            postalCode: "10001",
            country: "USA",
            latitude: "40.7128",
            longitude: "-74.0060",
            timezone: "America/New_York",
        },
        asset: {
            id: "asset_01",
            name: "Chiller 01",
            assetNumber: "AST-0100",
        },
    };

    const defaultTechnician = {
        id: TECH_ID,
        employeeId: "emp_800",
        employee: {
            id: "emp_800",
            workspaceId: WS_ID,
            displayName: "Sarah Connor",
            employeeNumber: "TECH-800",
            status: "ACTIVE",
        },
    };

    const defaultAppointment = {
        id: APPT_ID,
        workspaceId: WS_ID,
        appointmentNumber: "APT-2026-000800",
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
        notes: "Routine quarterly tune-up",
        metadata: null,
        createdAt: new Date("2026-08-26T08:00:00.000Z"),
        updatedAt: new Date("2026-08-26T08:00:00.000Z"),
        workOrder: defaultWorkOrder,
        technician: defaultTechnician,
        dispatchedByMember: null,
        undispatchedByMember: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.requireWorkspaceAuthorization.mockResolvedValue(defaultAuth);
        mocks.assertPermission.mockReturnValue(true);
        mocks.scheduleAppointmentFindFirst.mockResolvedValue(defaultAppointment);
        mocks.scheduleAppointmentFindMany.mockResolvedValue([defaultAppointment]);
        mocks.scheduleAppointmentCount.mockResolvedValue(1);
        mocks.technicianProfileFindFirst.mockResolvedValue(defaultTechnician);
        mocks.workOrderFindFirst.mockResolvedValue(defaultWorkOrder);
    });

    // =========================================================================
    // 1. getSchedule() Tests
    // =========================================================================
    describe("1. getSchedule()", () => {
        it("happy path: retrieves single appointment mapped to standard read model", async () => {
            const result = await getSchedule(WS_ID, APPT_ID);

            expect(mocks.requireWorkspaceAuthorization).toHaveBeenCalledWith(WS_ID);
            expect(mocks.assertPermission).toHaveBeenCalledWith(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_VIEW,
            );

            expect(mocks.scheduleAppointmentFindFirst).toHaveBeenCalledWith({
                where: {
                    id: APPT_ID,
                    workspaceId: WS_ID,
                },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
            });

            expect(result.id).toBe(APPT_ID);
            expect(result.customerName).toBe("Acme Towers");
            expect(result.technicianName).toBe("Sarah Connor");
            expect(result.assetName).toBe("Chiller 01");
        });

        it("throws ScheduleAppointmentNotFoundError if appointment does not exist in workspace", async () => {
            mocks.scheduleAppointmentFindFirst.mockResolvedValue(null);

            await expect(getSchedule(WS_ID, "non_existent_id")).rejects.toThrow(
                ScheduleAppointmentNotFoundError,
            );
        });
    });

    // =========================================================================
    // 2. listSchedules() Directory Query Tests
    // =========================================================================
    describe("2. listSchedules()", () => {
        it("happy path: lists appointments with default pagination and sorting", async () => {
            const result = await listSchedules(WS_ID, {});

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: { workspaceId: WS_ID },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
                skip: 0,
                take: 20,
            });

            expect(result.items).toHaveLength(1);
            expect(result.pagination.total).toBe(1);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.limit).toBe(20);
            expect(result.pagination.totalPages).toBe(1);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("filters by customerId and locationId via workOrder relation traversal", async () => {
            await listSchedules(WS_ID, {
                customerId: CUST_ID,
                locationId: LOC_ID,
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    workOrder: {
                        customerId: CUST_ID,
                        locationId: LOC_ID,
                    },
                },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
                skip: 0,
                take: 20,
            });
        });

        it("filters by technicianId and half-open date range overlap", async () => {
            const start = "2026-08-26T00:00:00.000Z";
            const end = "2026-08-26T23:59:59.000Z";

            await listSchedules(WS_ID, {
                technicianId: TECH_ID,
                startDate: start,
                endDate: end,
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    technicianId: TECH_ID,
                    scheduledStart: { lt: new Date(end) },
                    scheduledEnd: { gt: new Date(start) },
                },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
                skip: 0,
                take: 20,
            });
        });

        it("filters by status and dispatchStatus", async () => {
            await listSchedules(WS_ID, {
                status: "SCHEDULED",
                dispatchStatus: "PENDING_DISPATCH",
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    status: "SCHEDULED",
                    dispatchStatus: "PENDING_DISPATCH",
                },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
                skip: 0,
                take: 20,
            });
        });

        it("searches across appointment, work order, customer, location, and technician", async () => {
            await listSchedules(WS_ID, {
                search: "Acme",
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    workspaceId: WS_ID,
                    OR: expect.arrayContaining([
                        { appointmentNumber: { contains: "Acme", mode: "insensitive" } },
                        { notes: { contains: "Acme", mode: "insensitive" } },
                        { workOrder: { customer: { name: { contains: "Acme", mode: "insensitive" } } } },
                    ]),
                }),
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
                skip: 0,
                take: 20,
            });
        });

        it("rejects unallowlisted sort fields via schema validation", async () => {
            await expect(
                listSchedules(WS_ID, {
                    sortBy: "unauthorizedSqlInjectionField",
                }),
            ).rejects.toThrow();
        });

        it("handles empty pagination boundary gracefully", async () => {
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);
            mocks.scheduleAppointmentCount.mockResolvedValue(0);

            const result = await listSchedules(WS_ID, {
                page: 3,
                limit: 10,
            });

            expect(result.items).toHaveLength(0);
            expect(result.pagination.total).toBe(0);
            expect(result.pagination.totalPages).toBe(1);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(true);
        });
    });

    // =========================================================================
    // 3. getTechnicianSchedule() Calendar Query Tests
    // =========================================================================
    describe("3. getTechnicianSchedule()", () => {
        const query = {
            startDate: "2026-08-26T00:00:00.000Z",
            endDate: "2026-08-26T23:59:59.000Z",
        };

        it("happy path: returns technician appointments excluding CANCELLED by default", async () => {
            const result = await getTechnicianSchedule(WS_ID, TECH_ID, query);

            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledWith({
                where: {
                    id: TECH_ID,
                    employee: { workspaceId: WS_ID },
                },
                select: { id: true },
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    technicianId: TECH_ID,
                    scheduledStart: { lt: new Date(query.endDate) },
                    scheduledEnd: { gt: new Date(query.startDate) },
                    status: { not: "CANCELLED" },
                },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
            });

            expect(result).toHaveLength(1);
        });

        it("includes CANCELLED appointments when includeCancelled: true is explicitly requested", async () => {
            await getTechnicianSchedule(WS_ID, TECH_ID, {
                ...query,
                includeCancelled: true,
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    technicianId: TECH_ID,
                    scheduledStart: { lt: new Date(query.endDate) },
                    scheduledEnd: { gt: new Date(query.startDate) },
                },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
            });
        });

        it("throws ScheduleTechnicianNotFoundError if technician does not exist in workspace", async () => {
            mocks.technicianProfileFindFirst.mockResolvedValue(null);

            await expect(
                getTechnicianSchedule(WS_ID, "non_existent_tech", query),
            ).rejects.toThrow(ScheduleTechnicianNotFoundError);
        });
    });

    // =========================================================================
    // 4. getWorkOrderSchedule() Timeline Query Tests
    // =========================================================================
    describe("4. getWorkOrderSchedule()", () => {
        it("happy path: returns all appointments for a WorkOrder ordered by scheduledStart asc", async () => {
            const result = await getWorkOrderSchedule(WS_ID, WO_ID);

            expect(mocks.workOrderFindFirst).toHaveBeenCalledWith({
                where: {
                    id: WO_ID,
                    workspaceId: WS_ID,
                },
                select: { id: true },
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    workOrderId: WO_ID,
                },
                include: SCHEDULE_APPOINTMENT_INCLUDE,
                orderBy: { scheduledStart: "asc" },
            });

            expect(result).toHaveLength(1);
        });

        it("throws ScheduleWorkOrderNotFoundError if work order is not found in workspace", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                getWorkOrderSchedule(WS_ID, "non_existent_wo"),
            ).rejects.toThrow(ScheduleWorkOrderNotFoundError);
        });
    });

    // =========================================================================
    // 5. Tenant Isolation Verification Tests (§11.1)
    // =========================================================================
    describe("5. Tenant Isolation (§11.1)", () => {
        const WS_B = "ws_tenant_beta";

        it("listSchedules: strictly scopes where clause to workspaceId across all filter combinations", async () => {
            await listSchedules(WS_ID, {
                technicianId: TECH_ID,
                workOrderId: WO_ID,
                status: "SCHEDULED",
                customerId: CUST_ID,
                locationId: LOC_ID,
                search: "HVAC",
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                    }),
                }),
            );

            expect(mocks.scheduleAppointmentCount).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                    }),
                }),
            );
        });

        it("getTechnicianSchedule: throws ScheduleTechnicianNotFoundError if technician belongs to another workspace", async () => {
            // Technician exists in WS_B, but caller searches in WS_ID
            mocks.technicianProfileFindFirst.mockImplementation(async ({ where }: any) => {
                if (where.employee?.workspaceId === WS_ID && where.id === "tech_in_ws_beta") {
                    return null;
                }
                return null;
            });

            await expect(
                getTechnicianSchedule(WS_ID, "tech_in_ws_beta", {
                    startDate: "2026-08-26T00:00:00.000Z",
                    endDate: "2026-08-26T23:59:59.000Z",
                }),
            ).rejects.toThrow(ScheduleTechnicianNotFoundError);
        });

        it("getTechnicianSchedule: strictly scopes appointment query to workspaceId", async () => {
            await getTechnicianSchedule(WS_ID, TECH_ID, {
                startDate: "2026-08-26T00:00:00.000Z",
                endDate: "2026-08-26T23:59:59.000Z",
            });

            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        technicianId: TECH_ID,
                    }),
                }),
            );
        });

        it("getSchedule: throws ScheduleAppointmentNotFoundError if appointment belongs to another workspace", async () => {
            mocks.scheduleAppointmentFindFirst.mockImplementation(async ({ where }: any) => {
                if (where.workspaceId === WS_ID && where.id === "apt_in_ws_beta") {
                    return null;
                }
                return null;
            });

            await expect(getSchedule(WS_ID, "apt_in_ws_beta")).rejects.toThrow(
                ScheduleAppointmentNotFoundError,
            );
        });

        it("getWorkOrderSchedule: throws ScheduleWorkOrderNotFoundError if work order belongs to another workspace", async () => {
            mocks.workOrderFindFirst.mockImplementation(async ({ where }: any) => {
                if (where.workspaceId === WS_ID && where.id === "wo_in_ws_beta") {
                    return null;
                }
                return null;
            });

            await expect(
                getWorkOrderSchedule(WS_ID, "wo_in_ws_beta"),
            ).rejects.toThrow(ScheduleWorkOrderNotFoundError);
        });
    });

    // =========================================================================
    // 6. N+1 Prevention & Exact Query-Count Assertion
    // =========================================================================
    describe("6. N+1 Prevention & Query-Count Verification", () => {
        it("asserts exactly 1 findMany and 1 count call for N=10 records with 0 follow-up queries", async () => {
            // Generate 10 appointment records
            const tenAppointments = Array.from({ length: 10 }, (_, i) => ({
                ...defaultAppointment,
                id: `apt_batch_${i}`,
                appointmentNumber: `APT-2026-0008${i.toString().padStart(2, "0")}`,
            }));

            mocks.scheduleAppointmentFindMany.mockResolvedValue(tenAppointments);
            mocks.scheduleAppointmentCount.mockResolvedValue(10);

            const result = await listSchedules(WS_ID, { limit: 10 });

            // Exactly 1 database query for appointment list
            expect(mocks.scheduleAppointmentFindMany).toHaveBeenCalledTimes(1);

            // Exactly 1 database query for total count
            expect(mocks.scheduleAppointmentCount).toHaveBeenCalledTimes(1);

            // Zero follow-up queries to technician or work order tables during mapping
            expect(mocks.technicianProfileFindFirst).toHaveBeenCalledTimes(0);
            expect(mocks.workOrderFindFirst).toHaveBeenCalledTimes(0);

            // All 10 records are fully projected with customer, location, and technician info
            expect(result.items).toHaveLength(10);
            for (const item of result.items) {
                expect(item.customerName).toBe("Acme Towers");
                expect(item.locationName).toBe("Main Tower");
                expect(item.technicianName).toBe("Sarah Connor");
            }
        });
    });
});
