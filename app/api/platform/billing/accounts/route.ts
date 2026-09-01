import { NextRequest } from "next/server";
import { withPlatformAuth, jsonSuccess } from "@/lib/services/platform/transport";
import { PLATFORM_PERMISSIONS } from "@/lib/services/platform/authorization";
import { listPlatformBillingAccounts } from "@/lib/services/platform/billing";

/**
 * GET /api/platform/billing/accounts
 * Lists billing accounts with delinquency, status, and search filters.
 * Gated by: platform.billing.view
 */
export const GET = withPlatformAuth(
    async (req: NextRequest, context) => {
        const searchParams = req.nextUrl.searchParams;

        const isDelinquent = searchParams.get("delinquentOnly") === "true";
        const workspaceId = searchParams.get("workspaceId") || undefined;
        const provider = (searchParams.get("provider") as any) || undefined;
        const limitParam = searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        const offsetParam = searchParams.get("offset");
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

        const result = await listPlatformBillingAccounts(context, {
            workspaceId,
            provider,
            isDelinquent: isDelinquent ? true : undefined,
            limit,
            offset,
        });

        return jsonSuccess(result);
    },
    {
        permission: PLATFORM_PERMISSIONS.BILLING_VIEW,
    }
);
