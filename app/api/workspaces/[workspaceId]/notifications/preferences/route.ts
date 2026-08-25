import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import {
    listNotificationPreferences,
    upsertNotificationPreference,
} from "@/lib/services/notification/notificationPreferenceService";
import {
    queryNotificationPreferencesSchema,
    updateNotificationPreferenceSchema,
} from "@/lib/services/notification/notification.schemas";
import { handleNotificationApiError } from "@/lib/utils/notificationApiError";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ workspaceId: string }> },
) {
    try {
        const { workspaceId } = await context.params;
        const authorization = await requireWorkspaceAuthorization(workspaceId);

        const { searchParams } = new URL(request.url);
        const query = queryNotificationPreferencesSchema.parse({
            scope: searchParams.get("scope") || undefined,
            scopeId: searchParams.get("scopeId") || undefined,
        });

        const preferences = await listNotificationPreferences(
            prisma,
            workspaceId,
            query.scope,
            query.scopeId,
        );

        return NextResponse.json({
            success: true,
            data: preferences,
        });
    } catch (error) {
        return handleNotificationApiError(error, "GET /api/workspaces/[workspaceId]/notifications/preferences");
    }
}

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ workspaceId: string }> },
) {
    try {
        const { workspaceId } = await context.params;
        const authorization = await requireWorkspaceAuthorization(workspaceId);

        const body = await request.json();
        const input = updateNotificationPreferenceSchema.parse(body);

        const updated = await upsertNotificationPreference(
            prisma,
            workspaceId,
            input,
            authorization.membership.id,
        );

        return NextResponse.json({
            success: true,
            data: updated,
        });
    } catch (error) {
        return handleNotificationApiError(error, "PUT /api/workspaces/[workspaceId]/notifications/preferences");
    }
}
