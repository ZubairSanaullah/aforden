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
    workOrderPartCreate: vi.fn(),
    workOrderPartFindFirst: vi.fn(),
    workOrderPartFindMany: vi.fn(),
    workOrderPartCount: vi.fn(),
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
        workOrderPart: {
            create: mocks.workOrderPartCreate,
            findFirst: mocks.workOrderPartFindFirst,
            findMany: mocks.workOrderPartFindMany,
            count: mocks.workOrderPartCount,
        },
        stockMovement: {
            create: mocks.stockMovementCreate,
        },
        $queryRaw: mocks.queryRaw,
        $transaction: mocks.transaction,
    },
}));

import { consumeStock } from "@/lib/services/inventory/movement/consumeStock";
import { getWorkOrderPart } from "@/lib/services/inventory/workOrderPart/getWorkOrderPart";
import { getWorkOrderParts } from "@/lib/services/inventory/workOrderPart/getWorkOrderParts";
import {
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
    WorkOrderNotFoundError,
} from "@/lib/services/inventory/movement/stockMovementErrors";
import { WorkOrderPartNotFoundError } from "@/lib/services/inventory/workOrderPart/workOrderPartErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import {
    type InventoryBalance,
    type StockMovement,
    type WorkOrderPart,
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

describe("Phase 1.10.14–1.10.15 — Stock Consumption (consumeStock & WorkOrderPart)", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];
    let locationsList: InventoryLocation[];
    let workOrdersList: Array<{ id: string; workspaceId: string }>;
    let balancesList: InventoryBalance[];
    let workOrderPartsList: WorkOrderPart[];
    let movementsList: StockMovement[];

    const WS_ID = "ws_test_alpha";
    const WS_ID_BETA = "ws_test_beta";

    const USER_ADMIN: User = {
        id: "user_admin_1",
        name: "Admin User",
        email: "admin@test.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "user_tech_1",
        name: "Field Tech",
        email: "tech@test.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_ACCOUNTANT: User = {
        id: "user_acc_1",
        name: "Accountant",
        email: "acc@test.com",
        platformRole: null,
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

    const PART_NULL_COST: Part = {
        id: "part_null_cost_1",
        workspaceId: WS_ID,
        name: "Uncosted Valve",
        sku: "VALVE-01",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.EACH,
        unitCost: null,
        minimumStockLevel: null,
        status: PartStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const LOCATION_ACTIVE: InventoryLocation = {
        id: "loc_active_1",
        workspaceId: WS_ID,
        name: "Van Stock 12",
        code: "VAN-12",
        locationType: InventoryLocationType.VEHICLE,
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
        name: "Decommissioned Van",
        code: "VAN-OLD",
        locationType: InventoryLocationType.VEHICLE,
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
        name: "Beta Van",
        code: "VAN-BETA",
        locationType: InventoryLocationType.VEHICLE,
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

    const WO_VALID = { id: "wo_valid_1", workspaceId: WS_ID };
    const WO_BETA = { id: "wo_beta_1", workspaceId: WS_ID_BETA };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        partsList = [PART_ACTIVE, PART_INACTIVE, PART_BETA, PART_NULL_COST];
        locationsList = [LOCATION_ACTIVE, LOCATION_INACTIVE, LOCATION_BETA];
        workOrdersList = [WO_VALID, WO_BETA];
        balancesList = [];
        workOrderPartsList = [];
        movementsList = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
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
        const memTech: WorkspaceMember = {
            id: "mem_tech_1",
            workspaceId: WS_ID,
            userId: USER_TECH.id,
            role: "TECHNICIAN",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const memAcc: WorkspaceMember = {
            id: "mem_acc_1",
            workspaceId: WS_ID,
            userId: USER_ACCOUNTANT.id,
            role: "ACCOUNTANT",
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        membersMap.set(`${WS_ID}:${USER_ADMIN.id}`, memAdmin);
        membersMap.set(`${WS_ID}:${USER_TECH.id}`, memTech);
        membersMap.set(`${WS_ID}:${USER_ACCOUNTANT.id}`, memAcc);

        // Default auth context to Technician (primary persona for consumption)
        mocks.auth.mockResolvedValue({
            user: { id: USER_TECH.id, email: USER_TECH.email },
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

        mocks.workOrderPartFindFirst.mockImplementation(
            async ({ where, include }: any) => {
                const found = workOrderPartsList.find((wop) => {
                    if (where.workspaceId && wop.workspaceId !== where.workspaceId)
                        return false;
                    if (where.id && wop.id !== where.id) return false;
                    return true;
                });
                if (!found) return null;
                if (include?.stockMovements) {
                    const movements = movementsList.filter(
                        (m) =>
                            m.workspaceId === found.workspaceId &&
                            m.originalWorkOrderPartId === found.id &&
                            m.movementType === StockMovementType.RETURN,
                    );
                    return { ...found, stockMovements: movements };
                }
                return found;
            },
        );

        mocks.workOrderPartFindMany.mockImplementation(
            async ({ where, skip = 0, take = 50 }: any) => {
                const filtered = workOrderPartsList.filter((wop) => {
                    if (where.workspaceId && wop.workspaceId !== where.workspaceId)
                        return false;
                    if (where.workOrderId && wop.workOrderId !== where.workOrderId)
                        return false;
                    if (where.partId && wop.partId !== where.partId) return false;
                    if (where.locationId && wop.locationId !== where.locationId)
                        return false;
                    return true;
                });
                return filtered.slice(skip, skip + take).map((wop) => {
                    const movements = movementsList.filter(
                        (m) =>
                            m.workspaceId === wop.workspaceId &&
                            m.originalWorkOrderPartId === wop.id &&
                            m.movementType === StockMovementType.RETURN,
                    );
                    return { ...wop, stockMovements: movements };
                });
            },
        );

        mocks.workOrderPartCount.mockImplementation(async ({ where }: any) => {
            return workOrderPartsList.filter((wop) => {
                if (where.workspaceId && wop.workspaceId !== where.workspaceId)
                    return false;
                if (where.workOrderId && wop.workOrderId !== where.workOrderId)
                    return false;
                if (where.partId && wop.partId !== where.partId) return false;
                if (where.locationId && wop.locationId !== where.locationId)
                    return false;
                return true;
            }).length;
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
                workOrderPart: {
                    create: async ({ data }: any) => {
                        const newWOPart: WorkOrderPart = {
                            id: `wop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            workspaceId: data.workspaceId,
                            workOrderId: data.workOrderId,
                            partId: data.partId,
                            locationId: data.locationId,
                            quantity: data.quantity,
                            unitCostAtTimeOfUse: data.unitCostAtTimeOfUse,
                            partName: data.partName,
                            partSku: data.partSku ?? null,
                            unitOfMeasure: data.unitOfMeasure,
                            consumedByMemberId: data.consumedByMemberId ?? null,
                            consumedAt: new Date(),
                            notes: data.notes ?? null,
                            createdAt: new Date(),
                        };
                        workOrderPartsList.push(newWOPart);
                        return newWOPart;
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
                            originalWorkOrderPartId:
                                data.originalWorkOrderPartId ?? null,
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

    describe("consumeStock Mutation Service", () => {
        it("successfully consumes stock fulfilling reservation and creates WorkOrderPart + StockMovement", async () => {
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

            const result = await consumeStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 4,
                workOrderId: WO_VALID.id,
                notes: "Installed 4ft copper pipe under sink",
                referenceNumber: "TECH-NOTE-1",
            });

            // Balance: both onHand (50 - 4 = 46) and reserved (10 - 4 = 6) decremented; available remains 40
            expect(result.balance.quantityOnHand).toBe(46);
            expect(result.balance.quantityReserved).toBe(6);
            expect(result.balance.quantityAvailable).toBe(40);

            // WorkOrderPart snapshot
            expect(result.workOrderPart.workOrderId).toBe(WO_VALID.id);
            expect(result.workOrderPart.partId).toBe(PART_ACTIVE.id);
            expect(result.workOrderPart.quantity).toBe(4);
            expect(result.workOrderPart.unitCostAtTimeOfUse).toBe(15.5);
            expect(result.workOrderPart.partName).toBe("Copper Pipe 1/2 in");
            expect(result.workOrderPart.partSku).toBe("PIPE-CU-050");
            expect(result.workOrderPart.unitOfMeasure).toBe(PartUnitOfMeasure.FOOT);
            expect(result.workOrderPart.consumedByMemberId).toBe("mem_tech_1");
            expect(result.workOrderPart.notes).toBe("Installed 4ft copper pipe under sink");
            expect(result.workOrderPart.netQuantityConsumed).toBe(4);

            // StockMovement ledger
            expect(result.movement.movementType).toBe(StockMovementType.CONSUMPTION);
            expect(result.movement.quantity).toBe(4);
            expect(result.movement.workOrderId).toBe(WO_VALID.id);
            expect(result.movement.originalWorkOrderPartId).toBe(result.workOrderPart.id);
            expect(result.movement.unitCostSnapshot).toBe(15.5);
            expect(result.movement.actorMemberId).toBe("mem_tech_1");
        });

        it("preserves null unitCostSnapshot on StockMovement while defaulting non-nullable unitCostAtTimeOfUse to 0 on WorkOrderPart when part.unitCost is null", async () => {
            balancesList.push({
                id: "bal_null_cost",
                workspaceId: WS_ID,
                partId: PART_NULL_COST.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("10.0000"),
                quantityReserved: new Prisma.Decimal("10.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await consumeStock(WS_ID, {
                partId: PART_NULL_COST.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 2,
                workOrderId: WO_VALID.id,
            });

            // WorkOrderPart has non-nullable Decimal in schema -> defaulted to 0
            expect(result.workOrderPart.unitCostAtTimeOfUse).toBe(0);

            // StockMovement has nullable Decimal? in schema -> preserved as null
            expect(result.movement.unitCostSnapshot).toBeNull();
        });

        it("throws InsufficientStockError when requested quantity exceeds quantityOnHand", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("3.0000"),
                quantityReserved: new Prisma.Decimal("3.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5, // onHand = 3 (< 5) -> throws
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("throws InsufficientStockError when requested quantity exceeds quantityReserved under strict fulfillment", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("2.0000"), // Only 2 reserved
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5, // Reserved = 2 (< 5) -> throws
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("throws InsufficientStockError on non-existent balance (lazy-create with 0 onHand/reserved)", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("rejects missing workOrderId at schema level", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow();
        });

        it("rejects zero quantity at schema level", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 0,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow();
        });

        it("rejects negative quantity at schema level", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: -2,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow();
        });

        it("throws PartNotFoundError when part does not exist in workspace", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: "non_existent_part",
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws PartInactiveError when part is INACTIVE", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_INACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(PartInactiveError);
        });

        it("throws InventoryLocationNotFoundError when location does not exist", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: "non_existent_loc",
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("throws InventoryLocationInactiveError when location is INACTIVE (operational pull requires active location)", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_INACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(InventoryLocationInactiveError);
        });

        it("throws WorkOrderNotFoundError when workOrder does not exist in workspace", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: "non_existent_wo",
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("enforces tenant isolation — rejects part belonging to foreign workspace", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_BETA.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation — rejects location belonging to foreign workspace", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_BETA.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — rejects workOrder belonging to foreign workspace", async () => {
            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_BETA.id,
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("enforces RBAC — allows TECHNICIAN persona to consume stock (Section 9.2)", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("10.0000"),
                quantityReserved: new Prisma.Decimal("5.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            const result = await consumeStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 2,
                workOrderId: WO_VALID.id,
            });

            expect(result.workOrderPart.consumedByMemberId).toBe("mem_tech_1");
            expect(result.balance.quantityOnHand).toBe(8);
            expect(result.balance.quantityReserved).toBe(3);
        });

        it("enforces RBAC — denies ACCOUNTANT persona from consuming stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_ACCOUNTANT.id, email: USER_ACCOUNTANT.email },
            });

            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("denies unauthenticated caller from consuming stock", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                consumeStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });

    describe("WorkOrderPart Read Model Services", () => {
        beforeEach(() => {
            // Default auth to Admin for read queries
            mocks.auth.mockResolvedValue({
                user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
            });
        });

        it("getWorkOrderPart retrieves detail model and computes netQuantityConsumed accounting for returns", async () => {
            const wop: WorkOrderPart = {
                id: "wop_100",
                workspaceId: WS_ID,
                workOrderId: WO_VALID.id,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: new Prisma.Decimal("10.0000"),
                unitCostAtTimeOfUse: new Prisma.Decimal("15.50"),
                partName: "Copper Pipe 1/2 in",
                partSku: "PIPE-CU-050",
                unitOfMeasure: PartUnitOfMeasure.FOOT,
                consumedByMemberId: "mem_tech_1",
                consumedAt: new Date("2026-01-15T10:00:00Z"),
                notes: "Initial rough-in",
                createdAt: new Date("2026-01-15T10:00:00Z"),
            };
            workOrderPartsList.push(wop);

            // Add a RETURN movement of 3 units
            movementsList.push({
                id: "mov_ret_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                movementType: StockMovementType.RETURN,
                quantity: new Prisma.Decimal("3.0000"),
                fromLocationId: null,
                toLocationId: null,
                workOrderId: WO_VALID.id,
                originalWorkOrderPartId: "wop_100",
                unitCostSnapshot: new Prisma.Decimal("15.50"),
                reason: "Leftover pipe returned",
                referenceNumber: null,
                actorMemberId: "mem_tech_1",
                createdAt: new Date("2026-01-15T14:00:00Z"),
            });

            const result = await getWorkOrderPart(WS_ID, "wop_100");

            expect(result.id).toBe("wop_100");
            expect(result.quantity).toBe(10);
            expect(result.unitCostAtTimeOfUse).toBe(15.5);
            expect(result.partName).toBe("Copper Pipe 1/2 in");
            expect(result.netQuantityConsumed).toBe(7); // 10 - 3 returned = 7 net
        });

        it("getWorkOrderPart throws WorkOrderPartNotFoundError when record is missing or in another workspace", async () => {
            await expect(
                getWorkOrderPart(WS_ID, "non_existent_wop"),
            ).rejects.toThrow(WorkOrderPartNotFoundError);
        });

        it("getWorkOrderParts returns paginated list filtered by workOrderId", async () => {
            workOrderPartsList.push(
                {
                    id: "wop_1",
                    workspaceId: WS_ID,
                    workOrderId: WO_VALID.id,
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: new Prisma.Decimal("5.0000"),
                    unitCostAtTimeOfUse: new Prisma.Decimal("15.50"),
                    partName: "Copper Pipe 1/2 in",
                    partSku: "PIPE-CU-050",
                    unitOfMeasure: PartUnitOfMeasure.FOOT,
                    consumedByMemberId: "mem_tech_1",
                    consumedAt: new Date("2026-01-15T10:00:00Z"),
                    notes: null,
                    createdAt: new Date("2026-01-15T10:00:00Z"),
                },
                {
                    id: "wop_2",
                    workspaceId: WS_ID_BETA, // Foreign workspace
                    workOrderId: WO_BETA.id,
                    partId: PART_BETA.id,
                    locationId: LOCATION_BETA.id,
                    quantity: new Prisma.Decimal("2.0000"),
                    unitCostAtTimeOfUse: new Prisma.Decimal("10.00"),
                    partName: "Beta Part",
                    partSku: "BETA-PART",
                    unitOfMeasure: PartUnitOfMeasure.EACH,
                    consumedByMemberId: null,
                    consumedAt: new Date("2026-01-16T10:00:00Z"),
                    notes: null,
                    createdAt: new Date("2026-01-16T10:00:00Z"),
                },
            );

            const result = await getWorkOrderParts(WS_ID, {
                workOrderId: WO_VALID.id,
            });

            expect(result.total).toBe(1);
            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("wop_1");
            expect(result.items[0].netQuantityConsumed).toBe(5);
        });
    });
});
