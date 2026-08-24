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

import { adjustStock } from "@/lib/services/inventory/movement/adjustStock";
import {
    InsufficientStockError,
    PartNotFoundError,
    PartInactiveError,
    InventoryLocationNotFoundError,
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

describe("Phase 1.10.10 — Stock Adjustment Service (adjustStock)", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];
    let locationsList: InventoryLocation[];
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
        balancesList = [];
        movementsList = [];

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
        it("rejects zero quantity at schema level", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 0,
                    reason: "Cycle count test",
                }),
            ).rejects.toThrow();
        });

        it("rejects missing reason at schema level", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                }),
            ).rejects.toThrow();
        });

        it("rejects empty/whitespace-only reason at schema level", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    reason: "    ",
                }),
            ).rejects.toThrow();
        });

        it("throws PartNotFoundError when part does not exist in workspace", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: "non_existent_part",
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    reason: "Cycle count",
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws PartInactiveError when part is INACTIVE", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: PART_INACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    reason: "Found extra parts",
                }),
            ).rejects.toThrow(PartInactiveError);
        });

        it("throws InventoryLocationNotFoundError when location does not exist", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: "non_existent_loc",
                    quantity: 5,
                    reason: "Cycle count",
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — throws PartNotFoundError if part belongs to another workspace", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: PART_BETA.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    reason: "Audit adjustment",
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if location belongs to another workspace", async () => {
            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_BETA.id,
                    quantity: 5,
                    reason: "Audit adjustment",
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("permits adjustments on an INACTIVE location (for inventory decommissioning and write-offs)", async () => {
            balancesList.push({
                id: "bal_inact",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_INACTIVE.id,
                quantityOnHand: new Prisma.Decimal("10.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await adjustStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_INACTIVE.id,
                quantity: -10,
                reason: "Zeroing out decommissioned depot",
            });

            expect(result.balance.quantityOnHand).toBe(0);
            expect(result.movement.quantity).toBe(-10);
        });
    });

    describe("Adjustment Execution & Sign Preservation", () => {
        it("positive adjustment increases onHand and stores positive signed quantity in movement", async () => {
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

            const result = await adjustStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 8.5,
                reason: "Cycle count found extra box",
                referenceNumber: "CC-2026-08",
            });

            expect(result.balance.quantityOnHand).toBe(28.5); // 20 + 8.5
            expect(result.balance.quantityReserved).toBe(5); // Untouched
            expect(result.balance.quantityAvailable).toBe(23.5); // 28.5 - 5

            expect(result.movement.movementType).toBe(StockMovementType.ADJUSTMENT);
            expect(result.movement.quantity).toBe(8.5);
            expect(result.movement.reason).toBe("Cycle count found extra box");
            expect(result.movement.referenceNumber).toBe("CC-2026-08");
            expect(result.movement.actorMemberId).toBe("mem_admin_1");
        });

        it("negative adjustment decreases onHand and stores negative signed quantity in movement", async () => {
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

            const result = await adjustStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: -6,
                reason: "Water damage write-off",
            });

            expect(result.balance.quantityOnHand).toBe(14); // 20 - 6
            expect(result.balance.quantityReserved).toBe(5); // Untouched
            expect(result.balance.quantityAvailable).toBe(9); // 14 - 5

            expect(result.movement.movementType).toBe(StockMovementType.ADJUSTMENT);
            expect(result.movement.quantity).toBe(-6); // Stored as signed negative
            expect(result.movement.reason).toBe("Water damage write-off");
        });

        it("throws InsufficientStockError when negative adjustment would drive quantityOnHand below zero", async () => {
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

            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: -15, // 10 - 15 = -5 (< 0)
                    reason: "Write-off attempt",
                }),
            ).rejects.toThrow(InsufficientStockError);
        });

        it("allows negative adjustment when onHand drops below reservations but remains non-negative (floor is onHand >= 0)", async () => {
            // onHand = 10, reserved = 8. Adjust -5 -> new onHand = 5 (>= 0).
            // Floor check is onHand >= 0, not quantityAvailable >= 0, so this succeeds.
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantityOnHand: new Prisma.Decimal("10.0000"),
                quantityReserved: new Prisma.Decimal("8.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await adjustStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: -5,
                reason: "Correction of unreserved damaged stock",
            });

            expect(result.balance.quantityOnHand).toBe(5);
            expect(result.balance.quantityReserved).toBe(8);
            expect(result.balance.quantityAvailable).toBe(-3); // onHand - reserved
        });

        it("successfully performs positive adjustment into a location with NO prior balance row (lazy create path)", async () => {
            const result = await adjustStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 12,
                reason: "Initial physical count reconciliation",
            });

            expect(result.balance.quantityOnHand).toBe(12);
            expect(result.balance.quantityReserved).toBe(0);
            expect(result.balance.quantityAvailable).toBe(12);
            expect(result.movement.quantity).toBe(12);
        });
    });

    describe("RBAC & Authentication Enforcement", () => {
        it("allows MANAGER role to adjust stock", async () => {
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
                user: { id: USER_MANAGER.id, email: USER_MANAGER.email },
            });

            const result = await adjustStock(WS_ID, {
                partId: PART_ACTIVE.id,
                locationId: LOCATION_ACTIVE.id,
                quantity: 2,
                reason: "Manager audit",
            });

            expect(result.balance.quantityOnHand).toBe(12);
            expect(result.movement.actorMemberId).toBe("mem_manager_1");
        });

        it("denies DISPATCHER role from adjusting stock (per spec Section 9.2)", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_DISPATCHER.id, email: USER_DISPATCHER.email },
            });

            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    reason: "Dispatcher adjustment attempt",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("denies TECHNICIAN role from adjusting stock", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    reason: "Tech adjustment attempt",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("denies unauthenticated caller", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                adjustStock(WS_ID, {
                    partId: PART_ACTIVE.id,
                    locationId: LOCATION_ACTIVE.id,
                    quantity: 5,
                    reason: "Unauth attempt",
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });
});
