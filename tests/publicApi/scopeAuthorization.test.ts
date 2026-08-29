import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
    createDeveloperApplication,
    createApiKey,
    revokeApiKey,
    ApiKeyEnvironment,
} from "@/lib/services/developerApp";
import {
    PUBLIC_API_SCOPES,
    ALL_PUBLIC_API_SCOPES,
    isValidPublicApiScope,
    validatePublicApiScopes,
    PUBLIC_SCOPE_TO_INTERNAL_PERMISSIONS_MAP,
} from "@/lib/publicApi/scopes";
import {
    withPublicApiAuth,
    requireScopes,
    jsonSuccess,
} from "@/lib/publicApi";
import { PUBLIC_ERROR_CODES } from "@/lib/publicApi/errors";
import { GENERIC_UNAUTHORIZED_MESSAGE } from "@/lib/publicApi/auth";

describe("Phase 1.18.5 — Public API Authorization & Scope Enforcement", () => {
    let prisma: PrismaClient;
    const runId = `scope_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const wsId = `ws_scope_${runId}`;
    const userId = `usr_scope_${runId}`;

    let appId: string;
    let fullScopeKeySecret: string;
    let readOnlyKeySecret: string;
    let noScopesKeySecret: string;
    let unrelatedScopeKeySecret: string;
    let revokedFullKeySecret: string;

    // Sample protected handlers for testing
    const workOrderWriteHandler = requireScopes(
        [PUBLIC_API_SCOPES.WORK_ORDERS_READ, PUBLIC_API_SCOPES.WORK_ORDERS_WRITE],
        async () => {
            return jsonSuccess({ result: "work_order_created" });
        },
    );

    const orScopeHandler = withPublicApiAuth(
        async () => {
            return jsonSuccess({ result: "read_success" });
        },
        {
            requiredScopes: [
                PUBLIC_API_SCOPES.CUSTOMERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
            ],
            scopeMode: "OR",
        },
    );

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Create test user & workspace
        await prisma.user.create({
            data: {
                id: userId,
                email: `scope-test-${runId}@example.com`,
                name: "Scope Test User",
                status: "ACTIVE",
            },
        });

        await prisma.workspace.create({
            data: {
                id: wsId,
                name: "Scope Test Workspace",
                slug: `scope-slug-${runId}`,
            },
        });

        // 2. Create Developer Application
        const app = await createDeveloperApplication(wsId, {
            name: "Scope Test Application",
            createdByUserId: userId,
        });
        appId = app.id;

        // Key with both read and write scopes
        const fullKey = await createApiKey(wsId, appId, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        fullScopeKeySecret = fullKey.rawSecretKey;

        // Key with read-only scope
        const readKey = await createApiKey(wsId, appId, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ],
        });
        readOnlyKeySecret = readKey.rawSecretKey;

        // Key with zero scopes
        const noScopeKey = await createApiKey(wsId, appId, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [],
        });
        noScopesKeySecret = noScopeKey.rawSecretKey;

        // Key with unrelated scopes (customers only)
        const unrelatedKey = await createApiKey(wsId, appId, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [PUBLIC_API_SCOPES.CUSTOMERS_READ],
        });
        unrelatedScopeKeySecret = unrelatedKey.rawSecretKey;

        // Revoked key that originally had full scopes
        const revKey = await createApiKey(wsId, appId, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        await revokeApiKey(wsId, appId, revKey.id);
        revokedFullKeySecret = revKey.rawSecretKey;
    });

    afterAll(async () => {
        if (prisma) {
            await prisma.workspace.deleteMany({
                where: { id: wsId },
            });
            await prisma.user.deleteMany({
                where: { id: userId },
            });
            await prisma.$disconnect();
        }
    });

    describe("1. Scope Registry & Key Creation Validation", () => {
        it("should define all expected canonical scopes", () => {
            expect(ALL_PUBLIC_API_SCOPES).toContain("work_orders:read");
            expect(ALL_PUBLIC_API_SCOPES).toContain("work_orders:write");
            expect(ALL_PUBLIC_API_SCOPES).toContain("customers:read");
            expect(ALL_PUBLIC_API_SCOPES).toContain("customers:write");
            expect(ALL_PUBLIC_API_SCOPES).toContain("invoices:read");
            expect(ALL_PUBLIC_API_SCOPES).toContain("ping:read");
        });

        it("should validate recognized vs unrecognized scopes", () => {
            expect(isValidPublicApiScope("work_orders:read")).toBe(true);
            expect(isValidPublicApiScope("invalid_scope_name")).toBe(false);
            expect(isValidPublicApiScope("")).toBe(false);
            expect(isValidPublicApiScope(null)).toBe(false);

            const check = validatePublicApiScopes([
                "work_orders:read",
                "admin:superpowers",
                "root:all",
            ]);
            expect(check.valid).toBe(false);
            expect(check.invalidScopes).toEqual(["admin:superpowers", "root:all"]);
        });

        it("should reject ApiKey creation with invalid/unknown scope string", async () => {
            await expect(
                createApiKey(wsId, appId, {
                    scopes: ["work_orders:read", "invalid:fake:scope"],
                }),
            ).rejects.toThrow(/invalid scope\(s\) requested/i);
        });

        it("should succeed ApiKey creation when all scopes are canonical", async () => {
            const key = await createApiKey(wsId, appId, {
                scopes: [PUBLIC_API_SCOPES.ASSETS_READ, PUBLIC_API_SCOPES.ASSETS_WRITE],
            });
            expect(key.id).toBeDefined();
            expect(key.scopes).toEqual(["assets:read", "assets:write"]);
        });
    });

    describe("2. Scope Authorization Enforcement (requireScopes)", () => {
        it("should return HTTP 200 when request key possesses all required scopes (AND mode)", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${fullScopeKeySecret}`,
                    "x-request-id": "scope-auth-success",
                },
            });

            const res = await workOrderWriteHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.result).toBe("work_order_created");
            expect(json.meta.requestId).toBe("scope-auth-success");
        });

        it("should return HTTP 403 FORBIDDEN when key is missing one required scope", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${readOnlyKeySecret}`,
                    "x-request-id": "scope-missing-write",
                },
            });

            const res = await workOrderWriteHandler(req);
            expect(res.status).toBe(403);
            expect(res.headers.get("content-type")).toBe("application/json");

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe(PUBLIC_ERROR_CODES.FORBIDDEN);
            expect(json.error.message).toBe("Missing required API scope.");
            expect(json.error.requestId).toBe("scope-missing-write");
            expect(json.error.documentationUrl).toBe(
                "https://docs.aforden.com/api/errors#FORBIDDEN",
            );
            expect(json.error.details).toBeDefined();
            expect(json.error.details![0].issue).toBe("INSUFFICIENT_SCOPE");
            expect(json.error.details![0].message).toContain("work_orders:write");
        });

        it("should return HTTP 403 FORBIDDEN when key has zero scopes", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${noScopesKeySecret}`,
                    "x-request-id": "scope-empty",
                },
            });

            const res = await workOrderWriteHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("should return HTTP 403 FORBIDDEN when key has only unrelated scopes", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${unrelatedScopeKeySecret}`,
                    "x-request-id": "scope-unrelated",
                },
            });

            const res = await workOrderWriteHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("should support OR scope mode (passes if at least one required scope is held)", async () => {
            // Key has work_orders:read (satisfies OR requirement of customers:read OR work_orders:read)
            const req = new Request("http://localhost:3000/api/v1/resource", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${readOnlyKeySecret}`,
                },
            });

            const res = await orScopeHandler(req);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.data.result).toBe("read_success");
        });
    });

    describe("3. Execution Ordering: Authenticate Before Authorize (401 precedes 403)", () => {
        it("should return HTTP 401 UNAUTHORIZED (not 403) when request is completely unauthenticated", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {}, // No Authorization header
            });

            const res = await workOrderWriteHandler(req);
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.error.code).toBe(PUBLIC_ERROR_CODES.UNAUTHORIZED);
            expect(json.error.message).toBe(GENERIC_UNAUTHORIZED_MESSAGE);
        });

        it("should return HTTP 401 UNAUTHORIZED (not 403) when key has full scopes but is REVOKED", async () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${revokedFullKeySecret}`,
                },
            });

            const res = await workOrderWriteHandler(req);
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.error.code).toBe(PUBLIC_ERROR_CODES.UNAUTHORIZED);
            expect(json.error.message).toBe(GENERIC_UNAUTHORIZED_MESSAGE);
        });
    });

    describe("4. Decoupled RBAC Permission Mapping", () => {
        it("should provide an explicit mapping for every canonical public API scope", () => {
            for (const scope of ALL_PUBLIC_API_SCOPES) {
                const mappedPermissions = PUBLIC_SCOPE_TO_INTERNAL_PERMISSIONS_MAP[scope];
                expect(
                    mappedPermissions,
                    `Scope '${scope}' must have an explicit internal permission mapping`,
                ).toBeDefined();
                expect(mappedPermissions.length).toBeGreaterThan(0);
            }
        });
    });
});
