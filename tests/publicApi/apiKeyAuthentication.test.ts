import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { GET as pingRouteHandler } from "@/app/api/v1/ping/route";
import {
    createDeveloperApplication,
    createApiKey,
    revokeApiKey,
    updateDeveloperApplicationStatus,
    DeveloperApplicationStatus,
    ApiKeyEnvironment,
} from "@/lib/services/developerApp";
import { GENERIC_UNAUTHORIZED_MESSAGE } from "@/lib/publicApi/auth";
import { PUBLIC_ERROR_CODES } from "@/lib/publicApi/errors";

describe("Phase 1.18.4 — Public API Key Authentication & Context", () => {
    let prisma: PrismaClient;
    const runId = `auth_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const wsId = `ws_auth_${runId}`;
    const userId = `usr_auth_${runId}`;

    let liveAppId: string;
    let liveKeySecret: string;
    let liveApiKeyId: string;

    let testKeySecret: string;

    let revokedKeySecret: string;
    let expiredKeySecret: string;

    let suspendedAppId: string;
    let suspendedKeySecret: string;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Create a test user
        await prisma.user.create({
            data: {
                id: userId,
                email: `auth-test-${runId}@example.com`,
                name: "API Auth Test User",
                status: "ACTIVE",
            },
        });

        // 2. Create a test workspace
        await prisma.workspace.create({
            data: {
                id: wsId,
                name: "Auth Test Workspace",
                slug: `auth-slug-${runId}`,
            },
        });

        // 3. Create an active Developer Application & active live/test keys
        const app = await createDeveloperApplication(wsId, {
            name: "Field Service Mobile App",
            description: "Primary field client",
            createdByUserId: userId,
        });
        liveAppId = app.id;

        const liveKey = await createApiKey(wsId, liveAppId, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: ["ping:read", "work_orders:read", "work_orders:write"],
        });
        liveKeySecret = liveKey.rawSecretKey;
        liveApiKeyId = liveKey.id;

        const testKey = await createApiKey(wsId, liveAppId, {
            environment: ApiKeyEnvironment.TEST,
            scopes: ["ping:read", "work_orders:read"],
        });
        testKeySecret = testKey.rawSecretKey;

        // 4. Create a key and revoke it
        const revKey = await createApiKey(wsId, liveAppId, {
            scopes: ["ping:read", "work_orders:read"],
        });
        await revokeApiKey(wsId, liveAppId, revKey.id);
        revokedKeySecret = revKey.rawSecretKey;

        // 5. Create an expired key (expired 2 hours ago)
        const expKey = await createApiKey(wsId, liveAppId, {
            scopes: ["ping:read", "work_orders:read"],
            expiresAt: new Date(Date.now() - 7200 * 1000),
        });
        expiredKeySecret = expKey.rawSecretKey;

        // 6. Create a suspended developer application and key
        const suspApp = await createDeveloperApplication(wsId, {
            name: "Suspended Partner Integration",
            createdByUserId: userId,
        });
        suspendedAppId = suspApp.id;

        const suspKey = await createApiKey(wsId, suspendedAppId, {
            scopes: ["ping:read", "work_orders:read"],
        });
        suspendedKeySecret = suspKey.rawSecretKey;
        await updateDeveloperApplicationStatus(
            wsId,
            suspendedAppId,
            DeveloperApplicationStatus.SUSPENDED,
        );
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

    describe("1. Successful Authentication (GET /api/v1/ping)", () => {
        it("should return HTTP 200 with populated application and environment context for valid LIVE key", async () => {
            const req = new Request("http://localhost:3000/api/v1/ping", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${liveKeySecret}`,
                    "x-request-id": "auth-test-valid-live",
                },
            });

            const res = await pingRouteHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual({
                status: "ok",
                message: "Aforden Public API v1 is operational",
                application: "Field Service Mobile App",
                environment: "LIVE",
                scopes: ["ping:read", "work_orders:read", "work_orders:write"],
            });
            expect(json.meta.requestId).toBe("auth-test-valid-live");
            expect(json.meta.timestamp).toBeDefined();
            expect(res.headers.get("x-request-id")).toBe("auth-test-valid-live");
        });

        it("should return HTTP 200 with TEST environment context for valid TEST key", async () => {
            const req = new Request("http://localhost:3000/api/v1/ping", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${testKeySecret}`,
                },
            });

            const res = await pingRouteHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.environment).toBe("TEST");
        });

        it("should update lastUsedAt on the ApiKey record upon successful authentication", async () => {
            const freshKey = await createApiKey(wsId, liveAppId, {
                environment: ApiKeyEnvironment.LIVE,
                scopes: ["ping:read", "work_orders:read"],
            });
            expect(freshKey.id).toBeDefined();

            const beforeAuth = await prisma.apiKey.findUnique({
                where: { id: freshKey.id },
            });
            expect(beforeAuth?.lastUsedAt).toBeNull();

            const req = new Request("http://localhost:3000/api/v1/ping", {
                method: "GET",
                headers: {
                    authorization: `Bearer ${freshKey.rawSecretKey}`,
                },
            });

            const res = await pingRouteHandler(req);
            expect(res.status).toBe(200);

            // Small delay to allow asynchronous touchApiKeyLastUsed to persist
            await new Promise((r) => setTimeout(r, 200));

            const afterAuth = await prisma.apiKey.findUnique({
                where: { id: freshKey.id },
            });
            expect(afterAuth?.lastUsedAt).not.toBeNull();
            expect(afterAuth!.lastUsedAt).toBeInstanceOf(Date);
        });
    });

    describe("2. Authentication Failure Modes (Enumeration Resistance)", () => {
        const failureCases: { name: string; headers: Record<string, string> }[] = [
            {
                name: "Missing Authorization header",
                headers: {},
            },
            {
                name: "Non-Bearer header scheme (Basic auth)",
                headers: { authorization: "Basic dXNlcjpwYXNz" },
            },
            {
                name: "Malformed Bearer token (no prefix)",
                headers: { authorization: "Bearer invalid_secret_12345" },
            },
            {
                name: "Malformed Bearer token (truncated)",
                headers: { authorization: "Bearer afd_live_short" },
            },
            {
                name: "Non-existent key with valid prefix format",
                headers: {
                    authorization:
                        "Bearer afd_live_00000000000000000000000000000000",
                },
            },
            {
                name: "Revoked API key",
                headers: { authorization: `Bearer ${revokedKeySecret}` },
            },
            {
                name: "Expired API key",
                headers: { authorization: `Bearer ${expiredKeySecret}` },
            },
            {
                name: "API key belonging to a SUSPENDED Developer Application",
                headers: { authorization: `Bearer ${suspendedKeySecret}` },
            },
        ];

        for (const testCase of failureCases) {
            it(`should return HTTP 401 UNAUTHORIZED with identical generic error envelope on ${testCase.name}`, async () => {
                const req = new Request("http://localhost:3000/api/v1/ping", {
                    method: "GET",
                    headers: {
                        ...testCase.headers,
                        "x-request-id": "auth-enum-check",
                    },
                });

                const res = await pingRouteHandler(req);
                expect(res.status).toBe(401);
                expect(res.headers.get("content-type")).toBe("application/json");
                expect(res.headers.get("x-request-id")).toBe("auth-enum-check");

                const json = await res.json();
                expect(json).toEqual({
                    success: false,
                    error: {
                        code: PUBLIC_ERROR_CODES.UNAUTHORIZED,
                        message: GENERIC_UNAUTHORIZED_MESSAGE,
                        requestId: "auth-enum-check",
                        documentationUrl:
                            "https://docs.aforden.com/api/errors#UNAUTHORIZED",
                    },
                });
            });
        }

        it("should produce byte-identical JSON response bodies across all 401 failure modes when given identical requestId", async () => {
            const fixedRequestId = "static-req-id-123";
            const responseBodies: string[] = [];

            for (const testCase of failureCases) {
                const req = new Request("http://localhost:3000/api/v1/ping", {
                    method: "GET",
                    headers: {
                        ...testCase.headers,
                        "x-request-id": fixedRequestId,
                    },
                });

                const res = await pingRouteHandler(req);
                const text = await res.text();
                responseBodies.push(text);
            }

            // Every failure response body must be 100% byte-identical
            const firstBody = responseBodies[0];
            for (let i = 1; i < responseBodies.length; i++) {
                expect(
                    responseBodies[i],
                    `Response body for '${failureCases[i].name}' should match '${failureCases[0].name}' byte-for-byte`,
                ).toBe(firstBody);
            }
        });
    });
});
