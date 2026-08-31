import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerDelete: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceLocationDelete: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogDelete: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeDelete: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    technicianProfileDelete: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderFindMany: vi.fn(),
    workOrderCreate: vi.fn(),
    workOrderDelete: vi.fn(),
    workOrderCount: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        workspace: { findUnique: mocks.workspaceFindUnique },
        workspaceMember: { findUnique: mocks.workspaceMemberFindUnique },
        customer: { findFirst: mocks.customerFindFirst, delete: mocks.customerDelete },
        serviceLocation: { findFirst: mocks.serviceLocationFindFirst, delete: mocks.serviceLocationDelete },
        serviceCatalog: { findFirst: mocks.serviceCatalogFindFirst, delete: mocks.serviceCatalogDelete },
        workType: { findFirst: mocks.workTypeFindFirst, delete: mocks.workTypeDelete },
        technicianProfile: { findFirst: mocks.technicianProfileFindFirst, delete: mocks.technicianProfileDelete },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            findMany: mocks.workOrderFindMany,
            create: mocks.workOrderCreate,
            delete: mocks.workOrderDelete,
            count: mocks.workOrderCount,
        },
    },
}));

import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { getWorkOrder } from "@/lib/services/workOrder/getWorkOrder";
import { deleteWorkOrder } from "@/lib/services/workOrder/deleteWorkOrder";
import { assignWorkOrder } from "@/lib/services/workOrder/assignWorkOrder";
import { deleteWorkType } from "@/lib/services/workType/deleteWorkType";
import { deleteServiceCatalog } from "@/lib/services/serviceCatalog/deleteServiceCatalog";
import { deleteCustomer } from "@/lib/services/customer/deleteCustomer";
import { deleteServiceLocation } from "@/lib/services/customer/deleteServiceLocation";
import { DELETE as deleteWorkOrderRoute } from "@/app/api/work-orders/[workOrderId]/route";
import {
    WorkOrderNotFoundError,
    WorkOrderDeletionNotAllowedError,
    WorkOrderCustomerNotFoundError,
    WorkOrderLocationNotFoundError,
    WorkOrderTechnicianNotFoundError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    WorkTypeNotFoundError,
    WorkTypeDeletionNotAllowedError,
} from "@/lib/services/workType/workTypeErrors";
import { ServiceCatalogDeletionNotAllowedError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import { CustomerDeletionNotAllowedError, ServiceLocationDeletionNotAllowedError } from "@/lib/services/customer/customerErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type {
    Customer,
    ServiceLocation,
    ServiceCatalog,
    WorkType,
    WorkOrder,
    User,
    Workspace,
    WorkspaceMember,
    TechnicianProfile,
    Employee,
} from "@/generated/prisma/client";

