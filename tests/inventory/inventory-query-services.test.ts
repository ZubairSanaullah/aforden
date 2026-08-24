import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    partFindFirst: vi.fn(),
    partFindMany: vi.fn(),
    partCount: vi.fn(),
    inventoryLocationFindFirst: vi.fn(),
    inventoryLocationFindMany: vi.fn(),
    inventoryBalanceFindFirst: vi.fn(),
    inventoryBalanceFindMany: vi.fn(),
    inventoryBalanceCount: vi.fn(),
    stockMovementFindMany: vi.fn(),
    stockMovementCount: vi.fn(),
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
            findMany: mocks.partFindMany,
            count: mocks.partCount,
        },
        inventoryLocation: {
            findFirst: mocks.inventoryLocationFindFirst,
            findMany: mocks.inventoryLocationFindMany,
        },
        inventoryBalance: {
            findFirst: mocks.inventoryBalanceFindFirst,
            findMany: mocks.inventoryBalanceFindMany,
            count: mocks.inventoryBalanceCount,
        },
        stockMovement: {
            findMany: mocks.stockMovementFindMany,
            count: mocks.stockMovementCount,
        },
    },
}));

import { getParts as listParts } from "@/lib/services/inventory/part/getParts";
import { getInventoryBalances as listInventoryBalances } from "@/lib/services/inventory/balance/getInventoryBalances";
import { listStockMovements } from "@/lib/services/inventory/movement/listStockMovements";
import { listReservations } from "@/lib/services/inventory/balance/listReservations";
import { listTechnicianStock } from "@/lib/services/inventory/balance/listTechnicianStock";
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

