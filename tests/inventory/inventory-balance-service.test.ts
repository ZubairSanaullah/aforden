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
    queryRaw: vi.fn(),
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
        },
        $queryRaw: mocks.queryRaw,
    },
}));

import { getInventoryBalance } from "@/lib/services/inventory/balance/getInventoryBalance";
import { getInventoryBalances } from "@/lib/services/inventory/balance/getInventoryBalances";
import { lockInventoryBalance } from "@/lib/services/inventory/balance/lockInventoryBalance";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import { InventoryLocationNotFoundError } from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";
import { UnauthorizedError } from "@/lib/services/authorization/authorizationErrors";
import {
    type InventoryBalance,
    type Part,
    type InventoryLocation,
    type User,
    type Workspace,
    type WorkspaceMember,
    PartStatus,
    PartUnitOfMeasure,
    InventoryLocationStatus,
    InventoryLocationType,
} from "@/generated/prisma/client";

describe("Phase 1.10.7 — InventoryBalance Read Services & Lock Helper", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];
    let locationsList: InventoryLocation[];
    let balancesList: InventoryBalance[];

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
        name: "Tech User",
        email: "tech@test.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const PART_1: Part = {
        id: "part_alpha_1",
        workspaceId: WS_ID,
        name: "Copper Pipe 1/2 in",
        sku: "PIPE-CU-050",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.FOOT,
        unitCost: new Prisma.Decimal("12.50") as any,
        minimumStockLevel: new Prisma.Decimal("10.0000") as any,
        status: PartStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const PART_2: Part = {
        id: "part_alpha_2",
        workspaceId: WS_ID,
        name: "Thermostat Digital",
        sku: "TSTAT-DIG",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.EACH,
        unitCost: new Prisma.Decimal("45.00") as any,
        minimumStockLevel: new Prisma.Decimal("5.0000") as any,
        status: PartStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const PART_BETA: Part = {
        id: "part_beta_1",
        workspaceId: WS_ID_BETA,
        name: "Beta Part",
        sku: "BETA-SKU",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.EACH,
        unitCost: null,
        minimumStockLevel: null,
        status: PartStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const LOCATION_1: InventoryLocation = {
        id: "loc_alpha_1",
        workspaceId: WS_ID,
        name: "Central Warehouse",
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

    const LOCATION_2: InventoryLocation = {
        id: "loc_alpha_2",
        workspaceId: WS_ID,
        name: "Van 1 Stock",
        code: "VAN-01",
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
        partsList = [PART_1, PART_2, PART_BETA];
        locationsList = [LOCATION_1, LOCATION_2, LOCATION_BETA];
        balancesList = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
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

        mocks.inventoryBalanceFindFirst.mockImplementation(
            async ({ where }: any) => {
                return (
                    balancesList.find((b) => {
                        if (
                            where.workspaceId &&
                            b.workspaceId !== where.workspaceId
                        )
                            return false;
                        if (where.partId && b.partId !== where.partId)
                            return false;
                        if (where.locationId && b.locationId !== where.locationId)
                            return false;
                        return true;
                    }) ?? null
                );
            },
        );

        mocks.inventoryBalanceFindMany.mockImplementation(
            async ({ where, skip, take }: any) => {
                let res = balancesList.filter((b) => {
                    if (
                        where.workspaceId &&
                        b.workspaceId !== where.workspaceId
                    )
                        return false;
                    if (where.partId && b.partId !== where.partId)
                        return false;
                    if (where.locationId && b.locationId !== where.locationId)
                        return false;
                    return true;
                });
                if (skip !== undefined && take !== undefined) {
                    res = res.slice(skip, skip + take);
                }
                return res;
            },
        );

        mocks.inventoryBalanceCount.mockImplementation(
            async ({ where }: any) => {
                const items = await mocks.inventoryBalanceFindMany({ where });
                return items.length;
            },
        );

        mocks.inventoryBalanceCreate.mockImplementation(
            async ({ data }: any) => {
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
        );
    });

    describe("getInventoryBalance", () => {
        it("returns synthetic zero-balance view model when no DB row exists for a valid part & location", async () => {
            const result = await getInventoryBalance(
                WS_ID,
                PART_1.id,
                LOCATION_1.id,
            );

            expect(result.id).toBeNull();
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.partId).toBe(PART_1.id);
            expect(result.locationId).toBe(LOCATION_1.id);
            expect(result.quantityOnHand).toBe(0);
            expect(result.quantityReserved).toBe(0);
            expect(result.quantityAvailable).toBe(0);
            expect(result.createdAt).toBeNull();
            expect(result.updatedAt).toBeNull();
        });

        it("returns actual values and computes quantityAvailable when a DB row exists", async () => {
            balancesList.push({
                id: "bal_existing_1",
                workspaceId: WS_ID,
                partId: PART_1.id,
                locationId: LOCATION_1.id,
                quantityOnHand: new Prisma.Decimal("100.0000"),
                quantityReserved: new Prisma.Decimal("15.0000"),
                createdAt: new Date("2026-01-01T00:00:00Z"),
                updatedAt: new Date("2026-01-02T00:00:00Z"),
            });

            const result = await getInventoryBalance(
                WS_ID,
                PART_1.id,
                LOCATION_1.id,
            );

            expect(result.id).toBe("bal_existing_1");
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.partId).toBe(PART_1.id);
            expect(result.locationId).toBe(LOCATION_1.id);
            expect(result.quantityOnHand).toBe(100);
            expect(result.quantityReserved).toBe(15);
            expect(result.quantityAvailable).toBe(85); // 100 - 15
            expect(result.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"));
            expect(result.updatedAt).toEqual(new Date("2026-01-02T00:00:00Z"));
        });

        it("throws PartNotFoundError when part does not exist in workspace", async () => {
            await expect(
                getInventoryBalance(WS_ID, "non_existent_part", LOCATION_1.id),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws InventoryLocationNotFoundError when location does not exist in workspace", async () => {
            await expect(
                getInventoryBalance(WS_ID, PART_1.id, "non_existent_location"),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — throws PartNotFoundError if part belongs to another workspace", async () => {
            await expect(
                getInventoryBalance(WS_ID, PART_BETA.id, LOCATION_1.id),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if location belongs to another workspace", async () => {
            await expect(
                getInventoryBalance(WS_ID, PART_1.id, LOCATION_BETA.id),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces RBAC — allows Technician role to view inventory balance", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            const result = await getInventoryBalance(
                WS_ID,
                PART_1.id,
                LOCATION_1.id,
            );

            expect(result.partId).toBe(PART_1.id);
            expect(result.quantityOnHand).toBe(0);
        });

        it("enforces authentication — denies when unauthenticated", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                getInventoryBalance(WS_ID, PART_1.id, LOCATION_1.id),
            ).rejects.toThrow(UnauthorizedError);
        });
    });

    describe("getInventoryBalances", () => {
        beforeEach(() => {
            balancesList.push(
                {
                    id: "bal_1",
                    workspaceId: WS_ID,
                    partId: PART_1.id,
                    locationId: LOCATION_1.id,
                    quantityOnHand: new Prisma.Decimal("50.0000"),
                    quantityReserved: new Prisma.Decimal("10.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_2",
                    workspaceId: WS_ID,
                    partId: PART_2.id,
                    locationId: LOCATION_1.id,
                    quantityOnHand: new Prisma.Decimal("20.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_3",
                    workspaceId: WS_ID,
                    partId: PART_1.id,
                    locationId: LOCATION_2.id,
                    quantityOnHand: new Prisma.Decimal("5.0000"),
                    quantityReserved: new Prisma.Decimal("2.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_beta",
                    workspaceId: WS_ID_BETA,
                    partId: PART_BETA.id,
                    locationId: LOCATION_BETA.id,
                    quantityOnHand: new Prisma.Decimal("999.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );
        });

        it("returns all workspace balance records with default pagination", async () => {
            const res = await getInventoryBalances(WS_ID);

            expect(res.items.length).toBe(3);
            expect(res.pagination.total).toBe(3);
            expect(res.pagination.page).toBe(1);
            expect(res.pagination.totalPages).toBe(1);
            expect(res.items[0].quantityAvailable).toBe(40); // 50 - 10
        });

        it("filters balances by partId", async () => {
            const res = await getInventoryBalances(WS_ID, {
                partId: PART_2.id,
            });

            expect(res.items.length).toBe(1);
            expect(res.items[0].partId).toBe(PART_2.id);
            expect(res.items[0].quantityOnHand).toBe(20);
            expect(res.items[0].quantityAvailable).toBe(20);
        });

        it("filters balances by locationId", async () => {
            const res = await getInventoryBalances(WS_ID, {
                locationId: LOCATION_2.id,
            });

            expect(res.items.length).toBe(1);
            expect(res.items[0].locationId).toBe(LOCATION_2.id);
            expect(res.items[0].quantityOnHand).toBe(5);
            expect(res.items[0].quantityReserved).toBe(2);
            expect(res.items[0].quantityAvailable).toBe(3);
        });

        it("enforces tenant isolation — does not return balances from other workspaces", async () => {
            const res = await getInventoryBalances(WS_ID);

            expect(
                res.items.some((b) => b.workspaceId === WS_ID_BETA),
            ).toBe(false);
            expect(
                res.items.some((b) => b.partId === PART_BETA.id),
            ).toBe(false);
        });
    });

    describe("lockInventoryBalance (internal helper)", () => {
        it("returns existing row locked with Decimal types when row already exists", async () => {
            const existingBalance: InventoryBalance = {
                id: "bal_locked_1",
                workspaceId: WS_ID,
                partId: PART_1.id,
                locationId: LOCATION_1.id,
                quantityOnHand: new Prisma.Decimal("75.5000"),
                quantityReserved: new Prisma.Decimal("10.2500"),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const txMock: any = {
                $queryRaw: vi.fn().mockResolvedValue([existingBalance]),
                inventoryBalance: {
                    create: vi.fn(),
                },
            };

            const result = await lockInventoryBalance(
                txMock,
                WS_ID,
                PART_1.id,
                LOCATION_1.id,
            );

            expect(result).toBe(existingBalance);
            expect(result.quantityOnHand).toBeInstanceOf(Prisma.Decimal);
            expect(result.quantityOnHand.toString()).toBe("75.5");
            expect(result.quantityReserved).toBeInstanceOf(Prisma.Decimal);
            expect(result.quantityReserved.toString()).toBe("10.25");
            expect(txMock.inventoryBalance.create).not.toHaveBeenCalled();
            expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it("lazily creates a new balance row (0 onHand, 0 reserved) and re-locks it when no row exists", async () => {
            const newCreatedBalance: InventoryBalance = {
                id: "bal_newly_created",
                workspaceId: WS_ID,
                partId: PART_1.id,
                locationId: LOCATION_1.id,
                quantityOnHand: new Prisma.Decimal(0),
                quantityReserved: new Prisma.Decimal(0),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const txMock: any = {
                $queryRaw: vi
                    .fn()
                    .mockResolvedValueOnce([]) // First select finds nothing
                    .mockResolvedValueOnce([newCreatedBalance]), // Re-select after create returns locked row
                inventoryBalance: {
                    create: vi.fn().mockResolvedValue(newCreatedBalance),
                },
            };

            const result = await lockInventoryBalance(
                txMock,
                WS_ID,
                PART_1.id,
                LOCATION_1.id,
            );

            expect(txMock.$queryRaw).toHaveBeenCalledTimes(2);
            expect(txMock.inventoryBalance.create).toHaveBeenCalledWith({
                data: {
                    workspaceId: WS_ID,
                    partId: PART_1.id,
                    locationId: LOCATION_1.id,
                    quantityOnHand: new Prisma.Decimal(0),
                    quantityReserved: new Prisma.Decimal(0),
                },
            });
            expect(result).toBe(newCreatedBalance);
            expect(result.quantityOnHand).toBeInstanceOf(Prisma.Decimal);
            expect(result.quantityOnHand.toNumber()).toBe(0);
            expect(result.quantityReserved).toBeInstanceOf(Prisma.Decimal);
            expect(result.quantityReserved.toNumber()).toBe(0);
        });

        it("handles concurrent first-creation race by catching P2002 on create and re-locking winner's row", async () => {
            const winnerBalance: InventoryBalance = {
                id: "bal_winner_created",
                workspaceId: WS_ID,
                partId: PART_1.id,
                locationId: LOCATION_1.id,
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal(0),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const p2002Error = {
                code: "P2002",
                message:
                    "Unique constraint failed on the fields: (`workspaceId`,`partId`,`locationId`)",
            };

            const txMock: any = {
                $queryRaw: vi
                    .fn()
                    .mockResolvedValueOnce([]) // First select finds nothing
                    .mockResolvedValueOnce([winnerBalance]), // Re-select after losing create race finds winner's row
                inventoryBalance: {
                    create: vi.fn().mockRejectedValue(p2002Error),
                },
            };

            const result = await lockInventoryBalance(
                txMock,
                WS_ID,
                PART_1.id,
                LOCATION_1.id,
            );

            expect(txMock.inventoryBalance.create).toHaveBeenCalledTimes(1);
            expect(txMock.$queryRaw).toHaveBeenCalledTimes(2);
            expect(result).toBe(winnerBalance);
            expect(result.id).toBe("bal_winner_created");
            expect(result.quantityOnHand).toBeInstanceOf(Prisma.Decimal);
            expect(result.quantityOnHand.toNumber()).toBe(50);
        });
    });
});
