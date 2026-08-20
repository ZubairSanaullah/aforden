import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogFindMany: vi.fn(),
    serviceCatalogCount: vi.fn(),
    workTypeCount: vi.fn(),
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
        serviceCatalog: {
            findFirst: mocks.serviceCatalogFindFirst,
            findMany: mocks.serviceCatalogFindMany,
            count: mocks.serviceCatalogCount,
        },
        workType: {
            count: mocks.workTypeCount,
        },
    },
}));

import { getServiceCatalog } from "@/lib/services/serviceCatalog/getServiceCatalog";
import { getServiceCatalogs } from "@/lib/services/serviceCatalog/getServiceCatalogs";
import { getServiceCatalogOperationalSummary } from "@/lib/services/serviceCatalog/getServiceCatalogOperationalSummary";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    UnauthorizedError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.4 — ServiceCatalog Read Services Layer", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: (ServiceCatalog & { workTypes?: WorkType[] })[];
    let workTypesList: WorkType[];

    const WS_ID = "ws_apex_100";
    const WS_ID_2 = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        catalogsList = [];
        workTypesList = [];

        mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
            return usersMap.get(where.id) || null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
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

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where, include }: any) => {
            const found = catalogsList.find((c) => {
                if (where.id && c.id !== where.id) return false;
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;

            const attachedWorkTypes = workTypesList.filter((wt) => wt.catalogId === found.id);
            const activeWorkTypes = attachedWorkTypes.filter((wt) => wt.status === "ACTIVE");

            return {
                ...found,
                _count: {
                    workTypes: attachedWorkTypes.length,
                },
                workTypes: include?.workTypes ? activeWorkTypes.map((wt) => ({ id: wt.id })) : [],
            };
        });

        mocks.serviceCatalogFindMany.mockImplementation(async ({ where, orderBy, skip = 0, take = 20 }: any) => {
            let matched = catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                if (where.status && c.status !== where.status) return false;
                if (where.OR) {
                    const searchStr = where.OR[0].name.contains.toLowerCase();
                    const matchesName = c.name.toLowerCase().includes(searchStr);
                    const matchesDesc = c.description ? c.description.toLowerCase().includes(searchStr) : false;
                    if (!matchesName && !matchesDesc) return false;
                }
                return true;
            });

            // Sorting
            matched = matched.sort((a, b) => {
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.name.localeCompare(b.name);
            });

            const sliced = matched.slice(skip, skip + take);

            return sliced.map((found) => {
                const attachedWorkTypes = workTypesList.filter((wt) => wt.catalogId === found.id);
                const activeWorkTypes = attachedWorkTypes.filter((wt) => wt.status === "ACTIVE");
                return {
                    ...found,
                    _count: {
                        workTypes: attachedWorkTypes.length,
                    },
                    workTypes: activeWorkTypes.map((wt) => ({ id: wt.id })),
                };
            });
        });

        mocks.serviceCatalogCount.mockImplementation(async ({ where }: any) => {
            return catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                if (where.status && c.status !== where.status) return false;
                return true;
            }).length;
        });

        mocks.workTypeCount.mockImplementation(async ({ where }: any) => {
            return workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.status && wt.status !== where.status) return false;
                return true;
            }).length;
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");
    });

    function registerUser(userId = "user_admin", name = "Admin User", status = "ACTIVE") {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed-pwd",
            emailVerified: new Date(),
            avatarUrl: null,
            status: status as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        usersMap.set(userId, user);
        return user;
    }

    function registerWorkspace(workspaceId: string, name: string, slug: string) {
        const workspace: Workspace = {
            id: workspaceId,
            name,
            slug,
            logoUrl: null,
            timezone: "Asia/Karachi",
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        workspacesMap.set(workspaceId, workspace);
        return workspace;
    }

    function registerMember(
        userId: string,
        workspaceId: string,
        role: "OWNER" | "ADMIN" | "MANAGER" | "DISPATCHER" | "TECHNICIAN" | "ACCOUNTANT" = "ADMIN",
        status = "ACTIVE",
    ) {
        const member: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role: role as any,
            status: status as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        membersMap.set(`${userId}_${workspaceId}`, member);
        membersMap.set(member.id, member);
        return member;
    }

    function loginAs(userId: string) {
        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${userId}@example.com` },
        });
    }

    describe("1. Get Single ServiceCatalog (`getServiceCatalog`)", () => {
        it("returns operational read model with correct workTypesCount and activeWorkTypesCount", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const catalog: ServiceCatalog = {
                id: "sc_1",
                workspaceId: WS_ID,
                name: "Residential HVAC",
                description: "Cooling and heating",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            catalogsList.push(catalog);

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_1",
                name: "AC Inspection",
                code: "AC-INSP",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_2",
                workspaceId: WS_ID,
                catalogId: "sc_1",
                name: "Legacy Furnace Tune",
                code: "FURN-LEGACY",
                description: null,
                estimatedDuration: 90,
                status: "INACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await getServiceCatalog(WS_ID, "sc_1");

            expect(result.id).toBe("sc_1");
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.name).toBe("Residential HVAC");
            expect(result.description).toBe("Cooling and heating");
            expect(result.workTypesCount).toBe(2);
            expect(result.activeWorkTypesCount).toBe(1);
        });

        it("throws ServiceCatalogNotFoundError for non-existent catalog ID", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(getServiceCatalog(WS_ID, "sc_nonexistent")).rejects.toThrow(
                ServiceCatalogNotFoundError,
            );
        });

        it("throws ServiceCatalogNotFoundError when querying catalog from another workspace (tenant isolation)", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_beta_1",
                workspaceId: WS_ID_2,
                name: "Beta Only Catalog",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(getServiceCatalog(WS_ID, "sc_beta_1")).rejects.toThrow(
                ServiceCatalogNotFoundError,
            );
        });

        it("allows all authorized roles (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, ACCOUNTANT) to view catalogs", async () => {
            const roles = ["OWNER", "ADMIN", "MANAGER", "DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const;

            catalogsList.push({
                id: "sc_shared",
                workspaceId: WS_ID,
                name: "Shared Catalog",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of roles) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                const res = await getServiceCatalog(WS_ID, "sc_shared");
                expect(res.name).toBe("Shared Catalog");
            }
        });
    });

    describe("2. List ServiceCatalogs (`getServiceCatalogs`)", () => {
        it("returns paginated operational read models scoped strictly to workspaceId", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push(
                {
                    id: "sc_1",
                    workspaceId: WS_ID,
                    name: "HVAC",
                    description: "Heating & Cooling",
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_2",
                    workspaceId: WS_ID,
                    name: "Plumbing",
                    description: "Pipes & Drainage",
                    status: "ACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_3",
                    workspaceId: WS_ID_2,
                    name: "Other WS Catalog",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const res = await getServiceCatalogs(WS_ID, {});

            expect(res.items.length).toBe(2);
            expect(res.pagination.total).toBe(2);
            expect(res.items.map((i) => i.name)).toEqual(["HVAC", "Plumbing"]);
            expect(res.items.find((i) => i.id === "sc_3")).toBeUndefined();
        });

        it("filters catalogs by search string in name or description", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push(
                {
                    id: "sc_1",
                    workspaceId: WS_ID,
                    name: "Residential HVAC",
                    description: "Air conditioning and heating",
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_2",
                    workspaceId: WS_ID,
                    name: "Commercial Electrical",
                    description: "Panel upgrades and wiring",
                    status: "ACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const res = await getServiceCatalogs(WS_ID, { search: "electrical" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].name).toBe("Commercial Electrical");
        });

        it("filters catalogs by status", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push(
                {
                    id: "sc_1",
                    workspaceId: WS_ID,
                    name: "Active Catalog",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_2",
                    workspaceId: WS_ID,
                    name: "Inactive Catalog",
                    description: null,
                    status: "INACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const res = await getServiceCatalogs(WS_ID, { status: "INACTIVE" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].name).toBe("Inactive Catalog");
        });
    });

    describe("3. Operational Summary (`getServiceCatalogOperationalSummary`)", () => {
        it("returns workspace-scoped aggregate counts for catalogs and work types", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push(
                {
                    id: "sc_1",
                    workspaceId: WS_ID,
                    name: "Cat 1",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_2",
                    workspaceId: WS_ID,
                    name: "Cat 2",
                    description: null,
                    status: "INACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            workTypesList.push(
                {
                    id: "wt_1",
                    workspaceId: WS_ID,
                    catalogId: "sc_1",
                    name: "WT 1",
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "ACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_2",
                    workspaceId: WS_ID,
                    catalogId: "sc_1",
                    name: "WT 2",
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "INACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_3",
                    workspaceId: WS_ID_2,
                    catalogId: "sc_other",
                    name: "WT Other WS",
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "ACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const summary = await getServiceCatalogOperationalSummary(WS_ID);

            expect(summary.workspaceId).toBe(WS_ID);
            expect(summary.totalCatalogs).toBe(2);
            expect(summary.activeCatalogs).toBe(1);
            expect(summary.inactiveCatalogs).toBe(1);
            expect(summary.totalWorkTypes).toBe(2);
            expect(summary.activeWorkTypes).toBe(1);
        });
    });
});
