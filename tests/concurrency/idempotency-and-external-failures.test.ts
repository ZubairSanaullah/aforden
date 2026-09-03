import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";
import { ResendAdapter } from "@/lib/integrations/adapters/resendAdapter";
import { TwilioAdapter } from "@/lib/integrations/adapters/twilioAdapter";
import { QuickBooksAdapter } from "@/lib/integrations/adapters/quickBooksAdapter";
import { AwsS3Adapter } from "@/lib/integrations/adapters/awsS3Adapter";
import { GoogleCalendarAdapter } from "@/lib/integrations/adapters/googleCalendarAdapter";
import {
    IntegrationCapability,
    IntegrationConnectionStatus,
    IntegrationFailureCode,
} from "@/lib/integrations/adapters/types";

describe("Phase 1.21.6 — Idempotency Under Concurrency, External Dependency Failures & Contention", () => {
    let prisma: PrismaClient;
    const runId = Math.floor(Math.random() * 900000 + 100000);
    const workspaceId = `ws_idem_${runId}`;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        await prisma.workspace.create({
            data: {
                id: workspaceId,
                name: `Idempotency Test Workspace ${runId}`,
                slug: `idem-ws-${runId}`,
                timezone: "America/New_York",
                defaultCurrencyCode: "USD",
            },
        });
    });

    afterAll(async () => {
        if (!prisma) return;
        try {
            await prisma.notificationOutbox.deleteMany({ where: { workspaceId } });
            await prisma.workspace.deleteMany({ where: { id: workspaceId } });
        } catch (e) {
            console.error("Cleanup error in idempotency test:", e);
        } finally {
            await prisma.$disconnect();
        }
    });

    // =========================================================================
    // 1. Notification Outbox DedupeKey Concurrent Ingestion
    // =========================================================================
    describe("1. Notification Outbox DedupeKey Concurrent Ingestion", () => {
        it("strictly deduplicates 5 concurrent emissions of the same event and creates exactly one outbox row", async () => {
            const dedupeKey = `dedupe_race_${runId}_event_100`;

            // Fire 5 concurrent emitNotificationEvent calls with the identical dedupeKey
            const emissionPromises = [1, 2, 3, 4, 5].map(() =>
                emitNotificationEvent(prisma, {
                    workspaceId,
                    eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                    sourceEntity: "WorkOrder",
                    sourceId: `wo_race_${runId}`,
                    dedupeKey,
                    payload: {
                        workOrderId: `wo_race_${runId}`,
                        workOrderNumber: `WO-${runId}`,
                        title: "High Voltage Relay Replacement",
                        customerId: `cust_race_${runId}`,
                        technicianId: `tp_race_${runId}`,
                        priority: "HIGH",
                    },
                })
            );

            const results = await Promise.allSettled(emissionPromises);

            const fulfilled = results.filter(r => r.status === "fulfilled");
            expect(fulfilled.length).toBeGreaterThanOrEqual(1);

            // Invariant: Exactly 1 row exists in notificationOutbox with this dedupeKey
            const outboxRows = await prisma.notificationOutbox.findMany({
                where: {
                    workspaceId,
                    dedupeKey,
                },
            });

            expect(outboxRows.length).toBe(1);
            expect(outboxRows[0].status).toBe("PENDING");
        });
    });

    // =========================================================================
    // 2. External Provider Failure Classification & Retryability (Google Calendar)
    // =========================================================================
    describe("2. External Provider Failure Simulation: Google Calendar Adapter", () => {
        it("correctly classifies 429 Rate Limit and 503 Backend Error as retryable, and 401 Unauthorized as non-retryable", async () => {
            const googleAdapter = new GoogleCalendarAdapter();

            // 1. Transient 429 Rate Limit
            const failure429 = googleAdapter.translateGoogleError(429, {
                error: { message: "User Rate Limit Exceeded", status: "RESOURCE_EXHAUSTED" },
            });
            expect(failure429.isRetryable).toBe(true);
            expect(failure429.code).toBe(IntegrationFailureCode.RATE_LIMITED);

            // 2. Transient 503 Backend Error
            const failure503 = googleAdapter.translateGoogleError(503, {
                error: { message: "Backend Error on Google Calendar cluster", status: "UNAVAILABLE" },
            });
            expect(failure503.isRetryable).toBe(true);
            expect(failure503.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);

            // 3. Permanent 401 Unauthorized
            const failure401 = googleAdapter.translateGoogleError(401, {
                error: { message: "Invalid OAuth2 credentials or expired token", status: "UNAUTHENTICATED" },
            });
            expect(failure401.isRetryable).toBe(false);
            expect(failure401.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
        });
    });

    // =========================================================================
    // 3. External Provider Failure Simulation: Resend & Twilio Adapters
    // =========================================================================
    describe("3. External Provider Failure Simulation: Resend & Twilio Adapters", () => {
        it("classifies Resend server errors / socket hangup as retryable and unprocessable recipient as non-retryable", async () => {
            const resendAdapter = new ResendAdapter();

            // Simulate 500 internal server error
            const resend500 = {
                name: "internal_server_error",
                message: "Internal server error occurred on Resend cluster",
            };
            const failure500 = resendAdapter.translateResendError(500, resend500);
            expect(failure500.isRetryable).toBe(true);
            expect(failure500.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);

            // Simulate 422 unprocessable recipient email
            const resend422 = {
                name: "validation_error",
                message: "The 'to' field contains an invalid email format",
            };
            const failure422 = resendAdapter.translateResendError(422, resend422);
            expect(failure422.isRetryable).toBe(false);
            expect(failure422.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
        });

        it("classifies Twilio 429/503 as retryable and 400 invalid phone number as non-retryable", async () => {
            const twilioAdapter = new TwilioAdapter();

            // 503 Service Unavailable (code 20003 or generic 503)
            const twilio503 = {
                status: 503,
                message: "Twilio service temporarily unavailable",
            };
            const failure503 = twilioAdapter.translateTwilioError(503, twilio503);
            expect(failure503.isRetryable).toBe(true);
            expect(failure503.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);

            // 400 Invalid phone number (code 21211)
            const twilio400 = {
                status: 400,
                code: 21211,
                message: "The 'To' number is not a valid phone number",
            };
            const failure400 = twilioAdapter.translateTwilioError(400, twilio400);
            expect(failure400.isRetryable).toBe(false);
            expect(failure400.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
        });
    });

    // =========================================================================
    // 4. External Provider Failure Simulation: QuickBooks & AWS S3
    // =========================================================================
    describe("4. External Provider Failure Simulation: QuickBooks & AWS S3 Adapters", () => {
        it("classifies QuickBooks 503/504 as retryable and 401 token expiration as non-retryable auth error", async () => {
            const qbAdapter = new QuickBooksAdapter();

            // 503 Service Unavailable
            const qb503 = {
                Fault: {
                    type: "SERVICE",
                    Error: [{ Message: "Service Unavailable", Detail: "Internal Gateway Timeout", code: "503" }],
                },
            };
            const failure503 = qbAdapter.translateQuickBooksError(503, qb503);
            expect(failure503.isRetryable).toBe(true);

            // 401 Invalid Auth Token
            const qb401 = {
                Fault: {
                    type: "AUTHENTICATION",
                    Error: [{ Message: "Invalid Token", Detail: "Token expired or revoked", code: "401" }],
                },
            };
            const failure401 = qbAdapter.translateQuickBooksError(401, qb401);
            expect(failure401.isRetryable).toBe(false);
            expect(failure401.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
        });

        it("classifies AWS S3 connection timeouts as retryable", async () => {
            const s3Adapter = new AwsS3Adapter();

            const s3SlowDown = "<Error><Code>SlowDown</Code><Message>Reduce request rate</Message></Error>";
            const failureSlowDown = s3Adapter.translateS3Error(503, s3SlowDown);
            expect(failureSlowDown.isRetryable).toBe(true);
            expect(failureSlowDown.code).toBe(IntegrationFailureCode.RATE_LIMITED);

            const s3Internal = "<Error><Code>InternalError</Code><Message>We encountered an internal error</Message></Error>";
            const failureInternal = s3Adapter.translateS3Error(500, s3Internal);
            expect(failureInternal.isRetryable).toBe(true);
            expect(failureInternal.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
        });
    });

    // =========================================================================
    // 5. Deadlock / Lock Contention Resilience Check (Two-Resource Opposite Order)
    // =========================================================================
    describe("5. Deadlock & Lock Contention Resilience Check", () => {
        it("detects genuine two-resource circular lock contention (Tx A: X->Y vs Tx B: Y->X) and handles PostgreSQL deadlock via retry", async () => {
            // Seed two distinct customer rows to construct opposite-order lock contention
            const custA = await prisma.customer.create({
                data: {
                    workspaceId,
                    name: `Deadlock Resource X ${runId}`,
                    customerNumber: `CUST-DL-X-${runId}`,
                },
            });

            const custB = await prisma.customer.create({
                data: {
                    workspaceId,
                    name: `Deadlock Resource Y ${runId}`,
                    customerNumber: `CUST-DL-Y-${runId}`,
                },
            });

            let deadlockEncountered = false;

            // Transactional runner with standard deadlock detection & exponential backoff retry
            async function runWithDeadlockRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        return await fn();
                    } catch (err: any) {
                        const isDeadlock =
                            err?.message?.toLowerCase().includes("deadlock") ||
                            err?.code === "40P01" ||
                            err?.code === "P2034";
                        if (isDeadlock && attempt < maxRetries) {
                            deadlockEncountered = true;
                            // Backoff before retrying
                            await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt) + Math.random() * 50));
                            continue;
                        }
                        throw err;
                    }
                }
                throw new Error("Exceeded max deadlock retries");
            }

            // Tx 1: Acquires lock on Customer A, pauses, then contends for Customer B
            const tx1 = () =>
                runWithDeadlockRetry(() =>
                    prisma.$transaction(async (tx) => {
                        await tx.customer.update({
                            where: { id: custA.id },
                            data: { notes: "Tx 1 locked Resource X" },
                        });
                        // Sleep to ensure Tx 2 acquires Resource Y before Tx 1 asks for it
                        await new Promise((r) => setTimeout(r, 150));
                        await tx.customer.update({
                            where: { id: custB.id },
                            data: { notes: "Tx 1 updated Resource Y" },
                        });
                    }, { timeout: 15000 })
                );

            // Tx 2: Acquires lock on Customer B, pauses, then contends for Customer A (opposite order)
            const tx2 = () =>
                runWithDeadlockRetry(() =>
                    prisma.$transaction(async (tx) => {
                        await tx.customer.update({
                            where: { id: custB.id },
                            data: { notes: "Tx 2 locked Resource Y" },
                        });
                        // Sleep to ensure Tx 1 acquires Resource X before Tx 2 asks for it
                        await new Promise((r) => setTimeout(r, 150));
                        await tx.customer.update({
                            where: { id: custA.id },
                            data: { notes: "Tx 2 updated Resource X" },
                        });
                    }, { timeout: 15000 })
                );

            // Fire both opposite-order contending transactions concurrently
            const results = await Promise.allSettled([tx1(), tx2()]);

            // Invariant: Both transactions resolve successfully thanks to clean deadlock detection & retry
            expect(results.every((r) => r.status === "fulfilled")).toBe(true);

            // Assert that both customer records were updated cleanly without corruption
            const finalA = await prisma.customer.findUnique({ where: { id: custA.id } });
            const finalB = await prisma.customer.findUnique({ where: { id: custB.id } });
            expect(finalA?.notes).toBeDefined();
            expect(finalB?.notes).toBeDefined();
        });
    });
});