describe("Phase 1.6.11 — WorkOrder Referential Integrity & Historical Safety Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let locationsList: ServiceLocation[];
    let catalogsList: ServiceCatalog[];
    let workTypesList: WorkType[];
    let techProfilesList: (TechnicianProfile & { employee: Employee })[];
    let workOrdersList: WorkOrder[];

    const WS_ALPHA = "ws_alpha_ref";
    const WS_BETA = "ws_beta_ref";

    const USER_ADMIN: User = {
        id: "user_adm_ref",
        name: "Admin Ref",
        email: "admin@ref.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_MANAGER: User = {
        id: "user_mgr_ref",
        name: "Manager Ref",
        email: "mgr@ref.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_OBJ_ALPHA: Workspace = {
        id: WS_ALPHA,
        name: "Alpha Workspace",
        slug: "alpha-ref",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_OBJ_BETA: Workspace = {
        id: WS_BETA,
        name: "Beta Workspace",
        slug: "beta-ref",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_ref",
        userId: USER_ADMIN.id,
        workspaceId: WS_ALPHA,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_MGR: WorkspaceMember = {
        id: "mem_mgr_ref",
        userId: USER_MANAGER.id,
        workspaceId: WS_ALPHA,
        role: "MANAGER",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_MANAGER.id, USER_MANAGER],
        ]);
        workspacesMap = new Map([
            [WS_ALPHA, WS_OBJ_ALPHA],
            [WS_BETA, WS_OBJ_BETA],
        ]);
        membersMap = new Map([
            [`${USER_ADMIN.id}_${WS_ALPHA}`, MEMBER_ADMIN],
            [`${USER_MANAGER.id}_${WS_ALPHA}`, MEMBER_MGR],
        ]);

        customersList = [];
        locationsList = [];
        catalogsList = [];
        workTypesList = [];
        techProfilesList = [];
        workOrdersList = [];

        mocks.auth.mockResolvedValue({
            user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
        });

        mocks.userFindUnique.mockImplementation(async ({ where }: any) => usersMap.get(where.id) || null);
        mocks.workspaceFindUnique.mockImplementation(async ({ where }: any) => workspacesMap.get(where.id) || null);
        mocks.workspaceMemberFindUnique.mockImplementation(async ({ where }: any) => {
            if (where.userId_workspaceId) {
                return membersMap.get(`${where.userId_workspaceId.userId}_${where.userId_workspaceId.workspaceId}`) || null;
            }
            if (where.id) return membersMap.get(where.id) || null;
            return null;
        });

        mocks.customerFindFirst.mockImplementation(async ({ where }: any) => {
            return customersList.find((c) => {
                if (where.id && c.id !== where.id) return false;
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            }) || null;
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            const loc = locationsList.find((l) => {
                if (where.id && l.id !== where.id) return false;
                if (where.customerId && l.customerId !== where.customerId) return false;
                return true;
            });
            if (!loc) return null;
            const parentCustomer = customersList.find((c) => c.id === loc.customerId);
            if (where.customer?.workspaceId && parentCustomer?.workspaceId !== where.customer.workspaceId) return false;
            return { ...loc, customer: parentCustomer };
        });

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where, include }: any) => {
            const cat = catalogsList.find((c) => {
                if (where.id && c.id !== where.id) return false;
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!cat) return null;
            const countWorkTypes = workTypesList.filter((wt) => wt.catalogId === cat.id).length;
            return {
                ...cat,
                _count: include?._count ? { workTypes: countWorkTypes } : undefined,
            };
        });

        mocks.workTypeFindFirst.mockImplementation(async ({ where, include }: any) => {
            const wt = workTypesList.find((w) => {
                if (where.id && w.id !== where.id) return false;
                if (where.workspaceId && w.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!wt) return null;
            const parentCat = catalogsList.find((c) => c.id === wt.catalogId);
            const countWorkOrders = workOrdersList.filter((wo) => wo.workTypeId === wt.id).length;
            return {
                ...wt,
                catalog: include?.catalog ? parentCat : undefined,
                _count: include?._count ? { workOrders: countWorkOrders } : undefined,
            };
        });

        mocks.technicianProfileFindFirst.mockImplementation(async ({ where, include }: any) => {
            const profile = techProfilesList.find((tp) => {
                if (where.id && tp.id !== where.id) return false;
                if (where.employee?.workspaceId && tp.employee.workspaceId !== where.employee.workspaceId) return false;
                return true;
            });
            if (!profile) return null;
            return profile;
        });

        mocks.workOrderFindFirst.mockImplementation(async ({ where }: any) => {
            const wo = workOrdersList.find((w) => {
                if (where.id && w.id !== where.id) return false;
                if (where.workspaceId && w.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!wo) return null;
            const cust = customersList.find((c) => c.id === wo.customerId)!;
            const loc = locationsList.find((l) => l.id === wo.locationId)!;
            const wt = workTypesList.find((w) => w.id === wo.workTypeId)!;
            return {
                ...wo,
                customer: cust,
                location: loc,
                workType: wt,
            };
        });

        mocks.workOrderDelete.mockImplementation(async ({ where }: any) => {
            const idx = workOrdersList.findIndex((w) => w.id === where.id);
            if (idx === -1) throw new Error("Record not found");
            return workOrdersList.splice(idx, 1)[0];
        });

        mocks.workTypeDelete.mockImplementation(async ({ where }: any) => {
            const count = workOrdersList.filter((w) => w.workTypeId === where.id).length;
            if (count > 0) {
                const err = new Error("Foreign key constraint failed on workTypeId");
                (err as any).code = "P2003";
                throw err;
            }
            const idx = workTypesList.findIndex((w) => w.id === where.id);
            if (idx === -1) throw new Error("Record not found");
            return workTypesList.splice(idx, 1)[0];
        });

        mocks.serviceCatalogDelete.mockImplementation(async ({ where }: any) => {
            const count = workTypesList.filter((w) => w.catalogId === where.id).length;
            if (count > 0) {
                const err = new Error("Foreign key constraint failed on catalogId");
                (err as any).code = "P2003";
                throw err;
            }
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            return catalogsList.splice(idx, 1)[0];
        });

        mocks.customerDelete.mockImplementation(async ({ where }: any) => {
            const count = workOrdersList.filter((w) => w.customerId === where.id).length;
            if (count > 0) {
                const err = new Error("Foreign key constraint failed on customerId");
                (err as any).code = "P2003";
                throw err;
            }
            const idx = customersList.findIndex((c) => c.id === where.id);
            return customersList.splice(idx, 1)[0];
        });

        mocks.serviceLocationDelete.mockImplementation(async ({ where }: any) => {
            const count = workOrdersList.filter((w) => w.locationId === where.id).length;
            if (count > 0) {
                const err = new Error("Foreign key constraint failed on locationId");
                (err as any).code = "P2003";
                throw err;
            }
            const idx = locationsList.findIndex((l) => l.id === where.id);
            return locationsList.splice(idx, 1)[0];
        });
    });

    function seedCustomer(workspaceId = WS_ALPHA, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): Customer {
        const c: Customer = {
            id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId,
            customerNumber: "CUST-001",
            name: "Alpha Customer Inc",
            email: "client@alpha.com",
            phone: "+1-555-0100",
            website: null,
            addressLine1: "100 Alpha St",
            addressLine2: null,
            city: "Austin",
            state: "TX",
            postalCode: "78701",
            country: "US",
            status,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        customersList.push(c);
        return c;
    }

    function seedLocation(customerId: string, workspaceId = WS_ALPHA): ServiceLocation {
        const loc: ServiceLocation = {
            id: `loc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            customerId,
            name: "Main Facility",
            addressLine1: "100 Alpha St",
            addressLine2: null,
            city: "Austin",
            state: "TX",
            postalCode: "78701",
            country: "US",
            latitude: null,
            longitude: null,
            notes: null,
            isPrimary: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        locationsList.push(loc);
        return loc;
    }

    function seedCatalog(workspaceId = WS_ALPHA, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): ServiceCatalog {
        const cat: ServiceCatalog = {
            id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId,
            name: "HVAC Services",
            description: "Catalog Description",
            status,
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        catalogsList.push(cat);
        return cat;
    }

    function seedWorkType(catalogId: string, workspaceId = WS_ALPHA, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): WorkType {
        const wt: WorkType = {
            id: `wt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId,
            catalogId,
            name: "Compressor Overhaul",
            code: "HVAC-COMP-01",
            description: "Full overhaul",
            estimatedDuration: 120,
            status,
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        workTypesList.push(wt);
        return wt;
    }

    function seedTechnician(workspaceId = WS_ALPHA, employeeStatus: "ACTIVE" | "INACTIVE" = "ACTIVE"): TechnicianProfile & { employee: Employee } {
        const emp: Employee = {
            id: `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId,
            workspaceMemberId: `mem_emp_${Date.now()}`,
            departmentId: null,
            jobTitleId: null,
            employeeNumber: `EMP-${Date.now()}`,
            displayName: "John Tech",
            phone: "+1-555-9000",
            hireDate: new Date(),
            status: employeeStatus,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const tp: TechnicianProfile & { employee: Employee } = {
            id: `tp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            employeeId: emp.id,
            employee: emp,
            licenseNumber: "LIC-12345",
            yearsExperience: 5,
            emergencyContact: null,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        techProfilesList.push(tp);
        return tp;
    }

    function seedWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
        const cust = overrides.customerId
            ? (customersList.find((c) => c.id === overrides.customerId) ?? seedCustomer(WS_ALPHA))
            : seedCustomer(WS_ALPHA);
        const loc = overrides.locationId
            ? (locationsList.find((l) => l.id === overrides.locationId) ?? seedLocation(cust.id, WS_ALPHA))
            : seedLocation(cust.id, WS_ALPHA);
        const cat = catalogsList.length > 0 ? catalogsList[0] : seedCatalog(WS_ALPHA);
        const wt = overrides.workTypeId
            ? (workTypesList.find((w) => w.id === overrides.workTypeId) ?? seedWorkType(cat.id, WS_ALPHA))
            : seedWorkType(cat.id, WS_ALPHA);

        const wo: WorkOrder = {
            id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId: WS_ALPHA,
            workOrderNumber: `WO-2026-${String(workOrdersList.length + 1).padStart(6, "0")}`,
            customerId: cust.id,
            locationId: loc.id,
            workTypeId: wt.id,
            assignedTechnicianId: null,
            assetId: null,
                sourceQuoteId: null,
            workTypeName: wt.name,
            workTypeCode: wt.code,
            estimatedDuration: wt.estimatedDuration,
            priority: "HIGH",
            status: "OPEN",
            title: "Test Work Order",
            description: null,
            internalNotes: null,
            holdReason: null,
            cancellationReason: null,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...overrides,
        };
        workOrdersList.push(wo);
        return wo;
    }

    describe("1. WorkType Referential Integrity & Deletion Protection", () => {
        it("rejects deletion of a WorkType when referenced by an existing WorkOrder", async () => {
            const cust = seedCustomer(WS_ALPHA);
            const loc = seedLocation(cust.id, WS_ALPHA);
            const cat = seedCatalog(WS_ALPHA);
            const wt = seedWorkType(cat.id, WS_ALPHA, "INACTIVE"); // Inactive so active check passes

            seedWorkOrder({
                customerId: cust.id,
                locationId: loc.id,
                workTypeId: wt.id,
                status: "OPEN",
            });

            await expect(deleteWorkType(WS_ALPHA, wt.id)).rejects.toThrow(
                WorkTypeDeletionNotAllowedError,
            );
            expect(workTypesList).toHaveLength(1);
        });

        it("allows deletion of an unreferenced INACTIVE WorkType", async () => {
            const cat = seedCatalog(WS_ALPHA);
            const wt = seedWorkType(cat.id, WS_ALPHA, "INACTIVE");

            const deleted = await deleteWorkType(WS_ALPHA, wt.id);
            expect(deleted.id).toBe(wt.id);
            expect(workTypesList).toHaveLength(0);
        });

        it("WorkOrder remains fully readable with frozen snapshot fields after WorkType is deactivated", async () => {
            const cust = seedCustomer(WS_ALPHA);
            const loc = seedLocation(cust.id, WS_ALPHA);
            const cat = seedCatalog(WS_ALPHA);
            const wt = seedWorkType(cat.id, WS_ALPHA, "ACTIVE");

            const wo = seedWorkOrder({
                customerId: cust.id,
                locationId: loc.id,
                workTypeId: wt.id,
                workTypeName: "Original Compressor Name",
                workTypeCode: "ORIG-01",
                estimatedDuration: 150,
            });

            // Deactivate WorkType
            wt.status = "INACTIVE";

            const result = await getWorkOrder(WS_ALPHA, wo.id);
            expect(result.id).toBe(wo.id);
            expect(result.workTypeName).toBe("Original Compressor Name");
            expect(result.workTypeCode).toBe("ORIG-01");
            expect(result.estimatedDuration).toBe(150);
        });

        it("mutating WorkType metadata does not corrupt historical snapshot fields on existing WorkOrder", async () => {
            const cust = seedCustomer(WS_ALPHA);
            const loc = seedLocation(cust.id, WS_ALPHA);
            const cat = seedCatalog(WS_ALPHA);
            const wt = seedWorkType(cat.id, WS_ALPHA, "ACTIVE");

            const wo = seedWorkOrder({
                customerId: cust.id,
                locationId: loc.id,
                workTypeId: wt.id,
                workTypeName: "Historical Name Snapshot",
                workTypeCode: "HIST-01",
                estimatedDuration: 90,
            });

            // Mutate current WorkType definition
            wt.name = "Brand New Renamed WorkType";
            wt.code = "NEW-CODE-99";
            wt.estimatedDuration = 300;

            const result = await getWorkOrder(WS_ALPHA, wo.id);
            // Snapshot fields on WorkOrder are preserved
            expect(result.workTypeName).toBe("Historical Name Snapshot");
            expect(result.workTypeCode).toBe("HIST-01");
            expect(result.estimatedDuration).toBe(90);
        });

        it("multiple WorkOrders referencing the same WorkType remain valid and operational", async () => {
            const cust = seedCustomer(WS_ALPHA);
            const loc = seedLocation(cust.id, WS_ALPHA);
            const cat = seedCatalog(WS_ALPHA);
            const wt = seedWorkType(cat.id, WS_ALPHA);

            const wo1 = seedWorkOrder({ customerId: cust.id, locationId: loc.id, workTypeId: wt.id });
            const wo2 = seedWorkOrder({ customerId: cust.id, locationId: loc.id, workTypeId: wt.id });

            const read1 = await getWorkOrder(WS_ALPHA, wo1.id);
            const read2 = await getWorkOrder(WS_ALPHA, wo2.id);

            expect(read1.workTypeId).toBe(wt.id);
            expect(read2.workTypeId).toBe(wt.id);
        });

        it("deleting one WorkOrder does not delete or modify the shared WorkType", async () => {
            const cust = seedCustomer(WS_ALPHA);
            const loc = seedLocation(cust.id, WS_ALPHA);
            const cat = seedCatalog(WS_ALPHA);
            const wt = seedWorkType(cat.id, WS_ALPHA);

            const wo1 = seedWorkOrder({ customerId: cust.id, locationId: loc.id, workTypeId: wt.id, status: "OPEN" });
            const wo2 = seedWorkOrder({ customerId: cust.id, locationId: loc.id, workTypeId: wt.id, status: "OPEN" });

            await deleteWorkOrder(WS_ALPHA, wo1.id);

            expect(workOrdersList).toHaveLength(1);
            expect(workTypesList).toHaveLength(1); // Shared WorkType untouched
            const read2 = await getWorkOrder(WS_ALPHA, wo2.id);
            expect(read2.workTypeId).toBe(wt.id);
        });
    });

    describe("2. ServiceCatalog Referential Integrity", () => {
        it("rejects deletion of a ServiceCatalog when it contains child WorkTypes referenced by WorkOrders", async () => {
            const cat = seedCatalog(WS_ALPHA, "INACTIVE");
            const wt = seedWorkType(cat.id, WS_ALPHA, "INACTIVE");
            seedWorkOrder({ workTypeId: wt.id });

            await expect(deleteServiceCatalog(WS_ALPHA, cat.id)).rejects.toThrow(
                ServiceCatalogDeletionNotAllowedError,
            );
            expect(catalogsList).toHaveLength(1);
        });

        it("deactivating a ServiceCatalog preserves WorkOrder history and readability", async () => {
            const cat = seedCatalog(WS_ALPHA, "ACTIVE");
            const wt = seedWorkType(cat.id, WS_ALPHA, "ACTIVE");
            const wo = seedWorkOrder({ workTypeId: wt.id });

            cat.status = "INACTIVE";

            const result = await getWorkOrder(WS_ALPHA, wo.id);
            expect(result.id).toBe(wo.id);
            expect(result.workTypeName).toBe(wo.workTypeName);
        });
    });

    describe("3. Customer & Location Referential Integrity", () => {
        it("rejects destructive deletion of Customer when referenced by existing WorkOrders", async () => {
            const cust = seedCustomer(WS_ALPHA, "INACTIVE");
            seedWorkOrder({ customerId: cust.id });

            await expect(deleteCustomer(WS_ALPHA, cust.id)).rejects.toThrow(
                CustomerDeletionNotAllowedError,
            );
            expect(customersList).toHaveLength(1);
        });

        it("rejects destructive deletion of ServiceLocation when referenced by existing WorkOrders", async () => {
            const cust = seedCustomer(WS_ALPHA, "ACTIVE");
            const loc = seedLocation(cust.id, WS_ALPHA);
            seedWorkOrder({ customerId: cust.id, locationId: loc.id });

            await expect(deleteServiceLocation(WS_ALPHA, cust.id, loc.id)).rejects.toThrow(
                ServiceLocationDeletionNotAllowedError,
            );
            expect(locationsList).toHaveLength(1);
        });

        it("WorkOrder remains valid and readable when Customer status is changed to INACTIVE", async () => {
            const cust = seedCustomer(WS_ALPHA, "ACTIVE");
            const wo = seedWorkOrder({ customerId: cust.id });

            cust.status = "INACTIVE";

            const result = await getWorkOrder(WS_ALPHA, wo.id);
            expect(result.id).toBe(wo.id);
            expect(result.customerName).toBe(cust.name);
        });

        it("deleting a WorkOrder releases references without deleting Customer or Location", async () => {
            const cust = seedCustomer(WS_ALPHA);
            const loc = seedLocation(cust.id, WS_ALPHA);
            const wo = seedWorkOrder({ customerId: cust.id, locationId: loc.id, status: "OPEN" });

            await deleteWorkOrder(WS_ALPHA, wo.id);

            expect(workOrdersList).toHaveLength(0);
            expect(customersList).toHaveLength(1);
            expect(locationsList).toHaveLength(1);
        });
    });

    describe("4. Technician Referential Integrity", () => {
        it("preserves assigned WorkOrder readability and history when Technician is deactivated", async () => {
            const tech = seedTechnician(WS_ALPHA, "ACTIVE");
            const wo = seedWorkOrder({ assignedTechnicianId: tech.id, status: "ASSIGNED" });

            // Deactivate technician
            tech.employee.status = "INACTIVE";

            const result = await getWorkOrder(WS_ALPHA, wo.id);
            expect(result.id).toBe(wo.id);
            expect(result.assignedTechnicianId).toBe(tech.id);
        });

        it("deleting a WorkOrder does not delete the assigned TechnicianProfile or Employee", async () => {
            const tech = seedTechnician(WS_ALPHA, "ACTIVE");
            const wo = seedWorkOrder({ assignedTechnicianId: tech.id, status: "CANCELLED" });

            await deleteWorkOrder(WS_ALPHA, wo.id);

            expect(workOrdersList).toHaveLength(0);
            expect(techProfilesList).toHaveLength(1);
        });

        it("shared Technician assignments across multiple WorkOrders remain intact when one is deleted", async () => {
            const tech = seedTechnician(WS_ALPHA, "ACTIVE");
            const wo1 = seedWorkOrder({ assignedTechnicianId: tech.id, status: "OPEN" });
            const wo2 = seedWorkOrder({ assignedTechnicianId: tech.id, status: "OPEN" });

            await deleteWorkOrder(WS_ALPHA, wo1.id);

            expect(workOrdersList).toHaveLength(1);
            const read2 = await getWorkOrder(WS_ALPHA, wo2.id);
            expect(read2.assignedTechnicianId).toBe(tech.id);
        });
    });

    describe("5. Cross-Tenant Integrity Guarantees", () => {
        it("rejects cross-workspace Customer reference during creation", async () => {
            const custBeta = seedCustomer(WS_BETA);
            const locBeta = seedLocation(custBeta.id, WS_BETA);
            const catAlpha = seedCatalog(WS_ALPHA);
            const wtAlpha = seedWorkType(catAlpha.id, WS_ALPHA);

            mocks.workOrderCount.mockResolvedValueOnce(0);

            await expect(
                createWorkOrder(WS_ALPHA, {
                    customerId: custBeta.id,
                    locationId: locBeta.id,
                    workTypeId: wtAlpha.id,
                    title: "Cross Tenant Test",
                }),
            ).rejects.toThrow(WorkOrderCustomerNotFoundError);
        });

        it("rejects cross-workspace Location reference during creation", async () => {
            const custAlpha = seedCustomer(WS_ALPHA);
            const custBeta = seedCustomer(WS_BETA);
            const locBeta = seedLocation(custBeta.id, WS_BETA);
            const catAlpha = seedCatalog(WS_ALPHA);
            const wtAlpha = seedWorkType(catAlpha.id, WS_ALPHA);

            mocks.workOrderCount.mockResolvedValueOnce(0);

            await expect(
                createWorkOrder(WS_ALPHA, {
                    customerId: custAlpha.id,
                    locationId: locBeta.id,
                    workTypeId: wtAlpha.id,
                    title: "Cross Location Test",
                }),
            ).rejects.toThrow(WorkOrderLocationNotFoundError);
        });

        it("rejects cross-workspace WorkType reference during creation", async () => {
            const custAlpha = seedCustomer(WS_ALPHA);
            const locAlpha = seedLocation(custAlpha.id, WS_ALPHA);
            const catBeta = seedCatalog(WS_BETA);
            const wtBeta = seedWorkType(catBeta.id, WS_BETA);

            mocks.workOrderCount.mockResolvedValueOnce(0);

            await expect(
                createWorkOrder(WS_ALPHA, {
                    customerId: custAlpha.id,
                    locationId: locAlpha.id,
                    workTypeId: wtBeta.id,
                    title: "Cross WorkType Test",
                }),
            ).rejects.toThrow(WorkTypeNotFoundError);
        });

        it("rejects cross-workspace Technician assignment reference", async () => {
            const woAlpha = seedWorkOrder({ status: "OPEN" });
            const techBeta = seedTechnician(WS_BETA);

            await expect(
                assignWorkOrder(WS_ALPHA, woAlpha.id, {
                    technicianId: techBeta.id,
                }),
            ).rejects.toThrow(WorkOrderTechnicianNotFoundError);
        });
    });

    describe("6. WorkOrder Administrative Deletion Lifecycle (deleteWorkOrder)", () => {
        it("allows deleting an OPEN WorkOrder", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });
            const deleted = await deleteWorkOrder(WS_ALPHA, wo.id);
            expect(deleted.id).toBe(wo.id);
            expect(workOrdersList).toHaveLength(0);
        });

        it("allows deleting a CANCELLED WorkOrder", async () => {
            const wo = seedWorkOrder({ status: "CANCELLED" });
            const deleted = await deleteWorkOrder(WS_ALPHA, wo.id);
            expect(deleted.id).toBe(wo.id);
            expect(workOrdersList).toHaveLength(0);
        });

        it("rejects deleting an ASSIGNED WorkOrder with 409 WorkOrderDeletionNotAllowedError", async () => {
            const wo = seedWorkOrder({ status: "ASSIGNED" });
            await expect(deleteWorkOrder(WS_ALPHA, wo.id)).rejects.toThrow(
                WorkOrderDeletionNotAllowedError,
            );
            expect(workOrdersList).toHaveLength(1);
        });

        it("rejects deleting an IN_PROGRESS WorkOrder with 409 WorkOrderDeletionNotAllowedError", async () => {
            const wo = seedWorkOrder({ status: "IN_PROGRESS" });
            await expect(deleteWorkOrder(WS_ALPHA, wo.id)).rejects.toThrow(
                WorkOrderDeletionNotAllowedError,
            );
        });

        it("rejects deleting an ON_HOLD WorkOrder with 409 WorkOrderDeletionNotAllowedError", async () => {
            const wo = seedWorkOrder({ status: "ON_HOLD" });
            await expect(deleteWorkOrder(WS_ALPHA, wo.id)).rejects.toThrow(
                WorkOrderDeletionNotAllowedError,
            );
        });

        it("rejects deleting a COMPLETED WorkOrder with 409 WorkOrderDeletionNotAllowedError", async () => {
            const wo = seedWorkOrder({ status: "COMPLETED" });
            await expect(deleteWorkOrder(WS_ALPHA, wo.id)).rejects.toThrow(
                WorkOrderDeletionNotAllowedError,
            );
        });

        it("rejects deletion by MANAGER with ForbiddenError (403)", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_MANAGER.id, email: USER_MANAGER.email },
            });
            const wo = seedWorkOrder({ status: "OPEN" });

            await expect(deleteWorkOrder(WS_ALPHA, wo.id)).rejects.toThrow(
                ForbiddenError,
            );
            expect(workOrdersList).toHaveLength(1);
        });

        it("throws WorkOrderNotFoundError for cross-tenant delete attempt", async () => {
            const woBeta = seedWorkOrder({ workspaceId: WS_BETA, status: "OPEN" });

            await expect(deleteWorkOrder(WS_ALPHA, woBeta.id)).rejects.toThrow(
                WorkOrderNotFoundError,
            );
        });
    });

    describe("7. REST API Boundary: DELETE /api/work-orders/[workOrderId]", () => {
        it("returns 200 with deleted WorkOrderReadModel for eligible OPEN work order", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });
            const req = new Request(`http://localhost/api/work-orders/${wo.id}`, {
                method: "DELETE",
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await deleteWorkOrderRoute(req, { params: Promise.resolve({ workOrderId: wo.id }) });
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(wo.id);
            expect(workOrdersList).toHaveLength(0);
        });

        it("returns 409 WORK_ORDER_DELETION_NOT_ALLOWED when attempting to delete COMPLETED work order", async () => {
            const wo = seedWorkOrder({ status: "COMPLETED" });
            const req = new Request(`http://localhost/api/work-orders/${wo.id}`, {
                method: "DELETE",
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await deleteWorkOrderRoute(req, { params: Promise.resolve({ workOrderId: wo.id }) });
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_DELETION_NOT_ALLOWED");
        });

        it("returns 404 WORK_ORDER_NOT_FOUND when work order does not exist", async () => {
            const req = new Request("http://localhost/api/work-orders/wo_non_existent", {
                method: "DELETE",
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await deleteWorkOrderRoute(req, { params: Promise.resolve({ workOrderId: "wo_non_existent" }) });
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_NOT_FOUND");
        });

        it("returns 400 MISSING_WORKSPACE when workspace header is omitted", async () => {
            const req = new Request("http://localhost/api/work-orders/wo_123", {
                method: "DELETE",
            });

            const res = await deleteWorkOrderRoute(req, { params: Promise.resolve({ workOrderId: "wo_123" }) });
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });
    });
});
