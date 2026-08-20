import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderUpdate: vi.fn(),
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
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
    },
}));

import {
    assignWorkOrder,
    reassignWorkOrder,
    unassignWorkOrder,
} from "@/lib/services/workOrder/assignWorkOrder";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    WorkOrderNotFoundError,
    WorkOrderTechnicianNotFoundError,
    WorkOrderTechnicianNotEligibleError,
    WorkOrderAssignmentNotAllowedError,
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

describe("Phase 1.6.6 — WorkOrder Assignment Services", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let employeesList: Employee[];
    let technicianProfilesList: TechnicianProfile[];
    let workOrdersList: WorkOrder[];

    const WS_ID = "ws_assign_100";
    const WS_ID_2 = "ws_assign_200";

    const USER_ADMIN: User = {
        id: "user_adm_1",
        name: "Admin Person",
        email: "admin@assign.com",
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
        email: "disp@assign.com",
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
        email: "tech1@assign.com",
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
        email: "acct@assign.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Assignment Testing Corp",
        slug: "assign-ws",
        logoUrl: null,
        timezone: "UTC",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_BETA: Workspace = {
        id: WS_ID_2,
        name: "Beta Workspace Corp",
        slug: "beta-assign-ws",
        logoUrl: null,
        timezone: "UTC",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_assign_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-100",
        name: "Facility Corp",
        email: "facility@assign.com",
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
        id: "loc_assign_1",
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
        id: "wt_assign_1",
        workspaceId: WS_ID,
        catalogId: "sc_assign_1",
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
        usersMap.set(USER_ACCOUNTANT.id, USER_ACCOUNTANT);

        workspacesMap.set(WS_ALPHA.id, WS_ALPHA);
        workspacesMap.set(WS_BETA.id, WS_BETA);

        // Memberships in Workspace Alpha
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
        membersMap.set(`${USER_ACCOUNTANT.id}_${WS_ALPHA.id}`, memAcct);

        // Employees in Workspace Alpha
        const empBob: Employee = {
            id: "emp_bob_1",
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
        const empAlice: Employee = {
            id: "emp_alice_2",
            workspaceId: WS_ALPHA.id,
            workspaceMemberId: "mem_alice_99",
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
        const empInactive: Employee = {
            id: "emp_inactive_3",
            workspaceId: WS_ALPHA.id,
            workspaceMemberId: "mem_inact_99",
            departmentId: null,
            jobTitleId: null,
            employeeNumber: "EMP-003",
            displayName: "Inactive Tech",
            phone: null,
            hireDate: new Date(),
            status: "INACTIVE",
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        // Employee in Workspace Beta
        const empBeta: Employee = {
            id: "emp_beta_4",
            workspaceId: WS_BETA.id,
            workspaceMemberId: "mem_beta_99",
            departmentId: null,
            jobTitleId: null,
            employeeNumber: "EMP-BETA-001",
            displayName: "Beta Workspace Tech",
            phone: null,
            hireDate: new Date(),
            status: "ACTIVE",
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        employeesList.push(empBob, empAlice, empInactive, empBeta);

        // Technician Profiles
        const profBob: TechnicianProfile = {
            id: "tp_bob_1",
            employeeId: empBob.id,
            licenseNumber: "LIC-001",
            yearsExperience: 5,
            emergencyContact: null,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const profAlice: TechnicianProfile = {
            id: "tp_alice_2",
            employeeId: empAlice.id,
            licenseNumber: "LIC-002",
            yearsExperience: 8,
            emergencyContact: null,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const profInactive: TechnicianProfile = {
            id: "tp_inactive_3",
            employeeId: empInactive.id,
            licenseNumber: "LIC-003",
            yearsExperience: 3,
            emergencyContact: null,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const profBeta: TechnicianProfile = {
            id: "tp_beta_4",
            employeeId: empBeta.id,
            licenseNumber: "LIC-BETA-001",
            yearsExperience: 4,
            emergencyContact: null,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        technicianProfilesList.push(profBob, profAlice, profInactive, profBeta);

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
                if (where.employee?.workspaceId) {
                    const emp = employeesList.find((e) => e.id === tp.employeeId);
                    if (!emp || emp.workspaceId !== where.employee.workspaceId) return false;
                }
                return true;
            });
            if (!found) return null;

            const emp = employeesList.find((e) => e.id === found.employeeId);
            return {
                ...found,
                employee: emp,
            };
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

    function createFixtureWorkOrder(status: WorkOrderStatus, assignedTechId: string | null = null, wsId = WS_ID): WorkOrder {
        const wo: WorkOrder = {
            id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            workspaceId: wsId,
            workOrderNumber: `WO-2026-000001`,
            customerId: FIXTURE_CUSTOMER.id,
            locationId: FIXTURE_LOCATION.id,
            workTypeId: FIXTURE_WORKTYPE.id,
            assignedTechnicianId: assignedTechId,
            assetId: null,
            workTypeName: FIXTURE_WORKTYPE.name,
            workTypeCode: FIXTURE_WORKTYPE.code,
            estimatedDuration: FIXTURE_WORKTYPE.estimatedDuration,
            status,
            priority: "MEDIUM",
            title: "Test Work Order Title",
            description: "Initial description",
            internalNotes: "Internal note",
            holdReason: null,
            cancellationReason: null,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
            createdAt: new Date("2026-08-20T08:00:00Z"),
            updatedAt: new Date("2026-08-20T08:00:00Z"),
        };
        workOrdersList.push(wo);
        return wo;
    }

    describe("1. Authentication & Permission RBAC", () => {
        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" }),
            ).rejects.toThrow(UnauthorizedError);
        });

        it("allows DISPATCHER to assign a technician", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_DISPATCHER.id } });
            const wo = createFixtureWorkOrder("OPEN", null);

            const result = await assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" });
            expect(result.assignedTechnicianId).toBe("tp_bob_1");
        });

        it("rejects TECHNICIAN with ForbiddenError when attempting to assign", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects ACCOUNTANT with ForbiddenError when attempting to assign", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_ACCOUNTANT.id } });
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" }),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("2. WorkOrder & Technician Tenant Scoping (IDOR Defense)", () => {
        it("throws WorkOrderNotFoundError (404) when workOrderId does not exist in workspace", async () => {
            await expect(
                assignWorkOrder(WS_ID, "wo_nonexistent_999", { technicianId: "tp_bob_1" }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("throws WorkOrderNotFoundError (404) when workOrder belongs to a DIFFERENT workspace", async () => {
            const betaWo = createFixtureWorkOrder("OPEN", null, WS_ID_2);

            await expect(
                assignWorkOrder(WS_ID, betaWo.id, { technicianId: "tp_bob_1" }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("throws WorkOrderTechnicianNotFoundError (404) when technician does not exist", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_nonexistent_999" }),
            ).rejects.toThrow(WorkOrderTechnicianNotFoundError);
        });

        it("rejects cross-tenant technician injection: assigning a technician from Workspace B to a WorkOrder in Workspace A throws 404", async () => {
            const wo = createFixtureWorkOrder("OPEN", null, WS_ID);

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_beta_4" }),
            ).rejects.toThrow(WorkOrderTechnicianNotFoundError);
        });
    });

    describe("3. Technician Eligibility (Phase 1.3 Precedent)", () => {
        it("accepts an active and eligible technician in the same workspace", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            const result = await assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" });
            expect(result.assignedTechnicianId).toBe("tp_bob_1");
        });

        it("rejects an inactive technician with WorkOrderTechnicianNotEligibleError (422)", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_inactive_3" }),
            ).rejects.toThrow(WorkOrderTechnicianNotEligibleError);
        });
    });

    describe("4. Assign Operations & Invariants", () => {
        it("assigns an unassigned WorkOrder and sets assignedTechnicianId", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            const result = await assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" });
            expect(result.assignedTechnicianId).toBe("tp_bob_1");
            expect(result.status).toBe("OPEN"); // Status is preserved
        });

        it("rejects assign on an already assigned WorkOrder with WorkOrderAssignmentNotAllowedError", async () => {
            const wo = createFixtureWorkOrder("OPEN", "tp_bob_1");

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_alice_2" }),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);
        });
    });

    describe("5. Reassign Operations & Invariants", () => {
        it("reassigns an assigned WorkOrder from one technician to another", async () => {
            const wo = createFixtureWorkOrder("OPEN", "tp_bob_1");

            const result = await reassignWorkOrder(WS_ID, wo.id, { technicianId: "tp_alice_2" });
            expect(result.assignedTechnicianId).toBe("tp_alice_2");
        });

        it("rejects reassign on an unassigned WorkOrder with WorkOrderAssignmentNotAllowedError", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                reassignWorkOrder(WS_ID, wo.id, { technicianId: "tp_alice_2" }),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);
        });
    });

    describe("6. Unassign Operations & Invariants", () => {
        it("unassigns an assigned WorkOrder and sets assignedTechnicianId to null", async () => {
            const wo = createFixtureWorkOrder("OPEN", "tp_bob_1");

            const result = await unassignWorkOrder(WS_ID, wo.id);
            expect(result.assignedTechnicianId).toBeNull();
        });

        it("rejects unassign on an unassigned WorkOrder with WorkOrderAssignmentNotAllowedError", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            await expect(
                unassignWorkOrder(WS_ID, wo.id),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);
        });
    });

    describe("7. Terminal State Protection", () => {
        it("rejects assign on a COMPLETED WorkOrder", async () => {
            const wo = createFixtureWorkOrder("COMPLETED", null);

            await expect(
                assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" }),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);
        });

        it("rejects reassign on a CANCELLED WorkOrder", async () => {
            const wo = createFixtureWorkOrder("CANCELLED", "tp_bob_1");

            await expect(
                reassignWorkOrder(WS_ID, wo.id, { technicianId: "tp_alice_2" }),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);
        });

        it("rejects unassign on a COMPLETED WorkOrder", async () => {
            const wo = createFixtureWorkOrder("COMPLETED", "tp_bob_1");

            await expect(
                unassignWorkOrder(WS_ID, wo.id),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);
        });
    });

    describe("8. Immutability of Snapshots and Unrelated Fields", () => {
        it("preserves WorkType snapshots, status, and title during assignment", async () => {
            const wo = createFixtureWorkOrder("OPEN", null);

            const result = await assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" });

            expect(result.workTypeName).toBe(FIXTURE_WORKTYPE.name);
            expect(result.workTypeCode).toBe(FIXTURE_WORKTYPE.code);
            expect(result.estimatedDuration).toBe(FIXTURE_WORKTYPE.estimatedDuration);
            expect(result.status).toBe("OPEN");
            expect(result.title).toBe("Test Work Order Title");
        });
    });

    describe("9. Integration Boundary with Phase 1.6.5 (OPEN -> assign -> transition ASSIGNED)", () => {
        it("enables legitimate workflow: unassigned OPEN -> 1.6.6 assign -> 1.6.5 transition to ASSIGNED", async () => {
            // 1. Initially unassigned OPEN work order
            const wo = createFixtureWorkOrder("OPEN", null);
            expect(wo.assignedTechnicianId).toBeNull();
            expect(wo.status).toBe("OPEN");

            // 2. Phase 1.6.5 rejects OPEN -> ASSIGNED before assignment
            await expect(
                transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "ASSIGNED" }),
            ).rejects.toThrow(WorkOrderAssignmentNotAllowedError);

            // 3. Phase 1.6.6 assigns the technician
            const assigned = await assignWorkOrder(WS_ID, wo.id, { technicianId: "tp_bob_1" });
            expect(assigned.assignedTechnicianId).toBe("tp_bob_1");
            expect(assigned.status).toBe("OPEN"); // Remains OPEN until status service is invoked

            // 4. Phase 1.6.5 now succeeds transitioning OPEN -> ASSIGNED
            const transitioned = await transitionWorkOrderStatus(WS_ID, wo.id, { toStatus: "ASSIGNED" });
            expect(transitioned.status).toBe("ASSIGNED");
            expect(transitioned.assignedTechnicianId).toBe("tp_bob_1");
        });
    });
});
