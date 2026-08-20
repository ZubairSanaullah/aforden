import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeCount: vi.fn(),
    serviceCatalogCount: vi.fn(),
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
            findFirst: mocks.workTypeFindFirst,
            findMany: mocks.workTypeFindMany,
            count: mocks.workTypeCount,
        },
        serviceCatalog: {
            count: mocks.serviceCatalogCount,
        },
    },
}));

import { getWorkType } from "@/lib/services/workType/getWorkType";
import { getWorkTypes } from "@/lib/services/workType/getWorkTypes";
import { getWorkTypeOperationalSummary } from "@/lib/services/workType/getWorkTypeOperationalSummary";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.5 — WorkType Read Services Layer", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];
    let workTypesList: (WorkType & { catalog?: ServiceCatalog })[];

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

        mocks.workTypeFindFirst.mockImplementation(async ({ where, include }: any) => {
            const found = workTypesList.find((wt) => {
                if (where.id && wt.id !== where.id) return false;
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;

            const parentCatalog = catalogsList.find((c) => c.id === found.catalogId);
            return {
                ...found,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeFindMany.mockImplementation(async ({ where, orderBy, skip = 0, take = 20 }: any) => {
            let matched = workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.status && wt.status !== where.status) return false;
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                if (where.OR) {
                    const searchStr = where.OR[0].name.contains.toLowerCase();
                    const matchesName = wt.name.toLowerCase().includes(searchStr);
                    const matchesCode = wt.code ? wt.code.toLowerCase().includes(searchStr) : false;
                    const matchesDesc = wt.description ? wt.description.toLowerCase().includes(searchStr) : false;
                    if (!matchesName && !matchesCode && !matchesDesc) return false;
                }
                return true;
            });

            // Deterministic sort order
            matched = matched.sort((a, b) => {
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.name.localeCompare(b.name);
            });

            const sliced = matched.slice(skip, skip + take);

            return sliced.map((wt) => {
                const parentCatalog = catalogsList.find((c) => c.id === wt.catalogId);
                return {
                    ...wt,
                    catalog: parentCatalog,
                };
            });
        });

        mocks.workTypeCount.mockImplementation(async ({ where }: any) => {
            return workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.status && wt.status !== where.status) return false;
                if (where.catalog?.status) {
                    const cat = catalogsList.find((c) => c.id === wt.catalogId);
                    if (!cat || cat.status !== where.catalog.status) return false;
                }
                return true;
            }).length;
        });

        mocks.serviceCatalogCount.mockImplementation(async ({ where }: any) => {
            return catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            }).length;
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");

        // Seed catalogs
        catalogsList.push(
            {
                id: "sc_hvac",
                workspaceId: WS_ID,
                name: "Residential HVAC",
                description: "HVAC Services",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_inactive",
                workspaceId: WS_ID,
                name: "Legacy Services",
                description: "Inactive trade",
                status: "INACTIVE",
                sortOrder: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        );
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

    describe("1. Get Single WorkType (`getWorkType`)", () => {
        it("returns operational read model with parent catalog details and availability calculation", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Inspection",
                code: "AC-INSP",
                description: "Standard diagnostic",
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await getWorkType(WS_ID, "wt_1");

            expect(result.id).toBe("wt_1");
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.catalogId).toBe("sc_hvac");
            expect(result.catalogName).toBe("Residential HVAC");
            expect(result.catalogStatus).toBe("ACTIVE");
            expect(result.name).toBe("AC Inspection");
            expect(result.code).toBe("AC-INSP");
            expect(result.estimatedDuration).toBe(60);
            expect(result.isAvailableForWorkOrder).toBe(true);
        });

        it("computes isAvailableForWorkOrder as false when parent catalog is INACTIVE", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_inactive_cat",
                workspaceId: WS_ID,
                catalogId: "sc_inactive",
                name: "Legacy Work",
                code: "LEG-01",
                description: null,
                estimatedDuration: 30,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await getWorkType(WS_ID, "wt_inactive_cat");

            expect(result.status).toBe("ACTIVE");
            expect(result.catalogStatus).toBe("INACTIVE");
            expect(result.isAvailableForWorkOrder).toBe(false);
        });

        it("throws WorkTypeNotFoundError for non-existent ID or cross-tenant ID", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_beta",
                workspaceId: WS_ID_2,
                catalogId: "sc_beta",
                name: "Beta Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(getWorkType(WS_ID, "wt_beta")).rejects.toThrow(WorkTypeNotFoundError);
            await expect(getWorkType(WS_ID, "wt_nonexistent")).rejects.toThrow(WorkTypeNotFoundError);
        });
    });

    describe("2. List WorkTypes (`getWorkTypes`)", () => {
        it("returns paginated and filtered work types scoped strictly to workspaceId", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push(
                {
                    id: "wt_1",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac",
                    name: "AC Inspection",
                    code: "AC-01",
                    description: null,
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_2",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac",
                    name: "Furnace Tune-Up",
                    code: "FURN-01",
                    description: null,
                    estimatedDuration: 90,
                    status: "INACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_3",
                    workspaceId: WS_ID_2,
                    catalogId: "sc_beta",
                    name: "Beta Work Type",
                    code: "BETA-01",
                    description: null,
                    estimatedDuration: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const result = await getWorkTypes(WS_ID, { catalogId: "sc_hvac" });

            expect(result.items.length).toBe(2);
            expect(result.pagination.total).toBe(2);
            expect(result.items.map((i) => i.name)).toEqual(["AC Inspection", "Furnace Tune-Up"]);
        });

        it("filters work types by search string", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push(
                {
                    id: "wt_1",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac",
                    name: "AC Compressor Check",
                    code: "COMP-01",
                    description: null,
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_2",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac",
                    name: "Heat Pump Diagnostic",
                    code: "HP-01",
                    description: null,
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const res = await getWorkTypes(WS_ID, { search: "compressor" });
            expect(res.items.length).toBe(1);
            expect(res.items[0].name).toBe("AC Compressor Check");
        });
    });

    describe("3. Operational Summary (`getWorkTypeOperationalSummary`)", () => {
        it("returns accurate workspace-scoped summary with availability calculations", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push(
                {
                    id: "wt_1",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac", // ACTIVE
                    name: "AC 1",
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_2",
                    workspaceId: WS_ID,
                    catalogId: "sc_inactive", // INACTIVE
                    name: "Legacy 1",
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "ACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_3",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac", // ACTIVE
                    name: "AC 2",
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "INACTIVE",
                    sortOrder: 3,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            const summary = await getWorkTypeOperationalSummary(WS_ID);

            expect(summary.workspaceId).toBe(WS_ID);
            expect(summary.totalWorkTypes).toBe(3);
            expect(summary.activeWorkTypes).toBe(2);
            expect(summary.inactiveWorkTypes).toBe(1);
            expect(summary.availableWorkTypes).toBe(1); // Only wt_1 (ACTIVE in ACTIVE catalog)
            expect(summary.unavailableWorkTypes).toBe(2); // wt_2 (in inactive catalog) + wt_3 (inactive)
            expect(summary.totalCatalogs).toBe(2);
        });
    });
});
