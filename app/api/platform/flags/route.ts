import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import {
    listFeatureFlags,
    createFeatureFlag,
} from "@/lib/services/platform/flags";

/**
 * GET /api/platform/flags
 * Lists platform feature flags with enabled and search filtering.
 * Gated by: platform.config.view
 */
export const GET = withPlatformAuth(
    async (req: NextRequest, context) => {
        const searchParams = req.nextUrl.searchParams;

        const search = searchParams.get("search") || undefined;
        const enabledParam = searchParams.get("enabled");
        const enabled = enabledParam !== null ? enabledParam === "true" : undefined;
        const limitParam = searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const offsetParam = searchParams.get("offset");
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

        const result = await listFeatureFlags(context, {
            search,
            enabled,
            limit,
            offset,
        });

        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_VIEW,
    }
);

/**
 * POST /api/platform/flags
 * Creates a new platform feature flag (Tier-1 Mutating Action).
 * Gated by: platform.config.manage_flags
 */
export const POST = withPlatformAuth(
    async (req: NextRequest, context) => {
        const body = await req.json();
        const reason = body.reason || "";
        const flag = await createFeatureFlag(context, body, reason);
        return jsonSuccess(flag, 201);
    },
    {
        permission: PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS,
    }
);
