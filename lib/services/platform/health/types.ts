/**
 * Health Status Severity Enum
 */
export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

/**
 * Database Ping & Connection Pool Health DTO
 */
export interface PlatformDatabaseHealthDto {
    status: HealthStatus;
    latencyMs: number;
    checkedAt: string;
    connectionPool: {
        isResponsive: boolean;
    };
}

/**
 * Background Asynchronous Job & Worker Queues Health DTO
 */
export interface PlatformQueueHealthDto {
    status: HealthStatus;
    checkedAt: string;
    notificationOutbox: {
        pending: number;
        processing: number;
        failed: number;
        totalBacklog: number;
    };
    automationExecutions: {
        pending: number;
        running: number;
        failed: number;
        completedLast24h: number;
    };
    automationSchedules: {
        activeCount: number;
        failingCount: number;
    };
    developerWebhooks: {
        pendingRetries: number;
        failedDeliveries: number;
        deliveredLast24h: number;
    };
    billingWebhooks: {
        pendingCount: number;
        failedCount: number;
        processedLast24h: number;
    };
}

/**
 * Third-Party Integration Execution & Connector Health DTO
 */
export interface PlatformIntegrationHealthDto {
    status: HealthStatus;
    checkedAt: string;
    totalExecutions24h: number;
    failedExecutions24h: number;
    failureRatePercent: number;
    unprocessedWebhookEvents: number;
}

/**
 * SaaS Billing Operational Health DTO
 */
export interface PlatformBillingHealthDto {
    status: HealthStatus;
    checkedAt: string;
    delinquentAccountsCount: number;
    pastDueSubscriptionsCount: number;
    unprocessedWebhooksBacklog: number;
}

/**
 * Platform Administrative Audit Velocity & Anomalies Health DTO
 */
export interface PlatformAuditHealthDto {
    status: HealthStatus;
    checkedAt: string;
    eventsLast1h: number;
    eventsLast24h: number;
    eventsLast7d: number;
    velocityPerHour: number;
    activeOperatorsLast24h: number;
    hasAnomalousSpike: boolean;
}

/**
 * Feature Flags & Runtime Configuration Rollout Health DTO
 */
export interface PlatformFeatureFlagsHealthDto {
    status: HealthStatus;
    checkedAt: string;
    totalFlags: number;
    activeFlags: number;
    runtimeSettingsOverrides: number;
}

/**
 * Known Blocker: Phase 1.18 In-Memory Rate Limiter Status DTO
 */
export interface PlatformRateLimiterBlockerDto {
    status: HealthStatus;
    checkedAt: string;
    isInMemoryStore: boolean;
    isDistributed: boolean;
    blockerCode: "PHASE_1_18_IN_MEMORY_RATE_LIMITER";
    multiInstanceRisk: "HIGH" | "LOW";
    activeStoreName: string;
    message: string;
    mitigation: string;
}

/**
 * Comprehensive System Health & Operational Visibility Rollup DTO
 */
export interface PlatformSystemHealthSummaryDto {
    status: HealthStatus;
    checkedAt: string;
    version: string;
    subsystems: {
        database: PlatformDatabaseHealthDto;
        queues: PlatformQueueHealthDto;
        integrations: PlatformIntegrationHealthDto;
        billing: PlatformBillingHealthDto;
        audit: PlatformAuditHealthDto;
        featureFlags: PlatformFeatureFlagsHealthDto;
        rateLimiterBlocker: PlatformRateLimiterBlockerDto;
    };
    degradedReasons: string[];
}
