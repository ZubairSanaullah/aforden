import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import {
    verifyPlatformStepUpChallenge,
    getPlatformStepUpStatus,
} from "@/lib/services/platform/security";

/**
 * POST /api/platform/auth/step-up
 * Submits a step-up re-authentication challenge (password re-entry / WebAuthn).
 * Verifies credentials, updates PlatformAdminProfile.stepUpConfirmedAt = now,
 * and records dedicated security audit events (Phase 1.19.17).
 * 
 * Access: Any authenticated platform operator with an active profile.
 */
export const POST = withPlatformAuth(
    async (req: NextRequest, context) => {
        const body = await req.json().catch(() => ({}));
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const result = await verifyPlatformStepUpChallenge(
            context,
            {
                password: body.password,
                reason: body.reason,
            },
            options
        );

        return jsonSuccess(result);
    }
);

/**
 * GET /api/platform/auth/step-up
 * Inspects current operator's step-up authentication validity, expiry timestamp,
 * and remaining validity window (Phase 1.19.17).
 */
export const GET = withPlatformAuth(
    async (_req: NextRequest, context) => {
        const status = getPlatformStepUpStatus(context);
        return jsonSuccess(status);
    }
);
