import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogUpdate: vi.fn(),
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
            update: mocks.serviceCatalogUpdate,
        },
    },
}));

import { updateServiceCatalog } from "@/lib/services/serviceCatalog/updateServiceCatalog";
import {
    ServiceCatalogNotFoundError,
    DuplicateServiceCatalogNameError,
    ServiceCatalogUpdateError,
} from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    ForbiddenError,
    UnauthorizedError,
} from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.5.4 — ServiceCatalog Update Service Layer", () => {
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

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                catalogsList.find((c) => {
                    if (where.id && c.id !== where.id) return false;
                    if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                    return true;
                }) || null
            );
        });

        mocks.serviceCatalogUpdate.mockImplementation(async ({ where, data }: any) => {
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }

            const current = catalogsList[idx];

            if (data.name && data.name !== current.name) {
                const duplicate = catalogsList.find(
                    (c) => c.id !== current.id && c.workspaceId === current.workspaceId && c.name.toLowerCase() === data.name.toLowerCase(),
                );
                if (duplicate) {
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`name`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const updated: ServiceCatalog = {
                ...current,
                ...(data.name !== undefined && { name: data.name }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
                updatedAt: new Date(),
            };

            catalogsList[idx] = updated;

            return {
                ...updated,
                _count: { workTypes: 0 },
                workTypes: [],
            };
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

    describe("1. Successful Updates", () => {
        it("updates catalog name, description, and sortOrder", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: "Old description",
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await updateServiceCatalog(WS_ID, "sc_1", {
                name: "Residential & Commercial HVAC",
                description: "Updated full scope description",
                sortOrder: 3,
            });

            expect(result.id).toBe("sc_1");
            expect(result.name).toBe("Residential & Commercial HVAC");
            expect(result.description).toBe("Updated full scope description");
            expect(result.sortOrder).toBe(3);
        });

        it("clears optional description with null", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: "Old description",
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await updateServiceCatalog(WS_ID, "sc_1", {
                description: null,
            });

            expect(result.description).toBeNull();
        });
    });

    describe("2. Authorization & RBAC Checks", () => {
        it("allows OWNER, ADMIN, and MANAGER to update catalog", async () => {
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                const res = await updateServiceCatalog(WS_ID, "sc_1", {
                    name: `HVAC by ${role}`,
                });
                expect(res.name).toBe(`HVAC by ${role}`);
            }
        });

        it("rejects DISPATCHER, TECHNICIAN, and ACCOUNTANT from updating catalog", async () => {
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of ["DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                await expect(
                    updateServiceCatalog(WS_ID, "sc_1", { name: "Illegal Update" }),
                ).rejects.toThrow(ForbiddenError);
            }
        });
    });

    describe("3. Tenant Isolation & Duplicate Validation", () => {
        it("throws ServiceCatalogNotFoundError when attempting to update a catalog in another workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_other_ws",
                workspaceId: WS_ID_2,
                name: "Other WS HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                updateServiceCatalog(WS_ID, "sc_other_ws", { name: "Hijacked Name" }),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });

        it("throws DuplicateServiceCatalogNameError when renaming to an existing name in the same workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push(
                {
                    id: "sc_1",
                    workspaceId: WS_ID,
                    name: "HVAC",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_2",
                    workspaceId: WS_ID,
                    name: "Plumbing",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            await expect(
                updateServiceCatalog(WS_ID, "sc_2", { name: "HVAC" }),
            ).rejects.toThrow(DuplicateServiceCatalogNameError);
        });
    });
});
