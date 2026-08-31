import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderCreate: vi.fn(),
    workOrderCount: vi.fn(),
    workspaceEntitlementOverrideFindUnique: vi.fn(),
    subscriptionFindFirst: vi.fn(),
    transaction: vi.fn(),
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
        customer: {
            findFirst: mocks.customerFindFirst,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            create: mocks.workOrderCreate,
            count: mocks.workOrderCount,
        },
        workspaceEntitlementOverride: {
            findUnique: mocks.workspaceEntitlementOverrideFindUnique,
        },
        subscription: {
            findFirst: mocks.subscriptionFindFirst,
        },
        $transaction: mocks.transaction,
    },
}));

import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import {
    WorkOrderCustomerNotFoundError,
    WorkOrderCustomerInactiveError,
    WorkOrderLocationNotFoundError,
    DuplicateWorkOrderReferenceError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    WorkTypeNotFoundError,
    WorkTypeUnavailableForWorkOrderError,
} from "@/lib/services/workType/workTypeErrors";
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
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.6.4 — WorkOrder Creation Service Layer", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let locationsList: ServiceLocation[];
    let catalogsList: ServiceCatalog[];
    let workTypesList: (WorkType & { catalog?: ServiceCatalog })[];
    let workOrdersList: WorkOrder[];

    const WS_ID = "ws_alpha_100";
    const WS_ID_2 = "ws_beta_200";

    const USER_ADMIN: User = {
        id: "user_admin_1",
        name: "Admin User",
        email: "admin@alpha.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "user_tech_2",
        name: "Technician User",
        email: "tech@alpha.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_ACCOUNTANT: User = {
        id: "user_acct_3",
        name: "Accountant User",
        email: "acct@alpha.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_ALPHA: Workspace = {
        id: WS_ID,
        name: "Alpha Workspace",
        slug: "alpha-ws",
        logoUrl: null,
        timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const WS_BETA: Workspace = {
        id: WS_ID_2,
        name: "Beta Workspace",
        slug: "beta-ws",
        logoUrl: null,
        timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        customersList = [];
        locationsList = [];
        catalogsList = [];
        workTypesList = [];
        workOrdersList = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
        usersMap.set(USER_TECH.id, USER_TECH);
        usersMap.set(USER_ACCOUNTANT.id, USER_ACCOUNTANT);

        workspacesMap.set(WS_ALPHA.id, WS_ALPHA);
        workspacesMap.set(WS_BETA.id, WS_BETA);

        // Alpha workspace members
        membersMap.set(`${USER_ADMIN.id}_${WS_ALPHA.id}`, {
            id: "mem_admin_1",
            userId: USER_ADMIN.id,
            workspaceId: WS_ALPHA.id,
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        membersMap.set(`${USER_TECH.id}_${WS_ALPHA.id}`, {
            id: "mem_tech_1",
            userId: USER_TECH.id,
            workspaceId: WS_ALPHA.id,
            role: "TECHNICIAN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        membersMap.set(`${USER_ACCOUNTANT.id}_${WS_ALPHA.id}`, {
            id: "mem_acct_1",
            userId: USER_ACCOUNTANT.id,
            workspaceId: WS_ALPHA.id,
            role: "ACCOUNTANT",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        });

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

        mocks.customerFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                customersList.find((c) => {
                    if (where.id && c.id !== where.id) return false;
                    if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                locationsList.find((l) => {
                    if (where.id && l.id !== where.id) return false;
                    if (where.customerId && l.customerId !== where.customerId) return false;
                    return true;
                }) || null
            );
        });

        mocks.workTypeFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                workTypesList.find((wt) => {
                    if (where.id && wt.id !== where.id) return false;
                    if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                    return true;
                }) || null
            );
        });

        mocks.workOrderFindFirst.mockImplementation(async ({ where, orderBy }: any) => {
            let filtered = workOrdersList.filter((wo) => {
                if (where.workspaceId && wo.workspaceId !== where.workspaceId) return false;
                if (where.workOrderNumber?.startsWith) {
                    if (!wo.workOrderNumber.startsWith(where.workOrderNumber.startsWith)) return false;
                }
                return true;
            });

            if (orderBy?.workOrderNumber === "desc") {
                filtered.sort((a, b) => b.workOrderNumber.localeCompare(a.workOrderNumber));
            }

            return filtered[0] || null;
        });

        mocks.workOrderCreate.mockImplementation(async ({ data }: any) => {
            // Check unique constraint [workspaceId, workOrderNumber]
            const existing = workOrdersList.find(
                (wo) =>
                    wo.workspaceId === data.workspaceId &&
                    wo.workOrderNumber === data.workOrderNumber,
            );
            if (existing) {
                const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`workOrderNumber`)");
                (err as any).code = "P2002";
                (err as any).meta = { target: ["workspaceId", "workOrderNumber"] };
                throw err;
            }

            const customer = customersList.find((c) => c.id === data.customerId)!;
            const location = locationsList.find((l) => l.id === data.locationId)!;
            const workType = workTypesList.find((wt) => wt.id === data.workTypeId)!;

            const created: WorkOrder = {
                id: `wo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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
                status: data.status,
                priority: data.priority,
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

            workOrdersList.push(created);

            return {
                ...created,
                customer,
                location,
                workType,
            };
        });

        // Mock $transaction executing callback with transaction client
        mocks.transaction.mockImplementation(async (callback: any) => {
            const tx = {
                workOrder: {
                    findFirst: mocks.workOrderFindFirst,
                    create: mocks.workOrderCreate,
                    count: mocks.workOrderCount,
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
            };
            return await callback(tx);
        });
    });

    // Helper to seed active customer, location, catalog, and workType
    function seedActiveFixtures(wsId = WS_ID) {
        const customer: Customer = {
            id: `cust_${wsId}_1`,
            workspaceId: wsId,
            customerNumber: "CUST-00001",
            name: "Apex Logistics Ltd",
            email: "ops@apex.com",
            phone: "+1-555-0199",
            website: null,
            addressLine1: "100 Commercial Way",
            addressLine2: null,
            city: "Lahore",
            state: "Punjab",
            postalCode: "54000",
            country: "PK",
            status: "ACTIVE",
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        customersList.push(customer);

        const location: ServiceLocation = {
            id: `loc_${wsId}_1`,
            customerId: customer.id,
            name: "Main Warehouse",
            addressLine1: "100 Commercial Way",
            addressLine2: "Bay 4",
            city: "Lahore",
            state: "Punjab",
            postalCode: "54000",
            country: "PK",
            latitude: null,
            longitude: null,
            notes: null,
            isPrimary: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        locationsList.push(location);

        const catalog: ServiceCatalog = {
            id: `sc_${wsId}_1`,
            workspaceId: wsId,
            name: "HVAC Maintenance",
            description: "Heating & cooling repairs",
            status: "ACTIVE",
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        catalogsList.push(catalog);

        const workType: WorkType & { catalog?: ServiceCatalog } = {
            id: `wt_${wsId}_1`,
            workspaceId: wsId,
            catalogId: catalog.id,
            name: "Compressor Overhaul",
            code: "HVAC-COMP-01",
            description: "Complete diagnostic and overhaul of commercial compressor",
            estimatedDuration: 180,
            status: "ACTIVE",
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            catalog,
        };
        workTypesList.push(workType);

        return { customer, location, catalog, workType };
    }

    describe("1. Successful WorkOrder Creation", () => {
        it("creates a WorkOrder with full valid input, OPEN status, snapshot fields, and sequential number", async () => {
            const { customer, location, workType } = seedActiveFixtures();

            const input = {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Emergency Compressor Repair",
                priority: "HIGH" as const,
                description: "Unit 2 tripping thermal overload circuit.",
                internalNotes: "Gate code is 4492.",
            };

            const result = await createWorkOrder(WS_ID, input);

            expect(result.id).toBeDefined();
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.workOrderNumber).toBe(`WO-${new Date().getFullYear()}-000001`);
            expect(result.customerId).toBe(customer.id);
            expect(result.customerName).toBe(customer.name);
            expect(result.locationId).toBe(location.id);
            expect(result.locationName).toBe(location.name);
            expect(result.workTypeId).toBe(workType.id);

            // Snapshot copies
            expect(result.workTypeName).toBe("Compressor Overhaul");
            expect(result.workTypeCode).toBe("HVAC-COMP-01");
            expect(result.estimatedDuration).toBe(180);

            // Lifecycle state
            expect(result.status).toBe("OPEN");
            expect(result.priority).toBe("HIGH");
            expect(result.assignedTechnicianId).toBeNull();
            expect(result.holdReason).toBeNull();
            expect(result.cancellationReason).toBeNull();
            expect(result.startedAt).toBeNull();
            expect(result.completedAt).toBeNull();
            expect(result.cancelledAt).toBeNull();
        });

        it("creates a WorkOrder with minimal input, defaulting priority to MEDIUM", async () => {
            const { customer, location, workType } = seedActiveFixtures();

            const input = {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Quarterly Routine Maintenance",
            };

            const result = await createWorkOrder(WS_ID, input);

            expect(result.priority).toBe("MEDIUM");
            expect(result.description).toBeNull();
            expect(result.internalNotes).toBeNull();
            expect(result.status).toBe("OPEN");
        });

        it("increments sequential workOrderNumber across consecutive creations in same workspace/year", async () => {
            const { customer, location, workType } = seedActiveFixtures();

            const res1 = await createWorkOrder(WS_ID, {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Job 1",
            });

            const res2 = await createWorkOrder(WS_ID, {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Job 2",
            });

            const currentYear = new Date().getFullYear();
            expect(res1.workOrderNumber).toBe(`WO-${currentYear}-000001`);
            expect(res2.workOrderNumber).toBe(`WO-${currentYear}-000002`);
        });

        it("snapshot fields copy values at creation time without live mutation linkage", async () => {
            const { customer, location, workType } = seedActiveFixtures();

            const result = await createWorkOrder(WS_ID, {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Pre-change Job",
            });

            expect(result.workTypeName).toBe("Compressor Overhaul");
            expect(result.workTypeCode).toBe("HVAC-COMP-01");
            expect(result.estimatedDuration).toBe(180);

            // Mutate template WorkType in memory
            workType.name = "Renamed Work Type Template";
            workType.code = "RENAMED-CODE";
            workType.estimatedDuration = 999;

            // Existing WorkOrder snapshot remains unaffected
            expect(result.workTypeName).toBe("Compressor Overhaul");
            expect(result.workTypeCode).toBe("HVAC-COMP-01");
            expect(result.estimatedDuration).toBe(180);
        });
    });

    describe("2. Customer Verification & Relational Invariants", () => {
        it("throws WorkOrderCustomerNotFoundError when customer does not exist in workspace", async () => {
            const { location, workType } = seedActiveFixtures();

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: "cust_nonexistent_999",
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Invalid Customer Test",
                }),
            ).rejects.toThrow(WorkOrderCustomerNotFoundError);
        });

        it("throws WorkOrderCustomerNotFoundError when customer exists in a different workspace (cross-tenant 404)", async () => {
            const { location, workType } = seedActiveFixtures(WS_ID);
            const { customer: betaCustomer } = seedActiveFixtures(WS_ID_2);

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: betaCustomer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Cross Tenant Customer Test",
                }),
            ).rejects.toThrow(WorkOrderCustomerNotFoundError);
        });

        it("throws WorkOrderCustomerInactiveError when customer status is INACTIVE", async () => {
            const { customer, location, workType } = seedActiveFixtures();
            customer.status = "INACTIVE";

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Inactive Customer Test",
                }),
            ).rejects.toThrow(WorkOrderCustomerInactiveError);
        });
    });

    describe("3. ServiceLocation Verification & Relational Parity", () => {
        it("throws WorkOrderLocationNotFoundError when locationId does not exist", async () => {
            const { customer, workType } = seedActiveFixtures();

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: "loc_nonexistent_999",
                    workTypeId: workType.id,
                    title: "Invalid Location Test",
                }),
            ).rejects.toThrow(WorkOrderLocationNotFoundError);
        });

        it("throws WorkOrderLocationNotFoundError when location belongs to a DIFFERENT customer (relational parity)", async () => {
            const { customer: customer1, workType } = seedActiveFixtures(WS_ID);

            // Create a second customer with their own location in the same workspace
            const customer2: Customer = {
                id: "cust_alpha_2",
                workspaceId: WS_ID,
                customerNumber: "CUST-00002",
                name: "Beta Logistics Ltd",
                email: null,
                phone: null,
                website: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                postalCode: null,
                country: null,
                status: "ACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            customersList.push(customer2);

            const location2: ServiceLocation = {
                id: "loc_alpha_cust2_1",
                customerId: customer2.id,
                name: "Customer 2 Facility",
                addressLine1: "200 Industrial Rd",
                addressLine2: null,
                city: "Lahore",
                state: null,
                postalCode: null,
                country: "PK",
                latitude: null,
                longitude: null,
                notes: null,
                isPrimary: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            locationsList.push(location2);

            // Attempting to create WorkOrder for customer1 using customer2's location
            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer1.id,
                    locationId: location2.id,
                    workTypeId: workType.id,
                    title: "Mismatched Location Test",
                }),
            ).rejects.toThrow(WorkOrderLocationNotFoundError);
        });
    });

    describe("4. WorkType Consumption Boundary & Availability", () => {
        it("propagates WorkTypeNotFoundError unchanged when workTypeId does not exist", async () => {
            const { customer, location } = seedActiveFixtures();

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: "wt_nonexistent_999",
                    title: "Invalid WorkType Test",
                }),
            ).rejects.toThrow(WorkTypeNotFoundError);
        });

        it("propagates WorkTypeUnavailableForWorkOrderError when workType is INACTIVE", async () => {
            const { customer, location, workType } = seedActiveFixtures();
            workType.status = "INACTIVE";

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Inactive WorkType Test",
                }),
            ).rejects.toThrow(WorkTypeUnavailableForWorkOrderError);
        });

        it("propagates WorkTypeUnavailableForWorkOrderError when parent ServiceCatalog is INACTIVE", async () => {
            const { customer, location, catalog, workType } = seedActiveFixtures();
            catalog.status = "INACTIVE";
            workType.catalog = catalog;

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Inactive Catalog Test",
                }),
            ).rejects.toThrow(WorkTypeUnavailableForWorkOrderError);
        });
    });

    describe("5. Authentication & RBAC Permissions", () => {
        it("throws UnauthorizedError when session is missing", async () => {
            mocks.auth.mockResolvedValue(null);
            const { customer, location, workType } = seedActiveFixtures();

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Unauthenticated Test",
                }),
            ).rejects.toThrow(UnauthorizedError);
        });

        it("throws ForbiddenError when caller has TECHNICIAN role (lacks WORK_ORDERS_CREATE)", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });
            const { customer, location, workType } = seedActiveFixtures();

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Technician Create Test",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("throws ForbiddenError when caller has ACCOUNTANT role (read-only)", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_ACCOUNTANT.id, email: USER_ACCOUNTANT.email },
            });
            const { customer, location, workType } = seedActiveFixtures();

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Accountant Create Test",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("enforces authentication and authorization before performing schema validation", async () => {
            // Missing session with completely invalid input body (empty object)
            mocks.auth.mockResolvedValue(null);
            await expect(createWorkOrder(WS_ID, {})).rejects.toThrow(UnauthorizedError);

            // Unauthorized role with completely invalid input body
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });
            await expect(createWorkOrder(WS_ID, {})).rejects.toThrow(ForbiddenError);
        });
    });

    describe("6. Concurrency Collision & Retry Handling", () => {
        it("retries number generation on P2002 collision and succeeds on subsequent attempt", async () => {
            const { customer, location, workType } = seedActiveFixtures();

            let attemptCount = 0;
            const originalCreate = mocks.workOrderCreate.getMockImplementation()!;

            mocks.workOrderCreate.mockImplementation(async (args: any) => {
                attemptCount++;
                if (attemptCount === 1) {
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`workOrderNumber`)");
                    (err as any).code = "P2002";
                    (err as any).meta = { target: ["workspaceId", "workOrderNumber"] };
                    throw err;
                }
                return originalCreate(args);
            });

            const result = await createWorkOrder(WS_ID, {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Retry Collision Test",
            });

            expect(attemptCount).toBe(2);
            expect(result.id).toBeDefined();
        });

        it("throws DuplicateWorkOrderReferenceError when all retry attempts fail on P2002", async () => {
            const { customer, location, workType } = seedActiveFixtures();

            mocks.workOrderCreate.mockImplementation(async () => {
                const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`workOrderNumber`)");
                (err as any).code = "P2002";
                (err as any).meta = { target: ["workspaceId", "workOrderNumber"] };
                throw err;
            });

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Exhausted Retries Test",
                }),
            ).rejects.toThrow(DuplicateWorkOrderReferenceError);
        });

        it("re-throws generic Error on unexpected database failure during creation", async () => {
            const { customer, location, workType } = seedActiveFixtures();

            mocks.workOrderCreate.mockImplementation(async () => {
                throw new Error("Fatal database network partition");
            });

            await expect(
                createWorkOrder(WS_ID, {
                    customerId: customer.id,
                    locationId: location.id,
                    workTypeId: workType.id,
                    title: "Generic Error Test",
                }),
            ).rejects.toThrow("Fatal database network partition");
        });
    });
});
