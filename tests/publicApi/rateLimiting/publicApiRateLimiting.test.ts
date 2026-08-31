import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
    createDeveloperApplication,
    createApiKey,
} from "@/lib/services/developerApp/developerAppService";
import {
    PUBLIC_API_SCOPES,
    RATE_LIMIT_HEADERS,
    setRateLimitConfig,
    resetRateLimitConfig,
    getRateLimitStore,
} from "@/lib/publicApi";
import { GET as listWorkOrdersHandler } from "@/app/api/v1/work-orders/route";

describe("Phase 1.18.13 — Public API Rate Limiting & Abuse Protection", () => {
    let prisma: PrismaClient;
    const runId = `rl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_rl_1_${runId}`;
    const user1Id = `usr_rl_1_${runId}`;
    let app1Id: string;
    let apiKey1Secret: string;
    let apiKey1Id: string;

    // Tenant 1 - Second API Key in same workspace
    let app1Client2Id: string;
    let apiKey1Client2Secret: string;
    let apiKey1Client2Id: string;

    // Tenant 2 (Cross-tenant testing)
    const ws2Id = `ws_rl_2_${runId}`;
    const user2Id = `usr_rl_2_${runId}`;
    let app2Id: string;
    let apiKey2Secret: string;
    let apiKey2Id: string;

    beforeAll(async () => {
        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL!,
        });
        prisma = new PrismaClient({ adapter });

        // 1. Create Users
        await prisma.user.createMany({
            data: [
                {
                    id: user1Id,
                    email: `rl-user1-${runId}@example.com`,
                    name: "RateLimit Admin 1",
                    status: "ACTIVE",
                },
                {
                    id: user2Id,
                    email: `rl-user2-${runId}@example.com`,
                    name: "RateLimit Admin 2",
                    status: "ACTIVE",
                },
            ],
        });

        // 2. Create Workspaces & Memberships
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "RateLimit Test Workspace 1",
                slug: `rl-ws1-${runId}`,
            },
        });
        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws1Id,
                userId: user1Id,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "RateLimit Test Workspace 2",
                slug: `rl-ws2-${runId}`,
            },
        });
        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: user2Id,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // 3. Setup Developer Applications & API Keys for Workspace 1
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "RateLimit App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const key1Res = await createApiKey(ws1Id, app1Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        apiKey1Secret = key1Res.rawSecretKey;
        apiKey1Id = key1Res.id;

        const app1Client2 = await createDeveloperApplication(ws1Id, {
            name: "RateLimit App 1 Client 2",
            createdByUserId: user1Id,
        });
        app1Client2Id = app1Client2.id;

        const key1Client2Res = await createApiKey(ws1Id, app1Client2Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        apiKey1Client2Secret = key1Client2Res.rawSecretKey;
        apiKey1Client2Id = key1Client2Res.id;

        // 4. Setup Developer Application & Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "RateLimit App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const key2Res = await createApiKey(ws2Id, app2Id, {
            environment: "LIVE",
            scopes: [
                PUBLIC_API_SCOPES.WORK_ORDERS_READ,
                PUBLIC_API_SCOPES.WORK_ORDERS_WRITE,
            ],
        });
        apiKey2Secret = key2Res.rawSecretKey;
        apiKey2Id = key2Res.id;
    }, 30000);

    afterAll(async () => {
        resetRateLimitConfig();
        await getRateLimitStore().clear();

        if (prisma) {
            await prisma.apiKey.deleteMany({
                where: {
                    developerApplication: { workspaceId: { in: [ws1Id, ws2Id] } },
                },
            });
            await prisma.developerApplication.deleteMany({
                where: { workspaceId: { in: [ws1Id, ws2Id] } },
            });
            await prisma.workspaceMember.deleteMany({
                where: { workspaceId: { in: [ws1Id, ws2Id] } },
            });
            await prisma.workspace.deleteMany({
                where: { id: { in: [ws1Id, ws2Id] } },
            });
            await prisma.user.deleteMany({
                where: { id: { in: [user1Id, user2Id] } },
            });
            await prisma.$disconnect();
        }
    }, 30000);

    beforeEach(async () => {
        resetRateLimitConfig();
        await getRateLimitStore().clear();
    });

    function createGetRequest(
        url: string,
        authBearer?: string,
        headers?: Record<string, string>,
    ): Request {
        const reqHeaders: Record<string, string> = {
            ...headers,
        };
        if (authBearer) {
            reqHeaders["authorization"] = `Bearer ${authBearer}`;
        }
        return new Request(url, {
            method: "GET",
            headers: reqHeaders,
        });
    }

    describe("1. Standard Rate Limit Header Attachment & Normal Flow", () => {
        it("returns standard X-RateLimit headers and decrements remaining quota on successful requests", async () => {
            setRateLimitConfig({ defaultKeyLimit: 10, defaultWorkspaceLimit: 50 });

            // 1st Request
            const req1 = createGetRequest(
                "http://localhost/api/v1/work-orders",
                apiKey1Secret,
            );
            const res1 = await listWorkOrdersHandler(req1);
            expect(res1.status).toBe(200);

            expect(res1.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe("10");
            expect(res1.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("9");
            const reset1 = Number(res1.headers.get(RATE_LIMIT_HEADERS.RESET));
            expect(reset1).toBeGreaterThan(Math.floor(Date.now() / 1000));
            expect(res1.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER)).toBeNull();

            // 2nd Request
            const req2 = createGetRequest(
                "http://localhost/api/v1/work-orders",
                apiKey1Secret,
            );
            const res2 = await listWorkOrdersHandler(req2);
            expect(res2.status).toBe(200);
            expect(res2.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe("10");
            expect(res2.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("8");
        });
    });

    describe("2. Per-API-Key Throttling & 429 Response Contract", () => {
        it("exceeding per-API-key quota triggers HTTP 429 RATE_LIMITED with Retry-After and zero remaining", async () => {
            // Set limit to 3 requests
            setRateLimitConfig({ defaultKeyLimit: 3, defaultWorkspaceLimit: 100 });

            // Request 1 -> 200 (2 remaining)
            const res1 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res1.status).toBe(200);
            expect(res1.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("2");

            // Request 2 -> 200 (1 remaining)
            const res2 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res2.status).toBe(200);
            expect(res2.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("1");

            // Request 3 -> 200 (0 remaining)
            const res3 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res3.status).toBe(200);
            expect(res3.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("0");

            // Request 4 -> 429 RATE_LIMITED
            const res4 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res4.status).toBe(429);
            expect(res4.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe("3");
            expect(res4.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("0");
            const retryAfter = Number(res4.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER));
            expect(retryAfter).toBeGreaterThanOrEqual(1);

            const json4 = await res4.json();
            expect(json4.success).toBe(false);
            expect(json4.error.code).toBe("RATE_LIMITED");
            expect(json4.error.message).toContain("API rate limit exceeded");
            expect(json4.error.message).toContain(`Please retry after ${retryAfter} seconds.`);
            expect(json4.error.documentationUrl).toBe(
                "https://docs.aforden.com/api/errors#RATE_LIMITED",
            );
        });
    });

    describe("3. Per-Workspace Aggregate Limit Interaction", () => {
        it("multiple keys in same workspace collectively trigger workspace limit even if individual keys are under quota", async () => {
            // Per-key limit: 5, Workspace aggregate limit: 3
            setRateLimitConfig({ defaultKeyLimit: 5, defaultWorkspaceLimit: 3 });

            // Key 1: Request 1 (Key 1 remaining: 4, Workspace remaining: 2 -> header shows 2)
            const res1 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res1.status).toBe(200);
            expect(res1.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("2");

            // Key 2: Request 1 (Key 2 remaining: 4, Workspace remaining: 1 -> header shows 1)
            const res2 = await listWorkOrdersHandler(
                createGetRequest(
                    "http://localhost/api/v1/work-orders",
                    apiKey1Client2Secret,
                ),
            );
            expect(res2.status).toBe(200);
            expect(res2.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("1");

            // Key 1: Request 2 (Key 1 remaining: 3, Workspace remaining: 0 -> header shows 0)
            const res3 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res3.status).toBe(200);
            expect(res3.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("0");

            // Key 2: Request 2 -> Exceeds workspace aggregate quota (even though Key 2 only used 1/5 of its own key quota)
            const res4 = await listWorkOrdersHandler(
                createGetRequest(
                    "http://localhost/api/v1/work-orders",
                    apiKey1Client2Secret,
                ),
            );
            expect(res4.status).toBe(429);
            expect(res4.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("0");
            const json4 = await res4.json();
            expect(json4.error.code).toBe("RATE_LIMITED");
        });
    });

    describe("4. Multi-Tenant & Multi-Client Isolation", () => {
        it("rate limit exhaustion in Workspace 1 does not affect Workspace 2", async () => {
            setRateLimitConfig({ defaultKeyLimit: 2, defaultWorkspaceLimit: 2 });

            // Exhaust Workspace 1
            await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            const resBlocked = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(resBlocked.status).toBe(429);

            // Workspace 2 request executes normally with full quota
            const resWs2 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey2Secret),
            );
            expect(resWs2.status).toBe(200);
            expect(resWs2.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("1");
        });
    });

    describe("5. Window Reset & Recovery", () => {
        it("resets quota after sliding window and allows requests to resume", async () => {
            setRateLimitConfig({ defaultKeyLimit: 1, defaultWorkspaceLimit: 10 });

            // 1st request succeeds
            const res1 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res1.status).toBe(200);

            // 2nd request blocked
            const res2 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res2.status).toBe(429);

            // Clear/reset the store (simulates sliding window elapsed)
            await getRateLimitStore().clear();

            // Next request succeeds again
            const res3 = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res3.status).toBe(200);
            expect(res3.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("0");
        });
    });

    describe("6. Unauthenticated IP Abuse & Brute-Force Protection", () => {
        it("throttles repeated invalid/missing authentication attempts per client IP", async () => {
            setRateLimitConfig({ defaultUnauthenticatedIpLimit: 2 });
            const testIp = "198.51.100.42";

            // Attempt 1: Bad API key -> 401 UNAUTHORIZED
            const res1 = await listWorkOrdersHandler(
                createGetRequest(
                    "http://localhost/api/v1/work-orders",
                    "afd_live_invalidkey11111111111111111111",
                    { "x-forwarded-for": testIp },
                ),
            );
            expect(res1.status).toBe(401);
            const json1 = await res1.json();
            expect(json1.error.code).toBe("UNAUTHORIZED");

            // Attempt 2: Bad API key -> 401 UNAUTHORIZED
            const res2 = await listWorkOrdersHandler(
                createGetRequest(
                    "http://localhost/api/v1/work-orders",
                    "afd_live_invalidkey22222222222222222222",
                    { "x-forwarded-for": testIp },
                ),
            );
            expect(res2.status).toBe(401);

            // Attempt 3: Exceeds unauthenticated IP limit -> 429 RATE_LIMITED
            const res3 = await listWorkOrdersHandler(
                createGetRequest(
                    "http://localhost/api/v1/work-orders",
                    "afd_live_invalidkey33333333333333333333",
                    { "x-forwarded-for": testIp },
                ),
            );
            expect(res3.status).toBe(429);
            expect(res3.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe("0");
            expect(res3.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER)).toBeDefined();
            const json3 = await res3.json();
            expect(json3.error.code).toBe("RATE_LIMITED");

            // Different IP sending invalid key still gets 401 (isolated)
            const resDiffIp = await listWorkOrdersHandler(
                createGetRequest(
                    "http://localhost/api/v1/work-orders",
                    "afd_live_invalidkey44444444444444444444",
                    { "x-forwarded-for": "198.51.100.99" },
                ),
            );
            expect(resDiffIp.status).toBe(401);
        });
    });

    describe("7. Information Leakage Audit", () => {
        it("confirms no internal storage keys, memory structures, or raw identifiers leak in responses", async () => {
            const res = await listWorkOrdersHandler(
                createGetRequest("http://localhost/api/v1/work-orders", apiKey1Secret),
            );
            expect(res.status).toBe(200);

            // Check response headers - only standard RFC rate limit headers present
            expect(res.headers.get("x-ratelimit-bucket")).toBeNull();
            expect(res.headers.get("x-ratelimit-store")).toBeNull();
            expect(res.headers.get("x-ratelimit-key")).toBeNull();

            const json = await res.json();
            expect(Object.keys(json).sort()).toEqual(["data", "meta", "success"]);
            expect(json.meta.rateLimitBucket).toBeUndefined();
            expect(json.meta.rateLimitKey).toBeUndefined();
        });
    });

    describe("8. SaaS Subscription Tier Workspace Quota Resolution", () => {
        it("dynamically resolves workspace quotas based on SaaS Subscription Plan Tier (Starter: 300, Growth: 1200, Enterprise: 6000)", async () => {
            // 1. Create a platform billing account for Workspace 1
            const billingAccount = await prisma.platformBillingAccount.create({
                data: {
                    workspaceId: ws1Id,
                    billingEmail: `billing-${runId}@example.com`,
                    providerCustomerId: `cus_mock_${runId}`,
                },
            });

            // 2. Create Growth plan and subscription
            const growthPlan = await prisma.subscriptionPlan.create({
                data: {
                    code: `growth-${runId}`,
                    name: "Growth Plan",
                    tier: "GROWTH",
                },
            });

            const growthSub = await prisma.subscription.create({
                data: {
                    workspaceId: ws1Id,
                    accountId: billingAccount.id,
                    planId: growthPlan.id,
                    status: "ACTIVE",
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
            });

            // Clear cache to pick up new subscription
            resetRateLimitConfig();

            const { resolveWorkspaceTierLimit } = await import("@/lib/publicApi/rateLimit/rateLimitService");
            const resolvedGrowthLimit = await resolveWorkspaceTierLimit(ws1Id);
            expect(resolvedGrowthLimit).toBe(1200);

            // 3. Upgrade to Enterprise plan
            const entPlan = await prisma.subscriptionPlan.create({
                data: {
                    code: `enterprise-${runId}`,
                    name: "Enterprise Plan",
                    tier: "ENTERPRISE",
                },
            });

            await prisma.subscription.update({
                where: { id: growthSub.id },
                data: { planId: entPlan.id },
            });

            resetRateLimitConfig();
            const resolvedEntLimit = await resolveWorkspaceTierLimit(ws1Id);
            expect(resolvedEntLimit).toBe(6000);

            // Clean up subscription test records
            await prisma.subscription.deleteMany({ where: { workspaceId: ws1Id } });
            await prisma.platformBillingAccount.deleteMany({ where: { workspaceId: ws1Id } });
            await prisma.subscriptionPlan.deleteMany({
                where: { id: { in: [growthPlan.id, entPlan.id] } },
            });
            resetRateLimitConfig();
        });
    });
}, 30000);

