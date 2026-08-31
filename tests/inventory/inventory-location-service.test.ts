import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    technicianProfileFindFirst: vi.fn(),
    inventoryLocationFindFirst: vi.fn(),
    inventoryLocationFindMany: vi.fn(),
    inventoryLocationCount: vi.fn(),
    inventoryLocationCreate: vi.fn(),
    inventoryLocationUpdate: vi.fn(),
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
        technicianProfile: {
            findFirst: mocks.technicianProfileFindFirst,
        },
        inventoryLocation: {
            findFirst: mocks.inventoryLocationFindFirst,
            findMany: mocks.inventoryLocationFindMany,
            count: mocks.inventoryLocationCount,
            create: mocks.inventoryLocationCreate,
            update: mocks.inventoryLocationUpdate,
        },
    },
}));

import { createInventoryLocation } from "@/lib/services/inventory/inventoryLocation/createInventoryLocation";
import { getInventoryLocation } from "@/lib/services/inventory/inventoryLocation/getInventoryLocation";
import { getInventoryLocations } from "@/lib/services/inventory/inventoryLocation/getInventoryLocations";
import { updateInventoryLocation } from "@/lib/services/inventory/inventoryLocation/updateInventoryLocation";
import { transitionInventoryLocationStatus } from "@/lib/services/inventory/inventoryLocation/transitionInventoryLocationStatus";
import {
    InventoryLocationNotFoundError,
    DuplicateInventoryLocationError,
    TechnicianStockLocationAlreadyExistsError,
} from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";
import { TechnicianProfileNotFoundError } from "@/lib/services/technicianProfile/technicianProfileErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import {
    InventoryLocationStatus,
    InventoryLocationType,
    type InventoryLocation,
    type TechnicianProfile,
    type User,
    type Workspace,
    type WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.10.5 — InventoryLocation Service Unit Tests", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let techProfilesList: TechnicianProfile[];
    let locationsList: InventoryLocation[];

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

    const TECH_PROFILE_1: TechnicianProfile = {
        id: "tech_prof_1",
        employeeId: "emp_1",
        licenseNumber: "LIC-123",
        yearsExperience: 5,
        emergencyContact: "555-1234",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const TECH_PROFILE_2: TechnicianProfile = {
        id: "tech_prof_2",
        employeeId: "emp_2",
        licenseNumber: null,
        yearsExperience: 2,
        emergencyContact: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const TECH_PROFILE_BETA: TechnicianProfile = {
        id: "tech_prof_beta",
        employeeId: "emp_beta",
        licenseNumber: null,
        yearsExperience: 3,
        emergencyContact: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        techProfilesList = [TECH_PROFILE_1, TECH_PROFILE_2, TECH_PROFILE_BETA];
        locationsList = [];

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

        const techWorkspaceMap = new Map<string, string>([
            ["tech_prof_1", WS_ID],
            ["tech_prof_2", WS_ID],
            ["tech_prof_beta", WS_ID_BETA],
        ]);

        mocks.technicianProfileFindFirst.mockImplementation(
            async ({ where }: any) => {
                return (
                    techProfilesList.find((tp) => {
                        const targetWs = where.employee?.workspaceId;
                        if (targetWs && techWorkspaceMap.get(tp.id) !== targetWs)
                            return false;
                        if (where.id && tp.id !== where.id) return false;
                        return true;
                    }) ?? null
                );
            },
        );

        mocks.inventoryLocationFindFirst.mockImplementation(
            async ({ where }: any) => {
                return (
                    locationsList.find((loc) => {
                        if (
                            where.workspaceId &&
                            loc.workspaceId !== where.workspaceId
                        )
                            return false;
                        if (typeof where.id === "string" && loc.id !== where.id)
                            return false;
                        if (where.id?.not && loc.id === where.id.not)
                            return false;
                        if (where.name && loc.name !== where.name) return false;
                        if (where.code && loc.code !== where.code) return false;
                        if (
                            where.locationType &&
                            loc.locationType !== where.locationType
                        )
                            return false;
                        if (
                            where.technicianProfileId &&
                            loc.technicianProfileId !== where.technicianProfileId
                        )
                            return false;
                        if (where.status && loc.status !== where.status)
                            return false;
                        return true;
                    }) ?? null
                );
            },
        );

        mocks.inventoryLocationFindMany.mockImplementation(
            async ({ where, skip, take }: any) => {
                let res = locationsList.filter((loc) => {
                    if (
                        where.workspaceId &&
                        loc.workspaceId !== where.workspaceId
                    )
                        return false;
                    if (where.status && loc.status !== where.status) return false;
                    if (
                        where.locationType &&
                        loc.locationType !== where.locationType
                    )
                        return false;
                    if (
                        where.technicianProfileId &&
                        loc.technicianProfileId !== where.technicianProfileId
                    )
                        return false;
                    if (where.OR && Array.isArray(where.OR)) {
                        const match = where.OR.some((clause: any) => {
                            if (clause.name?.contains) {
                                return loc.name
                                    .toLowerCase()
                                    .includes(clause.name.contains.toLowerCase());
                            }
                            if (clause.code?.contains) {
                                return (loc.code ?? "")
                                    .toLowerCase()
                                    .includes(clause.code.contains.toLowerCase());
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

        mocks.inventoryLocationCount.mockImplementation(
            async ({ where }: any) => {
                const items = await mocks.inventoryLocationFindMany({ where });
                return items.length;
            },
        );

        mocks.inventoryLocationCreate.mockImplementation(
            async ({ data }: any) => {
                const newLoc: InventoryLocation = {
                    id: `loc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    workspaceId: data.workspaceId,
                    name: data.name,
                    code: data.code ?? null,
                    locationType: data.locationType ?? InventoryLocationType.WAREHOUSE,
                    technicianProfileId: data.technicianProfileId ?? null,
                    addressLine1: data.addressLine1 ?? null,
                    addressLine2: data.addressLine2 ?? null,
                    city: data.city ?? null,
                    state: data.state ?? null,
                    postalCode: data.postalCode ?? null,
                    country: data.country ?? null,
                    notes: data.notes ?? null,
                    status: data.status ?? InventoryLocationStatus.ACTIVE,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                locationsList.push(newLoc);
                return newLoc;
            },
        );

        mocks.inventoryLocationUpdate.mockImplementation(
            async ({ where, data }: any) => {
                const idx = locationsList.findIndex(
                    (loc) =>
                        loc.id === where.id &&
                        (where.workspaceId
                            ? loc.workspaceId === where.workspaceId
                            : true),
                );
                if (idx === -1) throw new Error("Record not found");
                const existing = locationsList[idx];
                const updated: InventoryLocation = {
                    ...existing,
                    ...data,
                    updatedAt: new Date(),
                };
                locationsList[idx] = updated;
                return updated;
            },
        );
    });

    describe("createInventoryLocation", () => {
        it("successfully creates a location with all fields", async () => {
            const result = await createInventoryLocation(WS_ID, {
                name: "North Hub Warehouse",
                code: "WH-NORTH",
                locationType: InventoryLocationType.WAREHOUSE,
                addressLine1: "100 Warehouse Way",
                city: "Dallas",
                state: "TX",
                postalCode: "75201",
                country: "USA",
                notes: "Primary regional hub",
            });

            expect(result.id).toBeDefined();
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.name).toBe("North Hub Warehouse");
            expect(result.code).toBe("WH-NORTH");
            expect(result.locationType).toBe(InventoryLocationType.WAREHOUSE);
            expect(result.technicianProfileId).toBeNull();
            expect(result.status).toBe(InventoryLocationStatus.ACTIVE);
            expect(result.createdAt).toBeInstanceOf(Date);
        });

        it("defaults status to ACTIVE and locationType to WAREHOUSE", async () => {
            const result = await createInventoryLocation(WS_ID, {
                name: "Simple Storage Room",
            });

            expect(result.name).toBe("Simple Storage Room");
            expect(result.locationType).toBe(InventoryLocationType.WAREHOUSE);
            expect(result.status).toBe(InventoryLocationStatus.ACTIVE);
            expect(result.code).toBeNull();
            expect(result.technicianProfileId).toBeNull();
        });

        it("throws DuplicateInventoryLocationError when location name exists in same workspace", async () => {
            await createInventoryLocation(WS_ID, {
                name: "Central Depot",
                code: "DEP-01",
            });

            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Central Depot",
                    code: "DEP-02",
                }),
            ).rejects.toThrow(DuplicateInventoryLocationError);
        });

        it("throws DuplicateInventoryLocationError when location code exists in same workspace", async () => {
            await createInventoryLocation(WS_ID, {
                name: "Depot One",
                code: "DEP-01",
            });

            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Depot Two",
                    code: "DEP-01",
                }),
            ).rejects.toThrow(DuplicateInventoryLocationError);
        });

        it("allows same location name or code in different workspaces", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const loc1 = await createInventoryLocation(WS_ID, {
                name: "Regional Hub",
                code: "HUB-01",
            });
            const loc2 = await createInventoryLocation(WS_ID_BETA, {
                name: "Regional Hub",
                code: "HUB-01",
            });

            expect(loc1.workspaceId).toBe(WS_ID);
            expect(loc2.workspaceId).toBe(WS_ID_BETA);
            expect(loc1.id).not.toBe(loc2.id);
        });

        it("creates a TECHNICIAN_STOCK location for a valid technician in workspace", async () => {
            const result = await createInventoryLocation(WS_ID, {
                name: "Tech 1 Van Stock",
                code: "VAN-01",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });

            expect(result.locationType).toBe(InventoryLocationType.TECHNICIAN_STOCK);
            expect(result.technicianProfileId).toBe(TECH_PROFILE_1.id);
        });

        it("throws TechnicianProfileNotFoundError if technicianProfile does not exist in workspace", async () => {
            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Foreign Tech Van",
                    locationType: InventoryLocationType.TECHNICIAN_STOCK,
                    technicianProfileId: TECH_PROFILE_BETA.id,
                }),
            ).rejects.toThrow(TechnicianProfileNotFoundError);
        });

        it("throws TechnicianStockLocationAlreadyExistsError if creating second ACTIVE stock location for same technician", async () => {
            await createInventoryLocation(WS_ID, {
                name: "Tech 1 Van Stock",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });

            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Tech 1 Secondary Van Stock",
                    locationType: InventoryLocationType.TECHNICIAN_STOCK,
                    technicianProfileId: TECH_PROFILE_1.id,
                }),
            ).rejects.toThrow(TechnicianStockLocationAlreadyExistsError);
        });

        it("allows creating a TECHNICIAN_STOCK location if previous location for technician is INACTIVE", async () => {
            const loc1 = await createInventoryLocation(WS_ID, {
                name: "Tech 1 Old Van Stock",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });
            await transitionInventoryLocationStatus(WS_ID, loc1.id, {
                status: InventoryLocationStatus.INACTIVE,
            });

            const loc2 = await createInventoryLocation(WS_ID, {
                name: "Tech 1 New Van Stock",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });

            expect(loc2.id).not.toBe(loc1.id);
            expect(loc2.status).toBe(InventoryLocationStatus.ACTIVE);
        });

        it("catches Prisma P2002 duplicate collision and maps to DuplicateInventoryLocationError", async () => {
            mocks.inventoryLocationCreate.mockRejectedValueOnce({
                code: "P2002",
                meta: { target: ["workspaceId", "name"] },
            });

            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Unique Name",
                }),
            ).rejects.toThrow(DuplicateInventoryLocationError);
        });

        it("enforces RBAC — allows Manager role to create inventory locations", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_MANAGER.id, email: USER_MANAGER.email },
            });

            const result = await createInventoryLocation(WS_ID, {
                name: "Manager Storage",
            });

            expect(result.name).toBe("Manager Storage");
        });

        it("enforces RBAC — denies creation for technician role", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Technician Attempt",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("enforces RBAC — denies creation for dispatcher role", async () => {
            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_DISPATCHER.id, email: USER_DISPATCHER.email },
            });

            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Dispatcher Attempt",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("enforces authentication — denies when unauthenticated", async () => {
            mocks.auth.mockResolvedValueOnce(null);

            await expect(
                createInventoryLocation(WS_ID, {
                    name: "Unauth Attempt",
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });

    describe("getInventoryLocation", () => {
        it("retrieves an existing location by ID", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Central Depot",
                code: "CD-01",
            });

            const fetched = await getInventoryLocation(WS_ID, created.id);
            expect(fetched.id).toBe(created.id);
            expect(fetched.name).toBe("Central Depot");
            expect(fetched.code).toBe("CD-01");
        });

        it("throws InventoryLocationNotFoundError if location does not exist", async () => {
            await expect(
                getInventoryLocation(WS_ID, "non_existent_loc_id"),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if location is in another workspace", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const betaLoc = await createInventoryLocation(WS_ID_BETA, {
                name: "Beta Only Location",
            });

            await expect(
                getInventoryLocation(WS_ID, betaLoc.id),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces RBAC — allows Technician role to view inventory locations", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Viewable Location",
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            const fetched = await getInventoryLocation(WS_ID, created.id);
            expect(fetched.id).toBe(created.id);
        });
    });

    describe("getInventoryLocations", () => {
        beforeEach(async () => {
            await createInventoryLocation(WS_ID, {
                name: "Austin Central Warehouse",
                code: "WH-AUS",
                locationType: InventoryLocationType.WAREHOUSE,
            });
            await createInventoryLocation(WS_ID, {
                name: "Dallas Vehicle 1",
                code: "VEH-DAL-1",
                locationType: InventoryLocationType.VEHICLE,
            });
            const inactiveLoc = await createInventoryLocation(WS_ID, {
                name: "Old Closed Depot",
                code: "DEP-OLD",
                locationType: InventoryLocationType.OTHER,
            });
            await transitionInventoryLocationStatus(WS_ID, inactiveLoc.id, {
                status: InventoryLocationStatus.INACTIVE,
            });
        });

        it("returns all locations with default pagination", async () => {
            const res = await getInventoryLocations(WS_ID);
            expect(res.items.length).toBe(3);
            expect(res.pagination.total).toBe(3);
            expect(res.pagination.page).toBe(1);
            expect(res.pagination.totalPages).toBe(1);
        });

        it("filters by status", async () => {
            const activeRes = await getInventoryLocations(WS_ID, {
                status: InventoryLocationStatus.ACTIVE,
            });
            expect(activeRes.items.length).toBe(2);

            const inactiveRes = await getInventoryLocations(WS_ID, {
                status: InventoryLocationStatus.INACTIVE,
            });
            expect(inactiveRes.items.length).toBe(1);
            expect(inactiveRes.items[0].name).toBe("Old Closed Depot");
        });

        it("filters by locationType", async () => {
            const whRes = await getInventoryLocations(WS_ID, {
                locationType: InventoryLocationType.WAREHOUSE,
            });
            expect(whRes.items.length).toBe(1);
            expect(whRes.items[0].code).toBe("WH-AUS");
        });

        it("searches by keyword across name and code", async () => {
            const searchRes = await getInventoryLocations(WS_ID, {
                search: "VEH-DAL",
            });
            expect(searchRes.items.length).toBe(1);
            expect(searchRes.items[0].name).toBe("Dallas Vehicle 1");
        });

        it("enforces tenant isolation — does not return locations from other workspaces", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await createInventoryLocation(WS_ID_BETA, {
                name: "Beta Isolated Location",
            });

            const alphaList = await getInventoryLocations(WS_ID);
            expect(
                alphaList.items.some((loc) => loc.name === "Beta Isolated Location"),
            ).toBe(false);
        });
    });

    describe("updateInventoryLocation", () => {
        it("updates location attributes successfully", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Original Location Name",
                code: "ORIG-CODE",
            });

            const updated = await updateInventoryLocation(WS_ID, created.id, {
                name: "Updated Location Name",
                code: "NEW-CODE",
                city: "Houston",
            });

            expect(updated.id).toBe(created.id);
            expect(updated.name).toBe("Updated Location Name");
            expect(updated.code).toBe("NEW-CODE");
            expect(updated.city).toBe("Houston");
        });

        it("throws DuplicateInventoryLocationError if updated name collides with another location", async () => {
            await createInventoryLocation(WS_ID, {
                name: "Location Alpha",
                code: "LOC-A",
            });
            const locB = await createInventoryLocation(WS_ID, {
                name: "Location Beta",
                code: "LOC-B",
            });

            await expect(
                updateInventoryLocation(WS_ID, locB.id, {
                    name: "Location Alpha",
                }),
            ).rejects.toThrow(DuplicateInventoryLocationError);
        });

        it("throws DuplicateInventoryLocationError if updated code collides with another location", async () => {
            await createInventoryLocation(WS_ID, {
                name: "Location Alpha",
                code: "LOC-A",
            });
            const locB = await createInventoryLocation(WS_ID, {
                name: "Location Beta",
                code: "LOC-B",
            });

            await expect(
                updateInventoryLocation(WS_ID, locB.id, {
                    code: "LOC-A",
                }),
            ).rejects.toThrow(DuplicateInventoryLocationError);
        });

        it("throws TechnicianStockLocationAlreadyExistsError if updating to TECHNICIAN_STOCK when another active location exists for tech", async () => {
            await createInventoryLocation(WS_ID, {
                name: "Tech 1 Existing Stock",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });

            const warehouse = await createInventoryLocation(WS_ID, {
                name: "Spare Warehouse",
                locationType: InventoryLocationType.WAREHOUSE,
            });

            await expect(
                updateInventoryLocation(WS_ID, warehouse.id, {
                    locationType: InventoryLocationType.TECHNICIAN_STOCK,
                    technicianProfileId: TECH_PROFILE_1.id,
                }),
            ).rejects.toThrow(TechnicianStockLocationAlreadyExistsError);
        });

        it("throws InventoryLocationNotFoundError for non-existent location update", async () => {
            await expect(
                updateInventoryLocation(WS_ID, "missing_loc_id", {
                    name: "New Name",
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if updating location in another workspace", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const betaLoc = await createInventoryLocation(WS_ID_BETA, {
                name: "Beta Location For Update",
            });

            await expect(
                updateInventoryLocation(WS_ID, betaLoc.id, {
                    name: "Attempted Alpha Update",
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces RBAC — denies update for technician role", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Location For Tech Update Attempt",
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                updateInventoryLocation(WS_ID, created.id, {
                    name: "Tech Modified Name",
                }),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows keeping existing name and code on update without collision error", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Stable Location",
                code: "STABLE-CODE",
            });

            const updated = await updateInventoryLocation(WS_ID, created.id, {
                name: "Stable Location",
                code: "STABLE-CODE",
                notes: "Updated notes",
            });

            expect(updated.notes).toBe("Updated notes");
        });

        it("force-clears technicianProfileId when updating TECHNICIAN_STOCK location to WAREHOUSE without explicitly touching technicianProfileId", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Tech 1 Stock To Convert",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });
            expect(created.technicianProfileId).toBe(TECH_PROFILE_1.id);

            const updated = await updateInventoryLocation(WS_ID, created.id, {
                locationType: InventoryLocationType.WAREHOUSE,
            });

            expect(updated.locationType).toBe(InventoryLocationType.WAREHOUSE);
            expect(updated.technicianProfileId).toBeNull();
        });

        it("force-clears/ignores technicianProfileId when attempting to set technicianProfileId on an existing WAREHOUSE location without changing locationType", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Regular Warehouse",
                locationType: InventoryLocationType.WAREHOUSE,
            });
            expect(created.technicianProfileId).toBeNull();

            const updated = await updateInventoryLocation(WS_ID, created.id, {
                technicianProfileId: TECH_PROFILE_1.id,
            });

            expect(updated.locationType).toBe(InventoryLocationType.WAREHOUSE);
            expect(updated.technicianProfileId).toBeNull();
        });
    });

    describe("transitionInventoryLocationStatus", () => {
        it("transitions an ACTIVE location to INACTIVE", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Location To Deactivate",
            });
            expect(created.status).toBe(InventoryLocationStatus.ACTIVE);

            const transitioned = await transitionInventoryLocationStatus(
                WS_ID,
                created.id,
                {
                    status: InventoryLocationStatus.INACTIVE,
                },
            );

            expect(transitioned.status).toBe(InventoryLocationStatus.INACTIVE);
        });

        it("transitions an INACTIVE location back to ACTIVE", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Location To Reactivate",
            });
            await transitionInventoryLocationStatus(WS_ID, created.id, {
                status: InventoryLocationStatus.INACTIVE,
            });

            const transitioned = await transitionInventoryLocationStatus(
                WS_ID,
                created.id,
                {
                    status: InventoryLocationStatus.ACTIVE,
                },
            );

            expect(transitioned.status).toBe(InventoryLocationStatus.ACTIVE);
        });

        it("handles idempotent transition cleanly without throwing error", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Already Active Location",
            });

            const result = await transitionInventoryLocationStatus(
                WS_ID,
                created.id,
                {
                    status: InventoryLocationStatus.ACTIVE,
                },
            );

            expect(result.status).toBe(InventoryLocationStatus.ACTIVE);
            expect(result.id).toBe(created.id);
        });

        it("throws TechnicianStockLocationAlreadyExistsError when reactivating TECHNICIAN_STOCK location if another active location exists for tech", async () => {
            const loc1 = await createInventoryLocation(WS_ID, {
                name: "Tech 1 Old Stock",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });
            await transitionInventoryLocationStatus(WS_ID, loc1.id, {
                status: InventoryLocationStatus.INACTIVE,
            });

            // Create new active stock location for Tech 1
            await createInventoryLocation(WS_ID, {
                name: "Tech 1 Current Stock",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: TECH_PROFILE_1.id,
            });

            // Attempt to reactivate old stock location
            await expect(
                transitionInventoryLocationStatus(WS_ID, loc1.id, {
                    status: InventoryLocationStatus.ACTIVE,
                }),
            ).rejects.toThrow(TechnicianStockLocationAlreadyExistsError);
        });

        it("throws InventoryLocationNotFoundError when target location does not exist", async () => {
            await expect(
                transitionInventoryLocationStatus(WS_ID, "non_existent_loc", {
                    status: InventoryLocationStatus.INACTIVE,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces tenant isolation — throws InventoryLocationNotFoundError if transitioning location in another workspace", async () => {
            membersMap.set(`${WS_ID_BETA}:${USER_ADMIN.id}`, {
                id: "mem_admin_beta",
                workspaceId: WS_ID_BETA,
                userId: USER_ADMIN.id,
                role: "ADMIN",
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const betaLoc = await createInventoryLocation(WS_ID_BETA, {
                name: "Beta Location For Transition",
            });

            await expect(
                transitionInventoryLocationStatus(WS_ID, betaLoc.id, {
                    status: InventoryLocationStatus.INACTIVE,
                }),
            ).rejects.toThrow(InventoryLocationNotFoundError);
        });

        it("enforces RBAC — denies status transition for technician role", async () => {
            const created = await createInventoryLocation(WS_ID, {
                name: "Location For Tech Transition Attempt",
            });

            mocks.auth.mockResolvedValueOnce({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                transitionInventoryLocationStatus(WS_ID, created.id, {
                    status: InventoryLocationStatus.INACTIVE,
                }),
            ).rejects.toThrow(ForbiddenError);
        });
    });
});
