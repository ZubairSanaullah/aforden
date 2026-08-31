import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    partFindFirst: vi.fn(),
    partFindMany: vi.fn(),
    partCount: vi.fn(),
    partCreate: vi.fn(),
    partUpdate: vi.fn(),
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
            create: mocks.partCreate,
            update: mocks.partUpdate,
        },
    },
}));

import { createPart } from "@/lib/services/inventory/part/createPart";
import { getPart } from "@/lib/services/inventory/part/getPart";
import { getParts } from "@/lib/services/inventory/part/getParts";
import { updatePart } from "@/lib/services/inventory/part/updatePart";
import { transitionPartStatus } from "@/lib/services/inventory/part/transitionPartStatus";
import {
    PartNotFoundError,
    DuplicatePartNameError,
    DuplicatePartSkuError,
} from "@/lib/services/inventory/part/partErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import {
    PartStatus,
    PartUnitOfMeasure,
    type Part,
    type User,
    type Workspace,
    type WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.10.4 — Part Catalog Service Unit Tests", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let partsList: Part[];

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

    const USER_MANAGER: User = {
        id: "user_manager_1",
        name: "Manager User",
        email: "manager@test.com",
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
        name: "Tech User",
        email: "tech@test.com",
        platformRole: null,
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
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        partsList = [];

        usersMap.set(USER_ADMIN.id, USER_ADMIN);
        usersMap.set(USER_MANAGER.id, USER_MANAGER);
        usersMap.set(USER_TECH.id, USER_TECH);
        usersMap.set(USER_DISPATCHER.id, USER_DISPATCHER);

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
        const memTech: WorkspaceMember = {
            id: "mem_tech_1",
            workspaceId: WS_ID,
            userId: USER_TECH.id,
            role: "TECHNICIAN",
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

        membersMap.set(`${WS_ID}:${USER_ADMIN.id}`, memAdmin);
        membersMap.set(`${WS_ID}:${USER_MANAGER.id}`, memManager);
        membersMap.set(`${WS_ID}:${USER_TECH.id}`, memTech);
        membersMap.set(`${WS_ID}:${USER_DISPATCHER.id}`, memDispatcher);

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
                    if (typeof where.id === "string" && p.id !== where.id)
                        return false;
                    if (where.id?.not && p.id === where.id.not) return false;
                    if (where.name && p.name !== where.name) return false;
                    if (where.sku && p.sku !== where.sku) return false;
                    return true;
                }) ?? null
            );
        });

        mocks.partFindMany.mockImplementation(
            async ({ where, skip, take }: any) => {
                let res = partsList.filter((p) => {
                    if (
                        where.workspaceId &&
                        p.workspaceId !== where.workspaceId
                    )
                        return false;
                    if (where.status && p.status !== where.status) return false;
                    if (
                        where.unitOfMeasure &&
                        p.unitOfMeasure !== where.unitOfMeasure
                    )
                        return false;
                    if (where.OR && Array.isArray(where.OR)) {
                        const match = where.OR.some((clause: any) => {
                            if (clause.name?.contains) {
                                return p.name
                                    .toLowerCase()
                                    .includes(clause.name.contains.toLowerCase());
                            }
                            if (clause.sku?.contains) {
                                return (p.sku ?? "")
                                    .toLowerCase()
                                    .includes(clause.sku.contains.toLowerCase());
                            }
                            if (clause.description?.contains) {
                                return (p.description ?? "")
                                    .toLowerCase()
                                    .includes(
                                        clause.description.contains.toLowerCase(),
                                    );
                            }
                            return false;
                        });
                        if (!match) return false;
                    }
                    return true;
                });
                if (skip !== undefined && take !== undefined) {
                    res = res.slice(skip, skip + take);
                }
                return res;
            },
        );

        mocks.partCount.mockImplementation(async ({ where }: any) => {
            const items = await mocks.partFindMany({ where });
            return items.length;
        });

        mocks.partCreate.mockImplementation(async ({ data }: any) => {
            const newPart: Part = {
                id: `part_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                workspaceId: data.workspaceId,
                name: data.name,
                sku: data.sku ?? null,
                description: data.description ?? null,
                unitOfMeasure: data.unitOfMeasure ?? PartUnitOfMeasure.EACH,
                unitCost:
                    data.unitCost !== null && data.unitCost !== undefined
                        ? (data.unitCost as any)
                        : null,
                minimumStockLevel:
                    data.minimumStockLevel !== null &&
                    data.minimumStockLevel !== undefined
                        ? (data.minimumStockLevel as any)
                        : null,
                status: data.status ?? PartStatus.ACTIVE,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            partsList.push(newPart);
            return newPart;
        });

        mocks.partUpdate.mockImplementation(async ({ where, data }: any) => {
            const idx = partsList.findIndex(
                (p) =>
                    p.id === where.id &&
                    (where.workspaceId ? p.workspaceId === where.workspaceId : true),
            );
            if (idx === -1) throw new Error("Record not found");
            const existing = partsList[idx];
            const updated: Part = {
                ...existing,
                ...data,
                updatedAt: new Date(),
            };
            partsList[idx] = updated;
            return updated;
        });
    });

    describe("createPart", () => {
        it("successfully creates a part with all fields", async () => {
            const result = await createPart(WS_ID, {
                name: "HVAC Contactor 24V",
                sku: "CON-24V-30A",
                description: "Single pole 30A contactor",
                unitOfMeasure: PartUnitOfMeasure.EACH,
                unitCost: 24.5,
                minimumStockLevel: 10,
            });

            expect(result.id).toBeDefined();
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.name).toBe("HVAC Contactor 24V");
            expect(result.sku).toBe("CON-24V-30A");
            expect(result.description).toBe("Single pole 30A contactor");
            expect(result.unitOfMeasure).toBe(PartUnitOfMeasure.EACH);
            expect(result.unitCost).toBe(24.5);
            expect(result.minimumStockLevel).toBe(10);
            expect(result.status).toBe(PartStatus.ACTIVE);
            expect(result.createdAt).toBeInstanceOf(Date);
        });

        it("defaults status to ACTIVE and null fields properly", async () => {
            const result = await createPart(WS_ID, {
                name: "Universal Wire Nut",
            });

            expect(result.name).toBe("Universal Wire Nut");
            expect(result.sku).toBeNull();
            expect(result.unitOfMeasure).toBe(PartUnitOfMeasure.EACH);
            expect(result.unitCost).toBeNull();
            expect(result.minimumStockLevel).toBeNull();
            expect(result.status).toBe(PartStatus.ACTIVE);
        });

        it("throws DuplicatePartNameError when part name exists in same workspace", async () => {
            await createPart(WS_ID, {
                name: "Capacitor 45uF",
                sku: "CAP-45",
            });

            await expect(
                createPart(WS_ID, {
                    name: "Capacitor 45uF",
                    sku: "CAP-45-DIFF",
                }),
            ).rejects.toThrow(DuplicatePartNameError);
        });

        it("throws DuplicatePartSkuError when part SKU exists in same workspace", async () => {
            await createPart(WS_ID, {
                name: "Capacitor 45uF Brand A",
                sku: "CAP-45",
            });

            await expect(
                createPart(WS_ID, {
                    name: "Capacitor 45uF Brand B",
                    sku: "CAP-45",
                }),
            ).rejects.toThrow(DuplicatePartSkuError);
        });

        it("allows same part name or SKU in different workspaces", async () => {
            // Seed Admin in Beta
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const p1 = await createPart(WS_ID, {
                name: "Universal Thermostat",
                sku: "TSTAT-UNIV",
            });
            const p2 = await createPart(WS_ID_BETA, {
                name: "Universal Thermostat",
                sku: "TSTAT-UNIV",
            });

            expect(p1.workspaceId).toBe(WS_ID);
            expect(p2.workspaceId).toBe(WS_ID_BETA);
            expect(p1.id).not.toBe(p2.id);
        });

        it("catches Prisma P2002 duplicate collision and maps to domain error", async () => {
            mocks.partCreate.mockRejectedValueOnce({
                code: "P2002",
                meta: { target: ["workspaceId", "sku"] },
            });

            await expect(
                createPart(WS_ID, {
                    name: "Unique Name",
                    sku: "COLLISION-SKU",
                }),
            ).rejects.toThrow(DuplicatePartSkuError);

            mocks.partCreate.mockRejectedValueOnce({
                code: "P2002",
                meta: { target: ["workspaceId", "name"] },
            });

            await expect(
                createPart(WS_ID, {
                    name: "Collision Name",
                }),
            ).rejects.toThrow(DuplicatePartNameError);
        });

        it("enforces RBAC — allows Manager role to create parts", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_MANAGER.id, email: USER_MANAGER.email },
            });

            const result = await createPart(WS_ID, {
                name: "Manager Created Part",
            });

            expect(result.name).toBe("Manager Created Part");
        });

        it("enforces RBAC — denies creation for technician role", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                createPart(WS_ID, {
                    name: "Technician Part Attempt",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("enforces RBAC — denies creation for dispatcher role", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_DISPATCHER.id, email: USER_DISPATCHER.email },
            });

            await expect(
                createPart(WS_ID, {
                    name: "Dispatcher Part Attempt",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("enforces authentication — denies when unauthenticated", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                createPart(WS_ID, {
                    name: "Unauthenticated Part Attempt",
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });

    describe("getPart", () => {
        it("retrieves an existing part by ID", async () => {
            const created = await createPart(WS_ID, {
                name: "Furnace Filter 16x25x1",
                sku: "FILT-16251",
                unitCost: 8.5,
            });

            const fetched = await getPart(WS_ID, created.id);
            expect(fetched.id).toBe(created.id);
            expect(fetched.name).toBe("Furnace Filter 16x25x1");
            expect(fetched.unitCost).toBe(8.5);
        });

        it("throws PartNotFoundError if part does not exist", async () => {
            await expect(getPart(WS_ID, "non_existent_id")).rejects.toThrow(
                PartNotFoundError,
            );
        });

        it("enforces tenant isolation — throws PartNotFoundError if part is in another workspace", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const betaPart = await createPart(WS_ID_BETA, {
                name: "Beta Only Part",
            });

            await expect(getPart(WS_ID, betaPart.id)).rejects.toThrow(
                PartNotFoundError,
            );
        });

        it("enforces RBAC — allows Technician role to view parts", async () => {
            const created = await createPart(WS_ID, {
                name: "Viewable Part",
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            const fetched = await getPart(WS_ID, created.id);
            expect(fetched.id).toBe(created.id);
        });
    });

    describe("getParts", () => {
        beforeEach(async () => {
            const p1 = await createPart(WS_ID, {
                name: "Air Filter MERV 8",
                sku: "FILT-M8",
                unitOfMeasure: PartUnitOfMeasure.BOX,
                unitCost: 12.0,
            });
            const p2 = await createPart(WS_ID, {
                name: "Air Filter MERV 11",
                sku: "FILT-M11",
                unitOfMeasure: PartUnitOfMeasure.BOX,
                unitCost: 18.0,
            });
            const p3 = await createPart(WS_ID, {
                name: "Discontinued Blower Motor",
                sku: "BLOW-OLD",
                unitOfMeasure: PartUnitOfMeasure.EACH,
                unitCost: 150.0,
            });
            await transitionPartStatus(WS_ID, p3.id, {
                status: PartStatus.INACTIVE,
            });
        });

        it("returns all parts with default pagination", async () => {
            const res = await getParts(WS_ID);
            expect(res.items.length).toBe(3);
            expect(res.pagination.total).toBe(3);
            expect(res.pagination.page).toBe(1);
            expect(res.pagination.totalPages).toBe(1);
        });

        it("filters by status", async () => {
            const activeRes = await getParts(WS_ID, {
                status: PartStatus.ACTIVE,
            });
            expect(activeRes.items.length).toBe(2);

            const inactiveRes = await getParts(WS_ID, {
                status: PartStatus.INACTIVE,
            });
            expect(inactiveRes.items.length).toBe(1);
            expect(inactiveRes.items[0].name).toBe("Discontinued Blower Motor");
        });

        it("filters by unit of measure", async () => {
            const boxRes = await getParts(WS_ID, {
                unitOfMeasure: PartUnitOfMeasure.BOX,
            });
            expect(boxRes.items.length).toBe(2);
        });

        it("searches by keyword", async () => {
            const searchRes = await getParts(WS_ID, {
                search: "MERV 11",
            });
            expect(searchRes.items.length).toBe(1);
            expect(searchRes.items[0].sku).toBe("FILT-M11");
        });

        it("enforces tenant isolation — does not return parts from other workspaces", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await createPart(WS_ID_BETA, {
                name: "Beta Isolated Part",
            });

            const alphaList = await getParts(WS_ID);
            expect(
                alphaList.items.some((p) => p.name === "Beta Isolated Part"),
            ).toBe(false);
        });
    });

    describe("updatePart", () => {
        it("updates part attributes successfully", async () => {
            const created = await createPart(WS_ID, {
                name: "Original Name",
                sku: "ORIG-SKU",
                unitCost: 10.0,
            });

            const updated = await updatePart(WS_ID, created.id, {
                name: "Updated Name",
                unitCost: 14.5,
            });

            expect(updated.id).toBe(created.id);
            expect(updated.name).toBe("Updated Name");
            expect(updated.sku).toBe("ORIG-SKU");
            expect(updated.unitCost).toBe(14.5);
        });

        it("throws DuplicatePartNameError if updated name collides with another part", async () => {
            await createPart(WS_ID, {
                name: "Part Alpha",
                sku: "SKU-A",
            });
            const partB = await createPart(WS_ID, {
                name: "Part Beta",
                sku: "SKU-B",
            });

            await expect(
                updatePart(WS_ID, partB.id, {
                    name: "Part Alpha",
                }),
            ).rejects.toThrow(DuplicatePartNameError);
        });

        it("throws DuplicatePartSkuError if updated SKU collides with another part", async () => {
            await createPart(WS_ID, {
                name: "Part Alpha",
                sku: "SKU-A",
            });
            const partB = await createPart(WS_ID, {
                name: "Part Beta",
                sku: "SKU-B",
            });

            await expect(
                updatePart(WS_ID, partB.id, {
                    sku: "SKU-A",
                }),
            ).rejects.toThrow(DuplicatePartSkuError);
        });

        it("throws PartNotFoundError for non-existent part update", async () => {
            await expect(
                updatePart(WS_ID, "missing_part_id", {
                    name: "New Name",
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation — throws PartNotFoundError if updating part in another workspace", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const betaPart = await createPart(WS_ID_BETA, {
                name: "Beta Part To Update",
            });

            await expect(
                updatePart(WS_ID, betaPart.id, {
                    name: "Attempted Alpha Update",
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces RBAC — denies update for technician role", async () => {
            const created = await createPart(WS_ID, {
                name: "Part For Tech Update Attempt",
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                updatePart(WS_ID, created.id, {
                    name: "Tech Modified Name",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows keeping existing name and SKU on update without collision error", async () => {
            const created = await createPart(WS_ID, {
                name: "Stable Part",
                sku: "STABLE-SKU",
                unitCost: 5.0,
            });

            const updated = await updatePart(WS_ID, created.id, {
                name: "Stable Part",
                sku: "STABLE-SKU",
                unitCost: 7.5,
            });

            expect(updated.unitCost).toBe(7.5);
        });
    });

    describe("transitionPartStatus", () => {
        it("transitions an ACTIVE part to INACTIVE", async () => {
            const created = await createPart(WS_ID, {
                name: "Part To Deactivate",
            });
            expect(created.status).toBe(PartStatus.ACTIVE);

            const transitioned = await transitionPartStatus(WS_ID, created.id, {
                status: PartStatus.INACTIVE,
            });

            expect(transitioned.status).toBe(PartStatus.INACTIVE);
        });

        it("transitions an INACTIVE part back to ACTIVE", async () => {
            const created = await createPart(WS_ID, {
                name: "Part To Reactivate",
            });
            await transitionPartStatus(WS_ID, created.id, {
                status: PartStatus.INACTIVE,
            });

            const transitioned = await transitionPartStatus(WS_ID, created.id, {
                status: PartStatus.ACTIVE,
            });

            expect(transitioned.status).toBe(PartStatus.ACTIVE);
        });

        it("handles idempotent transition cleanly without throwing error", async () => {
            const created = await createPart(WS_ID, {
                name: "Already Active Part",
            });

            const result = await transitionPartStatus(WS_ID, created.id, {
                status: PartStatus.ACTIVE,
            });

            expect(result.status).toBe(PartStatus.ACTIVE);
            expect(result.id).toBe(created.id);
        });

        it("throws PartNotFoundError when target part does not exist", async () => {
            await expect(
                transitionPartStatus(WS_ID, "non_existent_part", {
                    status: PartStatus.INACTIVE,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces tenant isolation — throws PartNotFoundError if transitioning part in another workspace", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const betaPart = await createPart(WS_ID_BETA, {
                name: "Beta Part For Transition",
            });

            await expect(
                transitionPartStatus(WS_ID, betaPart.id, {
                    status: PartStatus.INACTIVE,
                }),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("enforces RBAC — denies status transition for technician role", async () => {
            const created = await createPart(WS_ID, {
                name: "Part For Tech Transition Attempt",
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                transitionPartStatus(WS_ID, created.id, {
                    status: PartStatus.INACTIVE,
                }),
            ).rejects.toThrow(ForbiddenError);
        });
    });
});
