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
    listNotificationHistory,
    getNotificationDetails,
    getDeliveryLogs,
} from "@/lib/services/notification/notificationHistoryService";
import {
    NotificationEventType,
    NotificationStatus,
    NotificationChannel,
    NotificationDeliveryStatus,
    MembershipRole,
    NotificationPreferenceScope,
} from "@/generated/prisma/enums";
import { GET as getHistoryRoute } from "@/app/api/workspaces/[workspaceId]/notifications/history/route";
import { GET as getHistoryDetailRoute } from "@/app/api/workspaces/[workspaceId]/notifications/history/[notificationId]/route";
import { GET as getDeliveryLogsRoute } from "@/app/api/workspaces/[workspaceId]/notifications/deliveries/[deliveryId]/logs/route";
import {
    GET as getPreferencesRoute,
    PUT as putPreferencesRoute,
} from "@/app/api/workspaces/[workspaceId]/notifications/preferences/route";
import { prisma } from "@/lib/prisma";

describe("Phase 1.13.10 — Notification History, Audit & Preference REST APIs", () => {
    const WS_ID = "ws_hist_test_1";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Notification History Query Service", () => {
        it("returns paginated notification history with delivery summaries", async () => {
            const mockNotifications = [
                {
                    id: "notif_1",
                    workspaceId: WS_ID,
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    status: NotificationStatus.SENT,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_1",
                    createdAt: new Date(),
                    deliveries: [
                        {
                            id: "del_1",
                            channel: NotificationChannel.EMAIL,
                            status: NotificationDeliveryStatus.DELIVERED,
                            recipientType: "CUSTOMER_CONTACT",
                            destination: "cust@example.com",
                            attemptCount: 1,
                            deliveredAt: new Date(),
                            nextAttemptAt: null,
                            errorCode: null,
                            errorMessage: null,
                        },
                    ],
                },
            ];

            const mockPrisma: any = {
                notification: {
                    count: vi.fn().mockResolvedValue(1),
                    findMany: vi.fn().mockResolvedValue(mockNotifications),
                },
            };

            const result = await listNotificationHistory(mockPrisma, WS_ID, {
                eventType: NotificationEventType.WORK_ORDER_CREATED,
                status: NotificationStatus.SENT,
                page: 1,
                limit: 10,
            });

            expect(result.items.length).toBe(1);
            expect(result.pagination.total).toBe(1);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.totalPages).toBe(1);
            expect(result.items[0].deliveries.length).toBe(1);
        });

        it("retrieves full notification details with nested deliveries and logs", async () => {
            const mockDetail = {
                id: "notif_detail_1",
                workspaceId: WS_ID,
                eventType: NotificationEventType.INVOICE_SENT,
                status: NotificationStatus.SENT,
                deliveries: [
                    {
                        id: "del_1",
                        channel: NotificationChannel.EMAIL,
                        logs: [{ id: "log_1", attemptNumber: 1, status: "DELIVERED" }],
                    },
                ],
                logs: [{ id: "log_1", attemptNumber: 1, status: "DELIVERED" }],
            };

            const mockPrisma: any = {
                notification: {
                    findFirst: vi.fn().mockResolvedValue(mockDetail),
                },
            };

            const result = await getNotificationDetails(mockPrisma, WS_ID, "notif_detail_1");
            expect(result.id).toBe("notif_detail_1");
            expect(result.deliveries[0].logs.length).toBe(1);
        });

        it("throws NotificationNotFoundError when notification does not exist", async () => {
            const mockPrisma: any = {
                notification: {
                    findFirst: vi.fn().mockResolvedValue(null),
                },
            };

            await expect(
                getNotificationDetails(mockPrisma, WS_ID, "notif_nonexistent"),
            ).rejects.toThrow("not found");
        });

        it("retrieves delivery audit logs for a valid delivery", async () => {
            const mockDelivery = { id: "del_1", workspaceId: WS_ID };
            const mockLogs = [
                { id: "log_1", deliveryId: "del_1", attemptNumber: 1, status: "FAILED" },
                { id: "log_2", deliveryId: "del_1", attemptNumber: 2, status: "DELIVERED" },
            ];

            const mockPrisma: any = {
                notificationDelivery: {
                    findFirst: vi.fn().mockResolvedValue(mockDelivery),
                },
                notificationLog: {
                    findMany: vi.fn().mockResolvedValue(mockLogs),
                },
            };

            const result = await getDeliveryLogs(mockPrisma, WS_ID, "del_1");
            expect(result.length).toBe(2);
            expect(result[0].attemptNumber).toBe(1);
            expect(result[1].attemptNumber).toBe(2);
        });
    });

    describe("2. Notification History REST API Routes", () => {
        it("allows ADMIN to query workspace notification history (GET 200)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                user: { id: "user_admin", email: "admin@example.com" },
                membership: { id: "mem_admin", role: MembershipRole.ADMIN, workspaceId: WS_ID },
            });

            vi.spyOn(prisma.notification, "count").mockResolvedValue(1);
            vi.spyOn(prisma.notification, "findMany").mockResolvedValue([
                {
                    id: "notif_1",
                    workspaceId: WS_ID,
                    eventType: NotificationEventType.QUOTE_SENT,
                    status: NotificationStatus.SENT,
                    deliveries: [],
                    createdAt: new Date(),
                } as any,
            ]);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/history?page=1&limit=10`);
            const res = await getHistoryRoute(req as any, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.length).toBe(1);
            expect(json.pagination.total).toBe(1);
        });

        it("forbids TECHNICIAN from viewing workspace-wide notification history (GET 403)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                user: { id: "user_tech", email: "tech@example.com" },
                membership: { id: "mem_tech", role: MembershipRole.TECHNICIAN, workspaceId: WS_ID },
            });

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/history`);
            const res = await getHistoryRoute(req as any, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.success).toBe(false);
        });

        it("returns notification details by ID (GET 200)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                user: { id: "user_mgr", email: "mgr@example.com" },
                membership: { id: "mem_mgr", role: MembershipRole.MANAGER, workspaceId: WS_ID },
            });

            vi.spyOn(prisma.notification, "findFirst").mockResolvedValue({
                id: "notif_1",
                workspaceId: WS_ID,
                eventType: NotificationEventType.INVOICE_OVERDUE,
                status: NotificationStatus.SENT,
                deliveries: [],
                logs: [],
            } as any);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/history/notif_1`);
            const res = await getHistoryDetailRoute(req as any, {
                params: Promise.resolve({ workspaceId: WS_ID, notificationId: "notif_1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe("notif_1");
        });

        it("returns delivery logs for a specific delivery ID (GET 200)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                user: { id: "user_owner", email: "owner@example.com" },
                membership: { id: "mem_owner", role: MembershipRole.OWNER, workspaceId: WS_ID },
            });

            vi.spyOn(prisma.notificationDelivery, "findFirst").mockResolvedValue({
                id: "del_1",
                workspaceId: WS_ID,
            } as any);

            vi.spyOn(prisma.notificationLog, "findMany").mockResolvedValue([
                {
                    id: "log_1",
                    workspaceId: WS_ID,
                    deliveryId: "del_1",
                    attemptNumber: 1,
                    status: NotificationDeliveryStatus.DELIVERED,
                    provider: "RESEND",
                } as any,
            ]);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/deliveries/del_1/logs`);
            const res = await getDeliveryLogsRoute(req as any, {
                params: Promise.resolve({ workspaceId: WS_ID, deliveryId: "del_1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data[0].provider).toBe("RESEND");
        });
    });

    describe("3. Notification Preferences REST API Routes", () => {
        it("lists preferences for workspace (GET 200)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                user: { id: "user_admin", email: "admin@example.com" },
                membership: { id: "mem_admin", role: MembershipRole.ADMIN, workspaceId: WS_ID },
            });

            vi.spyOn(prisma.notificationPreference, "findMany").mockResolvedValue([
                {
                    id: "pref_1",
                    workspaceId: WS_ID,
                    scope: NotificationPreferenceScope.WORKSPACE,
                    scopeId: null,
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    channel: NotificationChannel.EMAIL,
                    isEnabled: true,
                } as any,
            ]);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/preferences?scope=WORKSPACE`);
            const res = await getPreferencesRoute(req as any, {
                params: Promise.resolve({ workspaceId: WS_ID }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.length).toBe(1);
        });

        it("upserts a notification preference successfully (PUT 200)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                user: { id: "user_admin", email: "admin@example.com" },
                membership: { id: "mem_admin", role: MembershipRole.ADMIN, workspaceId: WS_ID },
            });

            vi.spyOn(prisma.workspaceMember, "findFirst").mockResolvedValue({
                id: "mem_admin",
                workspaceId: WS_ID,
                role: MembershipRole.ADMIN,
                status: "ACTIVE",
            } as any);

            vi.spyOn(prisma.notificationPreference, "findFirst").mockResolvedValue(null);
            vi.spyOn(prisma.notificationPreference, "create").mockResolvedValue({
                id: "pref_new",
                workspaceId: WS_ID,
                scope: NotificationPreferenceScope.WORKSPACE,
                scopeId: null,
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                channel: NotificationChannel.EMAIL,
                isEnabled: false,
            } as any);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/preferences`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    scope: NotificationPreferenceScope.WORKSPACE,
                    eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                    channel: NotificationChannel.EMAIL,
                    isEnabled: false,
                }),
            });

            const res = await putPreferencesRoute(req as any, {
                params: Promise.resolve({ workspaceId: WS_ID }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.isEnabled).toBe(false);
        });

        it("rejects attempt to disable mandatory transactional event (PUT 422)", async () => {
            mocks.requireWorkspaceAuthorization.mockResolvedValue({
                user: { id: "user_admin", email: "admin@example.com" },
                membership: { id: "mem_admin", role: MembershipRole.ADMIN, workspaceId: WS_ID },
            });

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/notifications/preferences`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    scope: NotificationPreferenceScope.WORKSPACE,
                    eventType: NotificationEventType.INVOICE_SENT, // Mandatory transactional
                    channel: NotificationChannel.EMAIL,
                    isEnabled: false,
                }),
            });

            const res = await putPreferencesRoute(req as any, {
                params: Promise.resolve({ workspaceId: WS_ID }),
            });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.message).toContain("mandatory transactional event");
        });
    });
});
