import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    requireWorkspaceAuthorization: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: mocks.requireWorkspaceAuthorization,
}));

import {
    listInAppNotifications,
    getUnreadNotificationCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    archiveNotification,
    NotificationNotFoundError,
} from "@/lib/services/notification";
import { GET as getFeedRoute } from "@/app/api/workspaces/[workspaceId]/notifications/route";
import { GET as getUnreadCountRoute } from "@/app/api/workspaces/[workspaceId]/notifications/unread-count/route";
import { PATCH as patchReadRoute } from "@/app/api/workspaces/[workspaceId]/notifications/[feedItemId]/read/route";
import { POST as postReadAllRoute } from "@/app/api/workspaces/[workspaceId]/notifications/read-all/route";
import { PATCH as patchArchiveRoute } from "@/app/api/workspaces/[workspaceId]/notifications/[feedItemId]/archive/route";
import { UnauthorizedError } from "@/lib/services/authorization/authorizationErrors";

describe("Phase 1.13.8 — In-App Notification Center & Member Feed API", () => {
    let mockPrisma: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma = {
            inAppNotificationFeed: {
                count: vi.fn(),
                findMany: vi.fn(),
                findFirst: vi.fn(),
                update: vi.fn(),
                updateMany: vi.fn(),
            },
        };
    });

    describe("1. Feed Query Service (listInAppNotifications & unread count)", () => {
        it("strictly filters queries by both workspaceId AND memberId", async () => {
            const feedItems = [
                {
                    id: "feed_1",
                    workspaceId: "ws_A",
                    memberId: "member_1",
                    notificationId: "notif_1",
                    title: "Work Order Created",
                    body: "WO-101 created",
                    linkUrl: "/work-orders/wo_101",
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_101",
                    isRead: false,
                    readAt: null,
                    isArchived: false,
                    archivedAt: null,
                    createdAt: new Date("2026-08-25T12:00:00.000Z"),
                    updatedAt: new Date("2026-08-25T12:00:00.000Z"),
                },
            ];

            mockPrisma.inAppNotificationFeed.count.mockResolvedValue(1);
            mockPrisma.inAppNotificationFeed.findMany.mockResolvedValue(feedItems);

            const result = await listInAppNotifications(
                mockPrisma,
                "ws_A",
                "member_1",
                {
                    workspaceId: "ws_A",
                    memberId: "member_1",
                    isRead: false,
                    limit: 10,
                    offset: 0,
                },
            );

            expect(result.items.length).toBe(1);
            expect(result.total).toBe(1);
            expect(result.hasMore).toBe(false);
            expect(result.items[0].id).toBe("feed_1");

            expect(mockPrisma.inAppNotificationFeed.findMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_A",
                    memberId: "member_1",
                    isRead: false,
                    isArchived: false, // default excludes archived
                },
                skip: 0,
                take: 10,
                orderBy: { createdAt: "desc" },
            });
        });

        it("correctly calculates hasMore across paginated queries", async () => {
            mockPrisma.inAppNotificationFeed.count.mockResolvedValue(25);
            mockPrisma.inAppNotificationFeed.findMany.mockResolvedValue(
                new Array(10).fill({
                    id: "f",
                    workspaceId: "ws_A",
                    memberId: "m_1",
                    notificationId: "n_1",
                    title: "T",
                    body: "B",
                    linkUrl: null,
                    sourceEntity: null,
                    sourceId: null,
                    isRead: false,
                    readAt: null,
                    isArchived: false,
                    archivedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }),
            );

            const result = await listInAppNotifications(
                mockPrisma,
                "ws_A",
                "member_1",
                {
                    workspaceId: "ws_A",
                    memberId: "member_1",
                    limit: 10,
                    offset: 0,
                },
            );

            expect(result.total).toBe(25);
            expect(result.items.length).toBe(10);
            expect(result.hasMore).toBe(true);
        });

        it("getUnreadNotificationCount excludes archived notifications", async () => {
            mockPrisma.inAppNotificationFeed.count.mockResolvedValue(4);

            const count = await getUnreadNotificationCount(
                mockPrisma,
                "ws_A",
                "member_1",
            );

            expect(count).toBe(4);
            expect(mockPrisma.inAppNotificationFeed.count).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_A",
                    memberId: "member_1",
                    isRead: false,
                    isArchived: false,
                },
            });
        });
    });

    describe("2. Mark Read & Archive Operations", () => {
        it("marks a feed item as read and returns updated DTO", async () => {
            const feedItem = {
                id: "feed_1",
                workspaceId: "ws_A",
                memberId: "member_1",
                notificationId: "notif_1",
                title: "Inspection",
                body: "Body",
                linkUrl: null,
                sourceEntity: null,
                sourceId: null,
                isRead: false,
                readAt: null,
                isArchived: false,
                archivedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mockPrisma.inAppNotificationFeed.findFirst.mockResolvedValue(feedItem);
            mockPrisma.inAppNotificationFeed.update.mockResolvedValue({
                ...feedItem,
                isRead: true,
                readAt: new Date("2026-08-25T13:00:00.000Z"),
            });

            const result = await markNotificationAsRead(
                mockPrisma,
                "ws_A",
                "member_1",
                "feed_1",
            );

            expect(result.isRead).toBe(true);
            expect(result.readAt).toBe("2026-08-25T13:00:00.000Z");
            expect(mockPrisma.inAppNotificationFeed.update).toHaveBeenCalledWith({
                where: { id: "feed_1" },
                data: {
                    isRead: true,
                    readAt: expect.any(Date),
                },
            });
        });

        it("returns existing DTO idempotently if item is already read", async () => {
            const alreadyRead = {
                id: "feed_read",
                workspaceId: "ws_A",
                memberId: "member_1",
                notificationId: "notif_1",
                title: "Inspection",
                body: "Body",
                linkUrl: null,
                sourceEntity: null,
                sourceId: null,
                isRead: true,
                readAt: new Date("2026-08-25T12:00:00.000Z"),
                isArchived: false,
                archivedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mockPrisma.inAppNotificationFeed.findFirst.mockResolvedValue(alreadyRead);

            const result = await markNotificationAsRead(
                mockPrisma,
                "ws_A",
                "member_1",
                "feed_read",
            );

            expect(result.isRead).toBe(true);
            expect(mockPrisma.inAppNotificationFeed.update).not.toHaveBeenCalled();
        });

        it("throws NotificationNotFoundError when attempting to mark another member's item as read", async () => {
            mockPrisma.inAppNotificationFeed.findFirst.mockResolvedValue(null);

            await expect(
                markNotificationAsRead(
                    mockPrisma,
                    "ws_A",
                    "member_1",
                    "feed_other_member",
                ),
            ).rejects.toThrow(NotificationNotFoundError);
        });

        it("markAllNotificationsAsRead updates only the authenticated member's items", async () => {
            mockPrisma.inAppNotificationFeed.updateMany.mockResolvedValue({
                count: 5,
            });

            const result = await markAllNotificationsAsRead(
                mockPrisma,
                "ws_A",
                "member_1",
            );

            expect(result.updatedCount).toBe(5);
            expect(mockPrisma.inAppNotificationFeed.updateMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_A",
                    memberId: "member_1",
                    isRead: false,
                    isArchived: false,
                },
                data: {
                    isRead: true,
                    readAt: expect.any(Date),
                },
            });
        });

        it("archives a single notification item", async () => {
            const feedItem = {
                id: "feed_1",
                workspaceId: "ws_A",
                memberId: "member_1",
                notificationId: "notif_1",
                title: "Inspection",
                body: "Body",
                linkUrl: null,
                sourceEntity: null,
                sourceId: null,
                isRead: true,
                readAt: new Date(),
                isArchived: false,
                archivedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mockPrisma.inAppNotificationFeed.findFirst.mockResolvedValue(feedItem);
            mockPrisma.inAppNotificationFeed.update.mockResolvedValue({
                ...feedItem,
                isArchived: true,
                archivedAt: new Date("2026-08-25T14:00:00.000Z"),
            });

            const result = await archiveNotification(
                mockPrisma,
                "ws_A",
                "member_1",
                "feed_1",
            );

            expect(result.isArchived).toBe(true);
            expect(result.archivedAt).toBe("2026-08-25T14:00:00.000Z");
        });
    });

    describe("3. REST API Route Handlers & Authentication Guards", () => {
        const mockContext = {
            params: Promise.resolve({
                workspaceId: "ws_A",
                feedItemId: "feed_1",
            }),
        };

        it("returns 401 UNAUTHORIZED on unauthenticated request to GET /notifications", async () => {
            mocks.requireWorkspaceAuthorization.mockRejectedValue(
                new UnauthorizedError(),
            );

            const req = new Request(
                "http://localhost:3000/api/workspaces/ws_A/notifications",
            );
            const res = await getFeedRoute(req, mockContext);
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("returns 401 UNAUTHORIZED on unauthenticated request to GET /notifications/unread-count", async () => {
            mocks.requireWorkspaceAuthorization.mockRejectedValue(
                new UnauthorizedError(),
            );

            const req = new Request(
                "http://localhost:3000/api/workspaces/ws_A/notifications/unread-count",
            );
            const res = await getUnreadCountRoute(req, mockContext);
            expect(res.status).toBe(401);
        });

        it("returns 401 UNAUTHORIZED on unauthenticated request to PATCH /notifications/[feedItemId]/read", async () => {
            mocks.requireWorkspaceAuthorization.mockRejectedValue(
                new UnauthorizedError(),
            );

            const req = new Request(
                "http://localhost:3000/api/workspaces/ws_A/notifications/feed_1/read",
                { method: "PATCH" },
            );
            const res = await patchReadRoute(req, mockContext);
            expect(res.status).toBe(401);
        });

        it("returns 401 UNAUTHORIZED on unauthenticated request to POST /notifications/read-all", async () => {
            mocks.requireWorkspaceAuthorization.mockRejectedValue(
                new UnauthorizedError(),
            );

            const req = new Request(
                "http://localhost:3000/api/workspaces/ws_A/notifications/read-all",
                { method: "POST" },
            );
            const res = await postReadAllRoute(req, mockContext);
            expect(res.status).toBe(401);
        });

        it("returns 401 UNAUTHORIZED on unauthenticated request to PATCH /notifications/[feedItemId]/archive", async () => {
            mocks.requireWorkspaceAuthorization.mockRejectedValue(
                new UnauthorizedError(),
            );

            const req = new Request(
                "http://localhost:3000/api/workspaces/ws_A/notifications/feed_1/archive",
                { method: "PATCH" },
            );
            const res = await patchArchiveRoute(req, mockContext);
            expect(res.status).toBe(401);
        });
    });
});
