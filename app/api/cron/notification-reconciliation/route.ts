import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    reconcileStuckDeliveries,
    reconcileStuckOutboxItems,
} from "@/lib/services/notification/reconciliationWorker";
import {
    verifyCronAuthorization,
    unauthorizedCronResponse,
} from "@/lib/services/cron/cronAuth";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron Endpoint: Notification Reconciliation Sweep
 * Schedule: Every 15 minutes (* /15 * * * *)
 *
 * Scans notification deliveries and outbox items stuck in PROCESSING state and recovers them.
 * Requires `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(request: NextRequest) {
    if (!verifyCronAuthorization(request)) {
        return unauthorizedCronResponse();
    }

    try {
        const deliveriesResult = await reconcileStuckDeliveries(prisma);
        const outboxResult = await reconcileStuckOutboxItems(prisma);

        return NextResponse.json({
            success: true,
            job: "notification-reconciliation",
            timestamp: new Date().toISOString(),
            metrics: {
                deliveries: {
                    recoveredCount: deliveriesResult.recoveredCount,
                    exhaustedCount: deliveriesResult.exhaustedCount,
                    totalReconciled: deliveriesResult.reconciledDeliveryIds.length,
                },
                outbox: {
                    recoveredCount: outboxResult.recoveredCount,
                    failedCount: outboxResult.failedCount,
                    totalReconciled: outboxResult.reconciledOutboxIds.length,
                },
            },
        });
    } catch (err) {
        console.error("[Cron:NotificationReconciliation] Sweep failed:", err);

        return NextResponse.json(
            {
                success: false,
                job: "notification-reconciliation",
                error: "Internal Server Error",
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    return GET(request);
}
