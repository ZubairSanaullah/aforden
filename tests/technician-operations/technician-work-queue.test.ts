import { describe, expect, it, vi, beforeEach } from "vitest";
import { listTechnicianWorkOrders } from "@/lib/services/technicianOperations/listTechnicianWorkOrders";
import { getTechnicianWorkOrderDetail } from "@/lib/services/technicianOperations/getTechnicianWorkOrderDetail";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    workOrderCount: vi.fn(),
    workOrderFindMany: vi.fn(),
    workOrderFindFirst: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        workOrder: {
            count: mocks.workOrderCount,
            findMany: mocks.workOrderFindMany,
            findFirst: mocks.workOrderFindFirst,
        },
    },
}));

describe("Phase 1.9.4 — Technician Work Queue (listTechnicianWorkOrders & getTechnicianWorkOrderDetail)", () => {
    const WS_ID = "ws_tenant_101";
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

    const adminContext: TechnicianExecutionContext = {
        userId: "usr_admin_001",
        workspaceId: WS_ID,
        membershipId: "mem_admin_001",
        role: "ADMIN",
        employeeId: "emp_admin_001",
        technicianProfileId: "tech_prof_admin",
        technicianName: "Admin User",
    };

    const accountantContext: TechnicianExecutionContext = {
        userId: "usr_acct_001",
        workspaceId: WS_ID,
        membershipId: "mem_acct_001",
        role: "ACCOUNTANT",
        employeeId: "emp_acct_001",
        technicianProfileId: "tech_prof_acct",
        technicianName: "Accountant User",
    };

    const sampleWorkOrder = {
        id: "wo_100",
        workspaceId: WS_ID,
        workOrderNumber: "WO-000100",
        customerId: "cust_1",
        locationId: "loc_1",
        workTypeId: "wt_1",
        workTypeName: "HVAC Inspection",
        workTypeCode: "HVAC-01",
        estimatedDuration: 120,
        assignedTechnicianId: TECH_PROFILE_ID_1,
        assetId: "asset_1",
        status: "ASSIGNED",
        priority: "HIGH",
        title: "Annual HVAC Preventative Maintenance",
        description: "Full diagnostic and filter replacement.",
        internalNotes: "Check rooftop unit compressor.",
        holdReason: null,
        cancellationReason: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date("2026-08-21T09:00:00Z"),
        updatedAt: new Date("2026-08-21T09:00:00Z"),
        customer: {
            id: "cust_1",
            name: "Acme Industrial",
            customerNumber: "CUST-001",
        },
        location: {
            id: "loc_1",
            name: "Headquarters Plant",
            addressLine1: "100 Industrial Parkway",
            addressLine2: "Suite 400",
            city: "Metropolis",
            state: "NY",
            postalCode: "10001",
            country: "USA",
        },
        workType: {
            id: "wt_1",
            name: "HVAC Inspection",
            code: "HVAC-01",
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.workOrderCount.mockResolvedValue(1);
        mocks.workOrderFindMany.mockResolvedValue([sampleWorkOrder]);
        mocks.workOrderFindFirst.mockResolvedValue(sampleWorkOrder);
    });

    describe("1. listTechnicianWorkOrders — Scoping & Isolation", () => {
        it("strictly scopes query to caller's technicianProfileId and workspaceId for TECHNICIAN role", async () => {
            const result = await listTechnicianWorkOrders(techContext);

            expect(mocks.workOrderCount).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    assignedTechnicianId: TECH_PROFILE_ID_1,
                },
            });

            expect(mocks.workOrderFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: WS_ID,
                    assignedTechnicianId: TECH_PROFILE_ID_1,
                },
                orderBy: [{ createdAt: "desc" }, { id: "asc" }],
                skip: 0,
                take: 20,
                include: {
                    customer: true,
                    location: true,
                    workType: true,
                },
            });

            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toEqual({
                id: "wo_100",
                workspaceId: WS_ID,
                workOrderNumber: "WO-000100",
                customerId: "cust_1",
                customerName: "Acme Industrial",
                customerNumber: "CUST-001",
                locationId: "loc_1",
                locationName: "Headquarters Plant",
                locationAddress: "100 Industrial Parkway, Suite 400, Metropolis, NY, 10001, USA",
                workTypeId: "wt_1",
                workTypeName: "HVAC Inspection",
                workTypeCode: "HVAC-01",
                estimatedDuration: 120,
                assignedTechnicianId: TECH_PROFILE_ID_1,
                assetId: "asset_1",
                status: "ASSIGNED",
                priority: "HIGH",
                title: "Annual HVAC Preventative Maintenance",
                description: "Full diagnostic and filter replacement.",
                internalNotes: "Check rooftop unit compressor.",
                holdReason: null,
                cancellationReason: null,
                startedAt: null,
                completedAt: null,
                cancelledAt: null,
                createdAt: sampleWorkOrder.createdAt,
                updatedAt: sampleWorkOrder.updatedAt,
            });
            expect(result.pagination).toEqual({
                page: 1,
                pageSize: 20,
                total: 1,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
            });
        });

        it("allows administrative roles to list all workspace orders when no technician filter is specified", async () => {
            await listTechnicianWorkOrders(adminContext);

            expect(mocks.workOrderFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                    },
                })
            );
        });

        it("allows administrative roles to filter by specific assignedTechnicianId", async () => {
            await listTechnicianWorkOrders(adminContext, {
                assignedTechnicianId: TECH_PROFILE_ID_2,
            });

            expect(mocks.workOrderFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                        assignedTechnicianId: TECH_PROFILE_ID_2,
                    },
                })
            );
        });

        it("rejects unauthorized roles (ACCOUNTANT) with ForbiddenError (403)", async () => {
            await expect(listTechnicianWorkOrders(accountantContext)).rejects.toThrow(
                ForbiddenError
            );
            expect(mocks.workOrderFindMany).not.toHaveBeenCalled();
        });
    });

    describe("2. listTechnicianWorkOrders — Filters, Search & Pagination", () => {
        it("applies status, priority, customer, location, and workType filters correctly", async () => {
            await listTechnicianWorkOrders(techContext, {
                status: "IN_PROGRESS",
                priority: "URGENT",
                customerId: "cust_99",
                locationId: "loc_99",
                workTypeId: "wt_99",
            });

            expect(mocks.workOrderFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                        assignedTechnicianId: TECH_PROFILE_ID_1,
                        status: "IN_PROGRESS",
                        priority: "URGENT",
                        customerId: "cust_99",
                        locationId: "loc_99",
                        workTypeId: "wt_99",
                    },
                })
            );
        });

        it("applies case-insensitive search filter across multiple fields", async () => {
            await listTechnicianWorkOrders(techContext, {
                search: "compressor",
            });

            expect(mocks.workOrderFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                        assignedTechnicianId: TECH_PROFILE_ID_1,
                        OR: [
                            { workOrderNumber: { contains: "compressor", mode: "insensitive" } },
                            { title: { contains: "compressor", mode: "insensitive" } },
                            { description: { contains: "compressor", mode: "insensitive" } },
                            { customer: { name: { contains: "compressor", mode: "insensitive" } } },
                            { customer: { customerNumber: { contains: "compressor", mode: "insensitive" } } },
                        ],
                    },
                })
            );
        });

        it("computes pagination correctly for page 2 with pageSize 10 and total 25", async () => {
            mocks.workOrderCount.mockResolvedValue(25);
            mocks.workOrderFindMany.mockResolvedValue([sampleWorkOrder]);

            const result = await listTechnicianWorkOrders(techContext, {
                page: 2,
                pageSize: 10,
                sortBy: "priority",
                sortOrder: "asc",
            });

            expect(mocks.workOrderFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    skip: 10,
                    take: 10,
                    orderBy: [{ priority: "asc" }, { id: "asc" }],
                })
            );

            expect(result.pagination).toEqual({
                page: 2,
                pageSize: 10,
                total: 25,
                totalPages: 3,
                hasNextPage: true,
                hasPreviousPage: true,
            });
        });
    });

    describe("3. getTechnicianWorkOrderDetail — Isolation & Anti-IDOR Protection", () => {
        it("returns canonical WorkOrderReadModel for own assigned work order", async () => {
            const detail = await getTechnicianWorkOrderDetail(techContext, "wo_100");

            expect(mocks.workOrderFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "wo_100",
                    workspaceId: WS_ID,
                    assignedTechnicianId: TECH_PROFILE_ID_1,
                },
                include: {
                    customer: true,
                    location: true,
                    workType: true,
                },
            });

            expect(detail.id).toBe("wo_100");
            expect(detail.customerName).toBe("Acme Industrial");
            expect(detail.locationAddress).toBe("100 Industrial Parkway, Suite 400, Metropolis, NY, 10001, USA");
        });

        it("throws WorkOrderNotFoundError (404 NOT 403) when order exists for a different technician", async () => {
            // Prisma returns null because assignedTechnicianId doesn't match
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                getTechnicianWorkOrderDetail(techContext, "wo_other_tech_order")
            ).rejects.toThrow(WorkOrderNotFoundError);

            // Proves the query strictly enforced assignedTechnicianId
            expect(mocks.workOrderFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: "wo_other_tech_order",
                        workspaceId: WS_ID,
                        assignedTechnicianId: TECH_PROFILE_ID_1,
                    },
                })
            );
        });

        it("throws WorkOrderNotFoundError (404) when order belongs to another workspace (cross-tenant)", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                getTechnicianWorkOrderDetail(techContext, "wo_workspace_b_order")
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("allows administrative roles to fetch any work order in the workspace", async () => {
            await getTechnicianWorkOrderDetail(adminContext, "wo_100");

            expect(mocks.workOrderFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "wo_100",
                    workspaceId: WS_ID,
                },
                include: {
                    customer: true,
                    location: true,
                    workType: true,
                },
            });
        });

        it("rejects unauthorized roles (ACCOUNTANT) with ForbiddenError (403)", async () => {
            await expect(
                getTechnicianWorkOrderDetail(accountantContext, "wo_100")
            ).rejects.toThrow(ForbiddenError);

            expect(mocks.workOrderFindFirst).not.toHaveBeenCalled();
        });

        it("throws WorkOrderNotFoundError for empty or whitespace-only workOrderId", async () => {
            await expect(getTechnicianWorkOrderDetail(techContext, "")).rejects.toThrow(
                WorkOrderNotFoundError
            );
            await expect(getTechnicianWorkOrderDetail(techContext, "   ")).rejects.toThrow(
                WorkOrderNotFoundError
            );
            expect(mocks.workOrderFindFirst).not.toHaveBeenCalled();
        });
    });
});
