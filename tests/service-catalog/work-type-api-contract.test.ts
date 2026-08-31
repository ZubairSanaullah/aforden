import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeCount: vi.fn(),
    workTypeCreate: vi.fn(),
    workTypeUpdate: vi.fn(),
    workTypeDelete: vi.fn(),
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
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
            findMany: mocks.workTypeFindMany,
            count: mocks.workTypeCount,
            create: mocks.workTypeCreate,
            update: mocks.workTypeUpdate,
            delete: mocks.workTypeDelete,
        },
    },
}));

import {
    GET as listWorkTypesHandler,
    POST as createWorkTypeHandler,
} from "@/app/api/work-types/route";
import {
    GET as getWorkTypeHandler,
    PATCH as updateWorkTypeHandler,
    DELETE as deleteWorkTypeHandler,
} from "@/app/api/work-types/[workTypeId]/route";
import { PATCH as updateWorkTypeStatusHandler } from "@/app/api/work-types/[workTypeId]/status/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.7 — Work Type HTTP API Contract Verification", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];
    let workTypesList: WorkType[];

    const WS_ID = "ws_apex_100";

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

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                catalogsList.find((c) => {
                    if (where.id && c.id !== where.id) return false;
                    if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                    return true;
                }) || null
            );
        });

        mocks.workTypeFindFirst.mockImplementation(async ({ where, include }: any) => {
            const found = workTypesList.find((wt) => {
                if (where.id && wt.id !== where.id) return false;
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.code && wt.code !== where.code) return false;
                if (where.NOT?.id && wt.id === where.NOT.id) return false;
                return true;
            });
            if (!found) return null;

            const parentCatalog = catalogsList.find((c) => c.id === found.catalogId);
            return {
                ...found,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
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

            matched = matched.sort((a, b) => {
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.name.localeCompare(b.name);
            });

            const sliced = matched.slice(skip, skip + take);

            return sliced.map((wt) => ({
                ...wt,
                catalog: catalogsList.find((c) => c.id === wt.catalogId),
            }));
        });

        mocks.workTypeCount.mockImplementation(async ({ where }: any) => {
            return workTypesList.filter((wt) => {
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
            }).length;
        });

        mocks.workTypeCreate.mockImplementation(async ({ data, include }: any) => {
            const nameDup = workTypesList.find(
                (wt) => wt.catalogId === data.catalogId && wt.name.toLowerCase() === data.name.toLowerCase(),
            );
            if (nameDup) {
                const err = new Error("Unique constraint failed on the fields: (`catalogId`,`name`)");
                (err as any).code = "P2002";
                (err as any).meta = { target: ["catalogId", "name"] };
                throw err;
            }

            if (data.code) {
                const codeDup = workTypesList.find(
                    (wt) => wt.workspaceId === data.workspaceId && wt.code === data.code,
                );
                if (codeDup) {
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`code`)");
                    (err as any).code = "P2002";
                    (err as any).meta = { target: ["workspaceId", "code"] };
                    throw err;
                }
            }

            const parentCatalog = catalogsList.find((c) => c.id === data.catalogId)!;
            const created: WorkType = {
                id: `wt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                workspaceId: data.workspaceId,
                catalogId: data.catalogId,
                name: data.name,
                code: data.code ?? null,
                description: data.description ?? null,
                estimatedDuration: data.estimatedDuration ?? null,
                status: data.status ?? "ACTIVE",
                sortOrder: data.sortOrder ?? 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workTypesList.push(created);

            return {
                ...created,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeUpdate.mockImplementation(async ({ where, data, include }: any) => {
            const idx = workTypesList.findIndex((wt) => wt.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }

            const current = workTypesList[idx];
            const updated: WorkType = {
                ...current,
                ...(data.catalogId !== undefined && { catalogId: data.catalogId }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.code !== undefined && { code: data.code }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.estimatedDuration !== undefined && { estimatedDuration: data.estimatedDuration }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
                updatedAt: new Date(),
            };
            workTypesList[idx] = updated;

            const parentCatalog = catalogsList.find((c) => c.id === updated.catalogId);

            return {
                ...updated,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeDelete.mockImplementation(async ({ where }: any) => {
            const idx = workTypesList.findIndex((wt) => wt.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }
            return workTypesList.splice(idx, 1)[0];
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ID, "ADMIN");
        loginAs("user_admin");

        catalogsList.push({
            id: "sc_hvac",
            workspaceId: WS_ID,
            name: "Residential HVAC",
            description: null,
            status: "ACTIVE",
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    });

    function registerUser(userId: string, name: string) {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
        platformRole: null,
            passwordHash: "hashed-pwd",
        emailVerified: new Date(),
            avatarUrl: null,
        status: "ACTIVE" as any,
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
        defaultCurrencyCode: "USD",
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
    ) {
        const member: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role: role as any,
            status: "ACTIVE" as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        membersMap.set(`${userId}_${workspaceId}`, member);
        return member;
    }

    function loginAs(userId: string) {
        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${userId}@example.com` },
        });
    }

    function createRequest(
        method: string,
        url: string,
        body?: any,
        headers: Record<string, string> = {},
    ) {
        const init: RequestInit = {
            method,
            headers: {
                "content-type": "application/json",
                ...headers,
            },
        };
        if (body !== undefined) {
            init.body = typeof body === "string" ? body : JSON.stringify(body);
        }
        return new Request(url, init);
    }

    describe("1. Duration Validation Contract", () => {
        it("returns 422 when estimatedDuration is less than 5 minutes", async () => {
            const req = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_hvac",
                    name: "Too Fast Service",
                    estimatedDuration: 4,
                },
                { "x-workspace-id": WS_ID },
            );
            const res = await createWorkTypeHandler(req);
            expect(res.status).toBe(422);
            const body = await res.json();
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });

        it("returns 422 when estimatedDuration exceeds 1440 minutes (24 hours)", async () => {
            const req = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_hvac",
                    name: "Too Long Service",
                    estimatedDuration: 1441,
                },
                { "x-workspace-id": WS_ID },
            );
            const res = await createWorkTypeHandler(req);
            expect(res.status).toBe(422);
            const body = await res.json();
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });

        it("returns 422 when estimatedDuration is a decimal number", async () => {
            const req = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_hvac",
                    name: "Decimal Service",
                    estimatedDuration: 45.5,
                },
                { "x-workspace-id": WS_ID },
            );
            const res = await createWorkTypeHandler(req);
            expect(res.status).toBe(422);
            const body = await res.json();
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("2. Code Normalization & Multi-Null Handling", () => {
        it("allows multiple work types with null codes in the same workspace", async () => {
            const req1 = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_hvac",
                    name: "First Uncoded Service",
                    code: null,
                },
                { "x-workspace-id": WS_ID },
            );
            const res1 = await createWorkTypeHandler(req1);
            expect(res1.status).toBe(201);

            const req2 = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_hvac",
                    name: "Second Uncoded Service",
                    code: null,
                },
                { "x-workspace-id": WS_ID },
            );
            const res2 = await createWorkTypeHandler(req2);
            expect(res2.status).toBe(201);
        });
    });
});
