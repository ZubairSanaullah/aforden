import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindMany: vi.fn(),
    serviceCatalogCount: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
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
            findMany: mocks.serviceCatalogFindMany,
            count: mocks.serviceCatalogCount,
            findFirst: mocks.serviceCatalogFindFirst,
        },
    },
}));

import { getServiceCatalogs } from "@/lib/services/serviceCatalog/getServiceCatalogs";
import { GET as listCatalogsApiHandler } from "@/app/api/service-catalogs/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.10 — Service Catalog Directory & Operational Read Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];
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
            return null;
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

            // Sorting simulation
            matched = matched.sort((a, b) => {
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.name.localeCompare(b.name);
            });

            const sliced = matched.slice(skip, skip + take);

            return sliced.map((c) => {
                const attached = workTypesList.filter((wt) => wt.catalogId === c.id);
                const active = attached.filter((wt) => wt.status === "ACTIVE");
                return {
                    ...c,
                    _count: { workTypes: attached.length },
                    workTypes: active.map((wt) => ({ id: wt.id })),
                };
            });
        });

        mocks.serviceCatalogCount.mockImplementation(async ({ where }: any) => {
            return catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                if (where.status && c.status !== where.status) return false;
                if (where.OR) {
                    const searchStr = where.OR[0].name.contains.toLowerCase();
                    const matchesName = c.name.toLowerCase().includes(searchStr);
                    const matchesDesc = c.description ? c.description.toLowerCase().includes(searchStr) : false;
                    if (!matchesName && !matchesDesc) return false;
                }
                return true;
            }).length;
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Operations", "beta-ops");

        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ID, "ADMIN");
        loginAs("user_admin");
    });

    function registerUser(userId: string, name: string) {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed",
            emailVerified: new Date(),
            avatarUrl: null,
            status: "ACTIVE" as any,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        usersMap.set(userId, user);
        return user;
    }

    function registerWorkspace(id: string, name: string, slug: string) {
        const ws: Workspace = {
            id,
            name,
            slug,
            logoUrl: null,
            timezone: "Asia/Karachi",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        workspacesMap.set(id, ws);
        return ws;
    }

    function registerMember(userId: string, workspaceId: string, role: any) {
        const m: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role,
            status: "ACTIVE" as any,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        membersMap.set(`${userId}_${workspaceId}`, m);
        return m;
    }

    function loginAs(userId: string) {
        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${userId}@example.com` },
        });
    }

    function createRequest(url: string, headers: Record<string, string> = {}) {
        return new Request(url, {
            method: "GET",
            headers: {
                "content-type": "application/json",
                ...headers,
            },
        });
    }

    describe("1. Directory Listing & Filtering", () => {
        it("returns empty paginated result with 200 when no catalogs exist in workspace", async () => {
            const result = await getServiceCatalogs(WS_ID);

            expect(result.items).toHaveLength(0);
            expect(result.pagination).toEqual({
                page: 1,
                pageSize: 20,
                total: 0,
                totalPages: 0,
                hasNextPage: false,
                hasPreviousPage: false,
            });
        });

        it("filters by status ACTIVE vs INACTIVE and returns accurate operational counts", async () => {
            catalogsList.push(
                {
                    id: "sc_active",
                    workspaceId: WS_ID,
                    name: "Active HVAC",
                    description: "Active description",
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_inactive",
                    workspaceId: WS_ID,
                    name: "Inactive Plumbing",
                    description: "Inactive description",
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
                    catalogId: "sc_active",
                    name: "Active Work 1",
                    code: "AW-1",
                    description: null,
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_2",
                    workspaceId: WS_ID,
                    catalogId: "sc_active",
                    name: "Inactive Work 2",
                    code: "IW-2",
                    description: null,
                    estimatedDuration: 60,
                    status: "INACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const activeResult = await getServiceCatalogs(WS_ID, { status: "ACTIVE" });
            expect(activeResult.items).toHaveLength(1);
            expect(activeResult.items[0].id).toBe("sc_active");
            expect(activeResult.items[0].workTypesCount).toBe(2);
            expect(activeResult.items[0].activeWorkTypesCount).toBe(1);

            const inactiveResult = await getServiceCatalogs(WS_ID, { status: "INACTIVE" });
            expect(inactiveResult.items).toHaveLength(1);
            expect(inactiveResult.items[0].id).toBe("sc_inactive");
            expect(inactiveResult.items[0].workTypesCount).toBe(0);
            expect(inactiveResult.items[0].activeWorkTypesCount).toBe(0);
        });

        it("returns workspace-isolated catalogs only (never leaks Workspace B data)", async () => {
            catalogsList.push(
                {
                    id: "sc_ws1",
                    workspaceId: WS_ID,
                    name: "Alpha Catalog",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_ws2",
                    workspaceId: WS_ID_2,
                    name: "Beta Catalog",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const res = await getServiceCatalogs(WS_ID);
            expect(res.items).toHaveLength(1);
            expect(res.items[0].name).toBe("Alpha Catalog");
        });
    });

    describe("2. HTTP REST API Endpoint Enforcement", () => {
        it("GET /api/service-catalogs returns 200 with standard pagination envelope", async () => {
            catalogsList.push({
                id: "sc_hvac",
                workspaceId: WS_ID,
                name: "HVAC Services",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("http://localhost/api/service-catalogs", { "x-workspace-id": WS_ID });
            const res = await listCatalogsApiHandler(req);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.items).toHaveLength(1);
            expect(body.data.items[0].name).toBe("HVAC Services");
        });
    });
});
