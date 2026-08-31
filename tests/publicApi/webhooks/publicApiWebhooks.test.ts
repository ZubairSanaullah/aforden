import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
    createDeveloperApplication,
} from "@/lib/services/developerApp/developerAppService";
import {
    createWebhookEndpoint,
    getWebhookEndpoint,
    listWebhookEndpoints,
    updateWebhookEndpoint,
    deleteWebhookEndpoint,
    rotateWebhookSecret,
    createWebhookDeliveryRecord,
    WebhookEndpointNotFoundError,
} from "@/lib/services/developerApp/webhookEndpointService";
import {
    PUBLIC_WEBHOOK_EVENTS,
    isValidWebhookEventType,
    assertValidWebhookEventTypes,
    validateWebhookUrl,
    InvalidWebhookUrlError,
    PublicWebhookPayloadEnvelope,
} from "@/lib/publicApi";

describe("Phase 1.18.17 — Webhook Delivery Foundation", () => {
    let prisma: PrismaClient;

    let ws1Id: string;
    let ws2Id: string;
    let user1Id: string;
    let user2Id: string;
    let app1Id: string;
    let app2Id: string;

    const runId = Math.random().toString(36).substring(2, 9);

    beforeAll(async () => {
        const connectionString =
            process.env.TEST_DATABASE_URL ||
            process.env.DATABASE_URL ||
            "postgresql://postgres:postgres@localhost:5432/aforden";

        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });

        // Workspace 1
        const ws1 = await prisma.workspace.create({
            data: {
                name: `Webhook WS 1 ${runId}`,
                slug: `webhook-ws1-${runId}`,
            },
        });
        ws1Id = ws1.id;

        const user1 = await prisma.user.create({
            data: {
                name: `Webhook User 1 ${runId}`,
                email: `webhook-user-1-${runId}@example.com`,
                status: "ACTIVE",
                emailVerified: new Date(),
            },
        });
        user1Id = user1.id;

        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws1Id,
                userId: user1Id,
                role: "OWNER",
                status: "ACTIVE",
            },
        });

        const app1 = await createDeveloperApplication(ws1Id, {
            name: "App 1 Webhooks",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        // Workspace 2 (Tenant isolation tests)
        const ws2 = await prisma.workspace.create({
            data: {
                name: `Webhook WS 2 ${runId}`,
                slug: `webhook-ws2-${runId}`,
            },
        });
        ws2Id = ws2.id;

        const user2 = await prisma.user.create({
            data: {
                name: `Webhook User 2 ${runId}`,
                email: `webhook-user-2-${runId}@example.com`,
                status: "ACTIVE",
                emailVerified: new Date(),
            },
        });
        user2Id = user2.id;

        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: user2Id,
                role: "OWNER",
                status: "ACTIVE",
            },
        });

        const app2 = await createDeveloperApplication(ws2Id, {
            name: "App 2 Webhooks",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;
    });

    afterAll(async () => {
        if (ws1Id) {
            await prisma.workspace.deleteMany({
                where: { id: { in: [ws1Id, ws2Id] } },
            });
        }
        if (user1Id) {
            await prisma.user.deleteMany({
                where: { id: { in: [user1Id, user2Id] } },
            });
        }
        await prisma.$disconnect();
    });

    describe("1. SSRF URL Validation & Protocol Requirements", () => {
        it("accepts valid public HTTPS endpoints", () => {
            const validUrls = [
                "https://api.example.com/webhooks/aforden",
                "https://webhook.site/1234-5678-90ab",
                "https://hooks.slack.com/services/T00/B00/X00",
                "https://sub.domain.co.uk:8443/events",
                "https://93.184.216.34/webhook", // Public IPv4
            ];

            for (const url of validUrls) {
                expect(() => validateWebhookUrl(url)).not.toThrow();
            }
        });

        it("rejects non-HTTPS protocols (HTTP, FTP, file, javascript, etc.)", () => {
            expect(() => validateWebhookUrl("http://api.example.com/webhook")).toThrowError(
                InvalidWebhookUrlError,
            );
            expect(() => validateWebhookUrl("ftp://api.example.com/webhook")).toThrowError(
                InvalidWebhookUrlError,
            );
            expect(() => validateWebhookUrl("javascript:alert(1)")).toThrowError(
                InvalidWebhookUrlError,
            );
            expect(() => validateWebhookUrl("data:text/html,test")).toThrowError(
                InvalidWebhookUrlError,
            );
        });

        it("rejects localhost and loopback IPv4/IPv6 addresses", () => {
            const loopbackTargets = [
                "https://localhost/webhook",
                "https://app.localhost:8080/events",
                "https://127.0.0.1/webhook",
                "https://127.0.0.2:3000/events",
                "https://127.1.2.3/webhook",
                "https://0.0.0.0/webhook",
                "https://[::1]/webhook",
                "https://[::1]:8443/webhook",
            ];

            for (const target of loopbackTargets) {
                expect(() => validateWebhookUrl(target)).toThrowError(
                    InvalidWebhookUrlError,
                );
            }
        });

        it("rejects cloud instance metadata endpoints (AWS, GCP, Azure, DigitalOcean)", () => {
            const metadataTargets = [
                "https://169.254.169.254/latest/meta-data/",
                "https://169.254.169.254:80/computeMetadata/v1/",
                "https://metadata.google.internal/computeMetadata/v1/",
                "https://169.254.1.1/events", // IPv4 Link-Local
            ];

            for (const target of metadataTargets) {
                expect(() => validateWebhookUrl(target)).toThrowError(
                    InvalidWebhookUrlError,
                );
            }
        });

        it("rejects private RFC 1918 and RFC 4193 subnets", () => {
            const privateTargets = [
                "https://10.0.0.1/webhook", // 10.0.0.0/8
                "https://10.254.1.99:8443/webhook",
                "https://172.16.0.1/webhook", // 172.16.0.0/12
                "https://172.24.10.5/events",
                "https://172.31.255.254/webhook",
                "https://192.168.1.1/webhook", // 192.168.0.0/16
                "https://192.168.100.50/events",
                "https://[fc00::1]/webhook", // Unique Local Address (ULA)
                "https://[fd12:3456:789a::1]/webhook",
                "https://[fe80::1]/webhook", // Link-Local IPv6
            ];

            for (const target of privateTargets) {
                expect(() => validateWebhookUrl(target)).toThrowError(
                    InvalidWebhookUrlError,
                );
            }
        });

        it("rejects reserved/internal hostnames and single-label names", () => {
            const internalHosts = [
                "https://internal-db/webhook",
                "https://backend/events",
                "https://redis/webhook",
                "https://service.local/webhook",
                "https://api.internal/webhook",
                "https://corp.lan/webhook",
                "https://staging.test/webhook",
                "https://demo.example/webhook",
            ];

            for (const target of internalHosts) {
                expect(() => validateWebhookUrl(target)).toThrowError(
                    InvalidWebhookUrlError,
                );
            }
        });

        it("rejects URLs with embedded basic authentication credentials", () => {
            expect(() => validateWebhookUrl("https://admin:secret@api.example.com/webhook")).toThrowError(
                InvalidWebhookUrlError,
            );
        });
    });

    describe("2. Canonical Event Type Registry", () => {
        it("contains all 9 canonical events specified in the roadmap", () => {
            const expectedEvents = [
                "work_order.created",
                "work_order.updated",
                "work_order.status_changed",
                "work_order.assigned",
                "work_order.completed",
                "customer.created",
                "customer.updated",
                "invoice.created",
                "invoice.paid",
            ];

            for (const event of expectedEvents) {
                expect(isValidWebhookEventType(event)).toBe(true);
            }
        });

        it("rejects unknown or invalid event types", () => {
            expect(isValidWebhookEventType("work_order.deleted")).toBe(false);
            expect(isValidWebhookEventType("user.created")).toBe(false);
            expect(isValidWebhookEventType("WORK_ORDER_CREATED")).toBe(false); // must use dot notation
            expect(isValidWebhookEventType("")).toBe(false);

            expect(() => assertValidWebhookEventTypes(["work_order.created", "invalid.type"])).toThrowError(
                /Invalid webhook event type/i,
            );
            expect(() => assertValidWebhookEventTypes([])).toThrowError(
                /must subscribe to at least one event type/i,
            );
        });
    });

    describe("3. Webhook Endpoint Lifecycle & Signing Secret Security", () => {
        let createdEndpointId: string;
        let createdRawSecret: string;

        it("successfully creates a WebhookEndpoint with valid HTTPS URL and canonical events", async () => {
            const res = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://api.partner.com/webhooks/aforden",
                description: "Primary Production Webhook",
                events: [
                    PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_COMPLETED,
                    PUBLIC_WEBHOOK_EVENTS.INVOICE_PAID,
                ],
            });

            expect(res.id).toBeDefined();
            expect(res.workspaceId).toBe(ws1Id);
            expect(res.developerApplicationId).toBe(app1Id);
            expect(res.url).toBe("https://api.partner.com/webhooks/aforden");
            expect(res.description).toBe("Primary Production Webhook");
            expect(res.status).toBe("ACTIVE");
            expect(res.events).toEqual([
                "work_order.created",
                "work_order.completed",
                "invoice.paid",
            ]);
            expect(res.rawSecret).toMatch(/^whsec_[a-f0-9]{48}$/);

            createdEndpointId = res.id;
            createdRawSecret = res.rawSecret;
        });

        it("getWebhookEndpoint returns masked secret and never returns raw secret", async () => {
            const endpoint = await getWebhookEndpoint(ws1Id, createdEndpointId);

            expect(endpoint.id).toBe(createdEndpointId);
            expect(endpoint.secretMasked).toBeDefined();
            expect(endpoint.secretMasked).not.toBe(createdRawSecret);
            expect(endpoint.secretMasked).toContain("...");
            expect((endpoint as any).secret).toBeUndefined();
            expect((endpoint as any).rawSecret).toBeUndefined();
        });

        it("listWebhookEndpoints returns list with masked secrets", async () => {
            const list = await listWebhookEndpoints(ws1Id, app1Id);
            expect(list.length).toBeGreaterThanOrEqual(1);

            const item = list.find((e) => e.id === createdEndpointId);
            expect(item).toBeDefined();
            expect(item?.secretMasked).toBeDefined();
            expect((item as any)?.secret).toBeUndefined();
        });

        it("updateWebhookEndpoint allows updating URL, events, description, and status", async () => {
            const updated = await updateWebhookEndpoint(ws1Id, createdEndpointId, {
                description: "Updated Description",
                status: "DISABLED",
                events: [PUBLIC_WEBHOOK_EVENTS.CUSTOMER_CREATED],
            });

            expect(updated.description).toBe("Updated Description");
            expect(updated.status).toBe("DISABLED");
            expect(updated.events).toEqual(["customer.created"]);

            // Re-enable
            const reEnabled = await updateWebhookEndpoint(ws1Id, createdEndpointId, {
                status: "ACTIVE",
            });
            expect(reEnabled.status).toBe("ACTIVE");
        });

        it("rotateWebhookSecret generates a new raw secret and updates the endpoint", async () => {
            const rotateRes = await rotateWebhookSecret(ws1Id, createdEndpointId);
            expect(rotateRes.id).toBe(createdEndpointId);
            expect(rotateRes.rawSecret).toMatch(/^whsec_[a-f0-9]{48}$/);
            expect(rotateRes.rawSecret).not.toBe(createdRawSecret);

            // Confirm database secret was updated
            const dbRecord = await prisma.webhookEndpoint.findUnique({
                where: { id: createdEndpointId },
            });
            expect(dbRecord?.secret).toBe(rotateRes.rawSecret);
        });

        it("deleteWebhookEndpoint removes the endpoint and cascades", async () => {
            await deleteWebhookEndpoint(ws1Id, createdEndpointId);

            await expect(getWebhookEndpoint(ws1Id, createdEndpointId)).rejects.toThrowError(
                WebhookEndpointNotFoundError,
            );
        });
    });

    describe("4. Multi-Tenant Isolation", () => {
        let ws1EndpointId: string;

        beforeAll(async () => {
            const res = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://ws1.partner.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });
            ws1EndpointId = res.id;
        });

        it("Workspace 2 cannot view or fetch Workspace 1 endpoint", async () => {
            await expect(getWebhookEndpoint(ws2Id, ws1EndpointId)).rejects.toThrowError(
                WebhookEndpointNotFoundError,
            );
        });

        it("Workspace 2 list never includes Workspace 1 endpoints", async () => {
            const list = await listWebhookEndpoints(ws2Id);
            expect(list.some((e) => e.id === ws1EndpointId)).toBe(false);
        });

        it("Workspace 2 cannot update or delete Workspace 1 endpoint", async () => {
            await expect(
                updateWebhookEndpoint(ws2Id, ws1EndpointId, { description: "Hacked" }),
            ).rejects.toThrowError(WebhookEndpointNotFoundError);

            await expect(deleteWebhookEndpoint(ws2Id, ws1EndpointId)).rejects.toThrowError(
                WebhookEndpointNotFoundError,
            );
        });

        it("cannot create endpoint in Workspace 1 using an application from Workspace 2", async () => {
            await expect(
                createWebhookEndpoint(ws1Id, app2Id, {
                    url: "https://partner.com/events",
                    events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
                }),
            ).rejects.toThrowError(/not found in workspace/i);
        });
    });

    describe("5. Webhook Payload Envelope & Delivery Record Foundation", () => {
        it("payload envelope conforms to public specification with explicit workspaceId", () => {
            const payload: PublicWebhookPayloadEnvelope<{ workOrderId: string; title: string }> = {
                id: "evt_01HPX7K9V4Z8Y6M2E3W1N0QRST",
                event: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                createdAt: new Date().toISOString(),
                workspaceId: ws1Id,
                apiVersion: "v1",
                data: {
                    workOrderId: "wo_123",
                    title: "HVAC Repair",
                },
            };

            expect(payload.id).toMatch(/^evt_/);
            expect(payload.event).toBe("work_order.created");
            expect(payload.workspaceId).toBe(ws1Id);
            expect(payload.apiVersion).toBe("v1");
            expect(payload.data.title).toBe("HVAC Repair");
        });

        it("creates foundation delivery record with PENDING status", async () => {
            const endpoint = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://delivery-test.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            const delivery = await createWebhookDeliveryRecord({
                workspaceId: ws1Id,
                webhookEndpointId: endpoint.id,
                eventId: "evt_test_delivery_100",
                eventType: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                payload: {
                    id: "evt_test_delivery_100",
                    event: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    createdAt: new Date().toISOString(),
                    workspaceId: ws1Id,
                    apiVersion: "v1",
                    data: { id: "wo_999", title: "Emergency Leak" },
                },
            });

            expect(delivery.id).toBeDefined();
            expect(delivery.workspaceId).toBe(ws1Id);
            expect(delivery.webhookEndpointId).toBe(endpoint.id);
            expect(delivery.eventId).toBe("evt_test_delivery_100");
            expect(delivery.eventType).toBe("work_order.created");
            expect(delivery.status).toBe("PENDING");
            expect(delivery.attempts).toBe(0);
        });
    });
});
