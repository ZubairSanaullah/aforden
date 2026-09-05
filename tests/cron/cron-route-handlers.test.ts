import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies before importing routes
vi.mock("@/lib/prisma", () => ({
    prisma: {
        subscription: {},
        notificationDelivery: {},
        notificationOutbox: {},
        session: {},
    },
}));

vi.mock("@/lib/services/billing/reconciliationService", () => ({
    runReconciliationSweep: vi.fn(),
}));

vi.mock("@/lib/services/notification/reconciliationWorker", () => ({
    reconcileStuckDeliveries: vi.fn(),
    reconcileStuckOutboxItems: vi.fn(),
}));

vi.mock("@/lib/services/auth/cleanupExpiredSessions", () => ({
    cleanupExpiredSessions: vi.fn(),
}));

import { GET as billingCronGET, POST as billingCronPOST } from "@/app/api/cron/billing-reconciliation/route";
import { GET as notificationCronGET, POST as notificationCronPOST } from "@/app/api/cron/notification-reconciliation/route";
import { GET as sessionCleanupCronGET, POST as sessionCleanupCronPOST } from "@/app/api/cron/session-cleanup/route";

import { runReconciliationSweep } from "@/lib/services/billing/reconciliationService";
import {
    reconcileStuckDeliveries,
    reconcileStuckOutboxItems,
} from "@/lib/services/notification/reconciliationWorker";
import { cleanupExpiredSessions } from "@/lib/services/auth/cleanupExpiredSessions";
import { verifyCronAuthorization } from "@/lib/services/cron/cronAuth";

const TEST_CRON_SECRET = "test-cron-secret-1234567890-abcdef";

