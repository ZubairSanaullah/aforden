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

import { updateWorkOrder } from "@/lib/services/workOrder/updateWorkOrder";
import { assignWorkOrder } from "@/lib/services/workOrder/assignWorkOrder";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    WorkOrderNotFoundError,
    WorkOrderImmutableError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import { ZodError } from "zod";
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
    WorkOrderPriority,
} from "@/generated/prisma/client";

describe("Phase 1.6.7 — WorkOrder Update & Operational Services", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let employeesList: Employee[];
    let technicianProfilesList: TechnicianProfile[];
    let workOrdersList: WorkOrder[];

    const WS_ID = "ws_update_100";
    const WS_ID_2 = "ws_update_200";

    const USER_ADMIN: User = {
        id: "user_adm_1",
        name: "Admin Person",
        email: "admin@update.com",
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
        email: "disp@update.com",
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
        email: "tech1@update.com",
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
        email: "tech2@update.com",
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
        email: "acct@update.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Update Testing Corp",
        slug: "update-ws",
        logoUrl: null,
        timezone: "UTC",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_BETA: Workspace = {
        id: WS_ID_2,
        name: "Beta Workspace Corp",
        slug: "beta-update-ws",
        logoUrl: null,
        timezone: "UTC",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const FIXTURE_CUSTOMER: Customer = {
        id: "cust_update_1",
        workspaceId: WS_ID,
        customerNumber: "CUST-100",
        name: "Facility Corp",
        email: "facility@update.com",
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
        id: "loc_update_1",
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
        id: "wt_update_1",
        workspaceId: WS_ID,
        catalogId: "sc_update_1",
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
        employeesList.push(empBob, empAlice);

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
        technicianProfilesList.push(profBob, profAlice);

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

    function createFixtureWorkOrder(
        status: WorkOrderStatus = "OPEN",
        assignedTechId: string | null = null,
        priority: WorkOrderPriority = "MEDIUM",
        wsId = WS_ID,
    ): WorkOrder {
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
            priority,
            title: "Original Title",
            description: "Original Description",
            internalNotes: "Original Notes",
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

    describe("1. Authentication & RBAC Permission", () => {
        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, { title: "New Title" }),
            ).rejects.toThrow(UnauthorizedError);
        });

        it("allows ADMIN, MANAGER, and DISPATCHER to update all operational fields including priority", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_DISPATCHER.id } });
            const wo = createFixtureWorkOrder();

            const result = await updateWorkOrder(WS_ID, wo.id, {
                title: "Dispatcher Updated Title",
                priority: "HIGH",
                description: "Updated description",
                internalNotes: "Updated internal note",
            });

            expect(result.title).toBe("Dispatcher Updated Title");
            expect(result.priority).toBe("HIGH");
            expect(result.description).toBe("Updated description");
            expect(result.internalNotes).toBe("Updated internal note");
        });

        it("allows assigned TECHNICIAN to update title, description, and internalNotes", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            const result = await updateWorkOrder(WS_ID, wo.id, {
                description: "Technician job notes added on-site",
                internalNotes: "Found rusted conduit",
            });

            expect(result.description).toBe("Technician job notes added on-site");
            expect(result.internalNotes).toBe("Found rusted conduit");
        });

        it("rejects TECHNICIAN with ForbiddenError when attempting to update priority (Section 5.2)", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } });
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_bob_1");

            await expect(
                updateWorkOrder(WS_ID, wo.id, {
                    priority: "URGENT",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects TECHNICIAN with ForbiddenError when attempting to update a WorkOrder assigned to another technician", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_TECH_1.id } }); // Bob
            const wo = createFixtureWorkOrder("IN_PROGRESS", "tp_alice_2"); // Assigned to Alice

            await expect(
                updateWorkOrder(WS_ID, wo.id, {
                    description: "Bob trying to edit Alice's order",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects ACCOUNTANT with ForbiddenError on any update attempt", async () => {
            mocks.auth.mockResolvedValue({ user: { id: USER_ACCOUNTANT.id } });
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, {
                    title: "Accountant title edit",
                }),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("2. Tenant Scoping & IDOR Defense", () => {
        it("throws WorkOrderNotFoundError (404) when workOrderId does not exist in workspace", async () => {
            await expect(
                updateWorkOrder(WS_ID, "wo_nonexistent_999", { title: "New Title" }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("throws WorkOrderNotFoundError (404) when workOrderId belongs to a DIFFERENT workspace", async () => {
            const betaWo = createFixtureWorkOrder("OPEN", null, "MEDIUM", WS_ID_2);

            await expect(
                updateWorkOrder(WS_ID, betaWo.id, { title: "Cross-Tenant Title" }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });
    });

    describe("3. Validation & Strict Schema Boundaries", () => {
        it("rejects empty title string with ZodError (422)", async () => {
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, { title: "   " }),
            ).rejects.toThrow(ZodError);
        });

        it("rejects invalid priority value with ZodError (422)", async () => {
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, { priority: "SUPER_URGENT" as any }),
            ).rejects.toThrow(ZodError);
        });

        it("rejects controlled field: status in update payload", async () => {
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, { status: "COMPLETED" } as any),
            ).rejects.toThrow(ZodError);
        });

        it("rejects controlled field: assignedTechnicianId in update payload", async () => {
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, { assignedTechnicianId: "tp_bob_1" } as any),
            ).rejects.toThrow(ZodError);
        });

        it("rejects immutable snapshot fields: workTypeName, workTypeCode, estimatedDuration", async () => {
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, { workTypeName: "Hacked Name" } as any),
            ).rejects.toThrow(ZodError);

            await expect(
                updateWorkOrder(WS_ID, wo.id, { estimatedDuration: 500 } as any),
            ).rejects.toThrow(ZodError);
        });

        it("rejects lifecycle timestamps: startedAt, completedAt, cancelledAt", async () => {
            const wo = createFixtureWorkOrder();

            await expect(
                updateWorkOrder(WS_ID, wo.id, { completedAt: new Date() } as any),
            ).rejects.toThrow(ZodError);
        });

        it("allows explicit null to clear nullable fields (description, internalNotes)", async () => {
            const wo = createFixtureWorkOrder();

            const result = await updateWorkOrder(WS_ID, wo.id, {
                description: null,
                internalNotes: null,
            });

            expect(result.description).toBeNull();
            expect(result.internalNotes).toBeNull();
            expect(result.title).toBe("Original Title"); // Preserved
        });

        it("preserves omitted fields during partial update", async () => {
            const wo = createFixtureWorkOrder();

            const result = await updateWorkOrder(WS_ID, wo.id, {
                title: "Only Title Changed",
            });

            expect(result.title).toBe("Only Title Changed");
            expect(result.description).toBe("Original Description");
            expect(result.internalNotes).toBe("Original Notes");
            expect(result.priority).toBe("MEDIUM");
        });
    });

    describe("4. Terminal State Protection", () => {
        it("rejects update on COMPLETED WorkOrder with WorkOrderImmutableError (409)", async () => {
            const wo = createFixtureWorkOrder("COMPLETED", "tp_bob_1");

            await expect(
                updateWorkOrder(WS_ID, wo.id, { title: "Attempted Edit" }),
            ).rejects.toThrow(WorkOrderImmutableError);
        });

        it("rejects update on CANCELLED WorkOrder with WorkOrderImmutableError (409)", async () => {
            const wo = createFixtureWorkOrder("CANCELLED", null);

            await expect(
                updateWorkOrder(WS_ID, wo.id, { description: "Attempted Edit" }),
            ).rejects.toThrow(WorkOrderImmutableError);
        });
    });

    describe("5. Immutability of Snapshots, Lifecycles, and Foreign Keys", () => {
        it("preserves workType snapshots, assignedTechnicianId, customerId, locationId, and status", async () => {
            const wo = createFixtureWorkOrder("OPEN", "tp_bob_1");

            const result = await updateWorkOrder(WS_ID, wo.id, {
                title: "Brand New Title",
                priority: "HIGH",
            });

            expect(result.workTypeName).toBe(FIXTURE_WORKTYPE.name);
            expect(result.workTypeCode).toBe(FIXTURE_WORKTYPE.code);
            expect(result.estimatedDuration).toBe(FIXTURE_WORKTYPE.estimatedDuration);
            expect(result.assignedTechnicianId).toBe("tp_bob_1");
            expect(result.customerId).toBe(FIXTURE_CUSTOMER.id);
            expect(result.locationId).toBe(FIXTURE_LOCATION.id);
            expect(result.status).toBe("OPEN");
        });
    });

    describe("6. Composition & Boundary Integration (1.6.4 -> 1.6.7 -> 1.6.6 -> 1.6.5)", () => {
        it("executes standard workflow: create (OPEN) -> 1.6.7 update -> 1.6.6 assign -> 1.6.5 transition (ASSIGNED)", async () => {
            // 1. Initial WorkOrder (simulating 1.6.4 creation)
            const wo = createFixtureWorkOrder("OPEN", null);
            expect(wo.status).toBe("OPEN");
            expect(wo.assignedTechnicianId).toBeNull();

            // 2. 1.6.7 Operational Update
            const updated = await updateWorkOrder(WS_ID, wo.id, {
                title: "Emergency HVAC Diagnostic",
                priority: "HIGH",
                description: "Customer reported strange smoke smell from unit",
            });
            expect(updated.title).toBe("Emergency HVAC Diagnostic");
            expect(updated.priority).toBe("HIGH");
            expect(updated.status).toBe("OPEN"); // Status untouched

            // 3. 1.6.6 Assignment
            const assigned = await assignWorkOrder(WS_ID, wo.id, {
                technicianId: "tp_bob_1",
            });
            expect(assigned.assignedTechnicianId).toBe("tp_bob_1");
            expect(assigned.status).toBe("OPEN"); // Status untouched

            // 4. 1.6.5 Lifecycle Status Transition
            const transitioned = await transitionWorkOrderStatus(WS_ID, wo.id, {
                toStatus: "ASSIGNED",
            });
            expect(transitioned.status).toBe("ASSIGNED");
            expect(transitioned.title).toBe("Emergency HVAC Diagnostic");
            expect(transitioned.priority).toBe("HIGH");
            expect(transitioned.assignedTechnicianId).toBe("tp_bob_1");
        });
    });
});
