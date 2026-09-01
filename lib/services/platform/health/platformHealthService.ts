import { prisma } from "@/lib/prisma";
import {
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    assertPlatformPermission,
} from "@/lib/services/platform/authorization";
import { getRateLimitStore } from "@/lib/publicApi/rateLimit/rateLimitService";
import {
    HealthStatus,
    PlatformDatabaseHealthDto,
    PlatformQueueHealthDto,
    PlatformIntegrationHealthDto,
    PlatformBillingHealthDto,
    PlatformAuditHealthDto,
    PlatformFeatureFlagsHealthDto,
    PlatformRateLimiterBlockerDto,
    PlatformSystemHealthSummaryDto,
} from "./types";

/**
 * Checks PostgreSQL database connectivity and measures round-trip ping latency.
 * Gated by: platform.operations.view_queues
 */
export async function getPlatformDatabaseHealth(
    context: PlatformAuthorizationContext
): Promise<PlatformDatabaseHealthDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES);

    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        const latencyMs = Date.now() - start;
        const status: HealthStatus = latencyMs > 250 ? "DEGRADED" : "HEALTHY";

        return {
            status,
            latencyMs,
            checkedAt: new Date().toISOString(),
            connectionPool: {
                isResponsive: true,
            },
        };
    } catch {
        return {
            status: "UNHEALTHY",
            latencyMs: -1,
            checkedAt: new Date().toISOString(),
            connectionPool: {
                isResponsive: false,
            },
        };
    }
}

/**
 * Aggregates background worker queues, outboxes, and scheduled automation jobs.
 * Gated by: platform.operations.view_queues
 */
export async function getPlatformQueueHealth(
    context: PlatformAuthorizationContext
): Promise<PlatformQueueHealthDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES);

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Notification Outbox
    const [outboxPending, outboxProcessing, outboxFailed] = await Promise.all([
        prisma.notificationOutbox.count({ where: { status: "PENDING" } }),
        prisma.notificationOutbox.count({ where: { status: "PROCESSING" } }),
        prisma.notificationOutbox.count({ where: { status: "FAILED" } }),
    ]);

    // 2. Automation Executions
    const [autoPending, autoRunning, autoFailed, autoCompleted24h] = await Promise.all([
        prisma.automationExecution.count({ where: { status: "PENDING" } }),
        prisma.automationExecution.count({ where: { status: "RUNNING" } }),
        prisma.automationExecution.count({ where: { status: "FAILED" } }),
        prisma.automationExecution.count({
            where: {
                status: "COMPLETED",
                createdAt: { gte: twentyFourHoursAgo },
            },
        }),
    ]);

    // 3. Automation Scheduled Jobs
    const [activeSchedules, failingSchedules] = await Promise.all([
        prisma.automationScheduleJob.count({ where: { isActive: true } }),
        prisma.automationScheduleJob.count({
            where: { isActive: true, failureCount: { gt: 0 } },
        }),
    ]);

    // 4. Developer Webhook Deliveries
    const [webhookPending, webhookFailed, webhookDelivered24h] = await Promise.all([
        prisma.webhookDelivery.count({ where: { status: "PENDING" } }),
        prisma.webhookDelivery.count({ where: { status: "FAILED" } }),
        prisma.webhookDelivery.count({
            where: {
                status: "DELIVERED",
                createdAt: { gte: twentyFourHoursAgo },
            },
        }),
    ]);

    // 5. Billing Webhook Events Backlog
    const [billingPending, billingFailed, billingProcessed24h] = await Promise.all([
        prisma.billingWebhookEvent.count({ where: { status: "RECEIVED" } }),
        prisma.billingWebhookEvent.count({ where: { status: "FAILED" } }),
        prisma.billingWebhookEvent.count({
            where: {
                status: "PROCESSED",
                createdAt: { gte: twentyFourHoursAgo },
            },
        }),
    ]);

    // Evaluate Queue Severity
    const totalFailed = outboxFailed + autoFailed + webhookFailed + billingFailed;
    const totalBacklog = outboxPending + autoPending + webhookPending + billingPending;

    let status: HealthStatus = "HEALTHY";
    if (totalFailed > 100 || failingSchedules > 10) {
        status = "UNHEALTHY";
    } else if (totalFailed > 10 || totalBacklog > 50 || failingSchedules > 0) {
        status = "DEGRADED";
    }

    return {
        status,
        checkedAt: now.toISOString(),
        notificationOutbox: {
            pending: outboxPending,
            processing: outboxProcessing,
            failed: outboxFailed,
            totalBacklog: outboxPending + outboxProcessing,
        },
        automationExecutions: {
            pending: autoPending,
            running: autoRunning,
            failed: autoFailed,
            completedLast24h: autoCompleted24h,
        },
        automationSchedules: {
            activeCount: activeSchedules,
            failingCount: failingSchedules,
        },
        developerWebhooks: {
            pendingRetries: webhookPending,
            failedDeliveries: webhookFailed,
            deliveredLast24h: webhookDelivered24h,
        },
        billingWebhooks: {
            pendingCount: billingPending,
            failedCount: billingFailed,
            processedLast24h: billingProcessed24h,
        },
    };
}

