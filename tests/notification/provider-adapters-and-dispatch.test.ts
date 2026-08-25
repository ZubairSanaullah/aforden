import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    DatabaseInAppProviderAdapter,
    ResendEmailProviderAdapter,
    MockEmailProviderAdapter,
    NotificationProviderFactory,
    dispatchNotificationDelivery,
    aggregateParentNotificationStatus,
    NotificationDeliveryStatus,
    NotificationStatus,
    NotificationChannel,
    RecipientType,
    NotificationEventType,
    NotificationProviderUnavailableError,
} from "@/lib/services/notification";

describe("Phase 1.13.7 — Provider Abstraction & Delivery Adapters", () => {
    let mockPrisma: any;

    beforeEach(() => {
        vi.clearAllMocks();
        NotificationProviderFactory.reset();

        mockPrisma = {
            inAppNotificationFeed: {
                create: vi.fn(),
            },
            notificationDelivery: {
                findUnique: vi.fn(),
                findMany: vi.fn(),
                update: vi.fn(),
            },
            notification: {
                findUnique: vi.fn(),
                update: vi.fn(),
            },
            notificationOutbox: {
                findUnique: vi.fn(),
            },
            notificationLog: {
                create: vi.fn(),
            },
            notificationTemplate: {
                findFirst: vi.fn(),
            },
        };
    });

    afterEach(() => {
        NotificationProviderFactory.reset();
    });

    describe("1. DatabaseInAppProviderAdapter", () => {
        it("publishes in-app notification feed item to database", async () => {
            const adapter = new DatabaseInAppProviderAdapter();
            mockPrisma.inAppNotificationFeed.create.mockResolvedValue({
                id: "feed_item_1",
                workspaceId: "ws_A",
                memberId: "member_1",
                notificationId: "notif_1",
                title: "Work Order Assigned",
                body: "You have been assigned to WO-101.",
            });

            const result = await adapter.publishInApp(mockPrisma, {
                workspaceId: "ws_A",
                memberId: "member_1",
                notificationId: "notif_1",
                title: "Work Order Assigned",
                body: "You have been assigned to WO-101.",
                sourceEntity: "WorkOrder",
                sourceId: "wo_101",
            });

            expect(result.success).toBe(true);
            expect(result.feedItemId).toBe("feed_item_1");
            expect(mockPrisma.inAppNotificationFeed.create).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_A",
                    memberId: "member_1",
                    notificationId: "notif_1",
                    title: "Work Order Assigned",
                    body: "You have been assigned to WO-101.",
                    linkUrl: null,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_101",
                    isRead: false,
                    isArchived: false,
                },
            });
        });

        it("defensively guards against missing memberId", async () => {
            const adapter = new DatabaseInAppProviderAdapter();
            await expect(
                adapter.publishInApp(mockPrisma, {
                    workspaceId: "ws_A",
                    memberId: "",
                    notificationId: "notif_1",
                    title: "Test",
                    body: "Body",
                }),
            ).rejects.toThrow();
        });
    });

    describe("2. Mock & Resend Email Provider Adapters", () => {
        it("MockEmailProviderAdapter succeeds and returns a mock message ID", async () => {
            const mockAdapter = new MockEmailProviderAdapter();
            const result = await mockAdapter.sendEmail({
                workspaceId: "ws_A",
                to: "customer@example.com",
                subject: "Invoice Due",
                bodyText: "Please pay invoice INV-101.",
            });

            expect(result.success).toBe(true);
            expect(result.providerMessageId).toContain("mock_email_");
            expect(result.isRetryable).toBe(false);
        });

        it("ResendEmailProviderAdapter gracefully handles missing API key", async () => {
            const resendAdapter = new ResendEmailProviderAdapter("");
            const result = await resendAdapter.sendEmail({
                workspaceId: "ws_A",
                to: "customer@example.com",
                subject: "Test",
                bodyText: "Test body",
            });

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe("RESEND_NOT_CONFIGURED");
            expect(result.isRetryable).toBe(false);
        });
    });

    describe("3. NotificationProviderFactory", () => {
        it("returns MockEmailProviderAdapter when RESEND_API_KEY is not set", () => {
            const originalKey = process.env.RESEND_API_KEY;
            delete process.env.RESEND_API_KEY;

            const provider = NotificationProviderFactory.getEmailProvider();
            expect(provider.name).toBe("MOCK_EMAIL");

            process.env.RESEND_API_KEY = originalKey;
        });

        it("returns DatabaseInAppProviderAdapter for IN_APP", () => {
            const provider = NotificationProviderFactory.getInAppProvider();
            expect(provider.name).toBe("DATABASE_IN_APP");
        });

        it("throws NotificationProviderUnavailableError when invoking SMS/Push stubs", async () => {
            const smsProvider = NotificationProviderFactory.getSMSProvider();
            await expect(
                smsProvider.sendSms({
                    workspaceId: "ws_A",
                    to: "+15551234567",
                    body: "Test SMS",
                }),
            ).rejects.toThrow(NotificationProviderUnavailableError);

            const pushProvider = NotificationProviderFactory.getPushProvider();
            await expect(
                pushProvider.sendPush({
                    workspaceId: "ws_A",
                    userId: "user_1",
                    title: "Test",
                    body: "Push body",
                }),
            ).rejects.toThrow(NotificationProviderUnavailableError);
        });
    });

    describe("4. dispatchNotificationDelivery() & Parent Aggregation", () => {
        it("successfully dispatches an EMAIL delivery and updates parent Notification to SENT", async () => {
            const delivery = {
                id: "deliv_email_1",
                notificationId: "notif_parent_1",
                workspaceId: "ws_A",
                channel: NotificationChannel.EMAIL,
                recipientType: RecipientType.WORKSPACE_MEMBER,
                recipientId: "member_1",
                destination: "tech@example.com",
                status: NotificationDeliveryStatus.PENDING,
                attemptCount: 0,
                maxAttempts: 5,
                notification: {
                    id: "notif_parent_1",
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_101",
                    metadata: {
                        outboxId: "outbox_1",
                    },
                },
            };

            mockPrisma.notificationDelivery.findUnique.mockResolvedValue(delivery);
            mockPrisma.notificationOutbox.findUnique.mockResolvedValue({
                id: "outbox_1",
                payload: {
                    workOrderId: "wo_101",
                    workOrderNumber: "WO-101",
                    title: "AC Repair",
                    customerId: "cust_1",
                    customerName: "Acme Corp",
                    technicianId: "tech_1",
                    technicianName: "Bob Tech",
                    priority: "HIGH",
                },
            });

            // Mock mock email provider injection
            NotificationProviderFactory.setEmailProvider({
                name: "MOCK_EMAIL_TEST",
                sendEmail: vi.fn().mockResolvedValue({
                    success: true,
                    providerMessageId: "msg_12345",
                    isRetryable: false,
                }),
            });

            // Sibling deliveries for aggregation: only this 1 delivery
            mockPrisma.notificationDelivery.findMany.mockResolvedValue([
                {
                    id: "deliv_email_1",
                    status: NotificationDeliveryStatus.DELIVERED,
                },
            ]);

            const result = await dispatchNotificationDelivery(
                mockPrisma,
                "deliv_email_1",
            );

            expect(result.status).toBe(NotificationDeliveryStatus.DELIVERED);
            expect(result.providerMessageId).toBe("msg_12345");
            expect(result.attemptCount).toBe(1);

            // Verify status transition update
            expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
                where: { id: "deliv_email_1" },
                data: expect.objectContaining({
                    status: NotificationDeliveryStatus.DELIVERED,
                    attemptCount: 1,
                    providerMessageId: "msg_12345",
                }),
            });

            // Verify durable audit log written
            expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_A",
                    notificationId: "notif_parent_1",
                    deliveryId: "deliv_email_1",
                    status: NotificationDeliveryStatus.DELIVERED,
                    attemptNumber: 1,
                    provider: "MOCK_EMAIL_TEST",
                }),
            });

            // Verify parent notification aggregated to SENT
            expect(mockPrisma.notification.update).toHaveBeenCalledWith({
                where: { id: "notif_parent_1" },
                data: { status: NotificationStatus.SENT },
            });
        });

        it("dispatches IN_APP delivery directly to database feed", async () => {
            const delivery = {
                id: "deliv_in_app_1",
                notificationId: "notif_parent_2",
                workspaceId: "ws_A",
                channel: NotificationChannel.IN_APP,
                recipientType: RecipientType.WORKSPACE_MEMBER,
                recipientId: "member_1",
                destination: "member_1",
                status: NotificationDeliveryStatus.PENDING,
                attemptCount: 0,
                maxAttempts: 5,
                notification: {
                    id: "notif_parent_2",
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_102",
                    metadata: {
                        outboxId: "outbox_2",
                    },
                },
            };

            mockPrisma.notificationDelivery.findUnique.mockResolvedValue(delivery);
            mockPrisma.notificationOutbox.findUnique.mockResolvedValue({
                id: "outbox_2",
                payload: {
                    workOrderId: "wo_102",
                    workOrderNumber: "WO-102",
                    title: "Inspection",
                    customerId: "cust_1",
                    priority: "LOW",
                },
            });

            mockPrisma.inAppNotificationFeed.create.mockResolvedValue({
                id: "feed_item_99",
            });

            mockPrisma.notificationDelivery.findMany.mockResolvedValue([
                {
                    id: "deliv_in_app_1",
                    status: NotificationDeliveryStatus.DELIVERED,
                },
            ]);

            const result = await dispatchNotificationDelivery(
                mockPrisma,
                "deliv_in_app_1",
            );

            expect(result.status).toBe(NotificationDeliveryStatus.DELIVERED);
            expect(result.providerMessageId).toBe("feed_item_99");
            expect(mockPrisma.inAppNotificationFeed.create).toHaveBeenCalled();
        });

        it("skips re-dispatching already DELIVERED deliveries", async () => {
            mockPrisma.notificationDelivery.findUnique.mockResolvedValue({
                id: "deliv_already_sent",
                status: NotificationDeliveryStatus.DELIVERED,
                attemptCount: 1,
            });

            const result = await dispatchNotificationDelivery(
                mockPrisma,
                "deliv_already_sent",
            );

            expect(result.status).toBe(NotificationDeliveryStatus.DELIVERED);
            expect(mockPrisma.notificationDelivery.update).not.toHaveBeenCalled();
        });
    });

    describe("5. Failure Isolation & Fault Containment (Core Invariant Proof)", () => {
        it("handles provider failure gracefully without throwing uncaught exceptions, marks delivery FAILED/EXHAUSTED, and writes audit log", async () => {
            const delivery = {
                id: "deliv_failing_email",
                notificationId: "notif_parent_fail",
                workspaceId: "ws_A",
                channel: NotificationChannel.EMAIL,
                recipientType: RecipientType.CUSTOMER_CONTACT,
                recipientId: "contact_1",
                destination: "bounced@invalid-domain.xyz",
                status: NotificationDeliveryStatus.PENDING,
                attemptCount: 0,
                maxAttempts: 3,
                notification: {
                    id: "notif_parent_fail",
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.INVOICE_SENT,
                    sourceEntity: "Invoice",
                    sourceId: "inv_101",
                    metadata: {
                        outboxId: "outbox_inv",
                    },
                },
            };

            mockPrisma.notificationDelivery.findUnique.mockResolvedValue(delivery);
            mockPrisma.notificationOutbox.findUnique.mockResolvedValue({
                id: "outbox_inv",
                payload: {
                    invoiceId: "inv_101",
                    invoiceNumber: "INV-101",
                    title: "HVAC Inspection",
                    customerId: "cust_1",
                    customerName: "Acme Corp",
                    customerEmail: "bounced@invalid-domain.xyz",
                    totalAmount: "500.00",
                    dueDate: "2026-09-01",
                    currencyCode: "USD",
                },
            });

            // Mock an email provider throwing a network exception
            NotificationProviderFactory.setEmailProvider({
                name: "RESEND_MOCK_FAILING",
                sendEmail: vi.fn().mockRejectedValue(new Error("ETIMEDOUT: Connection timed out to Resend API")),
            });

            mockPrisma.notificationDelivery.findMany.mockResolvedValue([
                {
                    id: "deliv_failing_email",
                    status: NotificationDeliveryStatus.EXHAUSTED,
                },
            ]);

            // Execute dispatch — should NOT throw
            const result = await dispatchNotificationDelivery(
                mockPrisma,
                "deliv_failing_email",
            );

            expect(result.status).toBe(NotificationDeliveryStatus.EXHAUSTED);
            expect(result.errorCode).toBe("PROVIDER_UNCAUGHT_EXCEPTION");
            expect(result.errorMessage).toContain("Connection timed out");
            expect(result.attemptCount).toBe(1);

            // Durable audit log must be written
            expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    deliveryId: "deliv_failing_email",
                    status: NotificationDeliveryStatus.EXHAUSTED,
                    attemptNumber: 1,
                    provider: "RESEND_MOCK_FAILING",
                }),
            });

            // Parent notification must be updated to FAILED
            expect(mockPrisma.notification.update).toHaveBeenCalledWith({
                where: { id: "notif_parent_fail" },
                data: { status: NotificationStatus.FAILED },
            });
        });

        it("aggregates parent notification to PARTIALLY_SENT when one delivery succeeds and another fails", async () => {
            mockPrisma.notificationDelivery.findMany.mockResolvedValue([
                { id: "d1", status: NotificationDeliveryStatus.DELIVERED },
                { id: "d2", status: NotificationDeliveryStatus.FAILED },
            ]);

            const status = await aggregateParentNotificationStatus(
                mockPrisma,
                "notif_mixed",
            );

            expect(status).toBe(NotificationStatus.PARTIALLY_SENT);
            expect(mockPrisma.notification.update).toHaveBeenCalledWith({
                where: { id: "notif_mixed" },
                data: { status: NotificationStatus.PARTIALLY_SENT },
            });
        });
    });
});
