import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runReconciliationSweep } from "@/lib/services/billing/reconciliationService";
import {
    verifyCronAuthorization,
    unauthorizedCronResponse,
} from "@/lib/services/cron/cronAuth";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron Endpoint: Billing Subscription Reconciliation Sweep
 * Schedule: Hourly (0 * * * *)
 *
 * Scans non-terminal subscriptions and reconciles local state with external billing providers.
 * Requires `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(request: NextRequest) {
    if (!verifyCronAuthorization(request)) {
        return unauthorizedCronResponse();
    }

    try {
        const result = await runReconciliationSweep(prisma);

        return NextResponse.json({
            success: true,
            job: "billing-reconciliation",
            timestamp: new Date().toISOString(),
            metrics: {
                totalScanned: result.totalScanned,
                driftCount: result.driftCount,
                correctedCount: result.correctedCount,
                inSyncCount: result.inSyncCount,
                skippedCount: result.skippedCount,
                errorCount: result.errors.length,
            },
            errors: result.errors,
        });
    } catch (err) {
        console.error("[Cron:BillingReconciliation] Sweep failed:", err);

        return NextResponse.json(
            {
                success: false,
                job: "billing-reconciliation",
                error: "Internal Server Error",
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    return GET(request);
}
