import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    partFindFirst: vi.fn(),
    inventoryLocationFindFirst: vi.fn(),
    workOrderFindFirst: vi.fn(),
    inventoryBalanceFindFirst: vi.fn(),
    inventoryBalanceFindMany: vi.fn(),
    inventoryBalanceCount: vi.fn(),
    inventoryBalanceCreate: vi.fn(),
    inventoryBalanceUpdate: vi.fn(),
    stockMovementCreate: vi.fn(),
    queryRaw: vi.fn(),
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
        part: {
            findFirst: mocks.partFindFirst,
        },
        inventoryLocation: {
            findFirst: mocks.inventoryLocationFindFirst,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
        },
        inventoryBalance: {
            findFirst: mocks.inventoryBalanceFindFirst,
            findMany: mocks.inventoryBalanceFindMany,
            count: mocks.inventoryBalanceCount,
            create: mocks.inventoryBalanceCreate,
            update: mocks.inventoryBalanceUpdate,
        },
        stockMovement: {
            create: mocks.stockMovementCreate,
        },
        $queryRaw: mocks.queryRaw,
        $transaction: mocks.transaction,
    },
}));

import { reserveStock } from "@/lib/services/inventory/movement/reserveStock";
import { releaseStock } from "@/lib/services/inventory/movement/releaseStock";
import {
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
    WorkOrderNotFoundError,
} from "@/lib/services/inventory/movement/stockMovementErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import {
    type InventoryBalance,
    type StockMovement,
    type Part,
    type InventoryLocation,
    type User,
    type Workspace,
    type WorkspaceMember,
    PartStatus,
    PartUnitOfMeasure,
    InventoryLocationStatus,
    InventoryLocationType,
    StockMovementType,
} from "@/generated/prisma/client";

