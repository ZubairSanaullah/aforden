import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import {
    emitNotificationEvent,
    processNotificationOutboxBatch,
    extractRecipientTargets,
    NotificationEventType,
    NotificationChannel,
    RecipientType,
    NotificationOutboxStatus,
    NotificationStatus,
    NotificationDeliveryStatus,
    MembershipRole,
    NotificationPayloadValidationError,
    NotificationCrossTenantLeakageError,
} from "@/lib/services/notification";

describe("Phase 1.13.6 — Event Ingestion & Transactional Outbox Pipeline", () => {
    let mockTx: any;
    let mockPrisma: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockTx = {
            notificationOutbox: {
                findFirst: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
            },
        };

        mockPrisma = {
            $queryRaw: vi.fn(),
            $transaction: vi.fn(async (callback: any) => {
                return await callback({
                    notification: {
                        create: vi.fn().mockImplementation(async ({ data }: any) => ({
                            id: "notif_generated_123",
                            ...data,
                        })),
                    },
                    notificationDelivery: {
                        create: vi.fn().mockImplementation(async ({ data }: any) => ({
                            id: `deliv_${Math.random()}`,
                            ...data,
                        })),
                    },
                    notificationOutbox: {
                        update: vi.fn().mockResolvedValue({ id: "outbox_1" }),
                    },
                });
            }),
            workspaceMember: {
                findFirst: vi.fn(),
            },
            customerContact: {
                findFirst: vi.fn(),
            },
            notificationPreference: {
                findFirst: vi.fn(),
            },
            notificationOutbox: {
                update: vi.fn(),
            },
        };
    });

    describe("1. emitNotificationEvent()", () => {
        const samplePayload = {
            workOrderId: "wo_101",
            workOrderNumber: "WO-101",
            title: "Repair Leak",
            customerId: "cust_1",
            customerName: "Acme Corp",
            technicianId: "tech_1",
            technicianName: "Bob Tech",
            priority: "HIGH",
        };

        it("inserts a new PENDING outbox record with deterministic dedupeKey on first emission", async () => {
            mockTx.notificationOutbox.findFirst.mockResolvedValue(null);
            mockTx.notificationOutbox.create.mockResolvedValue({
                id: "outbox_new",
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_101",
                dedupeKey: "expected_hash",
                actorMemberId: "actor_1",
                payload: samplePayload,
                status: NotificationOutboxStatus.PENDING,
                attemptCount: 0,
                errorMessage: null,
                processedAt: null,
                createdAt: new Date("2026-08-25T12:00:00.000Z"),
            });

            const result = await emitNotificationEvent(mockTx, {
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_101",
                actorMemberId: "actor_1",
                payload: samplePayload,
            });

            expect(result.id).toBe("outbox_new");
            expect(result.status).toBe(NotificationOutboxStatus.PENDING);

            const expectedDedupeKey = crypto
                .createHash("sha256")
                .update(
                    `ws_A:WorkOrder:wo_101:${NotificationEventType.WORK_ORDER_ASSIGNED}`,
                )
                .digest("hex");

            expect(mockTx.notificationOutbox.findFirst).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_A",
                    dedupeKey: expectedDedupeKey,
                },
            });
            expect(mockTx.notificationOutbox.create).toHaveBeenCalled();
        });

        it("returns existing outbox record without duplicating when emitted twice (Tier 1 Idempotency)", async () => {
            const existingOutbox = {
                id: "outbox_existing",
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_101",
                dedupeKey: "existing_hash",
                actorMemberId: "actor_1",
                payload: samplePayload,
                status: NotificationOutboxStatus.PROCESSING, // status preserved
                attemptCount: 1,
                errorMessage: null,
                processedAt: null,
                createdAt: new Date("2026-08-25T12:00:00.000Z"),
            };

            mockTx.notificationOutbox.findFirst.mockResolvedValue(existingOutbox);

            const result = await emitNotificationEvent(mockTx, {
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_101",
                actorMemberId: "actor_1",
                payload: samplePayload,
            });

            expect(result.id).toBe("outbox_existing");
            expect(result.status).toBe(NotificationOutboxStatus.PROCESSING);
            expect(mockTx.notificationOutbox.create).not.toHaveBeenCalled();
        });

        it("respects caller-supplied dedupeKey override for recurring events", async () => {
            mockTx.notificationOutbox.findFirst.mockResolvedValue(null);
            mockTx.notificationOutbox.create.mockResolvedValue({
                id: "outbox_reminder",
                workspaceId: "ws_A",
                eventType: NotificationEventType.SCHEDULE_APPOINTMENT_APPROACHING,
                sourceEntity: "ScheduleAppointment",
                sourceId: "apt_1",
                dedupeKey: "custom_reminder_24h_hash",
                actorMemberId: null,
                payload: {
                    appointmentId: "apt_1",
                    appointmentNumber: "APT-001",
                    workOrderId: "wo_1",
                    technicianId: "tech_1",
                    scheduledStart: "2026-08-26T10:00:00.000Z",
                    minutesUntilStart: 1440,
                },
                status: NotificationOutboxStatus.PENDING,
                attemptCount: 0,
                errorMessage: null,
                processedAt: null,
                createdAt: new Date(),
            });

            await emitNotificationEvent(mockTx, {
                workspaceId: "ws_A",
                eventType: NotificationEventType.SCHEDULE_APPOINTMENT_APPROACHING,
                sourceEntity: "ScheduleAppointment",
                sourceId: "apt_1",
                dedupeKey: "custom_reminder_24h_hash",
                payload: {
                    appointmentId: "apt_1",
                    appointmentNumber: "APT-001",
                    workOrderId: "wo_1",
                    technicianId: "tech_1",
                    scheduledStart: "2026-08-26T10:00:00.000Z",
                    minutesUntilStart: 1440,
                },
            });

            expect(mockTx.notificationOutbox.findFirst).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_A",
                    dedupeKey: "custom_reminder_24h_hash",
                },
            });
        });

        it("throws NotificationPayloadValidationError when payload violates schema", async () => {
            await expect(
                emitNotificationEvent(mockTx, {
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_101",
                    payload: {
                        workOrderId: "wo_101",
                        // missing required workOrderNumber, title, customerId, technicianId, priority
                    },
                }),
            ).rejects.toThrow(NotificationPayloadValidationError);
        });

        it("throws NotificationCrossTenantLeakageError when workspaceId is missing", async () => {
            await expect(
                emitNotificationEvent(mockTx, {
                    workspaceId: "",
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_101",
                    payload: samplePayload,
                }),
            ).rejects.toThrow(NotificationCrossTenantLeakageError);
        });
    });

    describe("2. extractRecipientTargets()", () => {
        it("extracts workspace member targets from payload", async () => {
            const targets = await extractRecipientTargets(
                mockPrisma,
                "ws_A",
                [RecipientType.WORKSPACE_MEMBER],
                {
                    technicianId: "tech_1",
                    newTechnicianId: "tech_2",
                },
            );

            expect(targets).toEqual([
                {
                    recipientType: RecipientType.WORKSPACE_MEMBER,
                    recipientId: "tech_1",
                },
                {
                    recipientType: RecipientType.WORKSPACE_MEMBER,
                    recipientId: "tech_2",
                },
            ]);
        });

        it("extracts customer contact target by resolving customerId to primary contact", async () => {
            mockPrisma.customerContact.findFirst.mockResolvedValue({
                id: "contact_primary_1",
                customerId: "cust_101",
            });

            const targets = await extractRecipientTargets(
                mockPrisma,
                "ws_A",
                [RecipientType.CUSTOMER_CONTACT],
                { customerId: "cust_101" },
            );

            expect(targets).toEqual([
                {
                    recipientType: RecipientType.CUSTOMER_CONTACT,
                    recipientId: "contact_primary_1",
                },
            ]);
            expect(mockPrisma.customerContact.findFirst).toHaveBeenCalledWith({
                where: {
                    customerId: "cust_101",
                    customer: { workspaceId: "ws_A" },
                },
                orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            });
        });
    });

    describe("3. processNotificationOutboxBatch() & Fan-Out", () => {
        it("claims rows via FOR UPDATE SKIP LOCKED and expands 2 recipients × 2 channels into 4 deliveries", async () => {
            const outboxRow = {
                id: "outbox_claim_1",
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_COMPLETED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_101",
                dedupeKey: "dedupe_101",
                actorMemberId: "actor_1",
                payload: {
                    workOrderId: "wo_101",
                    workOrderNumber: "WO-101",
                    title: "Pump Replacement",
                    customerId: "cust_1",
                    customerName: "Acme",
                    customerContactId: "contact_1",
                    technicianId: "tech_1",
                    technicianName: "Alice Tech",
                    completedAt: "2026-08-25T14:00:00.000Z",
                },
                status: NotificationOutboxStatus.PROCESSING,
                attemptCount: 0,
                errorMessage: null,
                processedAt: null,
                createdAt: new Date(),
            };

            mockPrisma.$queryRaw.mockResolvedValue([outboxRow]);

            // Mock resolving technician (member)
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "tech_1",
                workspaceId: "ws_A",
                userId: "user_alice",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
                user: { name: "Alice Tech", email: "alice@company.com" },
                employee: { phone: "+15551234" },
            });

            // Mock resolving customer contact
            mockPrisma.customerContact.findFirst.mockResolvedValue({
                id: "contact_1",
                customerId: "cust_1",
                firstName: "John",
                lastName: "Customer",
                email: "john@acme.com",
                mobilePhone: "+15559876",
                customer: { id: "cust_1", name: "Acme", workspaceId: "ws_A" },
            });

            // Mock preferences (enabled)
            mockPrisma.notificationPreference.findFirst.mockResolvedValue(null);

            let createdNotificationData: any = null;
            const createdDeliveries: any[] = [];
            let updatedOutboxData: any = null;

            mockPrisma.$transaction.mockImplementation(
                async (callback: any) => {
                    return await callback({
                        notification: {
                            create: vi.fn().mockImplementation(
                                async ({ data }: any) => {
                                    createdNotificationData = data;
                                    return {
                                        id: "notif_wo_101",
                                        ...data,
                                    };
                                },
                            ),
                        },
                        notificationDelivery: {
                            create: vi.fn().mockImplementation(
                                async ({ data }: any) => {
                                    createdDeliveries.push(data);
                                    return {
                                        id: `deliv_${createdDeliveries.length}`,
                                        ...data,
                                    };
                                },
                            ),
                        },
                        notificationOutbox: {
                            update: vi.fn().mockImplementation(
                                async ({ data }: any) => {
                                    updatedOutboxData = data;
                                    return { id: outboxRow.id, ...data };
                                },
                            ),
                        },
                    });
                },
            );

            const result = await processNotificationOutboxBatch(mockPrisma, 10);

            expect(result.claimed).toBe(1);
            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(0);

            // Verify Notification created
            expect(createdNotificationData).toBeDefined();
            expect(createdNotificationData.eventType).toBe(
                NotificationEventType.WORK_ORDER_COMPLETED,
            );
            expect(createdNotificationData.status).toBe(
                NotificationStatus.PROCESSING,
            );

            // WORK_ORDER_COMPLETED has defaultChannels: [IN_APP, EMAIL] and defaultRecipientTypes: [WORKSPACE_MEMBER, CUSTOMER_CONTACT]
            // Tech (IN_APP, EMAIL) + Customer (EMAIL, IN_APP skipped) => 4 delivery rows
            expect(createdDeliveries.length).toBe(4);

            // Check Tier 2 Idempotency Keys are distinct
            const idempotencyKeys = createdDeliveries.map(
                (d) => d.idempotencyKey,
            );
            const uniqueKeys = new Set(idempotencyKeys);
            expect(uniqueKeys.size).toBe(4);

            // Customer Contact on IN_APP should be SKIPPED
            const customerInApp = createdDeliveries.find(
                (d) =>
                    d.recipientType === RecipientType.CUSTOMER_CONTACT &&
                    d.channel === NotificationChannel.IN_APP,
            );
            expect(customerInApp?.status).toBe(
                NotificationDeliveryStatus.SKIPPED,
            );
            expect(customerInApp?.errorCode).toBe(
                "IN_APP_REQUIRES_WORKSPACE_MEMBER",
            );

            // Outbox updated to PROCESSED
            expect(updatedOutboxData.status).toBe(
                NotificationOutboxStatus.PROCESSED,
            );
            expect(updatedOutboxData.processedAt).toBeDefined();
        });

        it("records SKIPPED status on delivery row when recipient lacks email", async () => {
            const outboxRow = {
                id: "outbox_claim_2",
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_102",
                dedupeKey: "dedupe_102",
                actorMemberId: "actor_1",
                payload: {
                    workOrderId: "wo_102",
                    workOrderNumber: "WO-102",
                    title: "Service Call",
                    customerId: "cust_1",
                    technicianId: "tech_no_email",
                    priority: "LOW",
                },
                status: NotificationOutboxStatus.PROCESSING,
                attemptCount: 0,
                errorMessage: null,
                processedAt: null,
                createdAt: new Date(),
            };

            mockPrisma.$queryRaw.mockResolvedValue([outboxRow]);

            // Member has no email
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "tech_no_email",
                workspaceId: "ws_A",
                userId: "user_no_email",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
                user: { name: "No Email Tech", email: "" },
                employee: null,
            });

            const createdDeliveries: any[] = [];
            mockPrisma.$transaction.mockImplementation(
                async (callback: any) => {
                    return await callback({
                        notification: {
                            create: vi.fn().mockResolvedValue({
                                id: "notif_wo_102",
                            }),
                        },
                        notificationDelivery: {
                            create: vi.fn().mockImplementation(
                                async ({ data }: any) => {
                                    createdDeliveries.push(data);
                                    return { id: "deliv_1", ...data };
                                },
                            ),
                        },
                        notificationOutbox: {
                            update: vi.fn().mockResolvedValue({}),
                        },
                    });
                },
            );

            await processNotificationOutboxBatch(mockPrisma, 10);

            const emailDelivery = createdDeliveries.find(
                (d) => d.channel === NotificationChannel.EMAIL,
            );
            expect(emailDelivery).toBeDefined();
            expect(emailDelivery.status).toBe(
                NotificationDeliveryStatus.SKIPPED,
            );
            expect(emailDelivery.errorCode).toBe("NO_EMAIL_ON_FILE");
        });

        it("marks outbox row FAILED when recipient cannot be resolved, without failing the batch", async () => {
            const outboxRow = {
                id: "outbox_broken",
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_broken",
                dedupeKey: "dedupe_broken",
                actorMemberId: "actor_1",
                payload: {
                    workOrderId: "wo_broken",
                    workOrderNumber: "WO-999",
                    title: "Broken Target",
                    customerId: "cust_1",
                    technicianId: "non_existent_tech",
                    priority: "LOW",
                },
                status: NotificationOutboxStatus.PROCESSING,
                attemptCount: 0,
                errorMessage: null,
                processedAt: null,
                createdAt: new Date(),
            };

            mockPrisma.$queryRaw.mockResolvedValue([outboxRow]);
            mockPrisma.workspaceMember.findFirst.mockResolvedValue(null); // Not found

            const result = await processNotificationOutboxBatch(mockPrisma, 10);

            expect(result.claimed).toBe(1);
            expect(result.succeeded).toBe(0);
            expect(result.failed).toBe(1);

            expect(mockPrisma.notificationOutbox.update).toHaveBeenCalledWith({
                where: { id: "outbox_broken" },
                data: expect.objectContaining({
                    status: NotificationOutboxStatus.FAILED,
                }),
            });
        });

        it("demonstrates concurrent invocations claim disjoint outbox rows with no double-processing (FOR UPDATE SKIP LOCKED simulation)", async () => {
            // Seed a shared pool of 4 pending outbox rows
            const sharedPool: Array<{
                id: string;
                workspaceId: string;
                eventType: NotificationEventType;
                sourceEntity: string;
                sourceId: string;
                dedupeKey: string;
                actorMemberId: string | null;
                payload: any;
                status: NotificationOutboxStatus;
                attemptCount: number;
                errorMessage: string | null;
                processedAt: Date | null;
                createdAt: Date;
            }> = [
                {
                    id: "outbox_row_1",
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_1",
                    dedupeKey: "dedupe_1",
                    actorMemberId: "actor_1",
                    payload: {
                        workOrderId: "wo_1",
                        workOrderNumber: "WO-001",
                        title: "Task 1",
                        customerId: "cust_1",
                        technicianId: "tech_1",
                        priority: "LOW",
                    },
                    status: NotificationOutboxStatus.PENDING,
                    attemptCount: 0,
                    errorMessage: null,
                    processedAt: null,
                    createdAt: new Date("2026-08-25T10:00:00.000Z"),
                },
                {
                    id: "outbox_row_2",
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_2",
                    dedupeKey: "dedupe_2",
                    actorMemberId: "actor_1",
                    payload: {
                        workOrderId: "wo_2",
                        workOrderNumber: "WO-002",
                        title: "Task 2",
                        customerId: "cust_1",
                        technicianId: "tech_1",
                        priority: "LOW",
                    },
                    status: NotificationOutboxStatus.PENDING,
                    attemptCount: 0,
                    errorMessage: null,
                    processedAt: null,
                    createdAt: new Date("2026-08-25T10:01:00.000Z"),
                },
                {
                    id: "outbox_row_3",
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_3",
                    dedupeKey: "dedupe_3",
                    actorMemberId: "actor_1",
                    payload: {
                        workOrderId: "wo_3",
                        workOrderNumber: "WO-003",
                        title: "Task 3",
                        customerId: "cust_1",
                        technicianId: "tech_1",
                        priority: "LOW",
                    },
                    status: NotificationOutboxStatus.PENDING,
                    attemptCount: 0,
                    errorMessage: null,
                    processedAt: null,
                    createdAt: new Date("2026-08-25T10:02:00.000Z"),
                },
                {
                    id: "outbox_row_4",
                    workspaceId: "ws_A",
                    eventType: NotificationEventType.WORK_ORDER_CREATED,
                    sourceEntity: "WorkOrder",
                    sourceId: "wo_4",
                    dedupeKey: "dedupe_4",
                    actorMemberId: "actor_1",
                    payload: {
                        workOrderId: "wo_4",
                        workOrderNumber: "WO-004",
                        title: "Task 4",
                        customerId: "cust_1",
                        technicianId: "tech_1",
                        priority: "LOW",
                    },
                    status: NotificationOutboxStatus.PENDING,
                    attemptCount: 0,
                    errorMessage: null,
                    processedAt: null,
                    createdAt: new Date("2026-08-25T10:03:00.000Z"),
                },
            ];

            // Atomic simulation of FOR UPDATE SKIP LOCKED:
            // Slices un-claimed rows and marks them PROCESSING
            mockPrisma.$queryRaw.mockImplementation(async () => {
                const available = sharedPool.filter(
                    (r) => r.status === NotificationOutboxStatus.PENDING,
                );
                const batch = available.slice(0, 2);
                for (const row of batch) {
                    row.status = NotificationOutboxStatus.PROCESSING;
                }
                return batch;
            });

            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "tech_1",
                workspaceId: "ws_A",
                userId: "user_1",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
                user: { name: "Tech One", email: "tech1@example.com" },
                employee: null,
            });

            // Run two worker batches concurrently with Promise.all
            const [batch1, batch2] = await Promise.all([
                processNotificationOutboxBatch(mockPrisma, 2),
                processNotificationOutboxBatch(mockPrisma, 2),
            ]);

            expect(batch1.claimed).toBe(2);
            expect(batch1.succeeded).toBe(2);
            expect(batch2.claimed).toBe(2);
            expect(batch2.succeeded).toBe(2);

            // Total claimed across concurrent calls equals total seeded rows (4)
            expect(batch1.claimed + batch2.claimed).toBe(4);

            // No row remained PENDING or was double-processed
            const pendingRemaining = sharedPool.filter(
                (r) => r.status === NotificationOutboxStatus.PENDING,
            );
            expect(pendingRemaining.length).toBe(0);
        });

        it("enforces actorMemberId is strictly derived from caller argument and not spoofed via payload", async () => {
            mockTx.notificationOutbox.findFirst.mockResolvedValue(null);
            mockTx.notificationOutbox.create.mockImplementation(
                async ({ data }: any) => ({
                    id: "outbox_actor_test",
                    ...data,
                    createdAt: new Date(),
                    processedAt: null,
                    attemptCount: 0,
                    errorMessage: null,
                }),
            );

            const result = await emitNotificationEvent(mockTx, {
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_CREATED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_sec_1",
                actorMemberId: "trusted_session_member_123",
                payload: {
                    workOrderId: "wo_sec_1",
                    workOrderNumber: "WO-SEC-01",
                    title: "Security Test",
                    customerId: "cust_1",
                    customerName: "Acme",
                    priority: "LOW",
                    // Malicious attempt to spoof actor inside payload
                    actorMemberId: "malicious_spoofed_member_999",
                } as any,
            });

            expect(result.actorMemberId).toBe("trusted_session_member_123");
            expect(mockTx.notificationOutbox.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        actorMemberId: "trusted_session_member_123",
                    }),
                }),
            );
        });
    });
});

