import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    partFindFirst: vi.fn(),
    inventoryLocationFindFirst: vi.fn(),
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

import { transferStock } from "@/lib/services/inventory/movement/transferStock";
import {
    TransferSameLocationError,
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
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

describe("Phase 1.10.9 — Stock Transfer Service (transferStock)", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];
    let locationsList: InventoryLocation[];
    let balancesList: InventoryBalance[];
    let movementsList: StockMovement[];
    let lockCallLog: string[];

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

    // Location IDs named to have distinct alphabetical sorting: "loc_aaa" < "loc_zzz"
    const LOCATION_A: InventoryLocation = {
        id: "loc_aaa_warehouse",
        workspaceId: WS_ID,
        name: "Central Warehouse A",
        code: "WH-A",
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

    const LOCATION_Z: InventoryLocation = {
        id: "loc_zzz_vehicle",
        workspaceId: WS_ID,
        name: "Field Van Z",
        code: "VAN-Z",
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

    const LOCATION_INACTIVE_SRC: InventoryLocation = {
        id: "loc_decommissioned_src",
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

    const LOCATION_INACTIVE_DEST: InventoryLocation = {
        id: "loc_closed_dest",
        workspaceId: WS_ID,
        name: "Closed Facility",
        code: "FAC-CLOSED",
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
        locationsList = [
            LOCATION_A,
            LOCATION_Z,
            LOCATION_INACTIVE_SRC,
            LOCATION_INACTIVE_DEST,
            LOCATION_BETA,
        ];
        balancesList = [];
        movementsList = [];
        lockCallLog = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
        usersMap.set(USER_MANAGER.id, USER_MANAGER);
        usersMap.set(USER_DISPATCHER.id, USER_DISPATCHER);
        usersMap.set(USER_TECH.id, USER_TECH);

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

        membersMap.set(`${WS_ID}:${USER_ADMIN.id}`, memAdmin);
        membersMap.set(`${WS_ID}:${USER_MANAGER.id}`, memManager);
        membersMap.set(`${WS_ID}:${USER_DISPATCHER.id}`, memDispatcher);
        membersMap.set(`${WS_ID}:${USER_TECH.id}`, memTech);

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

        // Mock interactive transaction executing the callback with a transaction client
        mocks.transaction.mockImplementation(async (callback: any) => {
            const tx = {
                $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
                    const ws = values[0];
                    const part = values[1];
                    const loc = values[2];
                    lockCallLog.push(loc);
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
                            fromLocationId: data.fromLocationId ?? null,
                            toLocationId: data.toLocationId ?? null,
                            workOrderId: null,
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

    describe("Validation & Rejection Rules", () => {
        it("throws TransferSameLocationError when fromLocationId === toLocationId", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_A.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(TransferSameLocationError);
        });

        it("rejects zero quantity at schema level", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 0,
                }),
            ).rejects.toThrow();
        });

        it("rejects negative quantity at schema level", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: -3,
                }),
            ).rejects.toThrow();
        });

        it("throws PartNotFoundError when part does not exist in workspace", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: "non_existent_part",
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws PartInactiveError when part is INACTIVE", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_INACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartInactiveError);
        });

        it("throws InventoryLocationNotFoundError when fromLocation does not exist", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: "non_existent_loc",
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("throws InventoryLocationNotFoundError when toLocation does not exist", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: "non_existent_loc",
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("does NOT throw InventoryLocationInactiveError for inactive fromLocation (allows decommissioning transfer out)", async () => {
            balancesList.push({
                id: "bal_decomm",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_INACTIVE_SRC.id,
                quantityOnHand: new Prisma.Decimal("20.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await transferStock(WS_ID, {
                partId: PART_ACTIVE.id,
                fromLocationId: LOCATION_INACTIVE_SRC.id,
                toLocationId: LOCATION_Z.id,
                quantity: 5,
            });

            expect(result.sourceBalance.quantityOnHand).toBe(15);
            expect(result.destinationBalance.quantityOnHand).toBe(5);
        });

        it("throws InventoryLocationInactiveError when toLocation is INACTIVE", async () => {
            balancesList.push({
                id: "bal_a",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_A.id,
                quantityOnHand: new Prisma.Decimal("20.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_INACTIVE_DEST.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationInactiveError);
        });

        it("enforces tenant isolation — throws PartNotFoundError if part belongs to another workspace", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_BETA.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if fromLocation belongs to another workspace", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_BETA.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if toLocation belongs to another workspace", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_BETA.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });
    });

    describe("Stock Availability & Insufficient Stock Rejection", () => {
        it("throws InsufficientStockError when source has zero balance", async () => {
            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 1,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("throws InsufficientStockError when source quantityOnHand is less than requested quantity", async () => {
            balancesList.push({
                id: "bal_a",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_A.id,
                quantityOnHand: new Prisma.Decimal("4.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("throws InsufficientStockError when reservations reduce quantityAvailable below requested quantity", async () => {
            // onHand = 10, reserved = 8 -> available = 2. Requested = 3 -> Insufficient!
            balancesList.push({
                id: "bal_a",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_A.id,
                quantityOnHand: new Prisma.Decimal("10.0000"),
                quantityReserved: new Prisma.Decimal("8.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 3,
                }),
            ).rejects.toThrow(InsufficientStockError);
        });
    });

    describe("Transfer Execution & Paired Movement Records", () => {
        it("successfully transfers stock between existing balances and creates paired movements", async () => {
            balancesList.push(
                {
                    id: "bal_src",
                    workspaceId: WS_ID,
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_A.id,
                    quantityOnHand: new Prisma.Decimal("50.0000"),
                    quantityReserved: new Prisma.Decimal("10.0000"),
                    createdAt: new Date("2026-01-01T00:00:00Z"),
                    updatedAt: new Date("2026-01-01T00:00:00Z"),
                },
                {
                    id: "bal_dest",
                    workspaceId: WS_ID,
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_Z.id,
                    quantityOnHand: new Prisma.Decimal("15.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date("2026-01-01T00:00:00Z"),
                    updatedAt: new Date("2026-01-01T00:00:00Z"),
                },
            );

            const result = await transferStock(WS_ID, {
                partId: PART_ACTIVE.id,
                fromLocationId: LOCATION_A.id,
                toLocationId: LOCATION_Z.id,
                quantity: 12.5,
                reason: "Replenishing van stock",
                referenceNumber: "TR-2001",
            });

            // Verify Source Balance (50 - 12.5 = 37.5 onHand, 10 reserved, 27.5 available)
            expect(result.sourceBalance.id).toBe("bal_src");
            expect(result.sourceBalance.quantityOnHand).toBe(37.5);
            expect(result.sourceBalance.quantityReserved).toBe(10);
            expect(result.sourceBalance.quantityAvailable).toBe(27.5);

            // Verify Destination Balance (15 + 12.5 = 27.5 onHand, 0 reserved, 27.5 available)
            expect(result.destinationBalance.id).toBe("bal_dest");
            expect(result.destinationBalance.quantityOnHand).toBe(27.5);
            expect(result.destinationBalance.quantityReserved).toBe(0);
            expect(result.destinationBalance.quantityAvailable).toBe(27.5);

            // Verify Paired Movements
            expect(result.transferOutMovement.movementType).toBe(StockMovementType.TRANSFER_OUT);
            expect(result.transferOutMovement.locationId).toBe(LOCATION_A.id);
            expect(result.transferOutMovement.fromLocationId).toBe(LOCATION_A.id);
            expect(result.transferOutMovement.toLocationId).toBe(LOCATION_Z.id);
            expect(result.transferOutMovement.quantity).toBe(12.5);
            expect(result.transferOutMovement.unitCostSnapshot).toBe(15.5);
            expect(result.transferOutMovement.reason).toBe("Replenishing van stock");
            expect(result.transferOutMovement.referenceNumber).toBe("TR-2001");
            expect(result.transferOutMovement.actorMemberId).toBe("mem_admin_1");

            expect(result.transferInMovement.movementType).toBe(StockMovementType.TRANSFER_IN);
            expect(result.transferInMovement.locationId).toBe(LOCATION_Z.id);
            expect(result.transferInMovement.fromLocationId).toBe(LOCATION_A.id);
            expect(result.transferInMovement.toLocationId).toBe(LOCATION_Z.id);
            expect(result.transferInMovement.quantity).toBe(12.5);
            expect(result.transferInMovement.unitCostSnapshot).toBe(15.5);
            expect(result.transferInMovement.reason).toBe("Replenishing van stock");
            expect(result.transferInMovement.referenceNumber).toBe("TR-2001");
            expect(result.transferInMovement.actorMemberId).toBe("mem_admin_1");
        });

        it("successfully transfers stock into a destination with NO prior balance row (lazy create path)", async () => {
            balancesList.push({
                id: "bal_src",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_A.id,
                quantityOnHand: new Prisma.Decimal("30.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await transferStock(WS_ID, {
                partId: PART_ACTIVE.id,
                fromLocationId: LOCATION_A.id,
                toLocationId: LOCATION_Z.id,
                quantity: 10,
            });

            expect(result.sourceBalance.quantityOnHand).toBe(20);
            expect(result.destinationBalance.quantityOnHand).toBe(10);
            expect(result.destinationBalance.quantityReserved).toBe(0);
            expect(result.destinationBalance.quantityAvailable).toBe(10);
        });
    });

    describe("Deterministic Lock Ordering (Deadlock Prevention)", () => {
        it("always acquires row locks in lexicographical order: A -> Z when transfer is A -> Z", async () => {
            balancesList.push(
                {
                    id: "bal_a",
                    workspaceId: WS_ID,
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_A.id, // "loc_aaa_warehouse"
                    quantityOnHand: new Prisma.Decimal("50.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_z",
                    workspaceId: WS_ID,
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_Z.id, // "loc_zzz_vehicle"
                    quantityOnHand: new Prisma.Decimal("10.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            await transferStock(WS_ID, {
                partId: PART_ACTIVE.id,
                fromLocationId: LOCATION_A.id,
                toLocationId: LOCATION_Z.id,
                quantity: 5,
            });

            // "loc_aaa_warehouse" < "loc_zzz_vehicle" -> lock order should be A first, then Z
            expect(lockCallLog).toEqual([LOCATION_A.id, LOCATION_Z.id]);
        });

        it("always acquires row locks in lexicographical order: A -> Z even when transfer is Z -> A", async () => {
            balancesList.push(
                {
                    id: "bal_a",
                    workspaceId: WS_ID,
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_A.id, // "loc_aaa_warehouse"
                    quantityOnHand: new Prisma.Decimal("10.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_z",
                    workspaceId: WS_ID,
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_Z.id, // "loc_zzz_vehicle"
                    quantityOnHand: new Prisma.Decimal("50.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            await transferStock(WS_ID, {
                partId: PART_ACTIVE.id,
                fromLocationId: LOCATION_Z.id, // Transfer FROM Z
                toLocationId: LOCATION_A.id,   // Transfer TO A
                quantity: 5,
            });

            // Even though request is Z -> A, deterministic sort ensures A is locked first, then Z!
            expect(lockCallLog).toEqual([LOCATION_A.id, LOCATION_Z.id]);
        });
    });

    describe("RBAC & Authorization Enforcement", () => {
        it("allows MANAGER role to transfer stock", async () => {
            balancesList.push({
                id: "bal_src",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_A.id,
                quantityOnHand: new Prisma.Decimal("20.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_MANAGER.id, email: USER_MANAGER.email },
            });

            const result = await transferStock(WS_ID, {
                partId: PART_ACTIVE.id,
                fromLocationId: LOCATION_A.id,
                toLocationId: LOCATION_Z.id,
                quantity: 5,
            });

            expect(result.sourceBalance.quantityOnHand).toBe(15);
            expect(result.transferOutMovement.actorMemberId).toBe("mem_manager_1");
        });

        it("allows DISPATCHER role to transfer stock (per spec Section 9.2)", async () => {
            balancesList.push({
                id: "bal_src",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_A.id,
                quantityOnHand: new Prisma.Decimal("20.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_DISPATCHER.id, email: USER_DISPATCHER.email },
            });

            const result = await transferStock(WS_ID, {
                partId: PART_ACTIVE.id,
                fromLocationId: LOCATION_A.id,
                toLocationId: LOCATION_Z.id,
                quantity: 5,
            });

            expect(result.sourceBalance.quantityOnHand).toBe(15);
            expect(result.transferOutMovement.actorMemberId).toBe("mem_disp_1");
        });

        it("denies TECHNICIAN role from transferring stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("denies unauthenticated caller", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                transferStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    fromLocationId: LOCATION_A.id,
                    toLocationId: LOCATION_Z.id,
                    quantity: 5,
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });
});
