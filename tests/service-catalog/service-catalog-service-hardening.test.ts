import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogCreate: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogFindMany: vi.fn(),
    serviceCatalogUpdate: vi.fn(),
    serviceCatalogDelete: vi.fn(),
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
            create: mocks.serviceCatalogCreate,
            findFirst: mocks.serviceCatalogFindFirst,
            findMany: mocks.serviceCatalogFindMany,
            update: mocks.serviceCatalogUpdate,
            delete: mocks.serviceCatalogDelete,
            count: mocks.serviceCatalogCount,
        },
        workType: {
            count: mocks.workTypeCount,
        },
    },
}));

import { createServiceCatalog } from "@/lib/services/serviceCatalog/createServiceCatalog";
import { getServiceCatalog } from "@/lib/services/serviceCatalog/getServiceCatalog";
import { updateServiceCatalog } from "@/lib/services/serviceCatalog/updateServiceCatalog";
import { deleteServiceCatalog } from "@/lib/services/serviceCatalog/deleteServiceCatalog";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.5.4 — ServiceCatalog Service Hardening & Security Isolation", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];

    const WS_ALPHA = "ws_alpha_100";
    const WS_BETA = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        catalogsList = [];

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

        mocks.serviceCatalogCreate.mockImplementation(async ({ data }: any) => {
            const created: ServiceCatalog = {
                id: `sc_${Date.now()}`,
                workspaceId: data.workspaceId,
                name: data.name,
                description: data.description ?? null,
                status: data.status ?? "ACTIVE",
                sortOrder: data.sortOrder ?? 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            catalogsList.push(created);
            return created;
        });

        registerWorkspace(WS_ALPHA, "Alpha Workspace", "alpha");
        registerWorkspace(WS_BETA, "Beta Workspace", "beta");

        registerUser("user_alpha", "Alpha Admin");
        registerMember("user_alpha", WS_ALPHA, "ADMIN");

        registerUser("user_beta", "Beta Admin");
        registerMember("user_beta", WS_BETA, "ADMIN");
    });

    function registerUser(userId: string, name = "User") {
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

    describe("1. Cross-Tenant Security Invariants", () => {
        it("returns identical ServiceCatalogNotFoundError for cross-tenant ID vs non-existent ID", async () => {
            catalogsList.push({
                id: "sc_secret_beta",
                workspaceId: WS_BETA,
                name: "Confidential Trade Services",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_alpha");

            // Querying a non-existent ID
            const nonExistentError = await getServiceCatalog(WS_ALPHA, "sc_does_not_exist").catch((e) => e);
            expect(nonExistentError).toBeInstanceOf(ServiceCatalogNotFoundError);

            // Querying Beta's ID from Alpha
            const crossTenantError = await getServiceCatalog(WS_ALPHA, "sc_secret_beta").catch((e) => e);
            expect(crossTenantError).toBeInstanceOf(ServiceCatalogNotFoundError);

            // Error message must not leak that the record exists in another workspace
            expect(crossTenantError.message).toBe(nonExistentError.message);
        });

        it("prevents cross-tenant update and cross-tenant delete", async () => {
            catalogsList.push({
                id: "sc_target_beta",
                workspaceId: WS_BETA,
                name: "Beta Core Services",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_alpha");

            await expect(
                updateServiceCatalog(WS_ALPHA, "sc_target_beta", { name: "Renamed by Alpha" }),
            ).rejects.toThrow(ServiceCatalogNotFoundError);

            await expect(
                deleteServiceCatalog(WS_ALPHA, "sc_target_beta"),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });
    });

    describe("2. Mass Assignment Defense", () => {
        it("ignores injected workspaceId in creation", async () => {
            loginAs("user_alpha");

            const created = await createServiceCatalog(WS_ALPHA, {
                name: "Residential HVAC",
                workspaceId: WS_BETA,
            } as any);

            expect(created.workspaceId).toBe(WS_ALPHA);
        });

        it("ignores injected status and id in update payload", async () => {
            catalogsList.push({
                id: "sc_alpha_1",
                workspaceId: WS_ALPHA,
                name: "Alpha HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.serviceCatalogUpdate.mockImplementation(async ({ where, data }: any) => {
                const current = catalogsList.find((c) => c.id === where.id)!;
                const updated = {
                    ...current,
                    ...data,
                    updatedAt: new Date(),
                };
                return {
                    ...updated,
                    _count: { workTypes: 0 },
                    workTypes: [],
                };
            });

            loginAs("user_alpha");

            const result = await updateServiceCatalog(WS_ALPHA, "sc_alpha_1", {
                name: "Renamed HVAC",
                status: "INACTIVE",
                id: "hacked_id",
            } as any);

            expect(result.name).toBe("Renamed HVAC");
            expect(result.status).toBe("ACTIVE"); // status not updated via general update
            expect(result.id).toBe("sc_alpha_1");
        });
    });
});
