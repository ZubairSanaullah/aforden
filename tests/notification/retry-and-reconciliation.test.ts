import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    calculateExponentialBackoff,
    scheduleDeliveryRetry,
    processDueDeliveryRetries,
} from "@/lib/services/notification/retryDeliveryService";
import {
    reconcileStuckDeliveries,
    reconcileStuckOutboxItems,
} from "@/lib/services/notification/reconciliationWorker";
import {
    NotificationDeliveryStatus,
    NotificationOutboxStatus,
    NotificationChannel,
    RecipientType,
    NotificationStatus,
    NotificationEventType,
} from "@/generated/prisma/enums";

describe("Phase 1.13.10 — Retry Engine & Reconciliation Worker", () => {
    const WS_ID = "ws_test_retry_10";

    describe("1. Exponential Backoff Calculation (Section 10.2 Locked Spec)", () => {
        it("computes default base delay for first retry (attempt 1) per locked spec (10s)", () => {
            const delay = calculateExponentialBackoff(1, {
                maxJitterSeconds: 0, // Zero jitter for deterministic base check
            });
            expect(delay).toBe(10);
        });

        it("scales exponentially per locked formula: min(3600, 10 * 2^(attempt-1))", () => {
            const delay2 = calculateExponentialBackoff(2, { maxJitterSeconds: 0 });
            expect(delay2).toBe(20);

            const delay3 = calculateExponentialBackoff(3, { maxJitterSeconds: 0 });
            expect(delay3).toBe(40);

            const delay4 = calculateExponentialBackoff(4, { maxJitterSeconds: 0 });
            expect(delay4).toBe(80);

            const delay5 = calculateExponentialBackoff(5, { maxJitterSeconds: 0 });
            expect(delay5).toBe(160);
        });

        it("caps maximum delay at maxDelaySeconds ceiling (default 3600s)", () => {
            const delay10 = calculateExponentialBackoff(10, {
                maxDelaySeconds: 300,
                maxJitterSeconds: 0,
            });
            expect(delay10).toBe(300);
        });

        it("applies additive uniform jitter uniform(0, 5s) within expected bounds", () => {
            for (let i = 0; i < 20; i++) {
                const delay1 = calculateExponentialBackoff(1); // 10s base + uniform(0, 5s)
                expect(delay1).toBeGreaterThanOrEqual(10);
                expect(delay1).toBeLessThanOrEqual(15);

                const delay2 = calculateExponentialBackoff(2); // 20s base + uniform(0, 5s)
                expect(delay2).toBeGreaterThanOrEqual(20);
                expect(delay2).toBeLessThanOrEqual(25);
            }
        });

        it("supports custom ratio overrides if provided", () => {
            const delay = calculateExponentialBackoff(2, {
                baseDelaySeconds: 100,
                backoffMultiplier: 2,
                jitterRatio: 0.1,
            });
            expect(delay).toBeGreaterThanOrEqual(180);
            expect(delay).toBeLessThanOrEqual(220);
        });
    });

    describe("2. Delivery Retry Scheduling", () => {
        it("schedules next retry timestamp for a FAILED delivery with attempts remaining", async () => {
            const mockDelivery = {
                id: "del_fail_1",
                workspaceId: WS_ID,
                notificationId: "notif_1",
                channel: NotificationChannel.EMAIL,
                recipientType: RecipientType.CUSTOMER_CONTACT,
                destination: "customer@example.com",
                status: NotificationDeliveryStatus.FAILED,
                attemptCount: 2,
                maxAttempts: 5,
            };

            const updatedRows: any[] = [];
            const logRows: any[] = [];

            const mockPrisma: any = {
                notificationDelivery: {
                    findUnique: vi.fn().mockResolvedValue(mockDelivery),
                    update: vi.fn().mockImplementation(({ data }) => {
                        updatedRows.push(data);
                        return { ...mockDelivery, ...data };
                    }),
                },
                notificationLog: {
                    create: vi.fn().mockImplementation(({ data }) => {
                        logRows.push(data);
                        return { id: "log_1", ...data };
                    }),
                },
            };

            const result = await scheduleDeliveryRetry(mockPrisma, "del_fail_1", {
                baseDelaySeconds: 60,
                backoffMultiplier: 2,
                jitterRatio: 0,
            });

            expect(result.status).toBe(NotificationDeliveryStatus.PENDING_RETRY);
            expect(updatedRows.length).toBe(1);
            expect(updatedRows[0].status).toBe(NotificationDeliveryStatus.PENDING_RETRY);
            expect(updatedRows[0].nextAttemptAt).toBeDefined();

            expect(logRows.length).toBe(1);
            expect(logRows[0].status).toBe(NotificationDeliveryStatus.PENDING_RETRY);
            expect(logRows[0].provider).toBe("RETRY_ENGINE");
        });

        it("transitions FAILED delivery to EXHAUSTED when attemptCount >= maxAttempts", async () => {
            const mockDelivery = {
                id: "del_fail_max",
                workspaceId: WS_ID,
                notificationId: "notif_1",
                channel: NotificationChannel.EMAIL,
                recipientType: RecipientType.CUSTOMER_CONTACT,
                destination: "customer@example.com",
                status: NotificationDeliveryStatus.FAILED,
                attemptCount: 5,
                maxAttempts: 5,
            };

            const updatedRows: any[] = [];
            const logRows: any[] = [];

            const mockPrisma: any = {
                notificationDelivery: {
                    findUnique: vi.fn().mockResolvedValue(mockDelivery),
                    findMany: vi.fn().mockResolvedValue([
                        { status: NotificationDeliveryStatus.EXHAUSTED },
                    ]),
                    update: vi.fn().mockImplementation(({ data }) => {
                        updatedRows.push(data);
                        return { ...mockDelivery, ...data };
                    }),
                },
                notificationLog: {
                    create: vi.fn().mockImplementation(({ data }) => {
                        logRows.push(data);
                        return { id: "log_2", ...data };
                    }),
                },
                notification: {
                    update: vi.fn().mockResolvedValue({ id: "notif_1" }),
                },
            };

            const result = await scheduleDeliveryRetry(mockPrisma, "del_fail_max");

            expect(result.status).toBe(NotificationDeliveryStatus.EXHAUSTED);
            expect(updatedRows[0].status).toBe(NotificationDeliveryStatus.EXHAUSTED);
            expect(updatedRows[0].nextAttemptAt).toBeNull();
            expect(logRows[0].errorCode).toBe("MAX_RETRIES_EXCEEDED");
        });

        it("is a no-op if delivery status is not FAILED", async () => {
            const mockDelivery = {
                id: "del_delivered",
                status: NotificationDeliveryStatus.DELIVERED,
            };

            const mockPrisma: any = {
                notificationDelivery: {
                    findUnique: vi.fn().mockResolvedValue(mockDelivery),
                    update: vi.fn(),
                },
            };

            const result = await scheduleDeliveryRetry(mockPrisma, "del_delivered");
            expect(result.status).toBe(NotificationDeliveryStatus.DELIVERED);
            expect(mockPrisma.notificationDelivery.update).not.toHaveBeenCalled();
        });
    });

    describe("3. Due Retry Batch Processing", () => {
        it("finds and processes due PENDING_RETRY deliveries", async () => {
            const dueDeliveries = [
                {
                    id: "del_due_1",
                    workspaceId: WS_ID,
                    notificationId: "notif_due_1",
                    channel: NotificationChannel.EMAIL,
                    status: NotificationDeliveryStatus.PENDING_RETRY,
                    destination: "user1@example.com",
                    recipientType: RecipientType.WORKSPACE_MEMBER,
                    recipientId: "mem_1",
                    attemptCount: 1,
                    maxAttempts: 5,
                    notification: {
                        eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                        metadata: { payload: { workOrderNumber: "WO-01" } },
                    },
                },
            ];

            const updatedStatuses: string[] = [];

            const mockPrisma: any = {
                notificationDelivery: {
                    findMany: vi.fn().mockResolvedValue(dueDeliveries),
                    findUnique: vi.fn().mockImplementation(({ where }) => {
                        return dueDeliveries.find((d) => d.id === where.id);
                    }),
                    update: vi.fn().mockImplementation(({ data }) => {
                        if (data.status) updatedStatuses.push(data.status);
                        return { ...dueDeliveries[0], ...data };
                    }),
                },
                notificationTemplate: {
                    findFirst: vi.fn().mockResolvedValue(null),
                },
                notificationLog: {
                    create: vi.fn().mockResolvedValue({ id: "log_retried" }),
                },
                notification: {
                    update: vi.fn().mockResolvedValue({ id: "notif_due_1" }),
                },
            };

            const result = await processDueDeliveryRetries(mockPrisma, {
                workspaceId: WS_ID,
                now: new Date(),
            });

            expect(result.processedCount).toBe(1);
            expect(result.results.length).toBe(1);
            expect(updatedStatuses).toContain(NotificationDeliveryStatus.PENDING);
            expect(result.results[0].status).toBe(NotificationDeliveryStatus.DELIVERED);
        });
    });

    describe("4. Stuck-PROCESSING Reconciliation Scanner", () => {
        it("recovers deliveries stuck in PROCESSING beyond stale threshold and reschedules them", async () => {
            const staleDate = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
            const stuckDeliveries = [
                {
                    id: "del_stuck_1",
                    workspaceId: WS_ID,
                    notificationId: "notif_1",
                    channel: NotificationChannel.EMAIL,
                    destination: "test@example.com",
                    status: NotificationDeliveryStatus.PROCESSING,
                    attemptCount: 1,
                    maxAttempts: 5,
                    lastAttemptAt: staleDate,
                },
            ];

            const updatedData: any[] = [];
            const logEntries: any[] = [];

            const mockPrisma: any = {
                notificationDelivery: {
                    findMany: vi.fn().mockResolvedValue(stuckDeliveries),
                    update: vi.fn().mockImplementation(({ data }) => {
                        updatedData.push(data);
                        return { ...stuckDeliveries[0], ...data };
                    }),
                },
                notificationLog: {
                    create: vi.fn().mockImplementation(({ data }) => {
                        logEntries.push(data);
                        return { id: "log_rec_1", ...data };
                    }),
                },
            };

            const result = await reconcileStuckDeliveries(mockPrisma, {
                staleThresholdMinutes: 10,
                now: new Date(),
            });

            expect(result.scannedCount).toBe(1);
            expect(result.recoveredCount).toBe(1);
            expect(result.exhaustedCount).toBe(0);
            expect(updatedData[0].status).toBe(NotificationDeliveryStatus.PENDING_RETRY);
            expect(logEntries[0].errorCode).toBe("STUCK_PROCESSING_RECOVERED");
            expect(logEntries[0].provider).toBe("RECONCILIATION_WORKER");
        });

        it("exhausts stuck deliveries that have already reached maxAttempts", async () => {
            const staleDate = new Date(Date.now() - 20 * 60 * 1000);
            const stuckDeliveries = [
                {
                    id: "del_stuck_max",
                    workspaceId: WS_ID,
                    notificationId: "notif_1",
                    channel: NotificationChannel.EMAIL,
                    destination: "test@example.com",
                    status: NotificationDeliveryStatus.PROCESSING,
                    attemptCount: 5,
                    maxAttempts: 5,
                    lastAttemptAt: staleDate,
                },
            ];

            const updatedData: any[] = [];
            const logEntries: any[] = [];

            const mockPrisma: any = {
                notificationDelivery: {
                    findMany: vi.fn().mockResolvedValue(stuckDeliveries),
                    update: vi.fn().mockImplementation(({ data }) => {
                        updatedData.push(data);
                        return { ...stuckDeliveries[0], ...data };
                    }),
                },
                notificationLog: {
                    create: vi.fn().mockImplementation(({ data }) => {
                        logEntries.push(data);
                        return { id: "log_rec_2", ...data };
                    }),
                },
                notification: {
                    update: vi.fn().mockResolvedValue({ id: "notif_1" }),
                },
            };

            const result = await reconcileStuckDeliveries(mockPrisma, {
                staleThresholdMinutes: 10,
                now: new Date(),
            });

            expect(result.scannedCount).toBe(1);
            expect(result.recoveredCount).toBe(0);
            expect(result.exhaustedCount).toBe(1);
            expect(updatedData[0].status).toBe(NotificationDeliveryStatus.EXHAUSTED);
            expect(logEntries[0].errorCode).toBe("STUCK_PROCESSING_EXHAUSTED");
        });

        it("reconciles stuck outbox records back to PENDING", async () => {
            const staleDate = new Date(Date.now() - 30 * 60 * 1000);
            const stuckOutbox = [
                {
                    id: "outbox_stuck_1",
                    workspaceId: WS_ID,
                    status: NotificationOutboxStatus.PROCESSING,
                    attemptCount: 1,
                    createdAt: staleDate,
                },
                {
                    id: "outbox_stuck_max",
                    workspaceId: WS_ID,
                    status: NotificationOutboxStatus.PROCESSING,
                    attemptCount: 5,
                    createdAt: staleDate,
                },
            ];

            const updatedOutbox: any[] = [];

            const mockPrisma: any = {
                notificationOutbox: {
                    findMany: vi.fn().mockResolvedValue(stuckOutbox),
                    update: vi.fn().mockImplementation(({ where, data }) => {
                        updatedOutbox.push({ id: where.id, ...data });
                        return { id: where.id, ...data };
                    }),
                },
            };

            const result = await reconcileStuckOutboxItems(mockPrisma, {
                staleThresholdMinutes: 10,
            });

            expect(result.scannedCount).toBe(2);
            expect(result.recoveredCount).toBe(1);
            expect(result.failedCount).toBe(1);
            expect(updatedOutbox[0].status).toBe(NotificationOutboxStatus.PENDING);
            expect(updatedOutbox[1].status).toBe(NotificationOutboxStatus.FAILED);
        });
    });

    describe("5. No-Duplicate-Delivery & In-Place Reconciliation Invariant", () => {
        it("reconcileStuckDeliveries resets EXISTING row in-place and never creates new NotificationDelivery rows", async () => {
            const staleDate = new Date(Date.now() - 20 * 60 * 1000);
            const originalIdempotencyKey = "sha256_idemp_original_12345";
            const originalDeliveryId = "del_stuck_existing_99";

            const existingDelivery = {
                id: originalDeliveryId,
                workspaceId: WS_ID,
                notificationId: "notif_orig_1",
                channel: NotificationChannel.EMAIL,
                recipientType: RecipientType.CUSTOMER_CONTACT,
                destination: "customer@example.com",
                status: NotificationDeliveryStatus.PROCESSING,
                attemptCount: 1,
                maxAttempts: 5,
                idempotencyKey: originalIdempotencyKey,
                lastAttemptAt: staleDate,
            };

            const mockCreate = vi.fn();
            const mockUpdate = vi.fn().mockImplementation(({ where, data }) => ({
                ...existingDelivery,
                ...data,
            }));

            const mockPrisma: any = {
                notificationDelivery: {
                    findMany: vi.fn().mockResolvedValue([existingDelivery]),
                    update: mockUpdate,
                    create: mockCreate,
                },
                notificationLog: {
                    create: vi.fn().mockResolvedValue({ id: "log_rec_dedup" }),
                },
            };

            const result = await reconcileStuckDeliveries(mockPrisma, {
                staleThresholdMinutes: 10,
            });

            expect(result.recoveredCount).toBe(1);
            expect(result.reconciledDeliveryIds).toEqual([originalDeliveryId]);

            // VERIFY: NotificationDelivery.create is NEVER called during reconciliation
            expect(mockCreate).not.toHaveBeenCalled();

            // VERIFY: NotificationDelivery.update is called specifically for the existing row ID
            expect(mockUpdate).toHaveBeenCalledTimes(1);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: originalDeliveryId },
                    data: expect.objectContaining({
                        status: NotificationDeliveryStatus.PENDING_RETRY,
                    }),
                }),
            );

            // Invariant: The idempotencyKey remains bound to the original row
            expect(existingDelivery.idempotencyKey).toBe(originalIdempotencyKey);
        });

        it("reconcileStuckOutboxItems resets EXISTING row in-place and never creates new NotificationOutbox rows", async () => {
            const staleDate = new Date(Date.now() - 20 * 60 * 1000);
            const originalDedupeKey = "sha256_outbox_dedupe_67890";
            const originalOutboxId = "outbox_stuck_existing_88";

            const existingOutboxItem = {
                id: originalOutboxId,
                workspaceId: WS_ID,
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                status: NotificationOutboxStatus.PROCESSING,
                attemptCount: 1,
                dedupeKey: originalDedupeKey,
                createdAt: staleDate,
            };

            const mockCreate = vi.fn();
            const mockUpdate = vi.fn().mockImplementation(({ where, data }) => ({
                ...existingOutboxItem,
                ...data,
            }));

            const mockPrisma: any = {
                notificationOutbox: {
                    findMany: vi.fn().mockResolvedValue([existingOutboxItem]),
                    update: mockUpdate,
                    create: mockCreate,
                },
            };

            const result = await reconcileStuckOutboxItems(mockPrisma, {
                staleThresholdMinutes: 10,
            });

            expect(result.recoveredCount).toBe(1);
            expect(result.reconciledOutboxIds).toEqual([originalOutboxId]);

            // VERIFY: NotificationOutbox.create is NEVER called during reconciliation
            expect(mockCreate).not.toHaveBeenCalled();

            // VERIFY: NotificationOutbox.update is called specifically for the existing row ID
            expect(mockUpdate).toHaveBeenCalledTimes(1);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: originalOutboxId },
                    data: expect.objectContaining({
                        status: NotificationOutboxStatus.PENDING,
                    }),
                }),
            );

            // Invariant: The dedupeKey remains bound to the original row
            expect(existingOutboxItem.dedupeKey).toBe(originalDedupeKey);
        });
    });
});
