import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    requireWorkspaceAuthorization: vi.fn(),
    listInAppNotifications: vi.fn(),
    getUnreadNotificationCount: vi.fn(),
    markNotificationAsRead: vi.fn(),
    markAllNotificationsAsRead: vi.fn(),
    archiveNotification: vi.fn(),
    getDeliveryLogs: vi.fn(),
    listNotificationPreferences: vi.fn(),
    upsertNotificationPreference: vi.fn(),
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: mocks.requireWorkspaceAuthorization,
}));

vi.mock("@/lib/services/notification", async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        listInAppNotifications: mocks.listInAppNotifications,
        getUnreadNotificationCount: mocks.getUnreadNotificationCount,
        markNotificationAsRead: mocks.markNotificationAsRead,
        markAllNotificationsAsRead: mocks.markAllNotificationsAsRead,
        archiveNotification: mocks.archiveNotification,
    };
});

vi.mock("@/lib/services/notification/notificationHistoryService", () => ({
    getDeliveryLogs: mocks.getDeliveryLogs,
}));

vi.mock("@/lib/services/notification/notificationPreferenceService", () => ({
    listNotificationPreferences: mocks.listNotificationPreferences,
    upsertNotificationPreference: mocks.upsertNotificationPreference,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {},
}));

import { NextRequest } from "next/server";
import { GET as getFeedRoute } from "@/app/api/workspaces/[workspaceId]/notifications/route";
import { GET as getUnreadCountRoute } from "@/app/api/workspaces/[workspaceId]/notifications/unread-count/route";
import { POST as postReadAllRoute } from "@/app/api/workspaces/[workspaceId]/notifications/read-all/route";
import { PATCH as patchReadRoute } from "@/app/api/workspaces/[workspaceId]/notifications/[feedItemId]/read/route";
import { PATCH as patchArchiveRoute } from "@/app/api/workspaces/[workspaceId]/notifications/[feedItemId]/archive/route";
import { GET as getDeliveryLogsRoute } from "@/app/api/workspaces/[workspaceId]/notifications/deliveries/[deliveryId]/logs/route";
import { GET as getPreferencesRoute, PUT as putPreferencesRoute } from "@/app/api/workspaces/[workspaceId]/notifications/preferences/route";
import { NotificationNotFoundError } from "@/lib/services/notification";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";

