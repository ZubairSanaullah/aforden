import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    workTypeCreate: vi.fn(),
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
        serviceCatalog: {
            findFirst: mocks.serviceCatalogFindFirst,
        },
        workType: {
            create: mocks.workTypeCreate,
            findFirst: mocks.workTypeFindFirst,
        },
    },
}));

import { createWorkType } from "@/lib/services/workType/createWorkType";
import {
    DuplicateWorkTypeNameError,
    DuplicateWorkTypeCodeError,
    WorkTypeCreationError,
} from "@/lib/services/workType/workTypeErrors";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.5 — WorkType Creation Service Layer", () => {
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

        mocks.workTypeFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                workTypesList.find((wt) => {
                    if (where.id && wt.id !== where.id) return false;
                    if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                    if (where.code && wt.code !== where.code) return false;
                    return true;
                }) || null
            );
        });

        mocks.workTypeCreate.mockImplementation(async ({ data, include }: any) => {
            // Check catalog-scoped name uniqueness
            const nameDup = workTypesList.find(
                (wt) => wt.catalogId === data.catalogId && wt.name.toLowerCase() === data.name.toLowerCase(),
            );
            if (nameDup) {
                const err = new Error("Unique constraint failed on the fields: (`catalogId`,`name`)");
                (err as any).code = "P2002";
                (err as any).meta = { target: ["catalogId", "name"] };
                throw err;
            }

            // Check workspace-scoped code uniqueness (when code is non-null)
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
                id: "sc_plumb",
                workspaceId: WS_ID,
                name: "Plumbing",
                description: "Plumbing Services",
                status: "ACTIVE",
                sortOrder: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_inactive",
                workspaceId: WS_ID,
                name: "Legacy Services",
                description: "Inactive trade",
                status: "INACTIVE",
                sortOrder: 3,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_beta_hvac",
                workspaceId: WS_ID_2,
                name: "Beta HVAC",
                description: "Beta catalog",
                status: "ACTIVE",
                sortOrder: 1,
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
        platformRole: null,
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

    describe("1. Successful WorkType Creation", () => {
        it("creates a work type with minimal required fields (catalogId, name) and computes availability", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const workType = await createWorkType(WS_ID, {
                catalogId: "sc_hvac",
                name: "AC Inspection & Diagnostic",
            });

            expect(workType.id).toBeDefined();
            expect(workType.workspaceId).toBe(WS_ID);
            expect(workType.catalogId).toBe("sc_hvac");
            expect(workType.catalogName).toBe("Residential HVAC");
            expect(workType.catalogStatus).toBe("ACTIVE");
            expect(workType.name).toBe("AC Inspection & Diagnostic");
            expect(workType.code).toBeNull();
            expect(workType.description).toBeNull();
            expect(workType.estimatedDuration).toBeNull();
            expect(workType.status).toBe("ACTIVE");
            expect(workType.sortOrder).toBe(0);
            expect(workType.isAvailableForWorkOrder).toBe(true);
        });

        it("creates a work type with full fields and normalized uppercase code", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const input = {
                catalogId: "sc_hvac",
                name: "Emergency Furnace Diagnostic",
                code: "hvac-furn-em",
                description: "24/7 emergency diagnostic service.",
                estimatedDuration: 90,
                sortOrder: 3,
            };

            const workType = await createWorkType(WS_ID, input);

            expect(workType.name).toBe("Emergency Furnace Diagnostic");
            expect(workType.code).toBe("HVAC-FURN-EM");
            expect(workType.description).toBe("24/7 emergency diagnostic service.");
            expect(workType.estimatedDuration).toBe(90);
            expect(workType.sortOrder).toBe(3);
            expect(workType.isAvailableForWorkOrder).toBe(true);
        });

        it("computes isAvailableForWorkOrder as false when created under an INACTIVE parent catalog", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const workType = await createWorkType(WS_ID, {
                catalogId: "sc_inactive",
                name: "Legacy Boiler Service",
            });

            expect(workType.status).toBe("ACTIVE");
            expect(workType.catalogStatus).toBe("INACTIVE");
            expect(workType.isAvailableForWorkOrder).toBe(false);
        });
    });

    describe("2. Critical Tenant Alignment Invariant", () => {
        it("rejects creation if catalogId belongs to another workspace (cross-tenant attack)", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(
                createWorkType(WS_ID, {
                    catalogId: "sc_beta_hvac", // Belongs to WS_ID_2
                    name: "Cross-Tenant Work Type",
                }),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });

        it("rejects creation if catalogId does not exist", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(
                createWorkType(WS_ID, {
                    catalogId: "sc_nonexistent",
                    name: "Ghost Work Type",
                }),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });
    });

    describe("3. Concurrency & Uniqueness Handlers", () => {
        it("translates duplicate name within the same catalog into DuplicateWorkTypeNameError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await createWorkType(WS_ID, {
                catalogId: "sc_hvac",
                name: "AC Tune Up",
            });

            await expect(
                createWorkType(WS_ID, {
                    catalogId: "sc_hvac",
                    name: "AC Tune Up",
                }),
            ).rejects.toThrow(DuplicateWorkTypeNameError);
        });

        it("allows same work type name under different catalogs in the same workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const wt1 = await createWorkType(WS_ID, {
                catalogId: "sc_hvac",
                name: "General Inspection",
            });

            const wt2 = await createWorkType(WS_ID, {
                catalogId: "sc_plumb",
                name: "General Inspection",
            });

            expect(wt1.name).toBe("General Inspection");
            expect(wt2.name).toBe("General Inspection");
            expect(wt1.catalogId).not.toBe(wt2.catalogId);
        });

        it("translates duplicate code within the same workspace into DuplicateWorkTypeCodeError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await createWorkType(WS_ID, {
                catalogId: "sc_hvac",
                name: "Service A",
                code: "INSP-01",
            });

            await expect(
                createWorkType(WS_ID, {
                    catalogId: "sc_plumb",
                    name: "Service B",
                    code: "INSP-01",
                }),
            ).rejects.toThrow(DuplicateWorkTypeCodeError);
        });

        it("allows same code across different workspaces", async () => {
            registerUser("user_admin_1");
            registerMember("user_admin_1", WS_ID, "ADMIN");

            registerUser("user_admin_2");
            registerMember("user_admin_2", WS_ID_2, "ADMIN");

            loginAs("user_admin_1");
            const wt1 = await createWorkType(WS_ID, {
                catalogId: "sc_hvac",
                name: "Standard Diagnostic",
                code: "DIAG-STD",
            });

            loginAs("user_admin_2");
            const wt2 = await createWorkType(WS_ID_2, {
                catalogId: "sc_beta_hvac",
                name: "Standard Diagnostic",
                code: "DIAG-STD",
            });

            expect(wt1.code).toBe("DIAG-STD");
            expect(wt2.code).toBe("DIAG-STD");
            expect(wt1.workspaceId).toBe(WS_ID);
            expect(wt2.workspaceId).toBe(WS_ID_2);
        });
    });

    describe("4. Authorization & RBAC Checks", () => {
        it("allows OWNER, ADMIN, and MANAGER to create work types", async () => {
            for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                const wt = await createWorkType(WS_ID, {
                    catalogId: "sc_hvac",
                    name: `Service by ${role}`,
                });
                expect(wt.name).toBe(`Service by ${role}`);
            }
        });

        it("rejects DISPATCHER, TECHNICIAN, and ACCOUNTANT with ForbiddenError", async () => {
            for (const role of ["DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                await expect(
                    createWorkType(WS_ID, {
                        catalogId: "sc_hvac",
                        name: `Service by ${role}`,
                    }),
                ).rejects.toThrow(ForbiddenError);
            }
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createWorkType(WS_ID, {
                    catalogId: "sc_hvac",
                    name: "Unauth Service",
                }),
            ).rejects.toThrow(UnauthorizedError);
        });
    });
});
