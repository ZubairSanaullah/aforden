import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        workspace: {
            findUnique: vi.fn(),
            create: vi.fn(),
        },
        workspaceMember: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
        },
        $transaction: vi.fn(),
    },
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

import { createWorkspace } from "@/lib/services/workspace/createWorkspace";
import { getUserWorkspaces } from "@/lib/services/workspace/getUserWorkspaces";
import { getWorkspaceMembership } from "@/lib/services/workspace/getWorkspaceMembership";
import { requireWorkspaceMembership } from "@/lib/services/workspace/requireWorkspaceMembership";
import { POST as createWorkspaceRoute, GET as getWorkspacesRoute } from "@/app/api/workspaces/route";
import { createWorkspaceSchema } from "@/lib/validations/workspace";

describe("Phase 1.21.2 — Workspace Creation & Membership Services Layer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Workspace Schema Validation (`lib/validations/workspace.ts`)", () => {
        it("accepts valid workspace payload with default timezone", () => {
            const parsed = createWorkspaceSchema.parse({
                name: "  Acme HVAC Services  ",
            });
            expect(parsed.name).toBe("Acme HVAC Services");
            expect(parsed.timezone).toBe("Asia/Karachi");
        });

        it("accepts valid custom timezone", () => {
            const parsed = createWorkspaceSchema.parse({
                name: "Beta Logistics",
                timezone: "America/New_York",
            });
            expect(parsed.timezone).toBe("America/New_York");
        });

        it("rejects names shorter than 2 chars or longer than 100 chars", () => {
            expect(createWorkspaceSchema.safeParse({ name: "A" }).success).toBe(false);
            expect(createWorkspaceSchema.safeParse({ name: "" }).success).toBe(false);
            expect(createWorkspaceSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
        });
    });

    describe("2. Workspace Creation Service (`createWorkspace.ts`)", () => {
        it("creates workspace with generated slug and atomic OWNER membership", async () => {
            mocks.prisma.$transaction.mockImplementation(async (callback: any) => {
                const tx = {
                    workspace: {
                        findUnique: vi.fn().mockResolvedValue(null), // slug is unique on first try
                        create: vi.fn().mockResolvedValue({
                            id: "ws_acme_1",
                            name: "Acme HVAC",
                            slug: "acme-hvac",
                            logoUrl: null,
                            timezone: "America/New_York",
                            createdAt: new Date("2026-09-01T00:00:00.000Z"),
                            updatedAt: new Date("2026-09-01T00:00:00.000Z"),
                        }),
                    },
                };
                return callback(tx);
            });

            const result = await createWorkspace("user_owner_1", {
                name: "Acme HVAC",
                timezone: "America/New_York",
            });

            expect(result.id).toBe("ws_acme_1");
            expect(result.slug).toBe("acme-hvac");
            expect(mocks.prisma.$transaction).toHaveBeenCalled();
        });

        it("resolves slug collisions iteratively by appending numeric suffixes", async () => {
            mocks.prisma.$transaction.mockImplementation(async (callback: any) => {
                const findUnique = vi
                    .fn()
                    .mockResolvedValueOnce({ id: "ws_existing_1" }) // "acme-hvac" taken
                    .mockResolvedValueOnce({ id: "ws_existing_2" }) // "acme-hvac-2" taken
                    .mockResolvedValueOnce(null); // "acme-hvac-3" free

                const create = vi.fn().mockImplementation(({ data }: any) => ({
                    id: "ws_acme_3",
                    name: data.name,
                    slug: data.slug,
                    logoUrl: null,
                    timezone: data.timezone,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));

                const tx = {
                    workspace: { findUnique, create },
                };
                return callback(tx);
            });

            const result = await createWorkspace("user_owner_1", {
                name: "Acme HVAC",
            });

            expect(result.slug).toBe("acme-hvac-3");
        });

        it("falls back to 'workspace' base slug if name contains no slugifiable characters", async () => {
            mocks.prisma.$transaction.mockImplementation(async (callback: any) => {
                const tx = {
                    workspace: {
                        findUnique: vi.fn().mockResolvedValue(null),
                        create: vi.fn().mockImplementation(({ data }: any) => ({
                            id: "ws_fallback",
                            name: data.name,
                            slug: data.slug,
                            logoUrl: null,
                            timezone: data.timezone,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        })),
                    },
                };
                return callback(tx);
            });

            const result = await createWorkspace("user_owner_1", {
                name: "??? !!!",
            });

            expect(result.slug).toBe("workspace");
        });
    });

    describe("3. Workspace Membership Services", () => {
        it("getUserWorkspaces returns active workspaces ordered by createdAt asc", async () => {
            const expectedMemberships = [
                {
                    id: "mem_1",
                    role: "OWNER",
                    status: "ACTIVE",
                    workspaceId: "ws_1",
                    workspace: {
                        id: "ws_1",
                        name: "Workspace 1",
                        slug: "ws-1",
                        logoUrl: null,
                        timezone: "UTC",
                    },
                },
            ];

            mocks.prisma.workspaceMember.findMany.mockResolvedValue(expectedMemberships);

            const result = await getUserWorkspaces("user_1");
            expect(result).toEqual(expectedMemberships);
            expect(mocks.prisma.workspaceMember.findMany).toHaveBeenCalledWith({
                where: {
                    userId: "user_1",
                    status: "ACTIVE",
                },
                orderBy: {
                    createdAt: "asc",
                },
                select: expect.any(Object),
            });
        });

        it("getWorkspaceMembership returns active membership or null", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValueOnce({
                id: "mem_1",
                role: "ADMIN",
                status: "ACTIVE",
                workspaceId: "ws_1",
                workspace: { id: "ws_1", name: "W1", slug: "w1", logoUrl: null, timezone: "UTC" },
            });

            const active = await getWorkspaceMembership("user_1", "ws_1");
            expect(active?.role).toBe("ADMIN");

            mocks.prisma.workspaceMember.findFirst.mockResolvedValueOnce(null);
            const none = await getWorkspaceMembership("user_2", "ws_1");
            expect(none).toBeNull();
        });

        it("requireWorkspaceMembership throws WORKSPACE_ACCESS_DENIED if membership missing", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);

            await expect(requireWorkspaceMembership("user_1", "ws_1")).rejects.toThrow(
                "WORKSPACE_ACCESS_DENIED",
            );
        });

        it("requireWorkspaceMembership returns membership when valid", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                id: "mem_1",
                role: "OWNER",
                status: "ACTIVE",
                workspaceId: "ws_1",
                workspace: { id: "ws_1", name: "W1", slug: "w1", logoUrl: null, timezone: "UTC" },
            });

            const mem = await requireWorkspaceMembership("user_1", "ws_1");
            expect(mem.role).toBe("OWNER");
        });
    });

    describe("4. Workspace REST API Routes (`app/api/workspaces/route.ts`)", () => {
        it("POST /api/workspaces creates workspace and returns 201 Created", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_123" } });
            mocks.prisma.$transaction.mockImplementation(async (callback: any) => {
                return {
                    id: "ws_new_1",
                    name: "Apex Tech",
                    slug: "apex-tech",
                    logoUrl: null,
                    timezone: "Asia/Karachi",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
            });

            const req = new Request("http://localhost:3000/api/workspaces", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "Apex Tech" }),
            });

            const res = await createWorkspaceRoute(req);
            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.workspace.name).toBe("Apex Tech");
        });

        it("POST /api/workspaces returns 401 when session is unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);

            const req = new Request("http://localhost:3000/api/workspaces", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "Apex Tech" }),
            });

            const res = await createWorkspaceRoute(req);
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Unauthorized");
        });

        it("POST /api/workspaces returns 400 on malformed JSON body", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_123" } });

            const req = new Request("http://localhost:3000/api/workspaces", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{ broken-json ",
            });

            const res = await createWorkspaceRoute(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toBe("Invalid request body");
        });

        it("POST /api/workspaces returns 500 on unexpected service exception", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_123" } });
            mocks.prisma.$transaction.mockRejectedValue(new Error("Database crash"));

            const req = new Request("http://localhost:3000/api/workspaces", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "Apex Tech" }),
            });

            const res = await createWorkspaceRoute(req);
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.error).toBe("Unable to create workspace");
        });

        it("GET /api/workspaces returns 200 OK with list of workspaces", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_123" } });
            mocks.prisma.workspaceMember.findMany.mockResolvedValue([
                {
                    id: "mem_1",
                    role: "OWNER",
                    status: "ACTIVE",
                    workspaceId: "ws_1",
                    workspace: { id: "ws_1", name: "Apex Tech", slug: "apex-tech", logoUrl: null, timezone: "UTC" },
                },
            ]);

            const res = await getWorkspacesRoute();
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.workspaces.length).toBe(1);
        });

        it("GET /api/workspaces returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);

            const res = await getWorkspacesRoute();
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Unauthorized");
        });

        it("GET /api/workspaces returns 500 on unexpected database error", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user_123" } });
            mocks.prisma.workspaceMember.findMany.mockRejectedValue(new Error("DB error"));

            const res = await getWorkspacesRoute();
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.error).toBe("Unable to retrieve workspaces");
        });
    });
});
