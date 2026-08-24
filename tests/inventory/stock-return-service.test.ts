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
    workOrderPartFindFirst: vi.fn(),
    inventoryBalanceFindFirst: vi.fn(),
    inventoryBalanceFindMany: vi.fn(),
    inventoryBalanceCount: vi.fn(),
    inventoryBalanceCreate: vi.fn(),
    inventoryBalanceUpdate: vi.fn(),
    stockMovementFindMany: vi.fn(),
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
        workOrderPart: {
            findFirst: mocks.workOrderPartFindFirst,
        },
        inventoryBalance: {
            findFirst: mocks.inventoryBalanceFindFirst,
            findMany: mocks.inventoryBalanceFindMany,
            count: mocks.inventoryBalanceCount,
            create: mocks.inventoryBalanceCreate,
            update: mocks.inventoryBalanceUpdate,
        },
        stockMovement: {
            findMany: mocks.stockMovementFindMany,
            create: mocks.stockMovementCreate,
        },
        $queryRaw: mocks.queryRaw,
        $transaction: mocks.transaction,
    },
}));

import { returnStock } from "@/lib/services/inventory/movement/returnStock";
import {
    ExcessiveReturnError,
    PartNotFoundError,
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
    WorkOrderNotFoundError,
    WorkOrderPartNotFoundError,
} from "@/lib/services/inventory/movement/stockMovementErrors";
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

