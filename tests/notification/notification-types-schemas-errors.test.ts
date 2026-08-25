import { describe, it, expect } from "vitest";
import {
    NotificationNotFoundError,
    NotificationDeliveryNotFoundError,
    NotificationTemplateNotFoundError,
    NotificationPreferenceNotFoundError,
    InvalidNotificationEventType,
    InvalidNotificationChannelError,
    DuplicateNotificationEventError,
    NotificationCrossTenantLeakageError,
    NotificationActorUnauthorizedError,
    NotificationPayloadValidationError,
    NotificationTemplateCompilationError,
    NotificationRecipientUnresolvableError,
    NotificationChannelDisabledError,
    NotificationDeliveryExhaustedError,
    NotificationProviderUnavailableError,
    NotificationEventType,
    NotificationChannel,
    NotificationOutboxStatus,
    NotificationStatus,
    NotificationDeliveryStatus,
    RecipientType,
    NotificationPreferenceScope,
    EVENT_CATALOG_REGISTRY,
    getEventCatalogDefinition,
    validateEventPayload,
    getEventVariableWhitelist,
    emitNotificationEnvelopeSchema,
    updateNotificationPreferenceSchema,
    createNotificationTemplateSchema,
    updateNotificationTemplateSchema,
    queryNotificationFeedSchema,
    queryNotificationLogsSchema,
} from "@/lib/services/notification";

