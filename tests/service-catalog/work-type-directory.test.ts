import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeCount: vi.fn(),
    workTypeFindFirst: vi.fn(),
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
        workType: {
            findMany: mocks.workTypeFindMany,
            count: mocks.workTypeCount,
            findFirst: mocks.workTypeFindFirst,
        },
    },
}));

import { getWorkTypes } from "@/lib/services/workType/getWorkTypes";
import { GET as listWorkTypesApiHandler } from "@/app/api/work-types/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.10 — WorkType Directory & Dynamic Operational Availability Suite", () => {
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

        mocks.workTypeFindMany.mockImplementation(async ({ where, orderBy, skip = 0, take = 20, include }: any) => {
            let matched = workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.status && wt.status !== where.status) return false;
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                if (where.catalog && where.catalog.workspaceId && wt.workspaceId !== where.catalog.workspaceId) return false;
                if (where.OR) {
                    const searchStr = where.OR[0].name.contains.toLowerCase();
                    const matchesName = wt.name.toLowerCase().includes(searchStr);
                    const matchesCode = wt.code ? wt.code.toLowerCase().includes(searchStr) : false;
                    const matchesDesc = wt.description ? wt.description.toLowerCase().includes(searchStr) : false;
                    if (!matchesName && !matchesCode && !matchesDesc) return false;
                }
                return true;
            });

            matched = matched.sort((a, b) => {
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.name.localeCompare(b.name);
            });

            const sliced = matched.slice(skip, skip + take);

            return sliced.map((wt) => {
                const parentCat = catalogsList.find((c) => c.id === wt.catalogId);
                return {
                    ...wt,
                    catalog: include?.catalog ? parentCat : undefined,
                };
            });
        });

        mocks.workTypeCount.mockImplementation(async ({ where }: any) => {
            return workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.status && wt.status !== where.status) return false;
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                if (where.catalog && where.catalog.workspaceId && wt.workspaceId !== where.catalog.workspaceId) return false;
                if (where.OR) {
                    const searchStr = where.OR[0].name.contains.toLowerCase();
                    const matchesName = wt.name.toLowerCase().includes(searchStr);
                    const matchesCode = wt.code ? wt.code.toLowerCase().includes(searchStr) : false;
                    const matchesDesc = wt.description ? wt.description.toLowerCase().includes(searchStr) : false;
                    if (!matchesName && !matchesCode && !matchesDesc) return false;
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

    describe("1. Dynamic Availability Calculation Formula", () => {
        it("verifies isAvailableForWorkOrder across all 4 lifecycle states", async () => {
            catalogsList.push(
                {
                    id: "sc_active",
                    workspaceId: WS_ID,
                    name: "Active Catalog",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_inactive",
                    workspaceId: WS_ID,
                    name: "Inactive Catalog",
                    description: null,
                    status: "INACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            workTypesList.push(
                {
                    id: "wt_act_act",
                    workspaceId: WS_ID,
                    catalogId: "sc_active",
                    name: "Active WT + Active Cat",
                    code: "AA-1",
                    description: null,
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_act_inact",
                    workspaceId: WS_ID,
                    catalogId: "sc_inactive",
                    name: "Active WT + Inactive Cat",
                    code: "AI-1",
                    description: null,
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_inact_act",
                    workspaceId: WS_ID,
                    catalogId: "sc_active",
                    name: "Inactive WT + Active Cat",
                    code: "IA-1",
                    description: null,
                    estimatedDuration: 60,
                    status: "INACTIVE",
                    sortOrder: 3,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_inact_inact",
                    workspaceId: WS_ID,
                    catalogId: "sc_inactive",
                    name: "Inactive WT + Inactive Cat",
                    code: "II-1",
                    description: null,
                    estimatedDuration: 60,
                    status: "INACTIVE",
                    sortOrder: 4,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const result = await getWorkTypes(WS_ID);
            expect(result.items).toHaveLength(4);

            const aa = result.items.find((i) => i.id === "wt_act_act");
            expect(aa?.isAvailableForWorkOrder).toBe(true);

            const ai = result.items.find((i) => i.id === "wt_act_inact");
            expect(ai?.isAvailableForWorkOrder).toBe(false);

            const ia = result.items.find((i) => i.id === "wt_inact_act");
            expect(ia?.isAvailableForWorkOrder).toBe(false);

            const ii = result.items.find((i) => i.id === "wt_inact_inact");
            expect(ii?.isAvailableForWorkOrder).toBe(false);
        });
    });

    describe("2. Filtering & Workspace Isolation", () => {
        it("never returns WorkTypes when filtering by cross-tenant catalogId", async () => {
            catalogsList.push({
                id: "sc_beta",
                workspaceId: WS_ID_2,
                name: "Beta Catalog",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            workTypesList.push({
                id: "wt_beta",
                workspaceId: WS_ID_2,
                catalogId: "sc_beta",
                name: "Beta Work",
                code: "BW-1",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Alpha user queries with Beta catalogId
            const result = await getWorkTypes(WS_ID, { catalogId: "sc_beta" });
            expect(result.items).toHaveLength(0);
        });
    });

    describe("3. HTTP REST API Endpoint Enforcement", () => {
        it("GET /api/work-types returns 200 with standard pagination envelope", async () => {
            catalogsList.push({
                id: "sc_cat",
                workspaceId: WS_ID,
                name: "Alpha Cat",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_alpha",
                workspaceId: WS_ID,
                catalogId: "sc_cat",
                name: "Alpha Work",
                code: "AW-1",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("http://localhost/api/work-types", { "x-workspace-id": WS_ID });
            const res = await listWorkTypesApiHandler(req);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.items).toHaveLength(1);
            expect(body.data.items[0].name).toBe("Alpha Work");
            expect(body.data.items[0].catalogName).toBe("Alpha Cat");
            expect(body.data.items[0].isAvailableForWorkOrder).toBe(true);
        });
    });
});
