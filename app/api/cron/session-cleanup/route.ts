import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/services/auth/cleanupExpiredSessions";
import {
    verifyCronAuthorization,
    unauthorizedCronResponse,
} from "@/lib/services/cron/cronAuth";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron Endpoint: Expired Session Database Cleanup
 * Schedule: Daily at 00:00 UTC (0 0 * * *)
 *
 * Purges database sessions that have exceeded the idle timeout or absolute lifetime.
 * Requires `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(request: NextRequest) {
    if (!verifyCronAuthorization(request)) {
        return unauthorizedCronResponse();
    }

    try {
        const deletedCount = await cleanupExpiredSessions();

        return NextResponse.json({
            success: true,
            job: "session-cleanup",
            timestamp: new Date().toISOString(),
            metrics: {
                deletedSessionsCount: deletedCount,
            },
        });
    } catch (err) {
        console.error("[Cron:SessionCleanup] Cleanup failed:", err);

        return NextResponse.json(
            {
                success: false,
                job: "session-cleanup",
                error: "Internal Server Error",
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    return GET(request);
}