describe("Phase 1.22.2 — Vercel Cron Infrastructure", () => {
    const originalEnv = process.env.CRON_SECRET;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = TEST_CRON_SECRET;
    });

    afterEach(() => {
        process.env.CRON_SECRET = originalEnv;
    });

    // =========================================================================
    // 1. Cron Authorization Utility (cronAuth.ts)
    // =========================================================================
    describe("1. Cron Authorization Layer (verifyCronAuthorization)", () => {
        it("rejects requests when Authorization header is completely absent", () => {
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation");
            expect(verifyCronAuthorization(req)).toBe(false);
        });

        it("rejects requests when Authorization header lacks 'Bearer ' prefix", () => {
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: `Basic ${TEST_CRON_SECRET}` },
            });
            expect(verifyCronAuthorization(req)).toBe(false);
        });

        it("rejects requests with an incorrect or mismatched token", () => {
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: "Bearer invalid-wrong-secret" },
            });
            expect(verifyCronAuthorization(req)).toBe(false);
        });

        it("fails closed when CRON_SECRET is not configured in process.env", () => {
            delete process.env.CRON_SECRET;
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            expect(verifyCronAuthorization(req)).toBe(false);
        });

        it("fails closed when CRON_SECRET is empty whitespace", () => {
            process.env.CRON_SECRET = "   ";
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: "Bearer    " },
            });
            expect(verifyCronAuthorization(req)).toBe(false);
        });

        it("accepts requests with exact matching Bearer ${CRON_SECRET}", () => {
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            expect(verifyCronAuthorization(req)).toBe(true);
        });
    });

    // =========================================================================
    // 2. Billing Reconciliation Cron Route (/api/cron/billing-reconciliation)
    // =========================================================================
    describe("2. /api/cron/billing-reconciliation", () => {
        it("returns 401 when Authorization header is missing", async () => {
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation");
            const res = await billingCronGET(req);
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Unauthorized");
            expect(runReconciliationSweep).not.toHaveBeenCalled();
        });

        it("returns 401 when token is invalid", async () => {
            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: "Bearer invalid-token" },
            });
            const res = await billingCronGET(req);
            expect(res.status).toBe(401);
            expect(runReconciliationSweep).not.toHaveBeenCalled();
        });

        it("invokes runReconciliationSweep and returns 200 on valid token", async () => {
            vi.mocked(runReconciliationSweep).mockResolvedValueOnce({
                totalScanned: 15,
                driftCount: 3,
                correctedCount: 3,
                inSyncCount: 12,
                skippedCount: 0,
                results: [],
                errors: [],
            });

            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await billingCronGET(req);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.job).toBe("billing-reconciliation");
            expect(json.metrics.totalScanned).toBe(15);
            expect(json.metrics.correctedCount).toBe(3);
            expect(runReconciliationSweep).toHaveBeenCalledTimes(1);
        });

        it("supports POST invocation with valid token", async () => {
            vi.mocked(runReconciliationSweep).mockResolvedValueOnce({
                totalScanned: 5,
                driftCount: 1,
                correctedCount: 1,
                inSyncCount: 4,
                skippedCount: 0,
                results: [],
                errors: [],
            });

            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                method: "POST",
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await billingCronPOST(req);
            expect(res.status).toBe(200);
            expect(runReconciliationSweep).toHaveBeenCalledTimes(1);
        });

        it("returns 500 when underlying service throws an unexpected error", async () => {
            vi.mocked(runReconciliationSweep).mockRejectedValueOnce(new Error("Database connection pool exhausted"));

            const req = new NextRequest("http://localhost:3000/api/cron/billing-reconciliation", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await billingCronGET(req);
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Internal Server Error");
        });
    });

    // =========================================================================
    // 3. Notification Reconciliation Cron Route (/api/cron/notification-reconciliation)
    // =========================================================================
    describe("3. /api/cron/notification-reconciliation", () => {
        it("returns 401 when Authorization header is missing", async () => {
            const req = new NextRequest("http://localhost:3000/api/cron/notification-reconciliation");
            const res = await notificationCronGET(req);
            expect(res.status).toBe(401);
            expect(reconcileStuckDeliveries).not.toHaveBeenCalled();
            expect(reconcileStuckOutboxItems).not.toHaveBeenCalled();
        });

        it("returns 401 when token is invalid", async () => {
            const req = new NextRequest("http://localhost:3000/api/cron/notification-reconciliation", {
                headers: { authorization: "Bearer wrong-token" },
            });
            const res = await notificationCronGET(req);
            expect(res.status).toBe(401);
            expect(reconcileStuckDeliveries).not.toHaveBeenCalled();
        });

        it("invokes reconcileStuckDeliveries and reconcileStuckOutboxItems and returns 200", async () => {
            vi.mocked(reconcileStuckDeliveries).mockResolvedValueOnce({
                scannedCount: 5,
                recoveredCount: 4,
                exhaustedCount: 1,
                reconciledDeliveryIds: ["del_1", "del_2", "del_3", "del_4", "del_5"],
            });
            vi.mocked(reconcileStuckOutboxItems).mockResolvedValueOnce({
                scannedCount: 2,
                recoveredCount: 2,
                failedCount: 0,
                reconciledOutboxIds: ["out_1", "out_2"],
            });

            const req = new NextRequest("http://localhost:3000/api/cron/notification-reconciliation", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await notificationCronGET(req);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.job).toBe("notification-reconciliation");
            expect(json.metrics.deliveries.recoveredCount).toBe(4);
            expect(json.metrics.deliveries.exhaustedCount).toBe(1);
            expect(json.metrics.outbox.recoveredCount).toBe(2);
            expect(reconcileStuckDeliveries).toHaveBeenCalledTimes(1);
            expect(reconcileStuckOutboxItems).toHaveBeenCalledTimes(1);
        });

        it("supports POST invocation with valid token", async () => {
            vi.mocked(reconcileStuckDeliveries).mockResolvedValueOnce({
                scannedCount: 0,
                recoveredCount: 0,
                exhaustedCount: 0,
                reconciledDeliveryIds: [],
            });
            vi.mocked(reconcileStuckOutboxItems).mockResolvedValueOnce({
                scannedCount: 0,
                recoveredCount: 0,
                failedCount: 0,
                reconciledOutboxIds: [],
            });

            const req = new NextRequest("http://localhost:3000/api/cron/notification-reconciliation", {
                method: "POST",
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await notificationCronPOST(req);
            expect(res.status).toBe(200);
            expect(reconcileStuckDeliveries).toHaveBeenCalledTimes(1);
            expect(reconcileStuckOutboxItems).toHaveBeenCalledTimes(1);
        });

        it("returns 500 when reconcileStuckDeliveries fails", async () => {
            vi.mocked(reconcileStuckDeliveries).mockRejectedValueOnce(new Error("Delivery sweep timeout"));

            const req = new NextRequest("http://localhost:3000/api/cron/notification-reconciliation", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await notificationCronGET(req);
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Internal Server Error");
        });
    });

    // =========================================================================
    // 4. Session Cleanup Cron Route (/api/cron/session-cleanup)
    // =========================================================================
    describe("4. /api/cron/session-cleanup", () => {
        it("returns 401 when Authorization header is missing", async () => {
            const req = new NextRequest("http://localhost:3000/api/cron/session-cleanup");
            const res = await sessionCleanupCronGET(req);
            expect(res.status).toBe(401);
            expect(cleanupExpiredSessions).not.toHaveBeenCalled();
        });

        it("returns 401 when token is invalid", async () => {
            const req = new NextRequest("http://localhost:3000/api/cron/session-cleanup", {
                headers: { authorization: "Bearer invalid-secret" },
            });
            const res = await sessionCleanupCronGET(req);
            expect(res.status).toBe(401);
            expect(cleanupExpiredSessions).not.toHaveBeenCalled();
        });

        it("invokes cleanupExpiredSessions and returns 200 on valid token", async () => {
            vi.mocked(cleanupExpiredSessions).mockResolvedValueOnce(42);

            const req = new NextRequest("http://localhost:3000/api/cron/session-cleanup", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await sessionCleanupCronGET(req);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.job).toBe("session-cleanup");
            expect(json.metrics.deletedSessionsCount).toBe(42);
            expect(cleanupExpiredSessions).toHaveBeenCalledTimes(1);
        });

        it("supports POST invocation with valid token", async () => {
            vi.mocked(cleanupExpiredSessions).mockResolvedValueOnce(10);

            const req = new NextRequest("http://localhost:3000/api/cron/session-cleanup", {
                method: "POST",
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await sessionCleanupCronPOST(req);
            expect(res.status).toBe(200);
            expect(cleanupExpiredSessions).toHaveBeenCalledTimes(1);
        });

        it("returns 500 when cleanupExpiredSessions throws", async () => {
            vi.mocked(cleanupExpiredSessions).mockRejectedValueOnce(new Error("Database transaction failed"));

            const req = new NextRequest("http://localhost:3000/api/cron/session-cleanup", {
                headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
            });
            const res = await sessionCleanupCronGET(req);
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Internal Server Error");
        });
    });
});