describe("Phase 1.10.17 — Inventory & Parts Cross-Cutting Query Services", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];
    let locationsList: InventoryLocation[];
    let balancesList: InventoryBalance[];
    let movementsList: StockMovement[];

    const WS_ID = "ws_test_alpha";
    const WS_ID_BETA = "ws_test_beta";
    const TECH_PROFILE_ID = "tech_profile_123";

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

    const PART_1: Part = {
        id: "part_1",
        workspaceId: WS_ID,
        name: "Copper Pipe 1/2 in",
        sku: "PIPE-CU-050",
        description: "Standard copper pipe",
        unitOfMeasure: PartUnitOfMeasure.FOOT,
        unitCost: new Prisma.Decimal("15.50") as any,
        minimumStockLevel: new Prisma.Decimal("10.0000") as any,
        status: PartStatus.ACTIVE,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    const PART_2: Part = {
        id: "part_2",
        workspaceId: WS_ID,
        name: "PVC Elbow 90deg",
        sku: "PVC-ELB-090",
        description: "White PVC fitting",
        unitOfMeasure: PartUnitOfMeasure.EACH,
        unitCost: new Prisma.Decimal("2.25") as any,
        minimumStockLevel: new Prisma.Decimal("20.0000") as any,
        status: PartStatus.INACTIVE,
        createdAt: new Date("2026-01-02T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
    };

    const PART_BETA: Part = {
        id: "part_beta",
        workspaceId: WS_ID_BETA,
        name: "Beta Part",
        sku: "BETA-01",
        description: null,
        unitOfMeasure: PartUnitOfMeasure.EACH,
        unitCost: new Prisma.Decimal("10.00") as any,
        minimumStockLevel: null,
        status: PartStatus.ACTIVE,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    const LOCATION_WH: InventoryLocation = {
        id: "loc_wh",
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
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    const LOCATION_TECH_VAN: InventoryLocation = {
        id: "loc_tech_van",
        workspaceId: WS_ID,
        name: "Van 101 - Tech",
        code: "VAN-101",
        locationType: InventoryLocationType.VEHICLE,
        technicianProfileId: TECH_PROFILE_ID,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        notes: null,
        status: InventoryLocationStatus.ACTIVE,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    const LOCATION_BETA: InventoryLocation = {
        id: "loc_beta",
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
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        partsList = [PART_1, PART_2, PART_BETA];
        locationsList = [LOCATION_WH, LOCATION_TECH_VAN, LOCATION_BETA];
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

        // Default auth to Admin
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

        // Parts mock
        mocks.partFindMany.mockImplementation(
            async ({ where, skip = 0, take = 50 }: any) => {
                const filtered = partsList.filter((p) => {
                    if (where.workspaceId && p.workspaceId !== where.workspaceId)
                        return false;
                    if (where.status && p.status !== where.status) return false;
                    if (where.unitOfMeasure && p.unitOfMeasure !== where.unitOfMeasure)
                        return false;
                    if (where.OR) {
                        const searchStr = where.OR[0].name.contains.toLowerCase();
                        const matchName = p.name.toLowerCase().includes(searchStr);
                        const matchSku = p.sku?.toLowerCase().includes(searchStr);
                        const matchDesc = p.description
                            ?.toLowerCase()
                            .includes(searchStr);
                        if (!matchName && !matchSku && !matchDesc) return false;
                    }
                    return true;
                });
                return filtered.slice(skip, skip + take);
            },
        );

        mocks.partCount.mockImplementation(async ({ where }: any) => {
            return partsList.filter((p) => {
                if (where.workspaceId && p.workspaceId !== where.workspaceId)
                    return false;
                if (where.status && p.status !== where.status) return false;
                if (where.unitOfMeasure && p.unitOfMeasure !== where.unitOfMeasure)
                    return false;
                if (where.OR) {
                    const searchStr = where.OR[0].name.contains.toLowerCase();
                    const matchName = p.name.toLowerCase().includes(searchStr);
                    const matchSku = p.sku?.toLowerCase().includes(searchStr);
                    const matchDesc = p.description?.toLowerCase().includes(searchStr);
                    if (!matchName && !matchSku && !matchDesc) return false;
                }
                return true;
            }).length;
        });

        // InventoryLocation mock
        mocks.inventoryLocationFindMany.mockImplementation(
            async ({ where }: any) => {
                return locationsList.filter((loc) => {
                    if (where.workspaceId && loc.workspaceId !== where.workspaceId)
                        return false;
                    if (
                        where.technicianProfileId &&
                        loc.technicianProfileId !== where.technicianProfileId
                    )
                        return false;
                    return true;
                });
            },
        );

        // Balances mock
        mocks.inventoryBalanceFindMany.mockImplementation(
            async ({ where, skip = 0, take = 50 }: any) => {
                const filtered = balancesList.filter((b) => {
                    if (where.workspaceId && b.workspaceId !== where.workspaceId)
                        return false;
                    if (where.partId && b.partId !== where.partId) return false;
                    if (where.locationId) {
                        if (typeof where.locationId === "string") {
                            if (b.locationId !== where.locationId) return false;
                        } else if (where.locationId.in) {
                            if (!where.locationId.in.includes(b.locationId))
                                return false;
                        }
                    }
                    if (where.quantityReserved?.gt !== undefined) {
                        if (
                            Number(b.quantityReserved) <= where.quantityReserved.gt
                        )
                            return false;
                    }
                    return true;
                });
                return filtered.slice(skip, skip + take);
            },
        );

        mocks.inventoryBalanceCount.mockImplementation(
            async ({ where }: any) => {
                return balancesList.filter((b) => {
                    if (where.workspaceId && b.workspaceId !== where.workspaceId)
                        return false;
                    if (where.partId && b.partId !== where.partId) return false;
                    if (where.locationId) {
                        if (typeof where.locationId === "string") {
                            if (b.locationId !== where.locationId) return false;
                        } else if (where.locationId.in) {
                            if (!where.locationId.in.includes(b.locationId))
                                return false;
                        }
                    }
                    if (where.quantityReserved?.gt !== undefined) {
                        if (
                            Number(b.quantityReserved) <=
                            where.quantityReserved.gt
                        )
                            return false;
                    }
                    return true;
                }).length;
            },
        );

        // StockMovement mock
        mocks.stockMovementFindMany.mockImplementation(
            async ({ where, skip = 0, take = 50 }: any) => {
                const filtered = movementsList.filter((m) => {
                    if (where.workspaceId && m.workspaceId !== where.workspaceId)
                        return false;
                    if (where.partId && m.partId !== where.partId) return false;
                    if (where.movementType && m.movementType !== where.movementType)
                        return false;
                    if (where.workOrderId && m.workOrderId !== where.workOrderId)
                        return false;
                    if (
                        where.originalWorkOrderPartId &&
                        m.originalWorkOrderPartId !== where.originalWorkOrderPartId
                    )
                        return false;
                    if (
                        where.actorMemberId &&
                        m.actorMemberId !== where.actorMemberId
                    )
                        return false;
                    if (where.OR) {
                        const locId = where.OR[0].locationId;
                        if (
                            m.locationId !== locId &&
                            m.fromLocationId !== locId &&
                            m.toLocationId !== locId
                        )
                            return false;
                    }
                    if (where.createdAt) {
                        if (
                            where.createdAt.gte &&
                            m.createdAt < where.createdAt.gte
                        )
                            return false;
                        if (
                            where.createdAt.lte &&
                            m.createdAt > where.createdAt.lte
                        )
                            return false;
                    }
                    return true;
                });
                return filtered.slice(skip, skip + take);
            },
        );

        mocks.stockMovementCount.mockImplementation(
            async ({ where }: any) => {
                return movementsList.filter((m) => {
                    if (where.workspaceId && m.workspaceId !== where.workspaceId)
                        return false;
                    if (where.partId && m.partId !== where.partId) return false;
                    if (where.movementType && m.movementType !== where.movementType)
                        return false;
                    if (where.workOrderId && m.workOrderId !== where.workOrderId)
                        return false;
                    if (
                        where.originalWorkOrderPartId &&
                        m.originalWorkOrderPartId !== where.originalWorkOrderPartId
                    )
                        return false;
                    if (
                        where.actorMemberId &&
                        m.actorMemberId !== where.actorMemberId
                    )
                        return false;
                    if (where.OR) {
                        const locId = where.OR[0].locationId;
                        if (
                            m.locationId !== locId &&
                            m.fromLocationId !== locId &&
                            m.toLocationId !== locId
                        )
                            return false;
                    }
                    if (where.createdAt) {
                        if (
                            where.createdAt.gte &&
                            m.createdAt < where.createdAt.gte
                        )
                            return false;
                        if (
                            where.createdAt.lte &&
                            m.createdAt > where.createdAt.lte
                        )
                            return false;
                    }
                    return true;
                }).length;
            },
        );
    });

    describe("1. listParts Query Service", () => {
        it("returns paginated list of parts with status and search filters", async () => {
            const result = await listParts(WS_ID, {
                status: "ACTIVE",
                search: "copper",
            });

            expect(result.pagination.total).toBe(1);
            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("part_1");
            expect(result.items[0].name).toBe("Copper Pipe 1/2 in");
        });

        it("enforces tenant isolation — excludes foreign workspace parts", async () => {
            const result = await listParts(WS_ID);
            expect(result.items.some((p) => p.workspaceId === WS_ID_BETA)).toBe(
                false,
            );
        });

        it("returns empty items array when no parts match filter", async () => {
            const result = await listParts(WS_ID, { search: "nonexistent" });
            expect(result.items).toEqual([]);
            expect(result.pagination.total).toBe(0);
        });
    });

    describe("2. listInventoryBalances Query Service", () => {
        it("returns paginated balances with computed quantityAvailable", async () => {
            balancesList.push({
                id: "bal_1",
                workspaceId: WS_ID,
                partId: "part_1",
                locationId: "loc_wh",
                quantityOnHand: new Prisma.Decimal("50.0000"),
                quantityReserved: new Prisma.Decimal("15.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await listInventoryBalances(WS_ID, {
                partId: "part_1",
                locationId: "loc_wh",
            });

            expect(result.pagination.total).toBe(1);
            expect(result.items[0].quantityOnHand).toBe(50);
            expect(result.items[0].quantityReserved).toBe(15);
            expect(result.items[0].quantityAvailable).toBe(35); // 50 - 15
        });

        it("enforces tenant isolation — excludes foreign balances", async () => {
            balancesList.push({
                id: "bal_beta",
                workspaceId: WS_ID_BETA,
                partId: "part_beta",
                locationId: "loc_beta",
                quantityOnHand: new Prisma.Decimal("100.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await listInventoryBalances(WS_ID);
            expect(result.items.some((b) => b.workspaceId === WS_ID_BETA)).toBe(
                false,
            );
        });
    });

    describe("3. listStockMovements Ledger Query Service", () => {
        it("returns paginated ledger entries filtered by movementType, partId, and locationId", async () => {
            movementsList.push(
                {
                    id: "mov_1",
                    workspaceId: WS_ID,
                    partId: "part_1",
                    locationId: "loc_wh",
                    movementType: StockMovementType.RECEIPT,
                    quantity: new Prisma.Decimal("50.0000"),
                    fromLocationId: null,
                    toLocationId: null,
                    workOrderId: null,
                    originalWorkOrderPartId: null,
                    unitCostSnapshot: new Prisma.Decimal("15.50"),
                    reason: "Initial receipt",
                    referenceNumber: "PO-100",
                    actorMemberId: "mem_admin_1",
                    createdAt: new Date("2026-01-10T10:00:00Z"),
                },
                {
                    id: "mov_2",
                    workspaceId: WS_ID,
                    partId: "part_1",
                    locationId: "loc_wh",
                    movementType: StockMovementType.CONSUMPTION,
                    quantity: new Prisma.Decimal("5.0000"),
                    fromLocationId: null,
                    toLocationId: null,
                    workOrderId: "wo_101",
                    originalWorkOrderPartId: "wop_1",
                    unitCostSnapshot: new Prisma.Decimal("15.50"),
                    reason: null,
                    referenceNumber: null,
                    actorMemberId: "mem_tech_1",
                    createdAt: new Date("2026-01-15T10:00:00Z"),
                },
            );

            const result = await listStockMovements(WS_ID, {
                partId: "part_1",
                movementType: StockMovementType.CONSUMPTION,
            });

            expect(result.pagination.total).toBe(1);
            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("mov_2");
            expect(result.items[0].movementType).toBe(
                StockMovementType.CONSUMPTION,
            );
            expect(result.items[0].workOrderId).toBe("wo_101");
        });

        it("filters stock movements by date range", async () => {
            movementsList.push({
                id: "mov_jan",
                workspaceId: WS_ID,
                partId: "part_1",
                locationId: "loc_wh",
                movementType: StockMovementType.RECEIPT,
                quantity: new Prisma.Decimal("10.0000"),
                fromLocationId: null,
                toLocationId: null,
                workOrderId: null,
                originalWorkOrderPartId: null,
                unitCostSnapshot: null,
                reason: null,
                referenceNumber: null,
                actorMemberId: null,
                createdAt: new Date("2026-01-05T00:00:00Z"),
            });

            const result = await listStockMovements(WS_ID, {
                startDate: new Date("2026-01-01T00:00:00Z"),
                endDate: new Date("2026-01-10T00:00:00Z"),
            });

            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("mov_jan");
        });

        it("enforces tenant isolation on stock movements", async () => {
            movementsList.push({
                id: "mov_beta",
                workspaceId: WS_ID_BETA,
                partId: "part_beta",
                locationId: "loc_beta",
                movementType: StockMovementType.RECEIPT,
                quantity: new Prisma.Decimal("10.0000"),
                fromLocationId: null,
                toLocationId: null,
                workOrderId: null,
                originalWorkOrderPartId: null,
                unitCostSnapshot: null,
                reason: null,
                referenceNumber: null,
                actorMemberId: null,
                createdAt: new Date(),
            });

            const result = await listStockMovements(WS_ID);
            expect(result.items.some((m) => m.workspaceId === WS_ID_BETA)).toBe(
                false,
            );
        });
    });

    describe("4. listReservations Query Service", () => {
        it("returns only balances where quantityReserved > 0", async () => {
            balancesList.push(
                {
                    id: "bal_reserved",
                    workspaceId: WS_ID,
                    partId: "part_1",
                    locationId: "loc_wh",
                    quantityOnHand: new Prisma.Decimal("100.0000"),
                    quantityReserved: new Prisma.Decimal("25.0000"), // Active reservation
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_unreserved",
                    workspaceId: WS_ID,
                    partId: "part_2",
                    locationId: "loc_wh",
                    quantityOnHand: new Prisma.Decimal("50.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"), // No reservation
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const result = await listReservations(WS_ID);

            expect(result.pagination.total).toBe(1);
            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("bal_reserved");
            expect(result.items[0].quantityReserved).toBe(25);
            expect(result.items[0].quantityAvailable).toBe(75);
        });

        it("returns empty items array when all reservations are 0", async () => {
            balancesList.push({
                id: "bal_zero_res",
                workspaceId: WS_ID,
                partId: "part_1",
                locationId: "loc_wh",
                quantityOnHand: new Prisma.Decimal("100.0000"),
                quantityReserved: new Prisma.Decimal("0.0000"),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await listReservations(WS_ID);
            expect(result.items).toEqual([]);
            expect(result.pagination.total).toBe(0);
        });

        it("enforces tenant isolation — excludes foreign reservations with quantityReserved > 0", async () => {
            balancesList.push(
                {
                    id: "bal_alpha_res",
                    workspaceId: WS_ID,
                    partId: "part_1",
                    locationId: "loc_wh",
                    quantityOnHand: new Prisma.Decimal("100.0000"),
                    quantityReserved: new Prisma.Decimal("10.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_beta_res",
                    workspaceId: WS_ID_BETA,
                    partId: "part_beta",
                    locationId: "loc_beta",
                    quantityOnHand: new Prisma.Decimal("200.0000"),
                    quantityReserved: new Prisma.Decimal("50.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const result = await listReservations(WS_ID);

            expect(result.pagination.total).toBe(1);
            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("bal_alpha_res");
            expect(result.items.some((b) => b.workspaceId === WS_ID_BETA)).toBe(false);
        });
    });

    describe("5. listTechnicianStock Query Service", () => {
        it("returns balances scoped to technician-assigned InventoryLocations", async () => {
            balancesList.push(
                {
                    id: "bal_van_stock",
                    workspaceId: WS_ID,
                    partId: "part_1",
                    locationId: "loc_tech_van", // Assigned to TECH_PROFILE_ID
                    quantityOnHand: new Prisma.Decimal("12.0000"),
                    quantityReserved: new Prisma.Decimal("2.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_warehouse_stock",
                    workspaceId: WS_ID,
                    partId: "part_1",
                    locationId: "loc_wh", // Warehouse (not tech van)
                    quantityOnHand: new Prisma.Decimal("200.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const result = await listTechnicianStock(WS_ID, TECH_PROFILE_ID);

            expect(result.pagination.total).toBe(1);
            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("bal_van_stock");
            expect(result.items[0].locationId).toBe("loc_tech_van");
            expect(result.items[0].quantityOnHand).toBe(12);
            expect(result.items[0].quantityAvailable).toBe(10);
        });

        it("enforces tenant isolation — excludes foreign technician locations with matching technicianProfileId", async () => {
            const LOCATION_TECH_VAN_BETA: InventoryLocation = {
                id: "loc_tech_van_beta",
                workspaceId: WS_ID_BETA,
                name: "Beta Van 101",
                code: "VAN-BETA-101",
                locationType: InventoryLocationType.VEHICLE,
                technicianProfileId: TECH_PROFILE_ID,
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
            locationsList.push(LOCATION_TECH_VAN_BETA);

            balancesList.push(
                {
                    id: "bal_alpha_van",
                    workspaceId: WS_ID,
                    partId: "part_1",
                    locationId: "loc_tech_van",
                    quantityOnHand: new Prisma.Decimal("10.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "bal_beta_van",
                    workspaceId: WS_ID_BETA,
                    partId: "part_beta",
                    locationId: "loc_tech_van_beta",
                    quantityOnHand: new Prisma.Decimal("99.0000"),
                    quantityReserved: new Prisma.Decimal("0.0000"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const result = await listTechnicianStock(WS_ID, TECH_PROFILE_ID);

            expect(result.pagination.total).toBe(1);
            expect(result.items.length).toBe(1);
            expect(result.items[0].id).toBe("bal_alpha_van");
            expect(result.items.some((b) => b.workspaceId === WS_ID_BETA)).toBe(false);
        });

        it("returns empty result when technician has no assigned locations", async () => {
            const result = await listTechnicianStock(
                WS_ID,
                "unassigned_tech_profile",
            );
            expect(result.items).toEqual([]);
            expect(result.pagination.total).toBe(0);
        });
    });

    describe("RBAC & Authentication Enforcement on Queries", () => {
        it("allows TECHNICIAN role to query stock and movements (INVENTORY_VIEW / PARTS_VIEW)", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            const result = await listParts(WS_ID);
            expect(result.items.length).toBeGreaterThanOrEqual(1);
        });

        it("denies unauthenticated caller from querying inventory services", async () => {
            mocks.auth.mockResolvedValueOnce(null);
            await expect(listStockMovements(WS_ID)).rejects.toThrow(
                UnauthorizedError,
            );
        });
    });
});
