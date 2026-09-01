import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import {
    getPlatformUsers,
    createPlatformUser,
} from "@/lib/services/platform/operators";

/**
 * GET /api/platform/operators
 * Lists platform operators with role and status filtering.
 * Gated by: platform.operators.view
 */
export const GET = withPlatformAuth(
    async (req: NextRequest, context) => {
        const searchParams = req.nextUrl.searchParams;

        const role = (searchParams.get("role") as any) || undefined;
        const status = (searchParams.get("status") as any) || undefined;
        const search = searchParams.get("search") || undefined;
        const limitParam = searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const offsetParam = searchParams.get("offset");
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

        const result = await getPlatformUsers(context, {
            role,
            status,
            search,
            limit,
            offset,
        });

        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.OPERATORS_VIEW,
    }
);

/**
 * POST /api/platform/operators
 * Invites a new platform operator profile (Tier-2 Mutating Action).
 * Gated by: platform.operators.invite
 */
export const POST = withPlatformAuth(
    async (req: NextRequest, context) => {
        const body = await req.json();
        const reason = body.reason || "";
        const options = {
            requestId: req.headers.get("x-request-id") || undefined,
            ipAddress: req.headers.get("x-forwarded-for") || undefined,
            userAgent: req.headers.get("user-agent") || undefined,
            metadata: body.metadata,
        };

        const operator = await createPlatformUser(
            context,
            body,
            reason,
            options
        );
        return jsonSuccess(operator, 201);
    },
    {
        permission: PLATFORM_PERMISSIONS.OPERATORS_INVITE,
    }
);
