import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    workTypeCreate: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeUpdate: vi.fn(),
    workTypeDelete: vi.fn(),
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
        serviceCatalog: {
            findFirst: mocks.serviceCatalogFindFirst,
            count: mocks.serviceCatalogCount,
        },
        workType: {
            create: mocks.workTypeCreate,
            findFirst: mocks.workTypeFindFirst,
            findMany: mocks.workTypeFindMany,
            update: mocks.workTypeUpdate,
            delete: mocks.workTypeDelete,
            count: mocks.workTypeCount,
        },
    },
}));

import { createWorkType } from "@/lib/services/workType/createWorkType";
import { getWorkType } from "@/lib/services/workType/getWorkType";
import { updateWorkType } from "@/lib/services/workType/updateWorkType";
import { deleteWorkType } from "@/lib/services/workType/deleteWorkType";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.5 — WorkType Service Hardening & Security Isolation", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];
    let workTypesList: WorkType[];

    const WS_ALPHA = "ws_alpha_100";
    const WS_BETA = "ws_beta_200";

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
                return true;
            });
            if (!found) return null;

            const parentCatalog = catalogsList.find((c) => c.id === found.catalogId);
            return {
                ...found,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeCreate.mockImplementation(async ({ data }: any) => {
            const parentCatalog = catalogsList.find((c) => c.id === data.catalogId)!;
            const created: WorkType = {
                id: `wt_${Date.now()}`,
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
                catalog: parentCatalog,
            };
        });

        registerWorkspace(WS_ALPHA, "Alpha Workspace", "alpha");
        registerWorkspace(WS_BETA, "Beta Workspace", "beta");

        registerUser("user_alpha", "Alpha Admin");
        registerMember("user_alpha", WS_ALPHA, "ADMIN");

        registerUser("user_beta", "Beta Admin");
        registerMember("user_beta", WS_BETA, "ADMIN");

        // Seed catalogs
        catalogsList.push(
            {
                id: "sc_alpha_hvac",
                workspaceId: WS_ALPHA,
                name: "Alpha HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_beta_hvac",
                workspaceId: WS_BETA,
                name: "Beta HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        );
    });

    function registerUser(userId: string, name = "User") {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
        platformRole: null,
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
        defaultCurrencyCode: "USD",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        workspacesMap.set(id, ws);
        return ws;
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
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        membersMap.set(`${userId}_${workspaceId}`, member);
        return member;
    }

    function loginAs(userId: string) {
        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${userId}@example.com` },
        });
    }

    describe("1. IDOR & Cross-Tenant Boundary Tests", () => {
        it("returns identical WorkTypeNotFoundError for cross-tenant ID vs nonexistent ID", async () => {
            workTypesList.push({
                id: "wt_secret_beta",
                workspaceId: WS_BETA,
                catalogId: "sc_beta_hvac",
                name: "Confidential Beta Work",
                code: "BETA-01",
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_alpha");

            const notFoundErr = await getWorkType(WS_ALPHA, "wt_ghost_id").catch((e) => e);
            const crossTenantErr = await getWorkType(WS_ALPHA, "wt_secret_beta").catch((e) => e);

            expect(notFoundErr).toBeInstanceOf(WorkTypeNotFoundError);
            expect(crossTenantErr).toBeInstanceOf(WorkTypeNotFoundError);
            expect(crossTenantErr.message).toBe(notFoundErr.message);
        });

        it("blocks cross-tenant catalog attachment on creation", async () => {
            loginAs("user_alpha");

            await expect(
                createWorkType(WS_ALPHA, {
                    catalogId: "sc_beta_hvac",
                    name: "Malicious Attachment",
                }),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });

        it("blocks cross-tenant catalog reparenting on update", async () => {
            workTypesList.push({
                id: "wt_alpha_1",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Alpha Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_alpha");

            await expect(
                updateWorkType(WS_ALPHA, "wt_alpha_1", {
                    catalogId: "sc_beta_hvac",
                }),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });
    });

    describe("2. Mass Assignment Defense", () => {
        it("strips client-injected workspaceId during create", async () => {
            loginAs("user_alpha");

            const created = await createWorkType(WS_ALPHA, {
                catalogId: "sc_alpha_hvac",
                name: "Secure Work Type",
                workspaceId: WS_BETA,
            } as any);

            expect(created.workspaceId).toBe(WS_ALPHA);
        });

        it("strips client-injected status during update", async () => {
            workTypesList.push({
                id: "wt_alpha_1",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Alpha Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.workTypeUpdate.mockImplementation(async ({ where, data }: any) => {
                const current = workTypesList.find((wt) => wt.id === where.id)!;
                const updated = {
                    ...current,
                    ...data,
                    updatedAt: new Date(),
                };
                const parentCatalog = catalogsList.find((c) => c.id === updated.catalogId);
                return {
                    ...updated,
                    catalog: parentCatalog,
                };
            });

            loginAs("user_alpha");

            const result = await updateWorkType(WS_ALPHA, "wt_alpha_1", {
                name: "Renamed Work Type",
                status: "INACTIVE",
            } as any);

            expect(result.name).toBe("Renamed Work Type");
            expect(result.status).toBe("ACTIVE"); // status not modified by updateWorkType
        });
    });
});
