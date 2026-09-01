import { describe, it, expect, vi, beforeEach } from "vitest";

// =========================================================================
// Mocks Setup
// =========================================================================

const {
    queryRawMock,
    outboxCountMock,
    autoExecCountMock,
    autoScheduleCountMock,
    webhookDeliveryCountMock,
    billingWebhookCountMock,
    integrationExecCountMock,
    integrationWebhookCountMock,
    billingAccountCountMock,
    subscriptionCountMock,
    auditLogCountMock,
    auditLogFindManyMock,
    featureFlagCountMock,
    runtimeSettingCountMock,
    auditCreateMock,
} = vi.hoisted(() => ({
    queryRawMock: vi.fn(),
    outboxCountMock: vi.fn(),
    autoExecCountMock: vi.fn(),
    autoScheduleCountMock: vi.fn(),
    webhookDeliveryCountMock: vi.fn(),
    billingWebhookCountMock: vi.fn(),
    integrationExecCountMock: vi.fn(),
    integrationWebhookCountMock: vi.fn(),
    billingAccountCountMock: vi.fn(),
    subscriptionCountMock: vi.fn(),
    auditLogCountMock: vi.fn(),
    auditLogFindManyMock: vi.fn(),
    featureFlagCountMock: vi.fn(),
    runtimeSettingCountMock: vi.fn(),
    auditCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        $queryRaw: queryRawMock,
        notificationOutbox: {
            count: outboxCountMock,
        },
        automationExecution: {
            count: autoExecCountMock,
        },
        automationScheduleJob: {
            count: autoScheduleCountMock,
        },
        webhookDelivery: {
            count: webhookDeliveryCountMock,
        },
        billingWebhookEvent: {
            count: billingWebhookCountMock,
        },
        integrationExecution: {
            count: integrationExecCountMock,
        },
        integrationWebhookEvent: {
            count: integrationWebhookCountMock,
        },
        platformBillingAccount: {
            count: billingAccountCountMock,
        },
        subscription: {
            count: subscriptionCountMock,
        },
        platformAuditLog: {
            count: auditLogCountMock,
            findMany: auditLogFindManyMock,
            create: auditCreateMock,
        },
        platformFeatureFlag: {
            count: featureFlagCountMock,
        },
        platformRuntimeSetting: {
            count: runtimeSettingCountMock,
        },
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
    getPlatformDatabaseHealth,
    getPlatformQueueHealth,
    getPlatformIntegrationHealth,
    getPlatformBillingHealth,
    getPlatformAuditActivityHealth,
    getPlatformFeatureFlagsHealth,
    getPlatformRateLimiterBlockerStatus,
    getPlatformSystemHealthSummary,
} from "@/lib/services/platform/health";
import { setRateLimitStore } from "@/lib/publicApi/rateLimit/rateLimitService";
import { defaultMemoryRateLimitStore } from "@/lib/publicApi/rateLimit/memoryRateLimitStore";

describe("Phase 1.19.15 — Platform System Health & Operational Visibility Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset to default in-memory rate limit store
        setRateLimitStore(defaultMemoryRateLimitStore);
    });

    function createPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_OPERATIONS
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
    // 1. Permission Gating & Least-Privilege Role Authority
    // =========================================================================
    describe("1. Permission Gating & Least-Privilege Role Authority", () => {
        it("allows PLATFORM_OPERATIONS, PLATFORM_ADMIN, and PLATFORM_OWNER full access to system health summary", async () => {
            queryRawMock.mockResolvedValueOnce([{ "?column?": 1 }]);
            outboxCountMock.mockResolvedValue(0);
            autoExecCountMock.mockResolvedValue(0);
            autoScheduleCountMock.mockResolvedValue(0);
            webhookDeliveryCountMock.mockResolvedValue(0);
            billingWebhookCountMock.mockResolvedValue(0);
            integrationExecCountMock.mockResolvedValue(0);
            integrationWebhookCountMock.mockResolvedValue(0);
            billingAccountCountMock.mockResolvedValue(0);
            subscriptionCountMock.mockResolvedValue(0);
            auditLogCountMock.mockResolvedValue(0);
            auditLogFindManyMock.mockResolvedValue([]);
            featureFlagCountMock.mockResolvedValue(0);
            runtimeSettingCountMock.mockResolvedValue(0);

            const opsContext = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);
            const adminContext = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const ownerContext = createPlatformContext(PlatformRole.PLATFORM_OWNER);

            await expect(getPlatformSystemHealthSummary(opsContext)).resolves.toBeDefined();
            await expect(getPlatformSystemHealthSummary(adminContext)).resolves.toBeDefined();
            await expect(getPlatformSystemHealthSummary(ownerContext)).resolves.toBeDefined();
        });

        it("strictly denies PLATFORM_SUPPORT, PLATFORM_SECURITY, and PLATFORM_BILLING from system health summary", async () => {
            const supportContext = createPlatformContext(PlatformRole.PLATFORM_SUPPORT);
            const securityContext = createPlatformContext(PlatformRole.PLATFORM_SECURITY);
            const billingContext = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(getPlatformSystemHealthSummary(supportContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(getPlatformSystemHealthSummary(securityContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(getPlatformSystemHealthSummary(billingContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
        });

        it("allows PLATFORM_SUPPORT and PLATFORM_SECURITY to view rate limiter blocker status via CONFIG_VIEW", async () => {
            const supportContext = createPlatformContext(PlatformRole.PLATFORM_SUPPORT);
            const securityContext = createPlatformContext(PlatformRole.PLATFORM_SECURITY);

            await expect(getPlatformRateLimiterBlockerStatus(supportContext)).resolves.toBeDefined();
            await expect(getPlatformRateLimiterBlockerStatus(securityContext)).resolves.toBeDefined();
        });

        it("allows PLATFORM_SECURITY to inspect audit activity health via AUDIT_VIEW", async () => {
            const securityContext = createPlatformContext(PlatformRole.PLATFORM_SECURITY);
            auditLogCountMock.mockResolvedValue(10);
            auditLogFindManyMock.mockResolvedValue([{ actorUserId: "usr_1" }]);

            const auditHealth = await getPlatformAuditActivityHealth(securityContext);
            expect(auditHealth.status).toBe("HEALTHY");
            expect(auditHealth.eventsLast1h).toBe(10);
        });

        it("strictly denies workspace/tenant member context without platform authorization", async () => {
            const tenantContext = {
                userId: "usr_tenant_owner",
                workspaceId: "ws_alpha",
                role: "OWNER",
                permissions: ["workspaces.view"],
            } as unknown as PlatformAuthorizationContext;

            await expect(getPlatformSystemHealthSummary(tenantContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(getPlatformQueueHealth(tenantContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
        });
    });

    // =========================================================================
    // 2. Database Connectivity Ping & Latency Metrics
    // =========================================================================
    describe("2. Database Connectivity Ping & Latency Metrics", () => {
        it("reports HEALTHY when database ping responds promptly (< 250ms)", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);
            queryRawMock.mockResolvedValueOnce([{ "?column?": 1 }]);

            const result = await getPlatformDatabaseHealth(context);
            expect(result.status).toBe("HEALTHY");
            expect(result.connectionPool.isResponsive).toBe(true);
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        });

        it("reports UNHEALTHY when database query throws an error", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);
            queryRawMock.mockRejectedValueOnce(new Error("Connection pool exhausted"));

            const result = await getPlatformDatabaseHealth(context);
            expect(result.status).toBe("UNHEALTHY");
            expect(result.connectionPool.isResponsive).toBe(false);
            expect(result.latencyMs).toBe(-1);
        });
    });

    // =========================================================================
    // 3. Background Queue & Asynchronous Worker Aggregations
    // =========================================================================
    describe("3. Background Queue & Worker Aggregations", () => {
        it("correctly aggregates queue backlogs across notification, automation, and webhook pipelines", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            // Notification outbox: 5 pending, 2 processing, 1 failed
            outboxCountMock
                .mockResolvedValueOnce(5)
                .mockResolvedValueOnce(2)
                .mockResolvedValueOnce(1);

            // Automation: 3 pending, 1 running, 0 failed, 15 completed
            autoExecCountMock
                .mockResolvedValueOnce(3)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(15);

            // Automation schedules: 4 active, 0 failing
            autoScheduleCountMock
                .mockResolvedValueOnce(4)
                .mockResolvedValueOnce(0);

            // Developer webhooks: 2 pending, 1 failed, 20 delivered
            webhookDeliveryCountMock
                .mockResolvedValueOnce(2)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(20);

            // Billing webhooks: 1 pending, 0 failed, 8 processed
            billingWebhookCountMock
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(8);

            const result = await getPlatformQueueHealth(context);

            expect(result.status).toBe("HEALTHY");
            expect(result.notificationOutbox.pending).toBe(5);
            expect(result.notificationOutbox.processing).toBe(2);
            expect(result.notificationOutbox.failed).toBe(1);
            expect(result.notificationOutbox.totalBacklog).toBe(7);

            expect(result.automationExecutions.pending).toBe(3);
            expect(result.automationExecutions.running).toBe(1);
            expect(result.automationExecutions.completedLast24h).toBe(15);

            expect(result.developerWebhooks.pendingRetries).toBe(2);
            expect(result.developerWebhooks.failedDeliveries).toBe(1);

            expect(result.billingWebhooks.pendingCount).toBe(1);
            expect(result.billingWebhooks.processedLast24h).toBe(8);
        });

        it("marks queues as DEGRADED when failed jobs exceed threshold", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            outboxCountMock
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(15); // > 10 failed

            autoExecCountMock.mockResolvedValue(0);
            autoScheduleCountMock.mockResolvedValue(0);
            webhookDeliveryCountMock.mockResolvedValue(0);
            billingWebhookCountMock.mockResolvedValue(0);

            const result = await getPlatformQueueHealth(context);
            expect(result.status).toBe("DEGRADED");
        });
    });

    // =========================================================================
    // 4. Third-Party Integration Connector Health
    // =========================================================================
    describe("4. Third-Party Integration Connector Health", () => {
        it("computes accurate failure rates and flags DEGRADED when errors exceed 15%", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            // 100 total executions, 20 failed -> 20.0% failure rate (> 15% threshold)
            integrationExecCountMock
                .mockResolvedValueOnce(100)
                .mockResolvedValueOnce(20);
            integrationWebhookCountMock.mockResolvedValueOnce(2);

            const result = await getPlatformIntegrationHealth(context);

            expect(result.totalExecutions24h).toBe(100);
            expect(result.failedExecutions24h).toBe(20);
            expect(result.failureRatePercent).toBe(20);
            expect(result.status).toBe("DEGRADED");
        });
    });

    // =========================================================================
    // 5. Explicit Verification of Phase 1.18 Rate Limiter Blocker
    // =========================================================================
    describe("5. Phase 1.18 Known Blocker: In-Memory Rate Limiter Status", () => {
        it("explicitly detects in-memory rate limiter store and flags HIGH multi-instance deployment risk", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            const blocker = await getPlatformRateLimiterBlockerStatus(context);

            expect(blocker.status).toBe("DEGRADED");
            expect(blocker.isInMemoryStore).toBe(true);
            expect(blocker.isDistributed).toBe(false);
            expect(blocker.blockerCode).toBe("PHASE_1_18_IN_MEMORY_RATE_LIMITER");
            expect(blocker.multiInstanceRisk).toBe("HIGH");
            expect(blocker.message).toContain("Phase 1.18 Known Blocker");
            expect(blocker.message).toContain("In-memory sliding window rate limiter is active");
            expect(blocker.mitigation).toContain("Configure a distributed Redis rate limit store");
        });

        it("unblocks multi-instance scaling when a distributed rate limit store is configured", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            // Mock a distributed store implementation
            const mockDistributedStore = {
                isDistributed: true,
                increment: vi.fn(),
                get: vi.fn(),
                reset: vi.fn(),
            };

            setRateLimitStore(mockDistributedStore as any);

            const blocker = await getPlatformRateLimiterBlockerStatus(context);

            expect(blocker.status).toBe("HEALTHY");
            expect(blocker.isInMemoryStore).toBe(false);
            expect(blocker.isDistributed).toBe(true);
            expect(blocker.multiInstanceRisk).toBe("LOW");
            expect(blocker.message).toContain("Distributed rate limiter active");
        });
    });

    // =========================================================================
    // 6. Master System Health Rollup Logic
    // =========================================================================
    describe("6. Master System Health Rollup Logic", () => {
        it("combines all subsystems and reports DEGRADED due to in-memory rate limiter blocker", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            // Database healthy
            queryRawMock.mockResolvedValueOnce([{ "?column?": 1 }]);
            // Queues healthy
            outboxCountMock.mockResolvedValue(0);
            autoExecCountMock.mockResolvedValue(0);
            autoScheduleCountMock.mockResolvedValue(0);
            webhookDeliveryCountMock.mockResolvedValue(0);
            billingWebhookCountMock.mockResolvedValue(0);
            // Integrations healthy
            integrationExecCountMock.mockResolvedValue(0);
            integrationWebhookCountMock.mockResolvedValue(0);
            // Billing healthy
            billingAccountCountMock.mockResolvedValue(0);
            subscriptionCountMock.mockResolvedValue(0);
            // Config healthy
            featureFlagCountMock.mockResolvedValue(5);
            runtimeSettingCountMock.mockResolvedValue(2);

            const summary = await getPlatformSystemHealthSummary(context);

            // Because the in-memory rate limiter blocker is active, overall summary is DEGRADED
            expect(summary.status).toBe("DEGRADED");
            expect(summary.degradedReasons.length).toBeGreaterThan(0);
            expect(summary.degradedReasons[0]).toContain("Phase 1.18 Known Blocker");
            expect(summary.subsystems.database.status).toBe("HEALTHY");
            expect(summary.subsystems.queues.status).toBe("HEALTHY");
            expect(summary.subsystems.rateLimiterBlocker.isInMemoryStore).toBe(true);
        });

        it("escalates overall status to UNHEALTHY if any primary infrastructure component fails", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            // Database fails!
            queryRawMock.mockRejectedValueOnce(new Error("Database offline"));

            outboxCountMock.mockResolvedValue(0);
            autoExecCountMock.mockResolvedValue(0);
            autoScheduleCountMock.mockResolvedValue(0);
            webhookDeliveryCountMock.mockResolvedValue(0);
            billingWebhookCountMock.mockResolvedValue(0);
            integrationExecCountMock.mockResolvedValue(0);
            integrationWebhookCountMock.mockResolvedValue(0);
            billingAccountCountMock.mockResolvedValue(0);
            subscriptionCountMock.mockResolvedValue(0);
            featureFlagCountMock.mockResolvedValue(0);
            runtimeSettingCountMock.mockResolvedValue(0);

            const summary = await getPlatformSystemHealthSummary(context);

            expect(summary.status).toBe("UNHEALTHY");
            expect(summary.subsystems.database.status).toBe("UNHEALTHY");
        });
    });

    // =========================================================================
    // 7. Read-Only Invariant & Zero Audit Mutation Verification
    // =========================================================================
    describe("7. Read-Only Invariant & Zero Audit Mutation", () => {
        it("strictly proves zero audit log entries are generated when running health diagnostics", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            queryRawMock.mockResolvedValueOnce([{ "?column?": 1 }]);
            outboxCountMock.mockResolvedValue(0);
            autoExecCountMock.mockResolvedValue(0);
            autoScheduleCountMock.mockResolvedValue(0);
            webhookDeliveryCountMock.mockResolvedValue(0);
            billingWebhookCountMock.mockResolvedValue(0);
            integrationExecCountMock.mockResolvedValue(0);
            integrationWebhookCountMock.mockResolvedValue(0);
            billingAccountCountMock.mockResolvedValue(0);
            subscriptionCountMock.mockResolvedValue(0);
            featureFlagCountMock.mockResolvedValue(0);
            runtimeSettingCountMock.mockResolvedValue(0);

            await getPlatformSystemHealthSummary(context);

            // Absolute read-only verification:
            expect(auditCreateMock).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 8. Audit Taxonomy Baseline Stability
    // =========================================================================
    describe("8. Audit Taxonomy Baseline Stability", () => {
        it("confirms audit taxonomy remains locked at exactly 31 events (zero new events in 1.19.15)", () => {
            const eventKeys = Object.keys(PLATFORM_AUDIT_EVENTS);
            expect(eventKeys.length).toBe(31);
        });
    });
});