describe("Phase 1.10.11–1.10.13 — Stock Reservation & Release (reserveStock / releaseStock)", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];
    let locationsList: InventoryLocation[];
    let workOrdersList: Array<{ id: string; workspaceId: string }>;
    let balancesList: InventoryBalance[];
    let movementsList: StockMovement[];

    const WS_ID = "ws_test_alpha";
    const WS_ID_BETA = "ws_test_beta";

    const USER_ADMIN: User = {
        id: "user_admin_1",
        name: "Admin User",
        email: "admin@test.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_MANAGER: User = {
        id: "user_manager_1",
        name: "Manager User",
        email: "manager@test.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_DISPATCHER: User = {
        id: "user_dispatcher_1",
        name: "Dispatcher User",
        email: "dispatcher@test.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "user_tech_1",
        name: "Tech User",
        email: "tech@test.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_ACCOUNTANT: User = {
        id: "user_acc_1",
        name: "Accountant User",
        email: "acc@test.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const PART_ACTIVE: Part = {
        id: "part_active_1",
        workspaceId: WS_ID,
        name: "Copper Pipe 1/2 in",
        sku: "PIPE-CU-050",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.FOOT,
        unitCost: new Prisma.Decimal("15.50") as any,
        minimumStockLevel: new Prisma.Decimal("10.0000") as any,
        status: PartStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const PART_INACTIVE: Part = {
        id: "part_inactive_1",
        workspaceId: WS_ID,
        name: "Obsolete Sensor",
        sku: "SENS-OBS",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.EACH,
        unitCost: new Prisma.Decimal("20.00") as any,
        minimumStockLevel: null,
        status: PartStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const PART_BETA: Part = {
        id: "part_beta_1",
        workspaceId: WS_ID_BETA,
        name: "Beta Part",
        sku: "BETA-PART",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.EACH,
        unitCost: new Prisma.Decimal("10.00") as any,
        minimumStockLevel: null,
        status: PartStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const LOCATION_ACTIVE: InventoryLocation = {
        id: "loc_active_1",
        workspaceId: WS_ID,
        name: "Main Warehouse",
        code: "WH-01",
        locationType: InventoryLocationType.WAREHOUSE,
        technicianProfileId: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        notes: null,
        status: InventoryLocationStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const LOCATION_INACTIVE: InventoryLocation = {
        id: "loc_inactive_1",
        workspaceId: WS_ID,
        name: "Decommissioned Depot",
        code: "DEP-DEC",
        locationType: InventoryLocationType.OTHER,
        technicianProfileId: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        notes: null,
        status: InventoryLocationStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const LOCATION_BETA: InventoryLocation = {
        id: "loc_beta_1",
        workspaceId: WS_ID_BETA,
        name: "Beta Warehouse",
        code: "WH-BETA",
        locationType: InventoryLocationType.WAREHOUSE,
        technicianProfileId: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        notes: null,
        status: InventoryLocationStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        partsList = [PART_ACTIVE, PART_INACTIVE, PART_BETA];
        locationsList = [LOCATION_ACTIVE, LOCATION_INACTIVE, LOCATION_BETA];
        workOrdersList = [
            { id: "wo_1001", workspaceId: WS_ID },
            { id: "wo_valid_1", workspaceId: WS_ID },
            { id: "wo_beta_1", workspaceId: WS_ID_BETA },
        ];
        balancesList = [];
        movementsList = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
        usersMap.set(USER_MANAGER.id, USER_MANAGER);
        usersMap.set(USER_DISPATCHER.id, USER_DISPATCHER);
        usersMap.set(USER_TECH.id, USER_TECH);
        usersMap.set(USER_ACCOUNTANT.id, USER_ACCOUNTANT);

        const wsAlpha: Workspace = {
            id: WS_ID,
            name: "Alpha Workspace",
            slug: "alpha",
            logoUrl: null,
            timezone: "UTC",
        defaultCurrencyCode: "USD",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const wsBeta: Workspace = {
            id: WS_ID_BETA,
            name: "Beta Workspace",
            slug: "beta",
            logoUrl: null,
            timezone: "UTC",
        defaultCurrencyCode: "USD",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        workspacesMap.set(WS_ID, wsAlpha);
        workspacesMap.set(WS_ID_BETA, wsBeta);

        const memAdmin: WorkspaceMember = {
            id: "mem_admin_1",
            workspaceId: WS_ID,
            userId: USER_ADMIN.id,
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memManager: WorkspaceMember = {
            id: "mem_manager_1",
            workspaceId: WS_ID,
            userId: USER_MANAGER.id,
            role: "MANAGER",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memDispatcher: WorkspaceMember = {
            id: "mem_disp_1",
            workspaceId: WS_ID,
            userId: USER_DISPATCHER.id,
            role: "DISPATCHER",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memTech: WorkspaceMember = {
            id: "mem_tech_1",
            workspaceId: WS_ID,
            userId: USER_TECH.id,
            role: "TECHNICIAN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memAccountant: WorkspaceMember = {
            id: "mem_acc_1",
            workspaceId: WS_ID,
            userId: USER_ACCOUNTANT.id,
            role: "ACCOUNTANT",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        membersMap.set(`${WS_ID}:${USER_ADMIN.id}`, memAdmin);
        membersMap.set(`${WS_ID}:${USER_MANAGER.id}`, memManager);
        membersMap.set(`${WS_ID}:${USER_DISPATCHER.id}`, memDispatcher);
        membersMap.set(`${WS_ID}:${USER_TECH.id}`, memTech);
        membersMap.set(`${WS_ID}:${USER_ACCOUNTANT.id}`, memAccountant);

        // Default auth context to Admin
        mocks.auth.mockResolvedValue({
            user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
        });

        mocks.userFindUnique.mockImplementation(async ({ where }: any) => {
            return usersMap.get(where.id) ?? null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: any) => {
            return workspacesMap.get(where.id) ?? null;
        });

        mocks.workspaceMemberFindUnique.mockImplementation(
            async ({ where }: any) => {
                if (where.userId_workspaceId) {
                    const key = `${where.userId_workspaceId.workspaceId}:${where.userId_workspaceId.userId}`;
                    return membersMap.get(key) ?? null;
                }
                return null;
            },
        );

        mocks.partFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                partsList.find((p) => {
                    if (where.workspaceId && p.workspaceId !== where.workspaceId)
                        return false;
                    if (where.id && p.id !== where.id) return false;
                    return true;
                }) ?? null
            );
        });

        mocks.inventoryLocationFindFirst.mockImplementation(
            async ({ where }: any) => {
                return (
                    locationsList.find((loc) => {
                        if (
                            where.workspaceId &&
                            loc.workspaceId !== where.workspaceId
                        )
                            return false;
                        if (where.id && loc.id !== where.id) return false;
                        return true;
                    }) ?? null
                );
            },
        );

        mocks.workOrderFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                workOrdersList.find((wo) => {
                    if (where.workspaceId && wo.workspaceId !== where.workspaceId)
                        return false;
                    if (where.id && wo.id !== where.id) return false;
                    return true;
                }) ?? null
            );
        });

        // Mock interactive transaction
        mocks.transaction.mockImplementation(async (callback: any) => {
            const tx = {
                $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
                    const ws = values[0];
                    const part = values[1];
                    const loc = values[2];
                    const found = balancesList.find(
                        (b) =>
                            b.workspaceId === ws &&
                            b.partId === part &&
                            b.locationId === loc,
                    );
                    return found ? [found] : [];
                },
                inventoryBalance: {
                    create: async ({ data }: any) => {
                        const newBal: InventoryBalance = {
                            id: `bal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            workspaceId: data.workspaceId,
                            partId: data.partId,
                            locationId: data.locationId,
                            quantityOnHand: data.quantityOnHand,
                            quantityReserved: data.quantityReserved,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };
                        balancesList.push(newBal);
                        return newBal;
                    },
                    update: async ({ where, data }: any) => {
                        const idx = balancesList.findIndex((b) => b.id === where.id);
                        if (idx === -1) throw new Error("Balance record not found");
                        const existing = balancesList[idx];
                        const updated: InventoryBalance = {
                            ...existing,
                            ...data,
                            updatedAt: new Date(),
                        };
                        balancesList[idx] = updated;
                        return updated;
                    },
                },
                stockMovement: {
                    create: async ({ data }: any) => {
                        const movement: StockMovement = {
                            id: `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            workspaceId: data.workspaceId,
                            partId: data.partId,
                            locationId: data.locationId ?? null,
                            movementType: data.movementType,
                            quantity: data.quantity,
                            fromLocationId: null,
                            toLocationId: null,
                            workOrderId: data.workOrderId ?? null,
                            originalWorkOrderPartId: null,
                            unitCostSnapshot: data.unitCostSnapshot ?? null,
                            reason: data.reason ?? null,
                            referenceNumber: data.referenceNumber ?? null,
                            actorMemberId: data.actorMemberId ?? null,
                            createdAt: new Date(),
                        };
                        movementsList.push(movement);
                        return movement;
                    },
                },
            };
            return callback(tx);
        });
    });

    describe("reserveStock", () => {
        it("successfully reserves stock against existing balance (increments reserved, onHand untouched)", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("10.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await reserveStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 15,
                workOrderId: "wo_1001",
                reason: "Reserved for furnace replacement",
                referenceNumber: "REQ-01",
            });

            // Verify Balance: onHand untouched (50), reserved incremented (10 + 15 = 25), available decreased (25)
            expect(result.balance.quantityOnHand).toBe(50);
            expect(result.balance.quantityReserved).toBe(25);
            expect(result.balance.quantityAvailable).toBe(25);

            // Verify Movement
            expect(result.movement.movementType).toBe(StockMovementType.RESERVATION);
            expect(result.movement.quantity).toBe(15);
            expect(result.movement.workOrderId).toBe("wo_1001");
            expect(result.movement.reason).toBe("Reserved for furnace replacement");
            expect(result.movement.referenceNumber).toBe("REQ-01");
            expect(result.movement.actorMemberId).toBe("mem_admin_1");
        });

        it("throws InsufficientStockError when requested reservation would exceed onHand", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("20.0000"),
                quantityReserved: new Prisma.Decimal("5.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Current reserved = 5, onHand = 20. Requesting 16 -> newReserved = 21 (> 20) -> throws!
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 16,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("throws InsufficientStockError when attempting to reserve on a non-existent / 0 onHand balance (lazy-create path)", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("rejects zero quantity at schema level", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 0,
                }),
            ).rejects.toThrow();
        });

        it("rejects negative quantity at schema level", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: -5,
                }),
            ).rejects.toThrow();
        });

        it("throws PartNotFoundError when part does not exist in workspace", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: "non_existent_part",
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws PartInactiveError when part is INACTIVE", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_INACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartInactiveError);
        });

        it("throws InventoryLocationNotFoundError when location does not exist in workspace", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: "non_existent_loc",
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("throws InventoryLocationInactiveError when location is INACTIVE (cannot reserve against decommissioned location)", async () => {
            balancesList.push({
                id: "bal_inact",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_INACTIVE.id,
                quantityOnHand: new Prisma.Decimal("100.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_INACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationInactiveError);
        });

        it("enforces tenant isolation — throws PartNotFoundError if part belongs to another workspace", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_BETA.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if location belongs to another workspace", async () => {
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_BETA.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — throws WorkOrderNotFoundError if workOrderId does not exist or belongs to another workspace", async () => {
            // Non-existent WorkOrder
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    workOrderId: "non_existent_wo",
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);

            // Foreign WorkOrder
            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    workOrderId: "wo_beta_1",
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("succeeds and tags workOrderId when valid workspace WorkOrder is provided", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await reserveStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 5,
                workOrderId: "wo_valid_1",
            });

            expect(result.balance.quantityReserved).toBe(5);
            expect(result.movement.workOrderId).toBe("wo_valid_1");
        });

        it("enforces RBAC — allows DISPATCHER role to reserve stock (per Section 9.2)", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_DISPATCHER.id, email: USER_DISPATCHER.email },
            });

            const result = await reserveStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 10,
            });

            expect(result.balance.quantityReserved).toBe(10);
            expect(result.movement.actorMemberId).toBe("mem_disp_1");
        });

        it("enforces RBAC — denies TECHNICIAN role from reserving stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("enforces RBAC — denies ACCOUNTANT role from reserving stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_ACCOUNTANT.id, email: USER_ACCOUNTANT.email },
            });

            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("releaseStock", () => {
        it("successfully releases reserved stock (decrements reserved, onHand untouched, increases available)", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("20.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await releaseStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 12,
                workOrderId: "wo_1001",
                reason: "WorkOrder scope reduced",
            });

            // Verify Balance: onHand untouched (50), reserved decremented (20 - 12 = 8), available increased (50 - 8 = 42)
            expect(result.balance.quantityOnHand).toBe(50);
            expect(result.balance.quantityReserved).toBe(8);
            expect(result.balance.quantityAvailable).toBe(42);

            // Verify Movement
            expect(result.movement.movementType).toBe(StockMovementType.RELEASE);
            expect(result.movement.quantity).toBe(12);
            expect(result.movement.workOrderId).toBe("wo_1001");
            expect(result.movement.reason).toBe("WorkOrder scope reduced");
            expect(result.movement.actorMemberId).toBe("mem_admin_1");
        });

        it("throws InsufficientStockError when attempting to release more stock than is currently reserved", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("5.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Current reserved = 5. Attempting release of 6 -> throws!
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 6,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("rejects zero quantity at schema level for release", async () => {
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 0,
                }),
            ).rejects.toThrow();
        });

        it("rejects negative quantity at schema level for release", async () => {
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: -3,
                }),
            ).rejects.toThrow();
        });

        it("permits releasing stock on an INACTIVE location (decommission exception)", async () => {
            balancesList.push({
                id: "bal_inact",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_INACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("15.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await releaseStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_INACTIVE.id,
                quantity: 15,
                reason: "Clearing reservations on decommissioned depot",
            });

            expect(result.balance.quantityReserved).toBe(0);
            expect(result.balance.quantityAvailable).toBe(50);
            expect(result.movement.quantity).toBe(15);
        });

        it("throws PartNotFoundError when part does not exist in workspace", async () => {
            await expect(
                releaseStock(WS_ID, {
                    partId: "non_existent_part",
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws PartInactiveError when part is INACTIVE", async () => {
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_INACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartInactiveError);
        });

        it("throws InventoryLocationNotFoundError when location does not exist in workspace", async () => {
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: "non_existent_loc",
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation on release — throws PartNotFoundError for foreign part", async () => {
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_BETA.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation on release — throws InventoryLocationNotFoundError for foreign location", async () => {
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_BETA.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces RBAC — allows DISPATCHER role to release stock (per Section 9.2)", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("10.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_DISPATCHER.id, email: USER_DISPATCHER.email },
            });

            const result = await releaseStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 5,
            });

            expect(result.balance.quantityReserved).toBe(5);
            expect(result.movement.actorMemberId).toBe("mem_disp_1");
        });

        it("enforces tenant isolation — throws WorkOrderNotFoundError if workOrderId does not exist or belongs to another workspace", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("10.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Non-existent WorkOrder
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    workOrderId: "non_existent_wo",
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);

            // Foreign WorkOrder
            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    workOrderId: "wo_beta_1",
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("succeeds and tags workOrderId when valid workspace WorkOrder is provided", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("10.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await releaseStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 5,
                workOrderId: "wo_valid_1",
            });

            expect(result.balance.quantityReserved).toBe(5);
            expect(result.movement.workOrderId).toBe("wo_valid_1");
        });

        it("enforces RBAC — denies TECHNICIAN role from releasing stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("enforces RBAC — denies ACCOUNTANT role from releasing stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_ACCOUNTANT.id, email: USER_ACCOUNTANT.email },
            });

            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("denies unauthenticated caller on both reserve and release", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                reserveStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(UnauthorizedError);

            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                releaseStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });
});
