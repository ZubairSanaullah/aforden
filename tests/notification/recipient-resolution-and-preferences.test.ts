import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    resolveRecipientDestination,
    resolveActiveChannels,
    getEffectivePreference,
    upsertNotificationPreference,
    listNotificationPreferences,
    RecipientType,
    NotificationPreferenceScope,
    NotificationEventType,
    NotificationChannel,
    MembershipRole,
    NotificationRecipientUnresolvableError,
    NotificationCrossTenantLeakageError,
    NotificationActorUnauthorizedError,
    NotificationPayloadValidationError,
} from "@/lib/services/notification";

describe("Phase 1.13.4 — Recipient Resolution Engine & Notification Preferences", () => {
    let mockPrisma: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma = {
            workspaceMember: {
                findFirst: vi.fn(),
            },
            customerContact: {
                findFirst: vi.fn(),
            },
            notificationPreference: {
                findFirst: vi.fn(),
                findMany: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
            },
        };
    });

    describe("1. resolveRecipientDestination()", () => {
        it("resolves an active WORKSPACE_MEMBER with full employee profile", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "mem_123",
                workspaceId: "ws_A",
                userId: "user_456",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
                user: {
                    id: "user_456",
                    name: "John Technician",
                    email: "john@example.com",
                },
                employee: {
                    displayName: "Johnny T",
                    phone: "+15551234567",
                },
            });

            const result = await resolveRecipientDestination(
                mockPrisma,
                "ws_A",
                RecipientType.WORKSPACE_MEMBER,
                "mem_123",
            );

            expect(mockPrisma.workspaceMember.findFirst).toHaveBeenCalledWith({
                where: {
                    id: "mem_123",
                    workspaceId: "ws_A",
                    status: "ACTIVE",
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            status: true,
                        },
                    },
                    employee: true,
                },
            });

            expect(result).toEqual({
                recipientId: "mem_123",
                recipientType: RecipientType.WORKSPACE_MEMBER,
                name: "Johnny T",
                email: "john@example.com",
                phone: "+15551234567",
                userId: "user_456",
                role: MembershipRole.TECHNICIAN,
            });
        });

        it("resolves a WORKSPACE_MEMBER without employee record, falling back to user.name", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "mem_789",
                workspaceId: "ws_A",
                userId: "user_999",
                role: MembershipRole.DISPATCHER,
                status: "ACTIVE",
                user: {
                    id: "user_999",
                    name: "Dispatcher Dave",
                    email: "dave@example.com",
                },
                employee: null,
            });

            const result = await resolveRecipientDestination(
                mockPrisma,
                "ws_A",
                RecipientType.WORKSPACE_MEMBER,
                "mem_789",
            );

            expect(result.name).toBe("Dispatcher Dave");
            expect(result.email).toBe("dave@example.com");
            expect(result.phone).toBeUndefined();
        });

        it("throws NotificationRecipientUnresolvableError when member is not found or inactive", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);

            await expect(
                resolveRecipientDestination(
                    mockPrisma,
                    "ws_A",
                    RecipientType.WORKSPACE_MEMBER,
                    "mem_unknown",
                ),
            ).rejects.toThrow(NotificationRecipientUnresolvableError);
        });

        it("enforces tenant isolation: member in ws_B queried with ws_A returns unresolvable", async () => {
            // Prisma findFirst returns null because query specifies { workspaceId: "ws_A" }
            mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);

            await expect(
                resolveRecipientDestination(
                    mockPrisma,
                    "ws_A",
                    RecipientType.WORKSPACE_MEMBER,
                    "mem_in_ws_B",
                ),
            ).rejects.toThrow(NotificationRecipientUnresolvableError);

            expect(mockPrisma.workspaceMember.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: "ws_A",
                        id: "mem_in_ws_B",
                    }),
                }),
            );
        });

        it("resolves CUSTOMER_CONTACT with customer name and contact details", async () => {
            mockPrisma.customerContact.findFirst.mockResolvedValue({
                id: "contact_111",
                customerId: "cust_222",
                firstName: "Jane",
                lastName: "Doe",
                email: "jane@acmecorp.com",
                mobilePhone: "+15559876543",
                customer: {
                    id: "cust_222",
                    name: "Acme Corp",
                    workspaceId: "ws_A",
                },
            });

            const result = await resolveRecipientDestination(
                mockPrisma,
                "ws_A",
                RecipientType.CUSTOMER_CONTACT,
                "contact_111",
            );

            expect(mockPrisma.customerContact.findFirst).toHaveBeenCalledWith({
                where: {
                    id: "contact_111",
                    customer: {
                        workspaceId: "ws_A",
                    },
                },
                include: {
                    customer: true,
                },
            });

            expect(result).toEqual({
                recipientId: "contact_111",
                recipientType: RecipientType.CUSTOMER_CONTACT,
                name: "Jane Doe",
                email: "jane@acmecorp.com",
                phone: "+15559876543",
                customerId: "cust_222",
            });
        });

        it("throws NotificationRecipientUnresolvableError if customer contact is in another workspace", async () => {
            mockPrisma.customerContact.findFirst.mockResolvedValue(null);

            await expect(
                resolveRecipientDestination(
                    mockPrisma,
                    "ws_A",
                    RecipientType.CUSTOMER_CONTACT,
                    "contact_other_ws",
                ),
            ).rejects.toThrow(NotificationRecipientUnresolvableError);
        });

        it("resolves DIRECT_RECIPIENT for valid email address without database lookup", async () => {
            const result = await resolveRecipientDestination(
                mockPrisma,
                "ws_A",
                RecipientType.DIRECT_RECIPIENT,
                "direct@client.com",
            );

            expect(result).toEqual({
                recipientId: "direct@client.com",
                recipientType: RecipientType.DIRECT_RECIPIENT,
                name: "direct@client.com",
                email: "direct@client.com",
                phone: undefined,
            });
            expect(mockPrisma.workspaceMember.findFirst).not.toHaveBeenCalled();
            expect(mockPrisma.customerContact.findFirst).not.toHaveBeenCalled();
        });

        it("resolves DIRECT_RECIPIENT for valid E.164 phone number", async () => {
            const result = await resolveRecipientDestination(
                mockPrisma,
                "ws_A",
                RecipientType.DIRECT_RECIPIENT,
                "+14155552671",
            );

            expect(result).toEqual({
                recipientId: "+14155552671",
                recipientType: RecipientType.DIRECT_RECIPIENT,
                name: "+14155552671",
                email: undefined,
                phone: "+14155552671",
            });
        });

        it("throws NotificationRecipientUnresolvableError for invalid direct recipient string", async () => {
            await expect(
                resolveRecipientDestination(
                    mockPrisma,
                    "ws_A",
                    RecipientType.DIRECT_RECIPIENT,
                    "not-an-email-or-phone",
                ),
            ).rejects.toThrow(NotificationRecipientUnresolvableError);
        });

        it("throws NotificationCrossTenantLeakageError if workspaceId is empty", async () => {
            await expect(
                resolveRecipientDestination(
                    mockPrisma,
                    "",
                    RecipientType.DIRECT_RECIPIENT,
                    "test@example.com",
                ),
            ).rejects.toThrow(NotificationCrossTenantLeakageError);
        });
    });

    describe("2. Notification Preferences Service", () => {
        it("getEffectivePreference returns true for mandatory transactional event regardless of preference", async () => {
            const isEnabled = await getEffectivePreference(
                mockPrisma,
                "ws_A",
                NotificationPreferenceScope.MEMBER,
                "mem_123",
                NotificationEventType.INVOICE_SENT,
                NotificationChannel.EMAIL,
            );

            expect(isEnabled).toBe(true);
            expect(mockPrisma.notificationPreference.findFirst).not.toHaveBeenCalled();
        });

        it("getEffectivePreference respects recipient preference when present", async () => {
            mockPrisma.notificationPreference.findFirst.mockResolvedValueOnce({
                isEnabled: false,
            });

            const isEnabled = await getEffectivePreference(
                mockPrisma,
                "ws_A",
                NotificationPreferenceScope.MEMBER,
                "mem_123",
                NotificationEventType.WORK_ORDER_ASSIGNED,
                NotificationChannel.EMAIL,
            );

            expect(isEnabled).toBe(false);
            expect(mockPrisma.notificationPreference.findFirst).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_A",
                    scope: NotificationPreferenceScope.MEMBER,
                    scopeId: "mem_123",
                    eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                    channel: NotificationChannel.EMAIL,
                },
            });
        });

        it("getEffectivePreference falls back to workspace preference when recipient preference is absent", async () => {
            mockPrisma.notificationPreference.findFirst
                .mockResolvedValueOnce(null) // member scope query
                .mockResolvedValueOnce({ isEnabled: false }); // workspace scope query

            const isEnabled = await getEffectivePreference(
                mockPrisma,
                "ws_A",
                NotificationPreferenceScope.MEMBER,
                "mem_123",
                NotificationEventType.WORK_ORDER_ASSIGNED,
                NotificationChannel.EMAIL,
            );

            expect(isEnabled).toBe(false);
        });

        it("getEffectivePreference falls back to true (enabled) when no preferences configured", async () => {
            mockPrisma.notificationPreference.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null);

            const isEnabled = await getEffectivePreference(
                mockPrisma,
                "ws_A",
                NotificationPreferenceScope.MEMBER,
                "mem_123",
                NotificationEventType.WORK_ORDER_ASSIGNED,
                NotificationChannel.EMAIL,
            );

            expect(isEnabled).toBe(true);
        });

        it("rejects attempt to disable mandatory transactional event with NotificationPayloadValidationError", async () => {
            await expect(
                upsertNotificationPreference(
                    mockPrisma,
                    "ws_A",
                    {
                        scope: NotificationPreferenceScope.WORKSPACE,
                        eventType: NotificationEventType.INVOICE_SENT,
                        channel: NotificationChannel.EMAIL,
                        isEnabled: false,
                    },
                    "actor_admin",
                ),
            ).rejects.toThrow(NotificationPayloadValidationError);
        });

        it("enforces RBAC: non-admin member cannot update WORKSPACE-scope preference", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "tech_1",
                workspaceId: "ws_A",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
            });

            await expect(
                upsertNotificationPreference(
                    mockPrisma,
                    "ws_A",
                    {
                        scope: NotificationPreferenceScope.WORKSPACE,
                        eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                        channel: NotificationChannel.EMAIL,
                        isEnabled: true,
                    },
                    "tech_1",
                ),
            ).rejects.toThrow(NotificationActorUnauthorizedError);
        });

        it("enforces RBAC: member cannot update another member's MEMBER-scope preference without Admin/Owner role", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "tech_1",
                workspaceId: "ws_A",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
            });

            await expect(
                upsertNotificationPreference(
                    mockPrisma,
                    "ws_A",
                    {
                        scope: NotificationPreferenceScope.MEMBER,
                        scopeId: "other_tech_2",
                        eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                        channel: NotificationChannel.EMAIL,
                        isEnabled: true,
                    },
                    "tech_1",
                ),
            ).rejects.toThrow(NotificationActorUnauthorizedError);
        });

        it("enforces RBAC: member CAN update their own MEMBER-scope preference", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "tech_1",
                workspaceId: "ws_A",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
            });

            mockPrisma.notificationPreference.findFirst.mockResolvedValue(null);
            mockPrisma.notificationPreference.create.mockResolvedValue({
                id: "pref_1",
                workspaceId: "ws_A",
                scope: NotificationPreferenceScope.MEMBER,
                scopeId: "tech_1",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                channel: NotificationChannel.EMAIL,
                isEnabled: false,
            });

            const result = await upsertNotificationPreference(
                mockPrisma,
                "ws_A",
                {
                    scope: NotificationPreferenceScope.MEMBER,
                    scopeId: "tech_1",
                    eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                    channel: NotificationChannel.EMAIL,
                    isEnabled: false,
                },
                "tech_1",
            );

            expect(result.isEnabled).toBe(false);
            expect(mockPrisma.notificationPreference.create).toHaveBeenCalled();
        });

        it("enforces RBAC: ADMIN can update WORKSPACE and any MEMBER preference", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "admin_1",
                workspaceId: "ws_A",
                role: MembershipRole.ADMIN,
                status: "ACTIVE",
            });

            mockPrisma.notificationPreference.findFirst.mockResolvedValue({
                id: "pref_existing",
            });
            mockPrisma.notificationPreference.update.mockResolvedValue({
                id: "pref_existing",
                isEnabled: true,
            });

            const result = await upsertNotificationPreference(
                mockPrisma,
                "ws_A",
                {
                    scope: NotificationPreferenceScope.MEMBER,
                    scopeId: "tech_target",
                    eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                    channel: NotificationChannel.EMAIL,
                    isEnabled: true,
                },
                "admin_1",
            );

            expect(result.isEnabled).toBe(true);
            expect(mockPrisma.notificationPreference.update).toHaveBeenCalled();
        });

        it("lists notification preferences scoped by workspace", async () => {
            mockPrisma.notificationPreference.findMany.mockResolvedValue([
                { id: "pref_1", workspaceId: "ws_A" },
            ]);

            const list = await listNotificationPreferences(mockPrisma, "ws_A");
            expect(list.length).toBe(1);
            expect(mockPrisma.notificationPreference.findMany).toHaveBeenCalledWith({
                where: { workspaceId: "ws_A" },
                orderBy: [{ eventType: "asc" }, { channel: "asc" }],
            });
        });
    });

    describe("3. resolveActiveChannels()", () => {
        it("skips channels where destination details are missing on recipient", async () => {
            const destinationWithoutEmail = {
                recipientId: "mem_no_email",
                recipientType: RecipientType.WORKSPACE_MEMBER,
                name: "No Email User",
                email: undefined,
                phone: "+15551234567",
                userId: "user_1",
            };

            const channels = await resolveActiveChannels(
                mockPrisma,
                "ws_A",
                NotificationEventType.WORK_ORDER_ASSIGNED, // default channels: [IN_APP, EMAIL]
                RecipientType.WORKSPACE_MEMBER,
                "mem_no_email",
                destinationWithoutEmail,
            );

            const inApp = channels.find(
                (c) => c.channel === NotificationChannel.IN_APP,
            );
            const email = channels.find(
                (c) => c.channel === NotificationChannel.EMAIL,
            );

            expect(inApp?.skipped).toBe(false);
            expect(inApp?.suppressed).toBe(false);

            expect(email?.skipped).toBe(true);
            expect(email?.skipReason).toBe("NO_EMAIL_ON_FILE");
        });

        it("skips IN_APP channel for CUSTOMER_CONTACT recipients", async () => {
            const customerDestination = {
                recipientId: "contact_1",
                recipientType: RecipientType.CUSTOMER_CONTACT,
                name: "Customer Jane",
                email: "jane@customer.com",
                phone: "+15554443333",
            };

            const channels = await resolveActiveChannels(
                mockPrisma,
                "ws_A",
                NotificationEventType.WORK_ORDER_COMPLETED, // default channels: [IN_APP, EMAIL]
                RecipientType.CUSTOMER_CONTACT,
                "contact_1",
                customerDestination,
            );

            const inApp = channels.find(
                (c) => c.channel === NotificationChannel.IN_APP,
            );
            const email = channels.find(
                (c) => c.channel === NotificationChannel.EMAIL,
            );

            expect(inApp?.skipped).toBe(true);
            expect(inApp?.skipReason).toBe("IN_APP_REQUIRES_WORKSPACE_MEMBER");

            expect(email?.skipped).toBe(false);
            expect(email?.suppressed).toBe(false);
        });

        it("bypasses preference suppression for mandatory transactional events (INVOICE_SENT)", async () => {
            const customerDestination = {
                recipientId: "contact_1",
                recipientType: RecipientType.CUSTOMER_CONTACT,
                name: "Customer Jane",
                email: "jane@customer.com",
            };

            const channels = await resolveActiveChannels(
                mockPrisma,
                "ws_A",
                NotificationEventType.INVOICE_SENT, // mandatory transactional event
                RecipientType.CUSTOMER_CONTACT,
                "contact_1",
                customerDestination,
            );

            const email = channels.find(
                (c) => c.channel === NotificationChannel.EMAIL,
            );
            expect(email?.skipped).toBe(false);
            expect(email?.suppressed).toBe(false);
            expect(mockPrisma.notificationPreference.findFirst).not.toHaveBeenCalled();
        });

        it("marks channel suppressed when preference is disabled", async () => {
            const memberDestination = {
                recipientId: "mem_opted_out",
                recipientType: RecipientType.WORKSPACE_MEMBER,
                name: "Member Opted Out",
                email: "optout@example.com",
                userId: "user_optout",
            };

            mockPrisma.notificationPreference.findFirst.mockResolvedValueOnce({
                isEnabled: false,
            });

            const channels = await resolveActiveChannels(
                mockPrisma,
                "ws_A",
                NotificationEventType.WORK_ORDER_ASSIGNED,
                RecipientType.WORKSPACE_MEMBER,
                "mem_opted_out",
                memberDestination,
            );

            const inApp = channels.find(
                (c) => c.channel === NotificationChannel.IN_APP,
            );
            expect(inApp?.suppressed).toBe(true);
            expect(inApp?.suppressionReason).toBe("PREFERENCE_DISABLED");
        });
    });
});
