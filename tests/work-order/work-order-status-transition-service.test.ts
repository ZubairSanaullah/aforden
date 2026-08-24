import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderUpdate: vi.fn(),
    workOrderHistoryCreate: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
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
            update: mocks.workOrderUpdate,
        },
        workOrderHistory: {
            create: mocks.workOrderHistoryCreate,
        },
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
        $transaction: async (cb: any) => {
            const { prisma: mockPrisma } = await import("@/lib/prisma");
            return typeof cb === "function" ? await cb(mockPrisma) : cb;
        },
    },
}));

import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderAssignmentNotAllowedError,
    WorkOrderCompletionPreconditionFailedError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import type {
    Customer,
    ServiceLocation,
    WorkType,
    WorkOrder,
    User,
    Workspace,
    WorkspaceMember,
    TechnicianProfile,
    Employee,
    WorkOrderStatus,
} from "@/generated/prisma/client";

describe("Phase 1.6.5 — WorkOrder Status Transition Service Layer", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let employeesList: Employee[];
    let technicianProfilesList: TechnicianProfile[];
    let workOrdersList: WorkOrder[];

    const WS_ID = "ws_status_100";
    const WS_ID_2 = "ws_status_200";

    const USER_ADMIN: User = {
        id: "user_adm_1",
        name: "Admin Person",
        email: "admin@status.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_DISPATCHER: User = {
        id: "user_disp_2",
        name: "Dispatcher Person",
        email: "disp@status.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH_1: User = {
        id: "user_tech_3",
        name: "Technician Bob",
        email: "tech1@status.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH_2: User = {
        id: "user_tech_4",
        name: "Technician Alice",
        email: "tech2@status.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_ACCOUNTANT: User = {
        id: "user_acct_5",
        name: "Accountant Dave",
        email: "acct@status.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Status Testing Corp",
        slug: "status-ws",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_BETA: Workspace = {
        id: WS_ID_2,
        name: "Other Workspace Corp",
        slug: "other-status-ws",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_status_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-100",
        name: "Global Facility Corp",
        email: "facility@global.com",
        phone: "+1-555-9000",
        website: null,
        addressLine1: "123 Industrial Pkwy",
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

    const FIXTURE_LOCATION: ServiceLocation = {
        id: "loc_status_1",
        customerId: FIXTURE_CUSTOMER.id,
        name: "Building A",
        addressLine1: "123 Industrial Pkwy",
        addressLine2: "Suite 400",
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

    const FIXTURE_WORKTYPE: WorkType = {
        id: "wt_status_1",
        workspaceId: WS_ID,
        catalogId: "sc_status_1",
        name: "Commercial Electrical Service",
        code: "ELEC-COM-01",
        description: "Standard commercial electrical diagnostic",
        estimatedDuration: 120,
        status: "ACTIVE",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        employeesList = [];
        technicianProfilesList = [];
        workOrdersList = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
        usersMap.set(USER_DISPATCHER.id, USER_DISPATCHER);
        usersMap.set(USER_TECH_1.id, USER_TECH_1);
        usersMap.set(USER_TECH_2.id, USER_TECH_2);
        usersMap.set(USER_ACCOUNTANT.id, USER_ACCOUNTANT);

        workspacesMap.set(WS_ALPHA.id, WS_ALPHA);
        workspacesMap.set(WS_BETA.id, WS_BETA);

        // Memberships
        const memAdmin: WorkspaceMember = {
            id: "mem_adm_1",
            userId: USER_ADMIN.id,
            workspaceId: WS_ALPHA.id,
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memDisp: WorkspaceMember = {
            id: "mem_disp_2",
            userId: USER_DISPATCHER.id,
            workspaceId: WS_ALPHA.id,
            role: "DISPATCHER",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memTech1: WorkspaceMember = {
            id: "mem_tech_3",
            userId: USER_TECH_1.id,
            workspaceId: WS_ALPHA.id,
            role: "TECHNICIAN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memTech2: WorkspaceMember = {
            id: "mem_tech_4",
            userId: USER_TECH_2.id,
            workspaceId: WS_ALPHA.id,
            role: "TECHNICIAN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memAcct: WorkspaceMember = {
            id: "mem_acct_5",
            userId: USER_ACCOUNTANT.id,
            workspaceId: WS_ALPHA.id,
            role: "ACCOUNTANT",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        membersMap.set(`${USER_ADMIN.id}_${WS_ALPHA.id}`, memAdmin);
        membersMap.set(`${USER_DISPATCHER.id}_${WS_ALPHA.id}`, memDisp);
        membersMap.set(`${USER_TECH_1.id}_${WS_ALPHA.id}`, memTech1);
        membersMap.set(`${USER_TECH_2.id}_${WS_ALPHA.id}`, memTech2);
        membersMap.set(`${USER_ACCOUNTANT.id}_${WS_ALPHA.id}`, memAcct);

        // Employees
        const empTech1: Employee = {
            id: "emp_tech_1",
            workspaceId: WS_ALPHA.id,
            workspaceMemberId: memTech1.id,
            departmentId: null,
            jobTitleId: null,
            employeeNumber: "EMP-001",
            displayName: "Technician Bob",
            phone: null,
            hireDate: new Date(),
            status: "ACTIVE",
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const empTech2: Employee = {
            id: "emp_tech_2",
            workspaceId: WS_ALPHA.id,
            workspaceMemberId: memTech2.id,
            departmentId: null,
            jobTitleId: null,
            employeeNumber: "EMP-002",
            displayName: "Technician Alice",
            phone: null,
            hireDate: new Date(),
            status: "ACTIVE",
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        employeesList.push(empTech1, empTech2);

        // Technician Profiles
        const profTech1: TechnicianProfile = {
            id: "tp_bob_1",
            employeeId: empTech1.id,
            licenseNumber: "LIC-001",
            yearsExperience: 5,
            emergencyContact: null,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const profTech2: TechnicianProfile = {
            id: "tp_alice_2",
            employeeId: empTech2.id,
            licenseNumber: "LIC-002",
            yearsExperience: 8,
            emergencyContact: null,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        technicianProfilesList.push(profTech1, profTech2);

        // Default session is ADMIN
        mocks.auth.mockResolvedValue({
            user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
        });

        mocks.userFindUnique.mockImplementation(async ({ where }: any) => {
            return usersMap.get(where.id) || null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: any) => {
            return workspacesMap.get(where.id) || null;
        });

        mocks.workspaceMemberFindUnique.mockImplementation(async ({ where }: any) => {
            if (where.userId_workspaceId) {
                const key = `${where.userId_workspaceId.userId}_${where.userId_workspaceId.workspaceId}`;
                return membersMap.get(key) || null;
            }
            if (where.id) {
                return membersMap.get(where.id) || null;
            }
            return null;
        });

        mocks.workOrderFindFirst.mockImplementation(async ({ where }: any) => {
            const found = workOrdersList.find((wo) => {
                if (where.id && wo.id !== where.id) return false;
                if (where.workspaceId && wo.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;
            return {
                ...found,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORKTYPE,
            };
        });

        mocks.technicianProfileFindFirst.mockImplementation(async ({ where }: any) => {
            const found = technicianProfilesList.find((tp) => {
                if (where.id && tp.id !== where.id) return false;
                if (where.employee?.workspaceMemberId) {
                    const emp = employeesList.find((e) => e.id === tp.employeeId);
                    if (!emp || emp.workspaceMemberId !== where.employee.workspaceMemberId) return false;
                }
                if (where.employee?.workspaceId) {
                    const emp = employeesList.find((e) => e.id === tp.employeeId);
                    if (!emp || emp.workspaceId !== where.employee.workspaceId) return false;
                }
                return true;
            });
            return found || null;
        });

        mocks.workOrderUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = workOrdersList.findIndex((wo) => wo.id === where.id);
            if (index === -1) throw new Error("Record not found for update");

            const updated: WorkOrder = {
                ...workOrdersList[index],
                ...data,
                updatedAt: new Date(),
            };
            workOrdersList[index] = updated;

            return {
                ...updated,
                customer: FIXTURE_CUSTOMER,
                location: FIXTURE_LOCATION,
                workType: FIXTURE_WORKTYPE,
            };
        });
    });

    function createFixtureWorkOrder(status: WorkOrderStatus, assignedTechId: string | null = "tp_bob_1", wsId = WS_ID): WorkOrder {
        const wo: WorkOrder = {
            id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            workspaceId: wsId,
            workOrderNumber: `WO-2026-000001`,
            customerId: FIXTURE_CUSTOMER.id,
            locationId: FIXTURE_LOCATION.id,
            workTypeId: FIXTURE_WORKTYPE.id,
            assignedTechnicianId: assignedTechId,
            assetId: null,
            sourceQuoteId: null,
            workTypeName: FIXTURE_WORKTYPE.name,
            workTypeCode: FIXTURE_WORKTYPE.code,
            estimatedDuration: FIXTURE_WORKTYPE.estimatedDuration,
            status,
            priority: "MEDIUM",
            title: "Test Work Order Title",
            description: "Initial description",
            internalNotes: "Internal note",
            holdReason: status === "ON_HOLD" ? "Awaiting special parts" : null,
            cancellationReason: status === "CANCELLED" ? "Client requested cancellation" : null,
            startedAt: (status === "IN_PROGRESS" || status === "ON_HOLD" || status === "COMPLETED") ? new Date("2026-08-20T10:00:00Z") : null,
            completedAt: status === "COMPLETED" ? new Date("2026-08-20T11:30:00Z") : null,
            cancelledAt: status === "CANCELLED" ? new Date("2026-08-20T09:30:00Z") : null,
            createdAt: new Date("2026-08-20T08:00:00Z"),
            updatedAt: new Date("2026-08-20T08:00:00Z"),
        };
        workOrdersList.push(wo);
        return wo;
    }

    describe("1. Full Matrix Positive Transitions & Side Effects", () => {
        it("OPEN -> ASSIGNED: succeeds for DISPATCHER when assignedTechnicianId is present", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_DISPATCHER.id } });
            const wo = createFixtureWorkOrder("OPEN", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "ASSIGNED",
            });

            expect(result.status).toBe("ASSIGNED");
        });

        it("OPEN -> CANCELLED: sets cancelledAt and cancellationReason", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "CANCELLED",
                cancellationReason: "Building power outage",
            });

            expect(result.status).toBe("CANCELLED");
            expect(result.cancelledAt).toBeInstanceOf(Date);
            expect(result.cancellationReason).toBe("Building power outage");
        });

        it("ASSIGNED -> OPEN (Unassign): clears assignedTechnicianId to null", async () => {
            const wo = createFixtureWorkOrder("ASSIGNED", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "OPEN",
            });

            expect(result.status).toBe("OPEN");
            expect(result.assignedTechnicianId).toBeNull();
        });

        it("ASSIGNED -> IN_PROGRESS: sets startedAt = now() if null", async () => {
            const wo = createFixtureWorkOrder("ASSIGNED", "tp_bob_1");
            wo.startedAt = null;

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "IN_PROGRESS",
            });

            expect(result.status).toBe("IN_PROGRESS");
            expect(result.startedAt).toBeInstanceOf(Date);
        });

        it("ASSIGNED -> ON_HOLD: records holdReason", async () => {
            const wo = createFixtureWorkOrder("ASSIGNED", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "ON_HOLD",
                holdReason: "Severe storm warning",
            });

            expect(result.status).toBe("ON_HOLD");
            expect(result.holdReason).toBe("Severe storm warning");
        });

        it("ASSIGNED -> CANCELLED: records cancelledAt and cancellationReason", async () => {
            const wo = createFixtureWorkOrder("ASSIGNED", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "CANCELLED",
                cancellationReason: "Duplicate order intake",
            });

            expect(result.status).toBe("CANCELLED");
            expect(result.cancelledAt).toBeInstanceOf(Date);
            expect(result.cancellationReason).toBe("Duplicate order intake");
        });

        it("IN_PROGRESS -> COMPLETED: sets completedAt = now()", async () => {
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "COMPLETED",
            });

            expect(result.status).toBe("COMPLETED");
            expect(result.completedAt).toBeInstanceOf(Date);
        });

        it("IN_PROGRESS -> ON_HOLD: records holdReason", async () => {
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "ON_HOLD",
                holdReason: "Awaiting custom replacement breaker",
            });

            expect(result.status).toBe("ON_HOLD");
            expect(result.holdReason).toBe("Awaiting custom replacement breaker");
        });

        it("IN_PROGRESS -> CANCELLED: records cancelledAt and cancellationReason", async () => {
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "CANCELLED",
                cancellationReason: "Customer denied site access midway",
            });

            expect(result.status).toBe("CANCELLED");
            expect(result.cancelledAt).toBeInstanceOf(Date);
            expect(result.cancellationReason).toBe("Customer denied site access midway");
        });

        it("ON_HOLD -> IN_PROGRESS (Resume): clears holdReason and preserves original startedAt", async () => {
            const originalStart = new Date("2026-08-20T09:15:00Z");
            const wo = createFixtureWorkOrder("ON_HOLD", "tp_bob_1");
            wo.startedAt = originalStart;
            wo.holdReason = "Parts delay";

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "IN_PROGRESS",
            });

            expect(result.status).toBe("IN_PROGRESS");
            expect(result.holdReason).toBeNull();
            expect(result.startedAt?.getTime()).toBe(originalStart.getTime());
        });

        it("ON_HOLD -> ASSIGNED (Re-queue): clears holdReason", async () => {
            const wo = createFixtureWorkOrder("ON_HOLD", "tp_bob_1");
            wo.holdReason = "Parts delay";

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "ASSIGNED",
            });

            expect(result.status).toBe("ASSIGNED");
            expect(result.holdReason).toBeNull();
        });

        it("ON_HOLD -> CANCELLED: records cancelledAt and cancellationReason", async () => {
            const wo = createFixtureWorkOrder("ON_HOLD", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "CANCELLED",
                cancellationReason: "Parts discontinued by manufacturer",
            });

            expect(result.status).toBe("CANCELLED");
            expect(result.cancelledAt).toBeInstanceOf(Date);
            expect(result.cancellationReason).toBe("Parts discontinued by manufacturer");
        });
    });

    describe("2. Invalid Status Transitions (Matrix Violations)", () => {
        it("rejects OPEN -> IN_PROGRESS (cannot skip ASSIGNED)", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "IN_PROGRESS" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });

        it("rejects OPEN -> COMPLETED", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "COMPLETED" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });

        it("rejects OPEN -> ON_HOLD", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);
            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "ON_HOLD",
                    holdReason: "Parts waiting",
                }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });

        it("rejects ASSIGNED -> COMPLETED (cannot complete without being IN_PROGRESS)", async () => {
            const wo = createFixtureWorkOrder("ASSIGNED", "tp_bob_1");
            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "COMPLETED" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });

        it("rejects same status transition (no-op guard)", async () => {
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");
            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "IN_PROGRESS" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });
    });

    describe("3. Terminal State Guards", () => {
        it("rejects any transition out of COMPLETED", async () => {
            const wo = createFixtureWorkOrder("COMPLETED", "tp_bob_1");

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "OPEN" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "IN_PROGRESS" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "CANCELLED",
                    cancellationReason: "Mistake",
                }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });

        it("rejects any transition out of CANCELLED", async () => {
            const wo = createFixtureWorkOrder("CANCELLED", null);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "OPEN" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "ASSIGNED" }),
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });
    });

    describe("4. Role-Specific Transition Authorization & Technician Scoping", () => {
        it("TECHNICIAN succeeds for IN_PROGRESS -> ON_HOLD on own assigned WorkOrder", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "ON_HOLD",
                holdReason: "Awaiting customer approval for wiring replacement",
            });

            expect(result.status).toBe("ON_HOLD");
            expect(result.holdReason).toBe("Awaiting customer approval for wiring replacement");
        });

        it("TECHNICIAN succeeds for ON_HOLD -> IN_PROGRESS on own assigned WorkOrder", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("ON_HOLD", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "IN_PROGRESS",
            });

            expect(result.status).toBe("IN_PROGRESS");
        });

        it("TECHNICIAN succeeds for IN_PROGRESS -> COMPLETED on own assigned WorkOrder", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "COMPLETED",
            });

            expect(result.status).toBe("COMPLETED");
            expect(result.completedAt).toBeInstanceOf(Date);
        });

        it("TECHNICIAN throws ForbiddenError when attempting transition on a WorkOrder assigned to ANOTHER technician", async () => {
            // Bob (USER_TECH_1) attempts to complete Alice's (tp_alice_2) work order
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_alice_2");

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "COMPLETED",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("TECHNICIAN throws ForbiddenError when attempting ASSIGNED -> ON_HOLD (binding addendum exclusion)", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("ASSIGNED", "tp_bob_1");

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "ON_HOLD",
                    holdReason: "Can't start today",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("TECHNICIAN succeeds for ASSIGNED -> IN_PROGRESS on own assigned WorkOrder", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("ASSIGNED", "tp_bob_1");

            const result = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "IN_PROGRESS",
            });

            expect(result.status).toBe("IN_PROGRESS");
            expect(result.startedAt).toBeInstanceOf(Date);
        });

        it("DISPATCHER throws ForbiddenError when attempting IN_PROGRESS -> COMPLETED (audit correction)", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_DISPATCHER.id } });
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "COMPLETED",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("ACCOUNTANT throws ForbiddenError immediately for any transition attempt", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_ACCOUNTANT.id } });
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "ASSIGNED",
                }),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("5. Preconditions & Relational Defense", () => {
        it("throws WorkOrderAssignmentNotAllowedError when transitioning OPEN to ASSIGNED without an assigned technician", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "ASSIGNED",
                }),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);
        });

        it("throws WorkOrderCompletionPreconditionFailedError when completing a work order with null assignedTechnicianId", async () => {
            // Admin attempts to complete an IN_PROGRESS work order that somehow has no technician assigned
            const wo = createFixtureWorkOrder("IN_PROGRESS", null);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "COMPLETED",
                }),
            ).rejects.toThrow(WorkOrderCompletionPreconditionFailedError);
        });
    });

    describe("6. Cross-Tenant IDOR Protection & Unauthenticated Guards", () => {
        it("throws WorkOrderNotFoundError (404) when workOrderId does not exist in workspace", async () => {
            await expect(
                transitionWorkOrderStatus(WS_ID, "wo_nonexistent_999", {
                    toStatus: "ASSIGNED",
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("throws WorkOrderNotFoundError (404) when workOrderId belongs to a DIFFERENT workspace", async () => {
            const betaWo = createFixtureWorkOrder("OPEN", null, WS_ID_2);

            await expect(
                transitionWorkOrderStatus(WS_ID, betaWo.id, {
                    toStatus: "ASSIGNED",
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("throws UnauthorizedError when session is missing", async () => {
            mocks.auth.mockResolvedValue(null);
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, {
                    toStatus: "ASSIGNED",
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });
});
