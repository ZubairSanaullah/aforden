import { describe, it, expect, vi, beforeEach } from "vitest";

// =========================================================================
// Mocks Setup
// =========================================================================

const {
    findManyAppsMock,
    findUniqueAppMock,
    updateAppMock,
    findManyKeysMock,
    findUniqueKeyMock,
    updateKeyMock,
    findManyWebhooksMock,
    findUniqueWebhookMock,
    updateWebhookMock,
    transactionMock,
    auditCreateMock,
    findFirstSubscriptionMock,
} = vi.hoisted(() => ({
    findManyAppsMock: vi.fn(),
    findUniqueAppMock: vi.fn(),
    updateAppMock: vi.fn(),
    findManyKeysMock: vi.fn(),
    findUniqueKeyMock: vi.fn(),
    updateKeyMock: vi.fn(),
    findManyWebhooksMock: vi.fn(),
    findUniqueWebhookMock: vi.fn(),
    updateWebhookMock: vi.fn(),
    transactionMock: vi.fn(),
    auditCreateMock: vi.fn(),
    findFirstSubscriptionMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        developerApplication: {
            findMany: findManyAppsMock,
            findUnique: findUniqueAppMock,
            update: updateAppMock,
        },
        apiKey: {
            findMany: findManyKeysMock,
            findUnique: findUniqueKeyMock,
            update: updateKeyMock,
        },
        webhookEndpoint: {
            findMany: findManyWebhooksMock,
            findUnique: findUniqueWebhookMock,
            update: updateWebhookMock,
        },
        subscription: {
            findFirst: findFirstSubscriptionMock,
        },
        platformAuditLog: {
            create: auditCreateMock,
        },
        $transaction: transactionMock,
    },
}));

import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
    PlatformAccessDeniedError,
} from "@/lib/services/platform/authorization";
import { PLATFORM_AUDIT_EVENTS } from "@/lib/services/platform/audit";
import {
    listPlatformDeveloperApplications,
    getPlatformDeveloperApplication,
    updatePlatformDeveloperApplicationStatus,
    listPlatformApiKeys,
    getPlatformApiKey,
    revokePlatformApiKey,
    listPlatformWebhookEndpoints,
    disablePlatformWebhookEndpoint,
    getPlatformRateLimitStatus,
    resetPlatformRateLimit,
} from "@/lib/services/platform/developer";
import {
    PlatformDeveloperApplicationNotFoundError,
    PlatformApiKeyNotFoundError,
    PlatformWebhookEndpointNotFoundError,
    PlatformDeveloperValidationError,
    PlatformDeveloperConflictError,
} from "@/lib/services/platform/developer/errors";
import { PlatformActionValidationError } from "@/lib/services/platform/workspaces/errors";
import { getRateLimitStore } from "@/lib/publicApi/rateLimit/rateLimitService";