/**
 * Aggregates third-party integration connector health and execution failure rates.
 * Gated by: platform.operations.view_queues
 */
export async function getPlatformIntegrationHealth(
    context: PlatformAuthorizationContext
): Promise<PlatformIntegrationHealthDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES);

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [totalExecutions24h, failedExecutions24h, unprocessedWebhookEvents] =
        await Promise.all([
            prisma.integrationExecution.count({
                where: { createdAt: { gte: twentyFourHoursAgo } },
            }),
            prisma.integrationExecution.count({
                where: {
                    createdAt: { gte: twentyFourHoursAgo },
                    status: "FAILED",
                },
            }),
            prisma.integrationWebhookEvent.count({
                where: { status: { not: "PROCESSED" } },
            }),
        ]);

    const failureRatePercent =
        totalExecutions24h > 0
            ? Math.round((failedExecutions24h / totalExecutions24h) * 1000) / 10
            : 0;

    let status: HealthStatus = "HEALTHY";
    if (failureRatePercent > 50 || unprocessedWebhookEvents > 50) {
        status = "UNHEALTHY";
    } else if (failureRatePercent > 15 || unprocessedWebhookEvents > 10) {
        status = "DEGRADED";
    }

    return {
        status,
        checkedAt: now.toISOString(),
        totalExecutions24h,
        failedExecutions24h,
        failureRatePercent,
        unprocessedWebhookEvents,
    };
}

/**
 * Aggregates SaaS billing commercial health, delinquent accounts, and past-due subscriptions.
 * Gated by: platform.operations.view_queues
 */
export async function getPlatformBillingHealth(
    context: PlatformAuthorizationContext
): Promise<PlatformBillingHealthDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES);

    const now = new Date();

    const [delinquentAccountsCount, pastDueSubscriptionsCount, unprocessedWebhooksBacklog] =
        await Promise.all([
            prisma.platformBillingAccount.count({
                where: { delinquentSince: { not: null } },
            }),
            prisma.subscription.count({
                where: { status: { in: ["PAST_DUE", "UNPAID"] } },
            }),
            prisma.billingWebhookEvent.count({
                where: { status: { in: ["RECEIVED", "PROCESSING", "FAILED"] } },
            }),
        ]);

    let status: HealthStatus = "HEALTHY";
    if (delinquentAccountsCount > 25 || unprocessedWebhooksBacklog > 50) {
        status = "UNHEALTHY";
    } else if (delinquentAccountsCount > 5 || pastDueSubscriptionsCount > 5 || unprocessedWebhooksBacklog > 10) {
        status = "DEGRADED";
    }

    return {
        status,
        checkedAt: now.toISOString(),
        delinquentAccountsCount,
        pastDueSubscriptionsCount,
        unprocessedWebhooksBacklog,
    };
}

/**
 * Aggregates platform administrative audit volume, velocity, and anomaly detection.
 * Gated by: platform.audit.view
 */
export async function getPlatformAuditActivityHealth(
    context: PlatformAuthorizationContext
): Promise<PlatformAuditHealthDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.AUDIT_VIEW);

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [eventsLast1h, eventsLast24h, eventsLast7d, operators] = await Promise.all([
        prisma.platformAuditLog.count({ where: { createdAt: { gte: oneHourAgo } } }),
        prisma.platformAuditLog.count({ where: { createdAt: { gte: twentyFourHoursAgo } } }),
        prisma.platformAuditLog.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.platformAuditLog.findMany({
            where: { createdAt: { gte: twentyFourHoursAgo } },
            select: { actorUserId: true },
            distinct: ["actorUserId"],
        }),
    ]);

    const velocityPerHour = Math.round((eventsLast24h / 24) * 10) / 10;
    // Anomaly: 1h activity is 5x higher than average hourly velocity and has more than 50 events
    const hasAnomalousSpike = eventsLast1h > Math.max(50, velocityPerHour * 5);

    return {
        status: hasAnomalousSpike ? "DEGRADED" : "HEALTHY",
        checkedAt: now.toISOString(),
        eventsLast1h,
        eventsLast24h,
        eventsLast7d,
        velocityPerHour,
        activeOperatorsLast24h: operators.length,
        hasAnomalousSpike,
    };
}

/**
 * Aggregates platform feature flags and runtime settings.
 * Gated by: platform.config.view
 */
export async function getPlatformFeatureFlagsHealth(
    context: PlatformAuthorizationContext
): Promise<PlatformFeatureFlagsHealthDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const now = new Date();

    const [totalFlags, activeFlags, runtimeSettingsOverrides] = await Promise.all([
        prisma.platformFeatureFlag.count(),
        prisma.platformFeatureFlag.count({ where: { enabled: true } }),
        prisma.platformRuntimeSetting.count(),
    ]);

    return {
        status: "HEALTHY",
        checkedAt: now.toISOString(),
        totalFlags,
        activeFlags,
        runtimeSettingsOverrides,
    };
}

