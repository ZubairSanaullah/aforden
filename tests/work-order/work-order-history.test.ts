import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    technicianProfileFindMany: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderFindMany: vi.fn(),
    workOrderCreate: vi.fn(),
    workOrderUpdate: vi.fn(),
    workOrderDelete: vi.fn(),
    workOrderCount: vi.fn(),
    workOrderHistoryCreate: vi.fn(),
    workOrderHistoryFindMany: vi.fn(),
    workOrderHistoryFindFirst: vi.fn(),
    workOrderHistoryCount: vi.fn(),
    workspaceEntitlementOverrideFindUnique: vi.fn(),
    subscriptionFindFirst: vi.fn(),
    $transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        workspace: { findUnique: mocks.workspaceFindUnique },
        workspaceMember: { findUnique: mocks.workspaceMemberFindUnique },
        customer: { findFirst: mocks.customerFindFirst },
        serviceLocation: { findFirst: mocks.serviceLocationFindFirst },
        serviceCatalog: { findFirst: mocks.serviceCatalogFindFirst },
        workType: { findFirst: mocks.workTypeFindFirst },
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
            findMany: mocks.technicianProfileFindMany,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            findMany: mocks.workOrderFindMany,
            create: mocks.workOrderCreate,
            update: mocks.workOrderUpdate,
            delete: mocks.workOrderDelete,
            count: mocks.workOrderCount,
        },
        workOrderHistory: {
            create: mocks.workOrderHistoryCreate,
            findMany: mocks.workOrderHistoryFindMany,
            findFirst: mocks.workOrderHistoryFindFirst,
            count: mocks.workOrderHistoryCount,
        },
        workspaceEntitlementOverride: {
            findUnique: mocks.workspaceEntitlementOverrideFindUnique,
        },
        subscription: {
            findFirst: mocks.subscriptionFindFirst,
        },
        $transaction: mocks.$transaction,
    },
}));

import * as workOrderModule from "@/lib/services/workOrder";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    assignWorkOrder,
    reassignWorkOrder,
    unassignWorkOrder,
} from "@/lib/services/workOrder/assignWorkOrder";
import { updateWorkOrder } from "@/lib/services/workOrder/updateWorkOrder";
import { deleteWorkOrder } from "@/lib/services/workOrder/deleteWorkOrder";
import { getWorkOrderHistory } from "@/lib/services/workOrder/getWorkOrderHistory";
import { GET as getWorkOrderHistoryRoute } from "@/app/api/work-orders/[workOrderId]/history/route";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderAssignmentNotAllowedError,
    WorkOrderDeletionNotAllowedError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import type {
    Customer,
    ServiceLocation,
    ServiceCatalog,
    WorkType,
    WorkOrder,
    WorkOrderHistory,
    User,
    Workspace,
    WorkspaceMember,
    TechnicianProfile,
    Employee,
} from "@/generated/prisma/client";