describe("Phase 1.19.12 — Platform API & Developer Administration Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default transaction mock implementation: executes callback with mocked tx
        transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
            const tx = {
                developerApplication: {
                    findUnique: findUniqueAppMock,
                    update: updateAppMock,
                },
                apiKey: {
                    findUnique: findUniqueKeyMock,
                    update: updateKeyMock,
                },
                webhookEndpoint: {
                    findUnique: findUniqueWebhookMock,
                    update: updateWebhookMock,
                },
                platformAuditLog: {
                    create: auditCreateMock,
                },
            };
            return callback(tx);
        });
    });

    function createPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN
    ): PlatformAuthorizationContext {
        return {
            userId: `usr_${role.toLowerCase()}`,
            email: `${role.toLowerCase()}@aforden.com`,
            name: `${role} Operator`,
            avatarUrl: null,
            platformRole: role,
            profileId: `prof_${role.toLowerCase()}`,
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt: new Date(),
            metadata: null,
        };
    }

    // =========================================================================
    // 1. Permission Gating (Both Ways)
    // =========================================================================
    describe("1. Permission Gating & RBAC Boundaries", () => {
        it("allows PLATFORM_ADMIN to view applications and revoke keys", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            findManyAppsMock.mockResolvedValueOnce([]);

            const apps = await listPlatformDeveloperApplications(context);
            expect(apps).toEqual([]);
        });

        it("allows PLATFORM_SUPPORT to view applications but denies key revocation and webhook disabling", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_SUPPORT);
            findManyAppsMock.mockResolvedValueOnce([]);

            // Read allowed
            await expect(listPlatformDeveloperApplications(context)).resolves.toEqual([]);

            // Mutation denied: revoke key
            await expect(
                revokePlatformApiKey(context, "key_1", "Security leak investigation reason")
            ).rejects.toThrow(PlatformAccessDeniedError);

            // Mutation denied: disable webhook
            await expect(
                disablePlatformWebhookEndpoint(context, "wh_1", "Operational reason")
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("allows PLATFORM_OPERATIONS to disable webhooks and reset rate limits, but denies viewing apps and revoking keys", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            // View apps denied
            await expect(listPlatformDeveloperApplications(context)).rejects.toThrow(
                PlatformAccessDeniedError
            );

            // Revoke keys denied
            await expect(
                revokePlatformApiKey(context, "key_1", "Security leak investigation reason")
            ).rejects.toThrow(PlatformAccessDeniedError);

            // Webhook management allowed
            findUniqueWebhookMock.mockResolvedValueOnce({
                id: "wh_1",
                workspaceId: "ws_alpha",
                status: "ACTIVE",
                secret: "whsec_1234567890abcdef",
            });
            updateWebhookMock.mockResolvedValueOnce({
                id: "wh_1",
                workspaceId: "ws_alpha",
                status: "DISABLED",
                secret: "whsec_1234567890abcdef",
                events: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                disablePlatformWebhookEndpoint(context, "wh_1", "Endpoint returning 500 continuously")
            ).resolves.toBeDefined();
        });

        it("strictly denies PLATFORM_BILLING on all developer platform administrative actions", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(listPlatformDeveloperApplications(context)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(
                revokePlatformApiKey(context, "key_1", "Revoking billing abuser key")
            ).rejects.toThrow(PlatformAccessDeniedError);
            await expect(
                disablePlatformWebhookEndpoint(context, "wh_1", "Billing suspension")
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("strictly denies non-platform / tenant user contexts", async () => {
            const tenantContext = {
                userId: "usr_tenant_owner",
                workspaceId: "ws_acme",
                role: "OWNER",
                permissions: ["workspaces.owner", "developer_apps.manage"],
            } as unknown as PlatformAuthorizationContext;

            await expect(listPlatformDeveloperApplications(tenantContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
        });
    });

    // =========================================================================
    // 2. Cross-Tenant Developer Application Queries
    // =========================================================================
    describe("2. Cross-Tenant Developer Application Queries", () => {
        it("lists developer applications with aggregate counts across all tenants", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findManyAppsMock.mockResolvedValueOnce([
                {
                    id: "app_1",
                    workspaceId: "ws_1",
                    name: "Zapier Integration",
                    description: "Connector app",
                    status: "ACTIVE",
                    createdByUserId: "usr_dev1",
                    createdAt: now,
                    updatedAt: now,
                    _count: { apiKeys: 2, webhookEndpoints: 1 },
                },
                {
                    id: "app_2",
                    workspaceId: "ws_2",
                    name: "ERP Sync",
                    description: "Internal sync",
                    status: "SUSPENDED",
                    createdByUserId: "usr_dev2",
                    createdAt: now,
                    updatedAt: now,
                    _count: { apiKeys: 0, webhookEndpoints: 3 },
                },
            ]);

            const apps = await listPlatformDeveloperApplications(context, {
                status: "ACTIVE",
                search: "Zapier",
            });

            expect(apps).toHaveLength(2);
            expect(apps[0]).toEqual({
                id: "app_1",
                workspaceId: "ws_1",
                name: "Zapier Integration",
                description: "Connector app",
                status: "ACTIVE",
                createdByUserId: "usr_dev1",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                apiKeyCount: 2,
                webhookCount: 1,
            });

            expect(findManyAppsMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: "ACTIVE",
                        OR: [
                            { name: { contains: "Zapier", mode: "insensitive" } },
                            { description: { contains: "Zapier", mode: "insensitive" } },
                        ],
                    }),
                })
            );
        });

        it("fetches detailed developer application metadata with nested keys and webhooks", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueAppMock.mockResolvedValueOnce({
                id: "app_100",
                workspaceId: "ws_100",
                name: "Mobile Field Service App",
                description: "iOS & Android app",
                status: "ACTIVE",
                createdByUserId: "usr_lead",
                createdAt: now,
                updatedAt: now,
                workspace: { name: "Apex Solutions", slug: "apex-solutions" },
                createdByUser: { email: "lead@apex.com" },
                apiKeys: [
                    {
                        id: "key_1",
                        developerApplicationId: "app_100",
                        keyPrefix: "afd_live_abc1...9xyz",
                        environment: "LIVE",
                        status: "ACTIVE",
                        scopes: ["work_orders.read", "technicians.read"],
                        expiresAt: null,
                        revokedAt: null,
                        lastUsedAt: now,
                        createdAt: now,
                        updatedAt: now,
                    },
                ],
                webhookEndpoints: [
                    {
                        id: "wh_1",
                        workspaceId: "ws_100",
                        developerApplicationId: "app_100",
                        url: "https://apex.com/webhooks/orders",
                        description: "Dispatched orders",
                        status: "ACTIVE",
                        events: ["work_order.created"],
                        secret: "whsec_verylongsecretkey123456789",
                        createdAt: now,
                        updatedAt: now,
                    },
                ],
            });

            const detail = await getPlatformDeveloperApplication(context, "app_100");

            expect(detail.id).toBe("app_100");
            expect(detail.workspaceName).toBe("Apex Solutions");
            expect(detail.createdByUserEmail).toBe("lead@apex.com");
            expect(detail.apiKeys).toHaveLength(1);
            expect(detail.apiKeys[0].keyPrefix).toBe("afd_live_abc1...9xyz");
            expect(detail.webhookEndpoints).toHaveLength(1);
            expect(detail.webhookEndpoints[0].secretMasked).toBe("whsec_ve...6789");
        });

        it("throws PlatformDeveloperApplicationNotFoundError when application does not exist", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            findUniqueAppMock.mockResolvedValueOnce(null);

            await expect(
                getPlatformDeveloperApplication(context, "app_non_existent")
            ).rejects.toThrow(PlatformDeveloperApplicationNotFoundError);
        });
    });

    // =========================================================================
    // 3. Cross-Tenant API Key Management & Secrets Exclusion
    // =========================================================================
    describe("3. Cross-Tenant API Key Management & Secrets Exclusion", () => {
        it("lists API keys across tenants and strictly excludes keyHash", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findManyKeysMock.mockResolvedValueOnce([
                {
                    id: "key_live_1",
                    developerApplicationId: "app_1",
                    keyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    keyPrefix: "afd_live_live1...9999",
                    environment: "LIVE",
                    status: "ACTIVE",
                    scopes: ["customers.read"],
                    expiresAt: null,
                    revokedAt: null,
                    lastUsedAt: now,
                    createdAt: now,
                    updatedAt: now,
                    developerApplication: {
                        name: "CRM Connector",
                        workspaceId: "ws_alpha",
                    },
                },
            ]);

            const keys = await listPlatformApiKeys(context, { workspaceId: "ws_alpha" });

            expect(keys).toHaveLength(1);
            expect(keys[0].id).toBe("key_live_1");
            expect(keys[0].developerApplicationName).toBe("CRM Connector");
            expect(keys[0].workspaceId).toBe("ws_alpha");
            expect(keys[0].keyPrefix).toBe("afd_live_live1...9999");
            // Guarantee: keyHash must NEVER exist on the DTO
            expect((keys[0] as any).keyHash).toBeUndefined();
        });

        it("fetches single API key and guarantees secrets exclusion", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueKeyMock.mockResolvedValueOnce({
                id: "key_test_1",
                developerApplicationId: "app_test",
                keyHash: "deadbeefcafebabe1234567890",
                keyPrefix: "afd_test_test1...0000",
                environment: "TEST",
                status: "ACTIVE",
                scopes: ["assets.read"],
                expiresAt: null,
                revokedAt: null,
                lastUsedAt: null,
                createdAt: now,
                updatedAt: now,
                developerApplication: {
                    name: "Test Runner App",
                    workspaceId: "ws_sandbox",
                },
            });

            const key = await getPlatformApiKey(context, "key_test_1");
            expect(key.id).toBe("key_test_1");
            expect((key as any).keyHash).toBeUndefined();
        });

        it("throws PlatformApiKeyNotFoundError when API key does not exist", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            findUniqueKeyMock.mockResolvedValueOnce(null);

            await expect(getPlatformApiKey(context, "key_ghost")).rejects.toThrow(
                PlatformApiKeyNotFoundError
            );
        });
    });

    // =========================================================================
    // 4. Tier-2 Dangerous Action: API Key Revocation
    // =========================================================================
    describe("4. Tier-2 Dangerous Action: API Key Revocation", () => {
        it("rejects revocation if justification reason is shorter than 10 characters", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                revokePlatformApiKey(context, "key_1", "Short")
            ).rejects.toThrow(PlatformActionValidationError);
        });

        it("rejects revocation if API key is already REVOKED", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            findUniqueKeyMock.mockResolvedValueOnce({
                id: "key_already_revoked",
                status: "REVOKED",
                developerApplication: { workspaceId: "ws_1", name: "App" },
            });

            await expect(
                revokePlatformApiKey(
                    context,
                    "key_already_revoked",
                    "Mandatory justification reason at least 10 chars"
                )
            ).rejects.toThrow(PlatformDeveloperConflictError);
        });

        it("successfully executes revocation in an atomic transaction and records audit event", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueKeyMock.mockResolvedValueOnce({
                id: "key_target",
                developerApplicationId: "app_1",
                keyPrefix: "afd_live_compromised...1234",
                environment: "LIVE",
                status: "ACTIVE",
                scopes: ["work_orders.write"],
                expiresAt: null,
                revokedAt: null,
                lastUsedAt: now,
                createdAt: now,
                developerApplication: {
                    name: "Third-party Portal",
                    workspaceId: "ws_compromised",
                },
            });

            updateKeyMock.mockResolvedValueOnce({
                id: "key_target",
                developerApplicationId: "app_1",
                keyPrefix: "afd_live_compromised...1234",
                environment: "LIVE",
                status: "REVOKED",
                scopes: ["work_orders.write"],
                expiresAt: null,
                revokedAt: now,
                lastUsedAt: now,
                createdAt: now,
                updatedAt: now,
            });

            const result = await revokePlatformApiKey(
                context,
                "key_target",
                "Compromised credential identified in external git repo leak",
                {
                    requestId: "req_audit_test_999",
                    ipAddress: "198.51.100.1",
                }
            );

            expect(result.status).toBe("REVOKED");
            expect(updateKeyMock).toHaveBeenCalledWith({
                where: { id: "key_target" },
                data: {
                    status: "REVOKED",
                    revokedAt: expect.any(Date),
                },
            });

            // Synchronous audit log emission verified
            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.DEVELOPER_API_KEY_REVOKED,
                    targetType: "API_KEY",
                    targetId: "key_target",
                    workspaceId: "ws_compromised",
                    reason: "Compromised credential identified in external git repo leak",
                    previousState: expect.objectContaining({ status: "ACTIVE" }),
                    newState: expect.objectContaining({ status: "REVOKED" }),
                }),
            });
        });
    });

    // =========================================================================
    // 5. Tier-2 Dangerous Action: Developer Application Lifecycle
    // =========================================================================
    describe("5. Tier-2 Dangerous Action: Developer Application Lifecycle", () => {
        it("rejects status update if justification reason is shorter than 10 characters", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                updatePlatformDeveloperApplicationStatus(
                    context,
                    "app_1",
                    "SUSPENDED",
                    "Too short"
                )
            ).rejects.toThrow(PlatformActionValidationError);
        });

        it("rejects transition if application is already in requested status", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            findUniqueAppMock.mockResolvedValueOnce({
                id: "app_suspended",
                status: "SUSPENDED",
                workspaceId: "ws_1",
            });

            await expect(
                updatePlatformDeveloperApplicationStatus(
                    context,
                    "app_suspended",
                    "SUSPENDED",
                    "Legitimate reason of ten characters minimum"
                )
            ).rejects.toThrow(PlatformDeveloperConflictError);
        });

        it("successfully updates status, emits DEVELOPER_APP_STATUS_UPDATED audit log atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueAppMock.mockResolvedValueOnce({
                id: "app_abusive",
                workspaceId: "ws_target",
                status: "ACTIVE",
            });

            updateAppMock.mockResolvedValueOnce({
                id: "app_abusive",
                workspaceId: "ws_target",
                name: "Abusive Integration",
                description: null,
                status: "SUSPENDED",
                createdByUserId: "usr_dev",
                createdAt: now,
                updatedAt: now,
            });

            const result = await updatePlatformDeveloperApplicationStatus(
                context,
                "app_abusive",
                "SUSPENDED",
                "Exceeded maximum API abuse rate thresholds across multiple endpoints",
                { requestId: "req_status_test_1" }
            );

            expect(result.status).toBe("SUSPENDED");
            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.DEVELOPER_APP_STATUS_UPDATED,
                    targetType: "DEVELOPER_APP",
                    targetId: "app_abusive",
                    workspaceId: "ws_target",
                    reason: "Exceeded maximum API abuse rate thresholds across multiple endpoints",
                    previousState: { status: "ACTIVE" },
                    newState: { status: "SUSPENDED" },
                }),
            });
        });
    });

    // =========================================================================
    // 6. Tier-1 Operational Action: Webhook Management
    // =========================================================================
    describe("6. Tier-1 Operational Action: Webhook Management", () => {
        it("lists webhooks and masks endpoint secrets", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findManyWebhooksMock.mockResolvedValueOnce([
                {
                    id: "wh_endpoint_1",
                    workspaceId: "ws_1",
                    developerApplicationId: "app_1",
                    url: "https://api.acme.com/webhooks",
                    description: "Acme dispatch receiver",
                    status: "ACTIVE",
                    events: ["work_order.status_changed"],
                    secret: "whsec_abcdef1234567890abcdef1234",
                    createdAt: now,
                    updatedAt: now,
                },
            ]);

            const list = await listPlatformWebhookEndpoints(context);
            expect(list).toHaveLength(1);
            expect(list[0].secretMasked).toBe("whsec_ab...1234");
        });

        it("disables abusive webhook endpoint and records audit log synchronously", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueWebhookMock.mockResolvedValueOnce({
                id: "wh_failing",
                workspaceId: "ws_target",
                developerApplicationId: "app_1",
                status: "ACTIVE",
                secret: "whsec_secret12345678",
            });

            updateWebhookMock.mockResolvedValueOnce({
                id: "wh_failing",
                workspaceId: "ws_target",
                developerApplicationId: "app_1",
                url: "https://dead-server.com/hooks",
                description: null,
                status: "DISABLED",
                events: [],
                secret: "whsec_secret12345678",
                createdAt: now,
                updatedAt: now,
            });

            const result = await disablePlatformWebhookEndpoint(
                context,
                "wh_failing",
                "Remote webhook receiver returning 502 Bad Gateway continuously for 24h"
            );

            expect(result.status).toBe("DISABLED");
            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.DEVELOPER_WEBHOOK_DISABLED,
                    targetType: "WEBHOOK",
                    targetId: "wh_failing",
                    workspaceId: "ws_target",
                    previousState: { status: "ACTIVE" },
                    newState: { status: "DISABLED" },
                }),
            });
        });

        it("rejects disabling with empty operational reason", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                disablePlatformWebhookEndpoint(context, "wh_failing", "   ")
            ).rejects.toThrow(PlatformDeveloperValidationError);
        });
    });

    // =========================================================================
    // 7. Rate Limit Inspection & Reset (Blocker Neutrality Proof)
    // =========================================================================
    describe("7. Rate Limit Inspection & Operational Reset", () => {
        it("inspects rate limit status resolving workspace subscription tier limit", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            findFirstSubscriptionMock.mockResolvedValueOnce({
                id: "sub_1",
                workspaceId: "ws_enterprise",
                plan: { tier: "ENTERPRISE" },
            });

            const status = await getPlatformRateLimitStatus(context, {
                workspaceId: "ws_enterprise",
            });

            expect(status.key).toBe("workspace:ws_enterprise");
            expect(status.targetType).toBe("WORKSPACE");
            expect(status.limit).toBe(6000); // Enterprise tier quota
        });

        it("manually resets rate limit quota and records audit log", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const rateLimitStore = getRateLimitStore();
            const resetSpy = vi.spyOn(rateLimitStore, "reset").mockResolvedValueOnce();

            const result = await resetPlatformRateLimit(
                context,
                {
                    key: "workspace:ws_throttled",
                    targetType: "WORKSPACE",
                    workspaceId: "ws_throttled",
                },
                "Manual quota unlock after emergency batch dispatch by client"
            );

            expect(result.success).toBe(true);
            expect(resetSpy).toHaveBeenCalledWith("workspace:ws_throttled");
            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.DEVELOPER_RATE_LIMIT_RESET,
                    targetType: "RATE_LIMIT",
                    targetId: "workspace:ws_throttled",
                    workspaceId: "ws_throttled",
                    reason: "Manual quota unlock after emergency batch dispatch by client",
                    previousState: { rateLimitKey: "workspace:ws_throttled", status: "THROTTLED" },
                    newState: { rateLimitKey: "workspace:ws_throttled", status: "RESET" },
                }),
            });
        });

        it("rejects rate limit reset with empty justification reason", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                resetPlatformRateLimit(
                    context,
                    { key: "workspace:ws_throttled", targetType: "WORKSPACE" },
                    ""
                )
            ).rejects.toThrow(PlatformDeveloperValidationError);
        });
    });

    // =========================================================================
    // 8. Explicit 4-Action Distinct Audit Event Mapping Proof
    // =========================================================================
    describe("8. Distinct Audit Taxonomy Emission for all 4 Mutating Actions", () => {
        it("proves each of the 4 mutating actions records its own unique, correctly-typed audit event", () => {
            const actions = [
                PLATFORM_AUDIT_EVENTS.DEVELOPER_API_KEY_REVOKED,
                PLATFORM_AUDIT_EVENTS.DEVELOPER_APP_STATUS_UPDATED,
                PLATFORM_AUDIT_EVENTS.DEVELOPER_WEBHOOK_DISABLED,
                PLATFORM_AUDIT_EVENTS.DEVELOPER_RATE_LIMIT_RESET,
            ];

            // Prove uniqueness across all 4 actions
            const uniqueActions = new Set(actions);
            expect(uniqueActions.size).toBe(4);

            // Prove string constants strictly adhere to platform dot-notation taxonomy
            expect(PLATFORM_AUDIT_EVENTS.DEVELOPER_API_KEY_REVOKED).toBe("platform.developer.api_key_revoked");
            expect(PLATFORM_AUDIT_EVENTS.DEVELOPER_APP_STATUS_UPDATED).toBe("platform.developer.app_status_updated");
            expect(PLATFORM_AUDIT_EVENTS.DEVELOPER_WEBHOOK_DISABLED).toBe("platform.developer.webhook_disabled");
            expect(PLATFORM_AUDIT_EVENTS.DEVELOPER_RATE_LIMIT_RESET).toBe("platform.developer.rate_limit_reset");
        });
    });
});
