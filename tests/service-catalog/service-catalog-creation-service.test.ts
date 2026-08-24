import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogCreate: vi.fn(),
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
            create: mocks.serviceCatalogCreate,
            findFirst: mocks.serviceCatalogFindFirst,
        },
    },
}));

import { createServiceCatalog } from "@/lib/services/serviceCatalog/createServiceCatalog";
import {
    DuplicateServiceCatalogNameError,
    ServiceCatalogCreationError,
} from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.5.4 — ServiceCatalog Creation Service", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];

    const WS_ID = "ws_apex_100";
    const WS_ID_2 = "ws_beta_200";

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
            if (where.id) {
                return membersMap.get(where.id) || null;
            }
            return null;
        });

        mocks.serviceCatalogCreate.mockImplementation(async ({ data }: { data: any }) => {
            const duplicate = catalogsList.find(
                (c) => c.workspaceId === data.workspaceId && c.name.toLowerCase() === data.name.toLowerCase(),
            );
            if (duplicate) {
                const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`name`)");
                (err as any).code = "P2002";
                throw err;
            }

            const created: ServiceCatalog = {
                id: `sc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

    describe("1. Successful Catalog Creation", () => {
        it("creates a catalog with minimal required fields and defaults status to ACTIVE and sortOrder to 0", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const catalog = await createServiceCatalog(WS_ID, {
                name: "Residential HVAC",
            });

            expect(catalog.id).toBeDefined();
            expect(catalog.workspaceId).toBe(WS_ID);
            expect(catalog.name).toBe("Residential HVAC");
            expect(catalog.status).toBe("ACTIVE");
            expect(catalog.sortOrder).toBe(0);
            expect(catalog.description).toBeNull();
        });

        it("creates a catalog with all optional fields persisted and trimmed", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const catalog = await createServiceCatalog(WS_ID, {
                name: "   Commercial Plumbing   ",
                description: "   Comprehensive industrial and commercial plumbing services.   ",
                sortOrder: 5,
            });

            expect(catalog.name).toBe("Commercial Plumbing");
            expect(catalog.description).toBe("Comprehensive industrial and commercial plumbing services.");
            expect(catalog.sortOrder).toBe(5);
            expect(catalog.status).toBe("ACTIVE");
        });
    });

    describe("2. Authorization & RBAC Checks", () => {
        it("allows OWNER to create a catalog", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID, "OWNER");
            loginAs("user_owner");

            const catalog = await createServiceCatalog(WS_ID, { name: "Owner Catalog" });
            expect(catalog.name).toBe("Owner Catalog");
        });

        it("allows ADMIN to create a catalog", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const catalog = await createServiceCatalog(WS_ID, { name: "Admin Catalog" });
            expect(catalog.name).toBe("Admin Catalog");
        });

        it("allows MANAGER to create a catalog", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID, "MANAGER");
            loginAs("user_mgr");

            const catalog = await createServiceCatalog(WS_ID, { name: "Manager Catalog" });
            expect(catalog.name).toBe("Manager Catalog");
        });

        it("rejects DISPATCHER from creating a catalog with ForbiddenError", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID, "DISPATCHER");
            loginAs("user_disp");

            await expect(createServiceCatalog(WS_ID, { name: "Dispatcher Catalog" })).rejects.toThrow(
                ForbiddenError,
            );
        });

        it("rejects TECHNICIAN from creating a catalog with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID, "TECHNICIAN");
            loginAs("user_tech");

            await expect(createServiceCatalog(WS_ID, { name: "Tech Catalog" })).rejects.toThrow(
                ForbiddenError,
            );
        });

        it("rejects ACCOUNTANT from creating a catalog with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID, "ACCOUNTANT");
            loginAs("user_acct");

            await expect(createServiceCatalog(WS_ID, { name: "Acct Catalog" })).rejects.toThrow(
                ForbiddenError,
            );
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(createServiceCatalog(WS_ID, { name: "Unauth Catalog" })).rejects.toThrow(
                UnauthorizedError,
            );
        });

        it("rejects caller with non-active user status with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended", "Suspended User", "SUSPENDED");
            registerMember("user_suspended", WS_ID, "ADMIN");
            loginAs("user_suspended");

            await expect(createServiceCatalog(WS_ID, { name: "Suspended Catalog" })).rejects.toThrow(
                WorkspaceAccessDeniedError,
            );
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(createServiceCatalog("ws_nonexistent", { name: "Nonexistent" })).rejects.toThrow(
                WorkspaceNotFoundError,
            );
        });
    });

    describe("3. Tenant Isolation & Duplicate Handling", () => {
        it("strictly enforces workspaceId from the service argument and ignores injected payload fields", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const catalog = await createServiceCatalog(WS_ID, {
                name: "Electrical",
                workspaceId: "ws_malicious_injected",
            } as any);

            expect(catalog.workspaceId).toBe(WS_ID);
            expect(catalog.workspaceId).not.toBe("ws_malicious_injected");
        });

        it("translates P2002 name collision within the same workspace to DuplicateServiceCatalogNameError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await createServiceCatalog(WS_ID, { name: "HVAC" });

            await expect(createServiceCatalog(WS_ID, { name: "HVAC" })).rejects.toThrow(
                DuplicateServiceCatalogNameError,
            );
        });

        it("permits the same catalog name across different workspaces", async () => {
            registerUser("user_admin_1");
            registerMember("user_admin_1", WS_ID, "ADMIN");

            registerUser("user_admin_2");
            registerMember("user_admin_2", WS_ID_2, "ADMIN");

            loginAs("user_admin_1");
            const c1 = await createServiceCatalog(WS_ID, { name: "HVAC Services" });

            loginAs("user_admin_2");
            const c2 = await createServiceCatalog(WS_ID_2, { name: "HVAC Services" });

            expect(c1.name).toBe("HVAC Services");
            expect(c1.workspaceId).toBe(WS_ID);
            expect(c2.name).toBe("HVAC Services");
            expect(c2.workspaceId).toBe(WS_ID_2);
        });
    });

    describe("4. Error Translation & Database Safety", () => {
        it("translates unexpected database errors into ServiceCatalogCreationError without leaking raw DB details", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            mocks.serviceCatalogCreate.mockRejectedValue(new Error("Connection reset by peer"));

            await expect(createServiceCatalog(WS_ID, { name: "HVAC" })).rejects.toThrow(
                ServiceCatalogCreationError,
            );
        });
    });
});