describe("Phase 1.13.3 — Notifications & Communications Domain Types, Errors & Schemas", () => {
    describe("1. Pure Domain Error Classes (Convention B)", () => {
        const errorTestCases = [
            {
                ErrorClass: NotificationNotFoundError,
                name: "NotificationNotFoundError",
                code: "NOTIFICATION_NOT_FOUND",
                statusCode: 404,
                httpStatus: 404,
                defaultMsg: "Notification not found.",
            },
            {
                ErrorClass: NotificationDeliveryNotFoundError,
                name: "NotificationDeliveryNotFoundError",
                code: "NOTIFICATION_DELIVERY_NOT_FOUND",
                statusCode: 404,
                httpStatus: 404,
                defaultMsg: "Notification delivery record not found.",
            },
            {
                ErrorClass: NotificationTemplateNotFoundError,
                name: "NotificationTemplateNotFoundError",
                code: "NOTIFICATION_TEMPLATE_NOT_FOUND",
                statusCode: 404,
                httpStatus: 404,
                defaultMsg: "Notification template not found.",
            },
            {
                ErrorClass: NotificationPreferenceNotFoundError,
                name: "NotificationPreferenceNotFoundError",
                code: "NOTIFICATION_PREFERENCE_NOT_FOUND",
                statusCode: 404,
                httpStatus: 404,
                defaultMsg: "Notification preference record not found.",
            },
            {
                ErrorClass: InvalidNotificationEventType,
                name: "InvalidNotificationEventType",
                code: "INVALID_NOTIFICATION_EVENT_TYPE",
                statusCode: 400,
                httpStatus: 400,
                defaultMsg: "Invalid or unsupported notification event type.",
            },
            {
                ErrorClass: InvalidNotificationChannelError,
                name: "InvalidNotificationChannelError",
                code: "INVALID_NOTIFICATION_CHANNEL",
                statusCode: 400,
                httpStatus: 400,
                defaultMsg: "Invalid or unsupported notification channel.",
            },
            {
                ErrorClass: DuplicateNotificationEventError,
                name: "DuplicateNotificationEventError",
                code: "DUPLICATE_NOTIFICATION_EVENT",
                statusCode: 409,
                httpStatus: 409,
                defaultMsg:
                    "Duplicate notification event detected by idempotency key.",
            },
            {
                ErrorClass: NotificationCrossTenantLeakageError,
                name: "NotificationCrossTenantLeakageError",
                code: "NOTIFICATION_CROSS_TENANT_LEAKAGE",
                statusCode: 403,
                httpStatus: 403,
                defaultMsg:
                    "Recipient or entity does not belong to the event workspace.",
            },
            {
                ErrorClass: NotificationActorUnauthorizedError,
                name: "NotificationActorUnauthorizedError",
                code: "NOTIFICATION_ACTOR_UNAUTHORIZED",
                statusCode: 403,
                httpStatus: 403,
                defaultMsg:
                    "Actor does not have permission to view or manage this notification resource.",
            },
            {
                ErrorClass: NotificationPayloadValidationError,
                name: "NotificationPayloadValidationError",
                code: "NOTIFICATION_PAYLOAD_VALIDATION_ERROR",
                statusCode: 422,
                httpStatus: 422,
                defaultMsg:
                    "Event payload failed schema validation for this event type.",
            },
            {
                ErrorClass: NotificationTemplateCompilationError,
                name: "NotificationTemplateCompilationError",
                code: "NOTIFICATION_TEMPLATE_COMPILATION_ERROR",
                statusCode: 422,
                httpStatus: 422,
                defaultMsg:
                    "Template compilation failed due to invalid token syntax or missing variable.",
            },
            {
                ErrorClass: NotificationRecipientUnresolvableError,
                name: "NotificationRecipientUnresolvableError",
                code: "NOTIFICATION_RECIPIENT_UNRESOLVABLE",
                statusCode: 422,
                httpStatus: 422,
                defaultMsg:
                    "Recipient cannot be resolved to a valid communication destination.",
            },
            {
                ErrorClass: NotificationChannelDisabledError,
                name: "NotificationChannelDisabledError",
                code: "NOTIFICATION_CHANNEL_DISABLED",
                statusCode: 422,
                httpStatus: 422,
                defaultMsg:
                    "The requested communication channel is disabled for this workspace.",
            },
            {
                ErrorClass: NotificationDeliveryExhaustedError,
                name: "NotificationDeliveryExhaustedError",
                code: "NOTIFICATION_DELIVERY_EXHAUSTED",
                statusCode: 500,
                httpStatus: 500,
                defaultMsg:
                    "Notification delivery exceeded maximum retry attempts.",
            },
            {
                ErrorClass: NotificationProviderUnavailableError,
                name: "NotificationProviderUnavailableError",
                code: "NOTIFICATION_PROVIDER_UNAVAILABLE",
                statusCode: 503,
                httpStatus: 503,
                defaultMsg:
                    "Third-party notification transport provider is currently unreachable.",
            },
        ];

        it("instantiates all 15 error classes with correct codes, statuses, and default messages", () => {
            for (const tc of errorTestCases) {
                const err = new tc.ErrorClass();
                expect(err).toBeInstanceOf(Error);
                expect(err.name).toBe(tc.name);
                expect(err.code).toBe(tc.code);
                expect(err.statusCode).toBe(tc.statusCode);
                expect(err.httpStatus).toBe(tc.httpStatus);
                expect(err.message).toBe(tc.defaultMsg);
            }
        });

        it("allows custom message overrides on all error classes", () => {
            for (const tc of errorTestCases) {
                const customMsg = `Custom error message for ${tc.name}`;
                const err = new tc.ErrorClass(customMsg);
                expect(err.message).toBe(customMsg);
                expect(err.code).toBe(tc.code);
            }
        });
    });

    describe("2. Event Catalog Registry & Coverage", () => {
        const allEventTypes = Object.values(NotificationEventType);

        it("contains all 24 NotificationEventType values in the registry", () => {
            expect(allEventTypes.length).toBe(24);
            for (const eventType of allEventTypes) {
                const def = EVENT_CATALOG_REGISTRY[eventType];
                expect(def).toBeDefined();
                expect(def.eventType).toBe(eventType);
                expect(def.domain).toBeDefined();
                expect(Array.isArray(def.defaultChannels)).toBe(true);
                expect(def.defaultChannels.length).toBeGreaterThan(0);
                expect(Array.isArray(def.defaultRecipientTypes)).toBe(true);
                expect(def.defaultRecipientTypes.length).toBeGreaterThan(0);
                expect(typeof def.isMandatoryTransactional).toBe("boolean");
                expect(def.payloadValidator).toBeDefined();
                expect(Array.isArray(def.variableWhitelist)).toBe(true);
                expect(def.variableWhitelist.length).toBeGreaterThan(0);
                expect(typeof def.description).toBe("string");
            }
        });

        it("correctly identifies mandatory transactional events", () => {
            const mandatoryEvents: NotificationEventType[] = [
                NotificationEventType.INVOICE_SENT,
                NotificationEventType.INVOICE_OVERDUE,
                NotificationEventType.PAYMENT_RECEIVED,
                NotificationEventType.PAYMENT_FAILED,
            ];

            for (const eventType of allEventTypes) {
                const def = EVENT_CATALOG_REGISTRY[eventType];
                if (mandatoryEvents.includes(eventType)) {
                    expect(def.isMandatoryTransactional).toBe(true);
                } else {
                    expect(def.isMandatoryTransactional).toBe(false);
                }
            }
        });

        it("getEventCatalogDefinition retrieves valid definitions and throws on invalid event", () => {
            const def = getEventCatalogDefinition(
                NotificationEventType.WORK_ORDER_ASSIGNED,
            );
            expect(def.domain).toBe("WORK_ORDER");
            expect(def.variableWhitelist).toContain("workOrderId");
            expect(def.variableWhitelist).toContain("technicianId");

            expect(() =>
                getEventCatalogDefinition("NON_EXISTENT_EVENT" as NotificationEventType),
            ).toThrow(InvalidNotificationEventType);
        });

        it("getEventVariableWhitelist returns the exact variable whitelist", () => {
            const whitelist = getEventVariableWhitelist(
                NotificationEventType.INVOICE_SENT,
            );
            expect(whitelist).toEqual([
                "invoiceId",
                "invoiceNumber",
                "title",
                "customerId",
                "customerName",
                "customerEmail",
                "totalAmount",
                "dueDate",
                "currencyCode",
            ]);
        });

        it("validates valid event payloads and rejects malformed payloads", () => {
            const validWorkOrderAssigned = {
                workOrderId: "wo_123",
                workOrderNumber: "WO-001",
                title: "HVAC Repair",
                customerId: "cust_456",
                customerName: "Acme Corp",
                technicianId: "tech_789",
                technicianName: "John Doe",
                priority: "HIGH",
            };

            const validated = validateEventPayload(
                NotificationEventType.WORK_ORDER_ASSIGNED,
                validWorkOrderAssigned,
            );
            expect(validated).toEqual(validWorkOrderAssigned);

            const invalidPayload = {
                workOrderId: "wo_123",
                // missing required fields
            };

            expect(() =>
                validateEventPayload(
                    NotificationEventType.WORK_ORDER_ASSIGNED,
                    invalidPayload,
                ),
            ).toThrow(NotificationPayloadValidationError);
        });
    });

    describe("3. Envelope & Management Schemas", () => {
        it("validates emitNotificationEnvelopeSchema correctly", () => {
            const validEnvelope = {
                workspaceId: "ws_123",
                eventType: NotificationEventType.WORK_ORDER_COMPLETED,
                sourceEntity: "WorkOrder",
                sourceId: "wo_999",
                actorMemberId: "mem_111",
                payload: {
                    workOrderId: "wo_999",
                    workOrderNumber: "WO-999",
                    title: "Pump Replacement",
                    customerId: "cust_333",
                    completedAt: "2026-08-25T12:00:00.000Z",
                },
                dedupeKey: "sha256_custom_hash_key",
            };

            const parsed = emitNotificationEnvelopeSchema.parse(validEnvelope);
            expect(parsed.workspaceId).toBe("ws_123");
            expect(parsed.eventType).toBe(
                NotificationEventType.WORK_ORDER_COMPLETED,
            );

            expect(() =>
                emitNotificationEnvelopeSchema.parse({
                    ...validEnvelope,
                    eventType: "INVALID_EVENT",
                }),
            ).toThrow();
        });

        it("validates updateNotificationPreferenceSchema", () => {
            const validPref = {
                scope: NotificationPreferenceScope.MEMBER,
                scopeId: "mem_123",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                channel: NotificationChannel.EMAIL,
                isEnabled: false,
            };

            const parsed = updateNotificationPreferenceSchema.parse(validPref);
            expect(parsed.isEnabled).toBe(false);

            expect(() =>
                updateNotificationPreferenceSchema.parse({
                    ...validPref,
                    channel: "INVALID_CHANNEL",
                }),
            ).toThrow();
        });

        it("validates createNotificationTemplateSchema and updateNotificationTemplateSchema", () => {
            const validTemplate = {
                eventType: NotificationEventType.INVOICE_SENT,
                channel: NotificationChannel.EMAIL,
                locale: "en",
                subject: "Invoice {{invoiceNumber}} from Aforden",
                bodyHtml: "<p>Please find attached invoice {{invoiceNumber}}</p>",
                bodyText: "Please find attached invoice {{invoiceNumber}}",
                isActive: true,
            };

            const parsed =
                createNotificationTemplateSchema.parse(validTemplate);
            expect(parsed.locale).toBe("en");

            const validUpdate = {
                subject: "Updated Subject",
                bodyText: "Updated body text",
            };
            const parsedUpdate =
                updateNotificationTemplateSchema.parse(validUpdate);
            expect(parsedUpdate.subject).toBe("Updated Subject");
        });

        it("validates queryNotificationFeedSchema and queryNotificationLogsSchema with defaults", () => {
            const feedQuery = queryNotificationFeedSchema.parse({});
            expect(feedQuery.page).toBe(1);
            expect(feedQuery.limit).toBe(20);

            const logsQuery = queryNotificationLogsSchema.parse({
                channel: NotificationChannel.EMAIL,
                status: NotificationDeliveryStatus.DELIVERED,
            });
            expect(logsQuery.channel).toBe(NotificationChannel.EMAIL);
            expect(logsQuery.status).toBe(NotificationDeliveryStatus.DELIVERED);
            expect(logsQuery.page).toBe(1);
            expect(logsQuery.limit).toBe(50);
        });
    });
});