/**
 * Evaluates the Phase 1.18 Known Blocker: In-Memory Rate Limiter Status.
 * Surfaces single-instance operational risk to platform operators.
 * Gated by: platform.config.view
 */
export async function getPlatformRateLimiterBlockerStatus(
    context: PlatformAuthorizationContext
): Promise<PlatformRateLimiterBlockerDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const store = getRateLimitStore();
    // In-memory detection: check if store is in-memory or lacks distributed flag
    const isDistributed = Boolean(
        store &&
            typeof store === "object" &&
            "isDistributed" in store &&
            (store as unknown as { isDistributed: boolean }).isDistributed === true
    );
    const isInMemory = !isDistributed;

    const storeName =
        (store && typeof store === "object" && store.constructor?.name) ||
        (isInMemory ? "MemoryRateLimitStore" : "DistributedRateLimitStore");

    return {
        status: isInMemory ? "DEGRADED" : "HEALTHY",
        checkedAt: new Date().toISOString(),
        isInMemoryStore: isInMemory,
        isDistributed,
        blockerCode: "PHASE_1_18_IN_MEMORY_RATE_LIMITER",
        multiInstanceRisk: isInMemory ? "HIGH" : "LOW",
        activeStoreName: storeName,
        message: isInMemory
            ? "Phase 1.18 Known Blocker: In-memory sliding window rate limiter is active. Multi-instance horizontal scaling is blocked until Redis-backed distributed rate limiter is deployed."
            : "Distributed rate limiter active; multi-instance horizontal scaling is unblocked.",
        mitigation: isInMemory
            ? "Configure a distributed Redis rate limit store (REDIS_RATE_LIMIT_URL) prior to multi-instance autoscaling."
            : "None required.",
    };
}

/**
 * Master System Health & Operational Visibility Rollup.
 * Gated by: platform.operations.view_queues
 */
export async function getPlatformSystemHealthSummary(
    context: PlatformAuthorizationContext
): Promise<PlatformSystemHealthSummaryDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATIONS_VIEW_QUEUES);

    const now = new Date();
    const degradedReasons: string[] = [];

    // Run independent subsystem diagnostics in parallel
    const [database, queues, integrations, billing, featureFlags, rateLimiterBlocker] =
        await Promise.all([
            getPlatformDatabaseHealth(context),
            getPlatformQueueHealth(context),
            getPlatformIntegrationHealth(context),
            getPlatformBillingHealth(context),
            getPlatformFeatureFlagsHealth(context),
            getPlatformRateLimiterBlockerStatus(context),
        ]);

    // Conditionally gather audit health if context holds AUDIT_VIEW, otherwise provide safe default
    let audit: PlatformAuditHealthDto;
    try {
        audit = await getPlatformAuditActivityHealth(context);
    } catch {
        audit = {
            status: "HEALTHY",
            checkedAt: now.toISOString(),
            eventsLast1h: 0,
            eventsLast24h: 0,
            eventsLast7d: 0,
            velocityPerHour: 0,
            activeOperatorsLast24h: 0,
            hasAnomalousSpike: false,
        };
    }

    // Collect degraded reasons
    if (database.status !== "HEALTHY") {
        degradedReasons.push(`Database connection is ${database.status} (latency: ${database.latencyMs}ms)`);
    }
    if (queues.status !== "HEALTHY") {
        degradedReasons.push(
            `Background queues are ${queues.status} (backlog: ${queues.notificationOutbox.totalBacklog})`
        );
    }
    if (integrations.status !== "HEALTHY") {
        degradedReasons.push(
            `Integrations are ${integrations.status} (${integrations.failureRatePercent}% failure rate)`
        );
    }
    if (billing.status !== "HEALTHY") {
        degradedReasons.push(
            `Billing operations are ${billing.status} (${billing.delinquentAccountsCount} delinquent accounts)`
        );
    }
    if (audit.status !== "HEALTHY") {
        degradedReasons.push("Platform audit activity shows anomalous spikes in the last hour");
    }
    if (rateLimiterBlocker.status !== "HEALTHY") {
        degradedReasons.push(rateLimiterBlocker.message);
    }

    // Overall status rollup:
    // Any UNHEALTHY -> UNHEALTHY
    // Any DEGRADED -> DEGRADED
    // Otherwise HEALTHY
    let overallStatus: HealthStatus = "HEALTHY";
    const statuses = [
        database.status,
        queues.status,
        integrations.status,
        billing.status,
        audit.status,
        featureFlags.status,
        rateLimiterBlocker.status,
    ];

    if (statuses.includes("UNHEALTHY")) {
        overallStatus = "UNHEALTHY";
    } else if (statuses.includes("DEGRADED")) {
        overallStatus = "DEGRADED";
    }

    return {
        status: overallStatus,
        checkedAt: now.toISOString(),
        version: "1.19.15",
        subsystems: {
            database,
            queues,
            integrations,
            billing,
            audit,
            featureFlags,
            rateLimiterBlocker,
        },
        degradedReasons,
    };
}