describe("Phase 1.10.16 — Stock Return Service (returnStock)", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];
    let locationsList: InventoryLocation[];
    let workOrdersList: Array<{ id: string; workspaceId: string }>;
    let workOrderPartsList: WorkOrderPart[];
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

    const USER_TECH: User = {
        id: "user_tech_1",
        name: "Field Tech",
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
        name: "Accountant",
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

    const WOP_INITIAL: WorkOrderPart = {
        id: "wop_initial_1",
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
        notes: "Initial consumption",
        createdAt: new Date("2026-01-15T10:00:00Z"),
    };

    const WOP_INACTIVE_PART: WorkOrderPart = {
        id: "wop_inactive_part_1",
        workspaceId: WS_ID,
        workOrderId: WO_VALID.id,
        partId: PART_INACTIVE.id,
        locationId: LOCATION_ACTIVE.id,
        quantity: new Prisma.Decimal("5.0000"),
        unitCostAtTimeOfUse: new Prisma.Decimal("20.00"),
        partName: "Obsolete Sensor",
        partSku: "SENS-OBS",
        unitOfMeasure: PartUnitOfMeasure.EACH,
        consumedByMemberId: "mem_tech_1",
        consumedAt: new Date("2026-01-15T10:00:00Z"),
        notes: null,
        createdAt: new Date("2026-01-15T10:00:00Z"),
    };

    const WOP_BETA: WorkOrderPart = {
        id: "wop_beta_1",
        workspaceId: WS_ID_BETA,
        workOrderId: WO_BETA.id,
        partId: PART_BETA.id,
        locationId: LOCATION_BETA.id,
        quantity: new Prisma.Decimal("4.0000"),
        unitCostAtTimeOfUse: new Prisma.Decimal("10.00"),
        partName: "Beta Part",
        partSku: "BETA-PART",
        unitOfMeasure: PartUnitOfMeasure.EACH,
        consumedByMemberId: null,
        consumedAt: new Date("2026-01-15T10:00:00Z"),
        notes: null,
        createdAt: new Date("2026-01-15T10:00:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        partsList = [PART_ACTIVE, PART_INACTIVE, PART_BETA];
        locationsList = [LOCATION_ACTIVE, LOCATION_INACTIVE, LOCATION_BETA];
        workOrdersList = [WO_VALID, WO_BETA];
        workOrderPartsList = [WOP_INITIAL, WOP_INACTIVE_PART, WOP_BETA];
        balancesList = [];
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

        // Default auth to technician
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
            async ({ where }: any) => {
                return (
                    workOrderPartsList.find((wop) => {
                        if (
                            where.workspaceId &&
                            wop.workspaceId !== where.workspaceId
                        )
                            return false;
                        if (where.id && wop.id !== where.id) return false;
                        return true;
                    }) ?? null
                );
            },
        );

        mocks.stockMovementFindMany.mockImplementation(
            async ({ where }: any) => {
                return movementsList.filter((m) => {
                    if (where.workspaceId && m.workspaceId !== where.workspaceId)
                        return false;
                    if (
                        where.originalWorkOrderPartId &&
                        m.originalWorkOrderPartId !== where.originalWorkOrderPartId
                    )
                        return false;
                    if (
                        where.movementType &&
                        m.movementType !== where.movementType
                    )
                        return false;
                    return true;
                });
            },
        );

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
                    findMany: mocks.stockMovementFindMany,
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

    describe("Stock Return Execution & Invariants", () => {
        it("successfully performs partial return incrementing onHand, leaving reserved untouched, and computing updated net quantity", async () => {
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

            const result = await returnStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 3,
                workOrderId: WO_VALID.id,
                originalWorkOrderPartId: WOP_INITIAL.id,
                reason: "Leftover pipe from job",
                referenceNumber: "RET-01",
            });

            // Balance: onHand incremented (20 + 3 = 23), reserved untouched (5), available increases to 18
            expect(result.balance.quantityOnHand).toBe(23);
            expect(result.balance.quantityReserved).toBe(5);
            expect(result.balance.quantityAvailable).toBe(18);

            // WorkOrderPart: gross quantity is immutable (10), net quantity is reduced (10 - 3 = 7)
            expect(result.workOrderPart.quantity).toBe(10);
            expect(result.workOrderPart.netQuantityConsumed).toBe(7);

            // StockMovement: RETURN movement created with positive quantity
            expect(result.movement.movementType).toBe(StockMovementType.RETURN);
            expect(result.movement.quantity).toBe(3);
            expect(result.movement.originalWorkOrderPartId).toBe(WOP_INITIAL.id);
            expect(result.movement.workOrderId).toBe(WO_VALID.id);
            expect(result.movement.unitCostSnapshot).toBe(15.5);
            expect(result.movement.actorMemberId).toBe("mem_tech_1");
        });

        it("successfully performs exact remaining return driving netQuantityConsumed to 0", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("0.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await returnStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 10, // Full 10 units of WOP_INITIAL
                workOrderId: WO_VALID.id,
                originalWorkOrderPartId: WOP_INITIAL.id,
            });

            expect(result.balance.quantityOnHand).toBe(10);
            expect(result.workOrderPart.netQuantityConsumed).toBe(0);
        });

        it("throws ExcessiveReturnError when return quantity exceeds gross consumed quantity", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("0.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 11, // Gross is 10
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(ExcessiveReturnError);
        });

        it("throws ExcessiveReturnError when sequential returns exceed remaining net-consumed quantity", async () => {
            // Simulate an existing prior return of 7 units
            movementsList.push({
                id: "mov_prev_ret",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                movementType: StockMovementType.RETURN,
                quantity: new Prisma.Decimal("7.0000"),
                fromLocationId: null,
                toLocationId: null,
                workOrderId: WO_VALID.id,
                originalWorkOrderPartId: WOP_INITIAL.id,
                unitCostSnapshot: new Prisma.Decimal("15.50"),
                reason: "Prior partial return",
                referenceNumber: null,
                actorMemberId: "mem_tech_1",
                createdAt: new Date(),
            });

            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("7.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Gross is 10, already returned 7 -> net remaining is 3. Attempting 4 throws!
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 4,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(ExcessiveReturnError);
        });

        it("permits returning a catalog Part that has since become INACTIVE (correcting past operational use)", async () => {
            balancesList.push({
                id: "bal_inact_part",
                workspaceId: WS_ID,
                partId: PART_INACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("0.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await returnStock(WS_ID, {
                partId: PART_INACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 2,
                workOrderId: WO_VALID.id,
                originalWorkOrderPartId: WOP_INACTIVE_PART.id,
            });

            expect(result.balance.quantityOnHand).toBe(2);
            expect(result.workOrderPart.netQuantityConsumed).toBe(3); // 5 - 2 = 3
        });
    });

    describe("Validation & Rejection Rules", () => {
        it("rejects missing originalWorkOrderPartId at schema level", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                }),
            ).rejects.toThrow();
        });

        it("rejects zero quantity at schema level", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 0,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow();
        });

        it("rejects negative quantity at schema level", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: -3,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow();
        });

        it("throws PartNotFoundError when part does not exist in workspace", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: "non_existent_part",
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws InventoryLocationNotFoundError when location does not exist in workspace", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: "non_existent_loc",
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("throws InventoryLocationInactiveError when location is INACTIVE (receiving stock requires active location)", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_INACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(InventoryLocationInactiveError);
        });

        it("throws WorkOrderNotFoundError when workOrderId does not exist in workspace", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: "non_existent_wo",
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("throws WorkOrderPartNotFoundError when originalWorkOrderPartId is missing or does not match workOrder/part", async () => {
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: "non_existent_wop",
                }),
            ).rejects.toThrow(WorkOrderPartNotFoundError);
        });

        it("enforces tenant isolation on part, location, workOrder, and workOrderPart", async () => {
            // Foreign Part
            await expect(
                returnStock(WS_ID, {
                    partId: PART_BETA.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(PartNotFoundError);

            // Foreign Location
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_BETA.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);

            // Foreign WorkOrder
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_BETA.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(WorkOrderNotFoundError);

            // Foreign WorkOrderPart
            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_BETA.id,
                }),
            ).rejects.toThrow(WorkOrderPartNotFoundError);
        });
    });

    describe("RBAC & Authentication Enforcement", () => {
        it("allows TECHNICIAN role to return stock (Section 9.2)", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("10.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            const result = await returnStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 1,
                workOrderId: WO_VALID.id,
                originalWorkOrderPartId: WOP_INITIAL.id,
            });

            expect(result.balance.quantityOnHand).toBe(11);
            expect(result.movement.actorMemberId).toBe("mem_tech_1");
        });

        it("denies ACCOUNTANT role from returning stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_ACCOUNTANT.id, email: USER_ACCOUNTANT.email },
            });

            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("denies unauthenticated caller from returning stock", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                returnStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 1,
                    workOrderId: WO_VALID.id,
                    originalWorkOrderPartId: WOP_INITIAL.id,
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });
});