describe("Phase 1.21.2 — Workspace Notification REST Routes Hardening", () => {
    const WS_ID = "ws_notif_100";
    const MEMBER_ID = "mem_notif_1";

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.requireWorkspaceAuthorization.mockResolvedValue({
            membership: {
                id: MEMBER_ID,
                role: "ADMIN",
                userId: "user_1",
                workspaceId: WS_ID,
            },
        });
    });

    describe("1. Feed & Unread Count Routes", () => {
        it("GET /notifications returns 200 with paginated notifications and parsed query", async () => {
            mocks.listInAppNotifications.mockResolvedValue({
                items: [{ id: "feed_1", title: "Job Dispatched" }],
                total: 1,
                hasMore: false,
            });

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications?limit=25&page=2`);
            const res = await getFeedRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.items.length).toBe(1);

            expect(mocks.listInAppNotifications).toHaveBeenCalledWith(
                expect.anything(),
                WS_ID,
                MEMBER_ID,
                expect.objectContaining({
                    limit: 25,
                    offset: 25,
                }),
            );
        });

        it("GET /notifications returns 401 when unauthorized", async () => {
            mocks.requireWorkspaceAuthorization.mockRejectedValue(new UnauthorizedError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications`);
            const res = await getFeedRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(401);
        });

        it("GET /notifications returns 500 when list service throws", async () => {
            mocks.listInAppNotifications.mockRejectedValue(new Error("Query failed"));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications`);
            const res = await getFeedRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(500);
        });

        it("GET /notifications/unread-count returns 200 with unread count integer", async () => {
            mocks.getUnreadNotificationCount.mockResolvedValue(7);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/unread-count`);
            const res = await getUnreadCountRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.count).toBe(7);
        });

        it("GET /notifications/unread-count returns 500 on database error", async () => {
            mocks.getUnreadNotificationCount.mockRejectedValue(new Error("DB error"));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/unread-count`);
            const res = await getUnreadCountRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(500);
        });
    });

    describe("2. Read All & Individual Item Operations", () => {
        it("POST /notifications/read-all returns 200 with updated count", async () => {
            mocks.markAllNotificationsAsRead.mockResolvedValue({ updatedCount: 12 });

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/read-all`, { method: "POST" });
            const res = await postReadAllRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.updatedCount).toBe(12);
        });

        it("PATCH /notifications/[feedItemId]/read returns 200 when marking read", async () => {
            mocks.markNotificationAsRead.mockResolvedValue({ id: "feed_1", isRead: true });

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/feed_1/read`, { method: "PATCH" });
            const res = await patchReadRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, feedItemId: "feed_1" }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.isRead).toBe(true);
        });

        it("PATCH /notifications/[feedItemId]/read returns 404 when item not found", async () => {
            mocks.markNotificationAsRead.mockRejectedValue(new NotificationNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/feed_nonexistent/read`, { method: "PATCH" });
            const res = await patchReadRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, feedItemId: "feed_nonexistent" }) });
            expect(res.status).toBe(404);
        });

        it("PATCH /notifications/[feedItemId]/archive returns 200 when archived", async () => {
            mocks.archiveNotification.mockResolvedValue({ id: "feed_1", isArchived: true });

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/feed_1/archive`, { method: "PATCH" });
            const res = await patchArchiveRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, feedItemId: "feed_1" }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.isArchived).toBe(true);
        });

        it("PATCH /notifications/[feedItemId]/archive returns 404 when item not found", async () => {
            mocks.archiveNotification.mockRejectedValue(new NotificationNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/feed_none/archive`, { method: "PATCH" });
            const res = await patchArchiveRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, feedItemId: "feed_none" }) });
            expect(res.status).toBe(404);
        });
    });

    describe("3. Delivery Logs & Preferences Routes", () => {
        it("GET /deliveries/[deliveryId]/logs returns 200 for allowed roles", async () => {
            mocks.getDeliveryLogs.mockResolvedValue([{ id: "log_1", status: "DELIVERED" }]);

            const req = new NextRequest(`http://localhost/api/workspaces/${WS_ID}/notifications/deliveries/del_1/logs`);
            const res = await getDeliveryLogsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, deliveryId: "del_1" }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBe(1);
        });

        it("GET /deliveries/[deliveryId]/logs returns 403 Forbidden for TECHNICIAN role", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                membership: {
                    id: MEMBER_ID,
                    role: "TECHNICIAN" as any,
                    userId: "user_tech",
                    workspaceId: WS_ID,
                },
            });

            const req = new NextRequest(`http://localhost/api/workspaces/${WS_ID}/notifications/deliveries/del_1/logs`);
            const res = await getDeliveryLogsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, deliveryId: "del_1" }) });
            expect(res.status).toBe(403);
        });

        it("GET /preferences returns 200 with scoped notification preferences", async () => {
            mocks.listNotificationPreferences.mockResolvedValue([{ id: "pref_1", channel: "EMAIL", enabled: true }]);

            const req = new NextRequest(`http://localhost/api/workspaces/${WS_ID}/notifications/preferences?scope=WORKSPACE`);
            const res = await getPreferencesRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBe(1);
        });

        it("PUT /preferences updates preference and returns 200", async () => {
            mocks.upsertNotificationPreference.mockResolvedValue({
                id: "pref_1",
                channel: "EMAIL",
                isEnabled: false,
            });

            const req = new NextRequest(`http://localhost/api/workspaces/${WS_ID}/notifications/preferences`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    channel: "EMAIL",
                    eventType: "WORK_ORDER_ASSIGNED",
                    isEnabled: false,
                    scope: "WORKSPACE",
                }),
            });

            const res = await putPreferencesRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.isEnabled).toBe(false);
        });

        it("PUT /preferences returns 422 on invalid payload schema", async () => {
            const req = new NextRequest(`http://localhost/api/workspaces/${WS_ID}/notifications/preferences`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    channel: "TELEPATHY", // invalid channel enum
                }),
            });

            const res = await putPreferencesRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });
            expect(res.status).toBe(422);
        });
    });
});
