import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { createDeveloperApplication } from "@/lib/services/developerApp/developerAppService";
import {
    createWebhookEndpoint,
    createWebhookDeliveryRecord,
} from "@/lib/services/developerApp/webhookEndpointService";
import {
    PUBLIC_WEBHOOK_EVENTS,
    signWebhookPayload,
    verifyWebhookSignature,
    resolveAndValidateWebhookIp,
    DeliverySsrfBlockedError,
    deliverWebhookAttempt,
    dispatchWebhookEvent,
    enqueueWebhookDelivery,
    calculateNextRetryAt,
    isTerminalClientError,
    RETRY_BACKOFF_DELAYS_MS,
    MAX_DELIVERY_ATTEMPTS,
} from "@/lib/publicApi";
import { createCustomer } from "@/lib/services/customer/createCustomer";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";


describe("Phase 1.18.18 — Webhook Security & Reliability", () => {
    let ws1Id: string;
    let ws2Id: string;
    let user1Id: string;
    let user2Id: string;
    let mem1Id: string;
    let app1Id: string;
    let app2Id: string;

    const runId = Math.random().toString(36).substring(2, 9);

    beforeAll(async () => {
        // Workspace 1
        const ws1 = await prisma.workspace.create({
            data: {
                name: `Webhook Sec WS 1 ${runId}`,
                slug: `webhook-sec-ws1-${runId}`,
            },
        });
        ws1Id = ws1.id;

        const user1 = await prisma.user.create({
            data: {
                name: `Webhook Sec User 1 ${runId}`,
                email: `webhook-sec-user-1-${runId}@example.com`,
                status: "ACTIVE",
                emailVerified: new Date(),
            },
        });
        user1Id = user1.id;

        const mem1 = await prisma.workspaceMember.create({
            data: {
                workspaceId: ws1Id,
                userId: user1Id,
                role: "OWNER",
                status: "ACTIVE",
            },
        });
        mem1Id = mem1.id;

        const app1 = await createDeveloperApplication(ws1Id, {
            name: "App 1 Webhook Security",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        // Workspace 2 (Tenant Isolation tests)
        const ws2 = await prisma.workspace.create({
            data: {
                name: `Webhook Sec WS 2 ${runId}`,
                slug: `webhook-sec-ws2-${runId}`,
            },
        });
        ws2Id = ws2.id;

        const user2 = await prisma.user.create({
            data: {
                name: `Webhook Sec User 2 ${runId}`,
                email: `webhook-sec-user-2-${runId}@example.com`,
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
            name: "App 2 Webhook Security",
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
    });

    describe("1. Pre-Connect DNS Resolution & DNS Rebinding SSRF Mitigation", () => {
        it("allows connection when DNS resolves to valid public IP", async () => {
            const publicResolver = async (_host: string) => ["93.184.216.34"];
            const resolved = await resolveAndValidateWebhookIp("api.example.com", publicResolver);
            expect(resolved).toEqual(["93.184.216.34"]);
        });

        it("blocks delivery when DNS rebinding resolves hostname to cloud metadata (169.254.169.254)", async () => {
            const rebindingResolver = async (_host: string) => ["169.254.169.254"];

            await expect(
                resolveAndValidateWebhookIp("rebinding-attack.com", rebindingResolver),
            ).rejects.toThrowError(DeliverySsrfBlockedError);
        });

        it("blocks delivery when DNS rebinding resolves hostname to loopback (127.0.0.1)", async () => {
            const rebindingResolver = async (_host: string) => ["127.0.0.1"];

            await expect(
                resolveAndValidateWebhookIp("rebinding-attack.com", rebindingResolver),
            ).rejects.toThrowError(DeliverySsrfBlockedError);
        });

        it("blocks delivery when DNS rebinding resolves hostname to private RFC 1918 (10.0.0.5)", async () => {
            const rebindingResolver = async (_host: string) => ["10.0.0.5"];

            await expect(
                resolveAndValidateWebhookIp("internal-proxy.com", rebindingResolver),
            ).rejects.toThrowError(DeliverySsrfBlockedError);
        });

        it("blocks delivery when DNS lookup returns dual-stack with one private IPv6 (::1)", async () => {
            const dualStackRebinding = async (_host: string) => ["93.184.216.34", "::1"];

            await expect(
                resolveAndValidateWebhookIp("dual-stack-attacker.com", dualStackRebinding),
            ).rejects.toThrowError(DeliverySsrfBlockedError);
        });

        it("e2e: dispatcher aborts outbound request before socket creation if DNS resolves to private IP", async () => {
            const endpoint = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://rebinding-partner.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            const delivery = await createWebhookDeliveryRecord({
                workspaceId: ws1Id,
                webhookEndpointId: endpoint.id,
                eventId: "evt_rebinding_test_1",
                eventType: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                payload: {
                    id: "evt_rebinding_test_1",
                    event: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    createdAt: new Date().toISOString(),
                    workspaceId: ws1Id,
                    apiVersion: "v1",
                    data: { test: true },
                },
            });

            const fetchMock = vi.fn();
            const rebindingResolver = async () => ["169.254.169.254"];

            const result = await deliverWebhookAttempt(delivery.id, {
                customDnsResolver: rebindingResolver,
                customFetch: fetchMock as any,
            });

            // Assert fetch was NEVER called (aborted pre-connect)
            expect(fetchMock).not.toHaveBeenCalled();
            expect(result.status).toBe("FAILED");
            expect(result.error).toContain("forbidden IP");

            // Verify database record was marked FAILED with SSRF error
            const dbRecord = await prisma.webhookDelivery.findUnique({
                where: { id: delivery.id },
            });
            expect(dbRecord?.status).toBe("FAILED");
            expect(dbRecord?.responseBody).toContain("DNS/SSRF Pre-Connect Check Failed");
        });
    });

    describe("2. HMAC-SHA256 Request Signing & Replay Protection", () => {
        const secret = "whsec_0123456789abcdef0123456789abcdef0123456789abcdef";
        const payload = {
            id: "evt_test_hmac_1",
            event: "work_order.created",
            workspaceId: "ws_test",
            data: { title: "Furnace Check" },
        };

        it("generates correct signature header format 't=...,v1=...'", () => {
            const fixedTimestamp = 1756641600;
            const signed = signWebhookPayload(secret, payload, fixedTimestamp);

            expect(signed.timestamp).toBe(fixedTimestamp);
            expect(signed.signature).toMatch(/^[a-f0-9]{64}$/);
            expect(signed.header).toBe(`t=${fixedTimestamp},v1=${signed.signature}`);
        });

        it("verifies valid signature successfully (roundtrip)", () => {
            const timestamp = Math.floor(Date.now() / 1000);
            const signed = signWebhookPayload(secret, payload, timestamp);

            const verification = verifyWebhookSignature({
                payload,
                signatureHeader: signed.header,
                secret,
                currentTimestampSeconds: timestamp + 5, // 5 seconds later
                toleranceSeconds: 300,
            });

            expect(verification.isValid).toBe(true);
            expect(verification.timestamp).toBe(timestamp);
            expect(verification.reason).toBeUndefined();
        });

        it("rejects tampered payload content", () => {
            const timestamp = Math.floor(Date.now() / 1000);
            const signed = signWebhookPayload(secret, payload, timestamp);

            const tamperedPayload = { ...payload, data: { title: "Tampered Title" } };

            const verification = verifyWebhookSignature({
                payload: tamperedPayload,
                signatureHeader: signed.header,
                secret,
                currentTimestampSeconds: timestamp,
            });

            expect(verification.isValid).toBe(false);
            expect(verification.reason).toBe("SIGNATURE_MISMATCH");
        });

        it("rejects incorrect secret", () => {
            const timestamp = Math.floor(Date.now() / 1000);
            const signed = signWebhookPayload(secret, payload, timestamp);

            const verification = verifyWebhookSignature({
                payload,
                signatureHeader: signed.header,
                secret: "whsec_wrongsecretwrongsecretwrongsecretwrongsecret000000",
                currentTimestampSeconds: timestamp,
            });

            expect(verification.isValid).toBe(false);
            expect(verification.reason).toBe("SIGNATURE_MISMATCH");
        });

        it("rejects expired timestamp (replay protection)", () => {
            const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s ago (>300s tolerance)
            const signed = signWebhookPayload(secret, payload, oldTimestamp);

            const verification = verifyWebhookSignature({
                payload,
                signatureHeader: signed.header,
                secret,
                currentTimestampSeconds: Math.floor(Date.now() / 1000),
                toleranceSeconds: 300,
            });

            expect(verification.isValid).toBe(false);
            expect(verification.reason).toBe("TIMESTAMP_EXPIRED");
        });

        it("rejects malformed signature header", () => {
            const verification = verifyWebhookSignature({
                payload,
                signatureHeader: "malformed-header-without-equal",
                secret,
            });

            expect(verification.isValid).toBe(false);
            expect(verification.reason).toBe("MALFORMED_HEADER");
        });
    });

    describe("3. HTTP Redirect Security Policy (redirect: 'manual')", () => {
        it("does not follow HTTP 302 redirects automatically and treats redirect as non-2xx response", async () => {
            const endpoint = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://partner-redirector.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            const delivery = await createWebhookDeliveryRecord({
                workspaceId: ws1Id,
                webhookEndpointId: endpoint.id,
                eventId: "evt_redirect_test_1",
                eventType: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                payload: {
                    id: "evt_redirect_test_1",
                    event: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    createdAt: new Date().toISOString(),
                    workspaceId: ws1Id,
                    apiVersion: "v1",
                    data: { id: "wo_1" },
                },
            });

            const publicResolver = async () => ["93.184.216.34"];
            const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
                expect(init.redirect).toBe("manual");
                return new Response(null, {
                    status: 302,
                    headers: { Location: "https://169.254.169.254/latest/meta-data/" },
                });
            });

            const result = await deliverWebhookAttempt(delivery.id, {
                customDnsResolver: publicResolver,
                customFetch: mockFetch as any,
            });

            expect(result.responseStatus).toBe(302);
            expect(result.status).toBe("RETRYING");
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe("4. Retry Policy, Backoff Schedule, & Failure Classification", () => {
        it("calculates exponential backoff schedule matching locked constants", () => {
            const baseTime = new Date("2026-08-31T12:00:00.000Z");

            // Retry 1 (+15s)
            const retry1 = calculateNextRetryAt(1, baseTime);
            expect(retry1.getTime() - baseTime.getTime()).toBe(RETRY_BACKOFF_DELAYS_MS[0]); // 15,000ms

            // Retry 2 (+60s)
            const retry2 = calculateNextRetryAt(2, baseTime);
            expect(retry2.getTime() - baseTime.getTime()).toBe(RETRY_BACKOFF_DELAYS_MS[1]); // 60,000ms

            // Retry 3 (+300s)
            const retry3 = calculateNextRetryAt(3, baseTime);
            expect(retry3.getTime() - baseTime.getTime()).toBe(RETRY_BACKOFF_DELAYS_MS[2]); // 300,000ms

            // Retry 4 (+1800s)
            const retry4 = calculateNextRetryAt(4, baseTime);
            expect(retry4.getTime() - baseTime.getTime()).toBe(RETRY_BACKOFF_DELAYS_MS[3]); // 1,800,000ms
        });

        it("classifies HTTP 4xx client errors as terminal non-retryable failures (except 429)", () => {
            expect(isTerminalClientError(400)).toBe(true);
            expect(isTerminalClientError(401)).toBe(true);
            expect(isTerminalClientError(403)).toBe(true);
            expect(isTerminalClientError(404)).toBe(true);
            expect(isTerminalClientError(410)).toBe(true);
            expect(isTerminalClientError(422)).toBe(true);
            expect(isTerminalClientError(429)).toBe(false); // 429 Rate limited is retryable
            expect(isTerminalClientError(500)).toBe(false);
            expect(isTerminalClientError(503)).toBe(false);
        });

        it("transitions to terminal FAILED on HTTP 400 Bad Request without further retries", async () => {
            const endpoint = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://bad-client.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            const delivery = await createWebhookDeliveryRecord({
                workspaceId: ws1Id,
                webhookEndpointId: endpoint.id,
                eventId: "evt_bad_client_1",
                eventType: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                payload: {
                    id: "evt_bad_client_1",
                    event: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    createdAt: new Date().toISOString(),
                    workspaceId: ws1Id,
                    apiVersion: "v1",
                    data: {},
                },
            });

            const mockFetch = vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ error: "Invalid json schema" }), {
                    status: 400,
                    headers: { "content-type": "application/json" },
                }),
            );

            const result = await deliverWebhookAttempt(delivery.id, {
                customDnsResolver: async () => ["93.184.216.34"],
                customFetch: mockFetch as any,
            });

            expect(result.status).toBe("FAILED");
            expect(result.responseStatus).toBe(400);

            const record = await prisma.webhookDelivery.findUnique({
                where: { id: delivery.id },
            });
            expect(record?.status).toBe("FAILED");
            expect(record?.failedAt).not.toBeNull();
            expect(record?.nextRetryAt).toBeNull();
            expect(record?.responseBody).toContain("Invalid json schema");
        });

        it("transitions to RETRYING on HTTP 500 Internal Error on attempt 1", async () => {
            const endpoint = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://failing-server.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            const delivery = await createWebhookDeliveryRecord({
                workspaceId: ws1Id,
                webhookEndpointId: endpoint.id,
                eventId: "evt_server_error_1",
                eventType: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                payload: {
                    id: "evt_server_error_1",
                    event: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    createdAt: new Date().toISOString(),
                    workspaceId: ws1Id,
                    apiVersion: "v1",
                    data: {},
                },
            });

            const mockFetch = vi.fn().mockResolvedValue(
                new Response("Internal database lock error", { status: 500 }),
            );

            const result = await deliverWebhookAttempt(delivery.id, {
                customDnsResolver: async () => ["93.184.216.34"],
                customFetch: mockFetch as any,
            });

            expect(result.status).toBe("RETRYING");
            expect(result.responseStatus).toBe(500);

            const record = await prisma.webhookDelivery.findUnique({
                where: { id: delivery.id },
            });
            expect(record?.status).toBe("RETRYING");
            expect(record?.attempts).toBe(1);
            expect(record?.nextRetryAt).not.toBeNull();
        });

        it("marks delivery FAILED when maximum retry attempts (5) are exhausted", async () => {
            const endpoint = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://persistent-500.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            // Seed delivery record already at 4 attempts
            const delivery = await prisma.webhookDelivery.create({
                data: {
                    workspaceId: ws1Id,
                    webhookEndpointId: endpoint.id,
                    eventId: "evt_exhaust_test",
                    eventType: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    payload: { test: true },
                    status: "RETRYING",
                    attempts: 4,
                },
            });

            const mockFetch = vi.fn().mockResolvedValue(new Response("Service Unavailable", { status: 503 }));

            const result = await deliverWebhookAttempt(delivery.id, {
                customDnsResolver: async () => ["93.184.216.34"],
                customFetch: mockFetch as any,
            });

            expect(result.attempts).toBe(5);
            expect(result.status).toBe("FAILED");

            const record = await prisma.webhookDelivery.findUnique({
                where: { id: delivery.id },
            });
            expect(record?.status).toBe("FAILED");
            expect(record?.failedAt).not.toBeNull();
            expect(record?.nextRetryAt).toBeNull();
        });
    });

    describe("5. Delivery Timeout Handling", () => {
        it("aborts hanging request at configured timeout threshold and marks RETRYING", async () => {
            const endpoint = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://slow-receiver.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            const delivery = await createWebhookDeliveryRecord({
                workspaceId: ws1Id,
                webhookEndpointId: endpoint.id,
                eventId: "evt_timeout_test_1",
                eventType: PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                payload: { test: true } as any,
            });

            // Mock fetch that hangs or throws AbortError
            const hangingFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
                const signal = init.signal;
                return new Promise((_, reject) => {
                    signal.addEventListener("abort", () => {
                        reject(new Error("The operation was aborted due to timeout"));
                    });
                });
            });

            const result = await deliverWebhookAttempt(delivery.id, {
                customDnsResolver: async () => ["93.184.216.34"],
                customFetch: hangingFetch as any,
                timeoutMs: 50, // Short timeout for test
            });

            expect(result.status).toBe("RETRYING");
            expect(result.error).toContain("aborted");

            const record = await prisma.webhookDelivery.findUnique({
                where: { id: delivery.id },
            });
            expect(record?.status).toBe("RETRYING");
            expect(record?.responseBody).toContain("aborted");
        });
    });

    describe("6. Event Dispatch Pipeline & Multi-Tenant Isolation", () => {
        it("dispatchWebhookEvent creates deliveries and delivers only to subscribed active endpoints in workspace", async () => {
            // Clean up prior test endpoints in ws1
            await prisma.webhookEndpoint.deleteMany({
                where: { workspaceId: ws1Id },
            });

            // Create 2 endpoints in Workspace 1: one subscribed to WORK_ORDER_CREATED, one to CUSTOMER_CREATED
            const ep1 = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://ws1-wo.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });
            const ep2 = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://ws1-cust.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.CUSTOMER_CREATED],
            });

            // Create endpoint in Workspace 2 subscribed to WORK_ORDER_CREATED
            const epWs2 = await createWebhookEndpoint(ws2Id, app2Id, {
                url: "https://ws2-wo.com/events",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            const mockFetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

            // Dispatch WORK_ORDER_CREATED event in Workspace 1
            const deliveries = await dispatchWebhookEvent(
                ws1Id,
                PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                { workOrderId: "wo_123", status: "PENDING" },
                {
                    customDnsResolver: async () => ["93.184.216.34"],
                    customFetch: mockFetch as any,
                },
            );

            // Should create delivery ONLY for ep1 (subscribed in ws1)
            expect(deliveries.length).toBe(1);
            expect(deliveries[0].webhookEndpointId).toBe(ep1.id);
            expect(deliveries[0].workspaceId).toBe(ws1Id);
            expect(deliveries[0].status).toBe("DELIVERED");

            // Verify Workspace 2 never received delivery
            const ws2Deliveries = await prisma.webhookDelivery.findMany({
                where: { workspaceId: ws2Id },
            });
            expect(ws2Deliveries.some((d) => d.webhookEndpointId === epWs2.id && (d.payload as any).data?.workOrderId === "wo_123")).toBe(false);
        });

        it("domain services (createCustomer, createWorkOrder, transitionWorkOrderStatus) automatically trigger webhook event emission", async () => {
            await prisma.webhookEndpoint.deleteMany({
                where: { workspaceId: ws1Id },
            });

            // Register endpoint subscribed to customer.created, work_order.created, work_order.status_changed
            const ep = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://auto-triggers.com/webhook",
                events: [
                    PUBLIC_WEBHOOK_EVENTS.CUSTOMER_CREATED,
                    PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                    PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_STATUS_CHANGED,
                ],
            });

            const actorContext = {
                user: { id: user1Id, email: "user1@example.com", name: "User 1", status: "ACTIVE" as const, emailVerified: new Date() },
                workspace: { id: ws1Id, name: "Webhook Sec WS 1", slug: `webhook-sec-ws1-${runId}`, logoUrl: null, timezone: "UTC" },
                membership: { id: mem1Id, workspaceId: ws1Id, userId: user1Id, role: "OWNER" as const, status: "ACTIVE" as const },
            };

            async function waitForWebhookDelivery(eventType: string, timeoutMs = 5000) {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    const records = await prisma.webhookDelivery.findMany({
                        where: {
                            workspaceId: ws1Id,
                            webhookEndpointId: ep.id,
                            eventType,
                        },
                    });
                    if (records.length > 0) {
                        return records;
                    }
                    await new Promise((r) => setTimeout(r, 50));
                }
                return prisma.webhookDelivery.findMany({
                    where: {
                        workspaceId: ws1Id,
                        webhookEndpointId: ep.id,
                        eventType,
                    },
                });
            }

            // 1. Trigger Customer Creation
            const customer = await createCustomer(
                ws1Id,
                { name: "Trigger Test Customer", status: "ACTIVE" },
                actorContext,
            );

            const custDeliveries = await waitForWebhookDelivery(PUBLIC_WEBHOOK_EVENTS.CUSTOMER_CREATED);
            expect(custDeliveries.length).toBe(1);
            expect((custDeliveries[0].payload as any).data.id).toBe(customer.id);

            // 2. Setup Location & WorkType for WorkOrder
            const loc = await prisma.serviceLocation.create({
                data: {
                    customerId: customer.id,
                    name: "Main Facility",
                    addressLine1: "100 Main St",
                    city: "Austin",
                    state: "TX",
                    postalCode: "78701",
                    country: "USA",
                },
            });

            const cat1 = await prisma.serviceCatalog.create({
                data: {
                    workspaceId: ws1Id,
                    name: `Catalog ${runId}`,
                    status: "ACTIVE",
                },
            });

            const workType = await prisma.workType.create({
                data: {
                    workspaceId: ws1Id,
                    catalogId: cat1.id,
                    name: `Repair ${runId}`,
                    code: `REP-${runId}`,
                    status: "ACTIVE",
                },
            });

            // 3. Trigger WorkOrder Creation
            const wo = await createWorkOrder(
                ws1Id,
                {
                    customerId: customer.id,
                    locationId: loc.id,
                    workTypeId: workType.id,
                    priority: "HIGH",
                    title: "Emergency Pipe Leak",
                },
                actorContext,
            );

            const woDeliveries = await waitForWebhookDelivery(PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED);
            expect(woDeliveries.length).toBe(1);
            expect((woDeliveries[0].payload as any).data.id).toBe(wo.id);

            // 4. Trigger WorkOrder Status Transition
            await transitionWorkOrderStatus(
                ws1Id,
                wo.id,
                { toStatus: "CANCELLED", cancellationReason: "Customer cancelled" },
                actorContext,
            );

            const statusDeliveries = await waitForWebhookDelivery(PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_STATUS_CHANGED);
            expect(statusDeliveries.length).toBe(1);
            expect((statusDeliveries[0].payload as any).data.id).toBe(wo.id);
            expect((statusDeliveries[0].payload as any).data.status).toBe("CANCELLED");
        });

        it("guarantees transaction atomicity: transaction rollback aborts and purges pending webhook deliveries", async () => {
            await prisma.webhookEndpoint.deleteMany({
                where: { workspaceId: ws1Id },
            });

            const rollbackEp = await createWebhookEndpoint(ws1Id, app1Id, {
                url: "https://rollback-test.com/webhook",
                events: [PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED],
            });

            // Simulate transaction failure after webhook enqueueing
            let transactionThrew = false;
            try {
                await prisma.$transaction(async (tx) => {
                    const cust = await tx.customer.create({
                        data: {
                            workspaceId: ws1Id,
                            customerNumber: `ROLLBACK-CUST-${Date.now()}`,
                            name: "Rollback Customer",
                            status: "ACTIVE",
                        },
                    });

                    // Enqueue webhook delivery inside the transaction
                    const deliveryIds = await enqueueWebhookDelivery(
                        tx,
                        ws1Id,
                        PUBLIC_WEBHOOK_EVENTS.WORK_ORDER_CREATED,
                        { id: "wo_rollback_123", customerId: cust.id },
                    );

                    expect(deliveryIds.length).toBe(1);

                    // Force an exception / transaction rollback
                    throw new Error("Simulated database failure before commit");
                });
            } catch (err: any) {
                if (err.message === "Simulated database failure before commit") {
                    transactionThrew = true;
                }
            }

            expect(transactionThrew).toBe(true);

            // Verify that zero webhook deliveries were committed to the database
            const committedDeliveries = await prisma.webhookDelivery.findMany({
                where: {
                    workspaceId: ws1Id,
                    webhookEndpointId: rollbackEp.id,
                },
            });
            expect(committedDeliveries.length).toBe(0);

            // Verify customer row was also rolled back
            const committedCustomers = await prisma.customer.findMany({
                where: {
                    workspaceId: ws1Id,
                    name: "Rollback Customer",
                },
            });
            expect(committedCustomers.length).toBe(0);
        });
    });
}, 30000);