describe("Phase 1.6.12 — WorkOrder Operational History & Audit Architecture Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let locationsList: ServiceLocation[];
    let catalogsList: ServiceCatalog[];
    let workTypesList: WorkType[];
    let techProfilesList: (TechnicianProfile & { employee: Employee })[];
    let workOrdersList: WorkOrder[];
    let historyList: WorkOrderHistory[];

    const WS_ALPHA = "ws_alpha_hist";
    const WS_BETA = "ws_beta_hist";

    const USER_ADMIN: User = {
        id: "user_adm_hist",
        name: "Admin Audit",
        email: "admin@audit.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH_1: User = {
        id: "user_tech_1",
        name: "Tech One",
        email: "tech1@audit.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH_2: User = {
        id: "user_tech_2",
        name: "Tech Two",
        email: "tech2@audit.com",
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
        slug: "alpha-hist",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_OBJ_BETA: Workspace = {
        id: WS_BETA,
        name: "Beta Workspace",
        slug: "beta-hist",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_adm_hist",
        userId: USER_ADMIN.id,
        workspaceId: WS_ALPHA,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH_1: WorkspaceMember = {
        id: "mem_tech_1",
        userId: USER_TECH_1.id,
        workspaceId: WS_ALPHA,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH_2: WorkspaceMember = {
        id: "mem_tech_2",
        userId: USER_TECH_2.id,
        workspaceId: WS_ALPHA,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_TECH_1.id, USER_TECH_1],
            [USER_TECH_2.id, USER_TECH_2],
        ]);
        workspacesMap = new Map([
            [WS_ALPHA, WS_OBJ_ALPHA],
            [WS_BETA, WS_OBJ_BETA],
        ]);
        membersMap = new Map([
            [`${USER_ADMIN.id}_${WS_ALPHA}`, MEMBER_ADMIN],
            [`${USER_TECH_1.id}_${WS_ALPHA}`, MEMBER_TECH_1],
            [`${USER_TECH_2.id}_${WS_ALPHA}`, MEMBER_TECH_2],
        ]);

        customersList = [];
        locationsList = [];
        catalogsList = [];
        workTypesList = [];
        techProfilesList = [];
        workOrdersList = [];
        historyList = [];

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

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where }: any) => {
            return catalogsList.find((c) => {
                if (where.id && c.id !== where.id) return false;
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            }) || null;
        });

        mocks.workTypeFindFirst.mockImplementation(async ({ where }: any) => {
            const wt = workTypesList.find((w) => {
                if (where.id && w.id !== where.id) return false;
                if (where.workspaceId && w.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!wt) return null;
            const parentCat = catalogsList.find((c) => c.id === wt.catalogId);
            return {
                ...wt,
                catalog: parentCat,
            };
        });

        mocks.technicianProfileFindFirst.mockImplementation(async ({ where }: any) => {
            return techProfilesList.find((tp) => {
                if (where.id && tp.id !== where.id) return false;
                if (where.employee?.workspaceId && tp.employee.workspaceId !== where.employee.workspaceId) return false;
                if (where.employee?.workspaceMemberId && tp.employee.workspaceMemberId !== where.employee.workspaceMemberId) return false;
                return true;
            }) || null;
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

        mocks.workOrderCreate.mockImplementation(async ({ data, include }: any) => {
            const wo: WorkOrder = {
                id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                workspaceId: data.workspaceId,
                workOrderNumber: data.workOrderNumber,
                customerId: data.customerId,
                locationId: data.locationId,
                workTypeId: data.workTypeId,
                assignedTechnicianId: data.assignedTechnicianId ?? null,
                assetId: data.assetId ?? null,
                sourceQuoteId: data.sourceQuoteId ?? null,
                workTypeName: data.workTypeName,
                workTypeCode: data.workTypeCode ?? null,
                estimatedDuration: data.estimatedDuration ?? null,
                status: data.status ?? "OPEN",
                priority: data.priority ?? "MEDIUM",
                title: data.title,
                description: data.description ?? null,
                internalNotes: data.internalNotes ?? null,
                holdReason: data.holdReason ?? null,
                cancellationReason: data.cancellationReason ?? null,
                startedAt: data.startedAt ?? null,
                completedAt: data.completedAt ?? null,
                cancelledAt: data.cancelledAt ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workOrdersList.push(wo);
            const cust = customersList.find((c) => c.id === wo.customerId)!;
            const loc = locationsList.find((l) => l.id === wo.locationId)!;
            const wt = workTypesList.find((w) => w.id === wo.workTypeId)!;
            return {
                ...wo,
                customer: include?.customer ? cust : undefined,
                location: include?.location ? loc : undefined,
                workType: include?.workType ? wt : undefined,
            };
        });

        mocks.workOrderUpdate.mockImplementation(async ({ where, data, include }: any) => {
            const idx = workOrdersList.findIndex((w) => w.id === where.id);
            if (idx === -1) throw new Error("Record not found");
            const updated = { ...workOrdersList[idx], ...data, updatedAt: new Date() };
            workOrdersList[idx] = updated;
            const cust = customersList.find((c) => c.id === updated.customerId)!;
            const loc = locationsList.find((l) => l.id === updated.locationId)!;
            const wt = workTypesList.find((w) => w.id === updated.workTypeId)!;
            return {
                ...updated,
                customer: include?.customer ? cust : undefined,
                location: include?.location ? loc : undefined,
                workType: include?.workType ? wt : undefined,
            };
        });

        mocks.workOrderDelete.mockImplementation(async ({ where }: any) => {
            const idx = workOrdersList.findIndex((w) => w.id === where.id);
            if (idx === -1) throw new Error("Record not found");
            return workOrdersList.splice(idx, 1)[0];
        });

        mocks.workOrderHistoryCreate.mockImplementation(async ({ data }: any) => {
            const hist: WorkOrderHistory = {
                id: `woh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                workspaceId: data.workspaceId,
                workOrderId: data.workOrderId,
                eventType: data.eventType,
                actorMemberId: data.actorMemberId ?? null,
                actorName: data.actorName ?? null,
                field: data.field ?? null,
                oldValue: data.oldValue ?? null,
                newValue: data.newValue ?? null,
                metadata: data.metadata ?? null,
                createdAt: new Date(),
            };
            historyList.push(hist);
            return hist;
        });

        mocks.workOrderHistoryFindMany.mockImplementation(async ({ where, skip = 0, take = 20, orderBy }: any) => {
            let filtered = historyList.filter((h) => {
                if (where.workspaceId && h.workspaceId !== where.workspaceId) return false;
                if (where.workOrderId && h.workOrderId !== where.workOrderId) return false;
                if (where.eventType && h.eventType !== where.eventType) return false;
                return true;
            });

            if (orderBy && Array.isArray(orderBy)) {
                const sortOrder = orderBy[0]?.createdAt ?? "desc";
                filtered.sort((a, b) => {
                    if (sortOrder === "asc") return a.createdAt.getTime() - b.createdAt.getTime();
                    return b.createdAt.getTime() - a.createdAt.getTime();
                });
            }

            return filtered.slice(skip, skip + take);
        });

        mocks.workOrderHistoryFindFirst.mockImplementation(async ({ where }: any) => {
            return historyList.find((h) => {
                if (where.workspaceId && h.workspaceId !== where.workspaceId) return false;
                if (where.workOrderId && h.workOrderId !== where.workOrderId) return false;
                if (where.eventType?.in && !where.eventType.in.includes(h.eventType)) return false;
                if (where.newValue && h.newValue !== where.newValue) return false;
                return true;
            }) || null;
        });

        mocks.workOrderHistoryCount.mockImplementation(async ({ where }: any) => {
            return historyList.filter((h) => {
                if (where.workspaceId && h.workspaceId !== where.workspaceId) return false;
                if (where.workOrderId && h.workOrderId !== where.workOrderId) return false;
                if (where.eventType && h.eventType !== where.eventType) return false;
                return true;
            }).length;
        });

        // Transaction mock executes callback passing mock transaction object with rollback
        mocks.$transaction.mockImplementation(async (cb: any) => {
            const workOrdersBackup = JSON.parse(JSON.stringify(workOrdersList));
            const historyBackup = JSON.parse(JSON.stringify(historyList));
            try {
                return await cb({
                    workOrder: {
                        create: mocks.workOrderCreate,
                        update: mocks.workOrderUpdate,
                        delete: mocks.workOrderDelete,
                        findFirst: mocks.workOrderFindFirst,
                        count: mocks.workOrderCount,
                    },
                    workOrderHistory: {
                        create: mocks.workOrderHistoryCreate,
                    },
                    workspace: {
                        findUnique: mocks.workspaceFindUnique,
                    },
                    workspaceEntitlementOverride: {
                        findUnique: mocks.workspaceEntitlementOverrideFindUnique,
                    },
                    subscription: {
                        findFirst: mocks.subscriptionFindFirst,
                    },
                });
            } catch (err) {
                workOrdersList.length = 0;
                workOrdersList.push(...workOrdersBackup);
                historyList.length = 0;
                historyList.push(...historyBackup);
                throw err;
            }
        });
    });

    function seedCustomer(workspaceId = WS_ALPHA): Customer {
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
            status: "ACTIVE",
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        customersList.push(c);
        return c;
    }

    function seedLocation(customerId: string): ServiceLocation {
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

    function seedCatalog(workspaceId = WS_ALPHA): ServiceCatalog {
        const cat: ServiceCatalog = {
            id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId,
            name: "HVAC Services",
            description: "Catalog Description",
            status: "ACTIVE",
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        catalogsList.push(cat);
        return cat;
    }

    function seedWorkType(catalogId: string, workspaceId = WS_ALPHA): WorkType {
        const wt: WorkType = {
            id: `wt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId,
            catalogId,
            name: "Compressor Overhaul",
            code: "HVAC-COMP-01",
            description: "Full overhaul",
            estimatedDuration: 120,
            status: "ACTIVE",
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        workTypesList.push(wt);
        return wt;
    }

    function seedTechnician(memberId: string, displayName = "John Tech", workspaceId = WS_ALPHA): TechnicianProfile & { employee: Employee } {
        const emp: Employee = {
            id: `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            workspaceId,
            workspaceMemberId: memberId,
            departmentId: null,
            jobTitleId: null,
            employeeNumber: `EMP-${Date.now()}`,
            displayName,
            phone: "+1-555-9000",
            hireDate: new Date(),
            status: "ACTIVE",
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
        const cust = seedCustomer(WS_ALPHA);
        const loc = seedLocation(cust.id);
        const cat = seedCatalog(WS_ALPHA);
        const wt = seedWorkType(cat.id, WS_ALPHA);

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

    describe("1. WorkOrder Lifecycle Event History Recording", () => {
        it("records CREATED history upon successful WorkOrder creation", async () => {
            const cust = seedCustomer(WS_ALPHA);
            const loc = seedLocation(cust.id);
            const cat = seedCatalog(WS_ALPHA);
            const wt = seedWorkType(cat.id, WS_ALPHA);

            mocks.workOrderCount.mockResolvedValueOnce(0);

            const created = await createWorkOrder(WS_ALPHA, {
                customerId: cust.id,
                locationId: loc.id,
                workTypeId: wt.id,
                title: "Heater Maintenance",
            });

            expect(historyList).toHaveLength(1);
            expect(historyList[0].workOrderId).toBe(created.id);
            expect(historyList[0].eventType).toBe("CREATED");
            expect(historyList[0].actorMemberId).toBe(MEMBER_ADMIN.id);
            expect(historyList[0].actorName).toBe(USER_ADMIN.name);
            expect(historyList[0].newValue).toBe(created.workOrderNumber);
        });

        it("records STATUS_CHANGED history on valid status transition", async () => {
            const tech = seedTechnician(MEMBER_TECH_1.id);
            const wo = seedWorkOrder({ assignedTechnicianId: tech.id, status: "ASSIGNED" });

            await transitionWorkOrderStatus(WS_ALPHA, wo.id, {
                toStatus: "IN_PROGRESS",
            });

            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("STATUS_CHANGED");
            expect(historyList[0].field).toBe("status");
            expect(historyList[0].oldValue).toBe("ASSIGNED");
            expect(historyList[0].newValue).toBe("IN_PROGRESS");
        });

        it("does NOT record history when a status transition fails validation or preconditions", async () => {
            const wo = seedWorkOrder({ status: "OPEN", assignedTechnicianId: null });

            // Invalid transition OPEN -> COMPLETED throws error
            await expect(
                transitionWorkOrderStatus(WS_ALPHA, wo.id, { toStatus: "COMPLETED" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);

            expect(historyList).toHaveLength(0);
        });

        it("records ASSIGNED history on successful technician assignment", async () => {
            const tech = seedTechnician(MEMBER_TECH_1.id, "Alice Tech");
            const wo = seedWorkOrder({ status: "OPEN", assignedTechnicianId: null });

            await assignWorkOrder(WS_ALPHA, wo.id, { technicianId: tech.id });

            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("ASSIGNED");
            expect(historyList[0].field).toBe("assignedTechnicianId");
            expect(historyList[0].oldValue).toBeNull();
            expect(historyList[0].newValue).toBe(tech.id);
        });

        it("records REASSIGNED history on successful technician reassignment", async () => {
            const tech1 = seedTechnician(MEMBER_TECH_1.id, "Tech One");
            const tech2 = seedTechnician(MEMBER_TECH_2.id, "Tech Two");
            const wo = seedWorkOrder({ status: "ASSIGNED", assignedTechnicianId: tech1.id });

            await reassignWorkOrder(WS_ALPHA, wo.id, { technicianId: tech2.id });

            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("REASSIGNED");
            expect(historyList[0].field).toBe("assignedTechnicianId");
            expect(historyList[0].oldValue).toBe(tech1.id);
            expect(historyList[0].newValue).toBe(tech2.id);
        });

        it("records UNASSIGNED history on successful unassignment", async () => {
            const tech = seedTechnician(MEMBER_TECH_1.id);
            const wo = seedWorkOrder({ status: "ASSIGNED", assignedTechnicianId: tech.id });

            await unassignWorkOrder(WS_ALPHA, wo.id);

            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("UNASSIGNED");
            expect(historyList[0].field).toBe("assignedTechnicianId");
            expect(historyList[0].oldValue).toBe(tech.id);
            expect(historyList[0].newValue).toBeNull();
        });

        it("records UPDATED history for each changed field in updateWorkOrder", async () => {
            const wo = seedWorkOrder({
                title: "Old Title",
                priority: "LOW",
                description: "Old description",
            });

            await updateWorkOrder(WS_ALPHA, wo.id, {
                title: "New Title",
                priority: "HIGH",
            });

            expect(historyList).toHaveLength(2);
            const titleChange = historyList.find((h) => h.field === "title");
            const priorityChange = historyList.find((h) => h.field === "priority");

            expect(titleChange?.eventType).toBe("UPDATED");
            expect(titleChange?.oldValue).toBe("Old Title");
            expect(titleChange?.newValue).toBe("New Title");

            expect(priorityChange?.eventType).toBe("UPDATED");
            expect(priorityChange?.oldValue).toBe("LOW");
            expect(priorityChange?.newValue).toBe("HIGH");
        });

        it("records DELETED history before physical deletion of an eligible WorkOrder", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });

            await deleteWorkOrder(WS_ALPHA, wo.id);

            expect(workOrdersList).toHaveLength(0); // Physically deleted
            expect(historyList).toHaveLength(1); // History preserved
            expect(historyList[0].eventType).toBe("DELETED");
            expect(historyList[0].workOrderId).toBe(wo.id);
            expect(historyList[0].oldValue).toBe(wo.workOrderNumber);
        });

        it("preserves historical audit trail even after WorkOrder deletion", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });

            // Seed CREATED event
            historyList.push({
                id: "hist_1",
                workspaceId: WS_ALPHA,
                workOrderId: wo.id,
                eventType: "CREATED",
                actorMemberId: MEMBER_ADMIN.id,
                actorName: USER_ADMIN.name,
                field: null,
                oldValue: null,
                newValue: wo.workOrderNumber,
                metadata: null,
                createdAt: new Date(Date.now() - 10000),
            });

            await deleteWorkOrder(WS_ALPHA, wo.id);

            const historyResult = await getWorkOrderHistory(WS_ALPHA, wo.id);
            expect(historyResult.items).toHaveLength(2); // CREATED + DELETED
            expect(historyResult.items[0].eventType).toBe("DELETED");
            expect(historyResult.items[1].eventType).toBe("CREATED");
        });
    });

    describe("2. Actor Attribution & Server-Side Security", () => {
        it("records authenticated actor identity from authorization context", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
            });

            const wo = seedWorkOrder({ status: "OPEN" });
            await updateWorkOrder(WS_ALPHA, wo.id, { title: "Updated Title" });

            expect(historyList[0].actorMemberId).toBe(MEMBER_ADMIN.id);
            expect(historyList[0].actorName).toBe(USER_ADMIN.name);
        });

        it("disallows spoofing actor identity through payload injection (rejected by strict schema)", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });

            // Passing arbitrary spoofed actor in payload is strictly rejected
            await expect(
                updateWorkOrder(WS_ALPHA, wo.id, {
                    title: "Updated Title",
                    // @ts-ignore
                    actorMemberId: "spoofed_actor",
                    actorName: "Spoofed User",
                }),
            ).rejects.toThrow();

            expect(historyList).toHaveLength(0);
        });
    });

    describe("3. Tenant & Technician Isolation Guarantees", () => {
        it("rejects history queries for cross-tenant WorkOrders with 404", async () => {
            const woBeta = seedWorkOrder({ workspaceId: WS_BETA });

            await expect(
                getWorkOrderHistory(WS_ALPHA, woBeta.id),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("allows TECHNICIAN to view history for WorkOrder assigned to them", async () => {
            const tech1 = seedTechnician(MEMBER_TECH_1.id);
            const wo = seedWorkOrder({ assignedTechnicianId: tech1.id, status: "ASSIGNED" });

            historyList.push({
                id: "hist_tech_1",
                workspaceId: WS_ALPHA,
                workOrderId: wo.id,
                eventType: "ASSIGNED",
                actorMemberId: MEMBER_ADMIN.id,
                actorName: USER_ADMIN.name,
                field: "assignedTechnicianId",
                oldValue: null,
                newValue: tech1.id,
                metadata: null,
                createdAt: new Date(),
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH_1.id, email: USER_TECH_1.email },
            });

            const result = await getWorkOrderHistory(WS_ALPHA, wo.id);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].eventType).toBe("ASSIGNED");
        });

        it("rejects TECHNICIAN from viewing history for WorkOrder assigned to another technician (403)", async () => {
            const tech1 = seedTechnician(MEMBER_TECH_1.id);
            const wo = seedWorkOrder({ assignedTechnicianId: tech1.id, status: "ASSIGNED" });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH_2.id, email: USER_TECH_2.email },
            });

            await expect(
                getWorkOrderHistory(WS_ALPHA, wo.id),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("4. Pagination, Sorting & Filtering", () => {
        it("returns paginated history with canonical metadata and deterministic ordering", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });

            for (let i = 0; i < 5; i++) {
                historyList.push({
                    id: `hist_${i}`,
                    workspaceId: WS_ALPHA,
                    workOrderId: wo.id,
                    eventType: "UPDATED",
                    actorMemberId: MEMBER_ADMIN.id,
                    actorName: USER_ADMIN.name,
                    field: "title",
                    oldValue: `Title ${i}`,
                    newValue: `Title ${i + 1}`,
                    metadata: null,
                    createdAt: new Date(Date.now() + i * 1000),
                });
            }

            const page1 = await getWorkOrderHistory(WS_ALPHA, wo.id, {
                page: 1,
                pageSize: 2,
                sortOrder: "desc",
            });

            expect(page1.items).toHaveLength(2);
            expect(page1.pagination).toEqual({
                page: 1,
                pageSize: 2,
                total: 5,
                totalPages: 3,
                hasNextPage: true,
                hasPreviousPage: false,
            });

            const page2 = await getWorkOrderHistory(WS_ALPHA, wo.id, {
                page: 2,
                pageSize: 2,
                sortOrder: "desc",
            });

            expect(page2.items).toHaveLength(2);
            expect(page2.pagination.hasNextPage).toBe(true);
            expect(page2.pagination.hasPreviousPage).toBe(true);
        });

        it("supports filtering history by eventType", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });

            historyList.push(
                {
                    id: "hist_c",
                    workspaceId: WS_ALPHA,
                    workOrderId: wo.id,
                    eventType: "CREATED",
                    actorMemberId: MEMBER_ADMIN.id,
                    actorName: USER_ADMIN.name,
                    field: null,
                    oldValue: null,
                    newValue: "WO-1",
                    metadata: null,
                    createdAt: new Date(),
                },
                {
                    id: "hist_u",
                    workspaceId: WS_ALPHA,
                    workOrderId: wo.id,
                    eventType: "UPDATED",
                    actorMemberId: MEMBER_ADMIN.id,
                    actorName: USER_ADMIN.name,
                    field: "title",
                    oldValue: "Old",
                    newValue: "New",
                    metadata: null,
                    createdAt: new Date(),
                },
            );

            const result = await getWorkOrderHistory(WS_ALPHA, wo.id, {
                eventType: "CREATED",
            });

            expect(result.items).toHaveLength(1);
            expect(result.items[0].eventType).toBe("CREATED");
        });
    });

    describe("5. REST API Boundary: GET /api/work-orders/[workOrderId]/history", () => {
        it("returns 200 with standard envelope and paginated history", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });
            historyList.push({
                id: "hist_1",
                workspaceId: WS_ALPHA,
                workOrderId: wo.id,
                eventType: "CREATED",
                actorMemberId: MEMBER_ADMIN.id,
                actorName: USER_ADMIN.name,
                field: null,
                oldValue: null,
                newValue: wo.workOrderNumber,
                metadata: null,
                createdAt: new Date(),
            });

            const req = new Request(`http://localhost/api/work-orders/${wo.id}/history?page=1&pageSize=10`, {
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await getWorkOrderHistoryRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.items).toHaveLength(1);
            expect(json.data.pagination.total).toBe(1);
        });

        it("returns 400 MISSING_WORKSPACE when workspace header is missing", async () => {
            const req = new Request("http://localhost/api/work-orders/wo_1/history");
            const res = await getWorkOrderHistoryRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_1" }),
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("returns 404 WORK_ORDER_NOT_FOUND for non-existent work order", async () => {
            const req = new Request("http://localhost/api/work-orders/wo_missing/history", {
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await getWorkOrderHistoryRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_missing" }),
            });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_NOT_FOUND");
        });

        it("returns 401 UNAUTHORIZED when session is missing", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            const req = new Request("http://localhost/api/work-orders/wo_1/history", {
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await getWorkOrderHistoryRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_1" }),
            });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("returns 403 FORBIDDEN when user has no access to workspace", async () => {
            const nonMemberUser: User = {
                id: "user_non_member",
                name: "Non Member",
                email: "nonmember@test.com",
        platformRole: null,
                emailVerified: new Date(),
                passwordHash: "hash",
                avatarUrl: null,
        status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            usersMap.set(nonMemberUser.id, nonMemberUser);

            mocks.auth.mockResolvedValueOnce({
                user: { id: nonMemberUser.id, email: nonMemberUser.email },
            });

            const req = new Request("http://localhost/api/work-orders/wo_1/history", {
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await getWorkOrderHistoryRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_1" }),
            });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 422 VALIDATION_ERROR when query parameters are invalid", async () => {
            const wo = seedWorkOrder({ status: "OPEN" });
            const req = new Request(`http://localhost/api/work-orders/${wo.id}/history?page=0&pageSize=999`, {
                headers: { "x-workspace-id": WS_ALPHA },
            });

            const res = await getWorkOrderHistoryRoute(req, {
                params: Promise.resolve({ workOrderId: wo.id }),
            });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("6. Transactional Atomicity & Immutability", () => {
        it("rolls back work order mutation when history recording fails in transaction", async () => {
            const wo = seedWorkOrder({ status: "OPEN", assignedTechnicianId: null });
            const tech = seedTechnician(MEMBER_TECH_1.id);

            // Force history creation to throw
            mocks.workOrderHistoryCreate.mockRejectedValueOnce(
                new Error("Database connection lost during history insertion"),
            );

            await expect(
                assignWorkOrder(WS_ALPHA, wo.id, { technicianId: tech.id }),
            ).rejects.toThrow("Database connection lost during history insertion");

            // Work order should remain unassigned due to transaction failure
            const check = workOrdersList.find((w) => w.id === wo.id);
            expect(check?.assignedTechnicianId).toBeNull();
            expect(historyList).toHaveLength(0);
        });

        it("confirms history records cannot be modified or deleted via public services", () => {
            // Verify there is no updateWorkOrderHistory or deleteWorkOrderHistory exported
            expect((workOrderModule as any).updateWorkOrderHistory).toBeUndefined();
            expect((workOrderModule as any).deleteWorkOrderHistory).toBeUndefined();
        });
    });
});

