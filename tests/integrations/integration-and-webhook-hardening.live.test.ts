import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import {
    PrismaClient,
    Prisma,
    IntegrationConnectionStatus,
    IntegrationCredentialStatus,
    IntegrationWebhookStatus,
    IntegrationCapability,
    IntegrationFailureCode,
} from "@/generated/prisma/client";
import { SubscriptionStatus } from "@/generated/prisma/enums";
import {
    registerAdapter,
    clearAdapters,
} from "@/lib/integrations/adapters/adapterRegistry";
import { MockEmailAdapter } from "@/lib/integrations/adapters/mockEmailAdapter";
import { seedIntegrationCatalog } from "@/lib/integrations/seed/integrationSeed";
import { processInboundWebhook } from "@/lib/integrations/webhooks/webhookPipeline";
import {
    verifyWebhookSignature,
    extractSignatureAndTimestamp,
} from "@/lib/integrations/webhooks/signatureVerification";
import { CREDENTIAL_SUPERSEDED_GRACE_PERIOD_MS } from "@/lib/integrations/credentialStateMachine";
import { refreshOAuth2TokenWithMutex, type OAuth2TokenPayload } from "@/lib/integrations/adapters/oauth2Helper";
import { executeCapability, executeCapabilityWithRetry } from "@/lib/integrations/execution";
import {
    createSubscription,
    transitionSubscriptionStatus,
} from "@/lib/services/billing/subscriptionService";
import { processBillingWebhookEvent } from "@/lib/services/billing/webhookService";
import { BillingProviderType } from "@/generated/prisma/enums";
import * as autoIngest from "@/lib/services/automation/eventIngestionService";

describe("Phase 1.21.7 — Integration & Webhook Testing (Adversarial, Idempotency, Failures & Hardening)", () => {
    let prisma: PrismaClient;
    const runId = Math.floor(Math.random() * 900000 + 100000);
    const workspaceId = `ws_wh_harden_${runId}`;
    const tenantBWorkspaceId = `ws_wh_tenant_b_${runId}`;
    const primarySigningSecret = `whsec_primary_${runId}_key_alpha_987654321`;
    const tenantBSigningSecret = `whsec_tenant_b_${runId}_key_beta_123456789`;
    const oldSupersededSecret = `whsec_superseded_${runId}_key_gamma_11223344`;

    let connectionId: string;
    let endpointSlug: string;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Seed integration catalog
        await seedIntegrationCatalog(prisma);

        // 2. Seed primary workspace
        await prisma.workspace.create({
            data: {
                id: workspaceId,
                name: `Webhook Hardening WS ${runId}`,
                slug: `wh-harden-ws-${runId}`,
                timezone: "America/New_York",
                defaultCurrencyCode: "USD",
            },
        });

        // 3. Seed foreign tenant workspace (Tenant B)
        await prisma.workspace.create({
            data: {
                id: tenantBWorkspaceId,
                name: `Tenant B Webhook WS ${runId}`,
                slug: `wh-tenant-b-${runId}`,
                timezone: "America/New_York",
                defaultCurrencyCode: "USD",
            },
        });

        // 4. Register Mock Email Adapter
        clearAdapters();
        const resendAdapter = new MockEmailAdapter("resend", "Resend Test Adapter");
        registerAdapter(resendAdapter);

        // 5. Seed Integration Connection for primary workspace
        const conn = await prisma.integrationConnection.create({
            data: {
                workspaceId,
                integrationId: "resend",
                status: IntegrationConnectionStatus.CONNECTED,
            },
        });
        connectionId = conn.id;

        // 6. Seed active credential with primary signing secret
        await prisma.integrationCredential.create({
            data: {
                connectionId,
                version: 1,
                status: IntegrationCredentialStatus.ACTIVE,
                keyVaultProvider: "LOCAL_ENCRYPTED_DB",
                algorithm: "AES_256_GCM",
                fingerprint: `fp_wh_${runId}_v1`,
                encryptedData: `plain:${primarySigningSecret}`,
                iv: "dGVzdF9pdl8xMjM0NTY=",
                tag: "dGVzdF90YWdfMTIzNDU2",
            },
        });

        // 7. Seed inbound webhook endpoint
        endpointSlug = `wh-slug-${runId}-${Math.random().toString(36).slice(2, 7)}`;
        await prisma.integrationWebhook.create({
            data: {
                workspaceId,
                connectionId,
                endpointSlug,
                status: IntegrationWebhookStatus.ACTIVE,
            },
        });

        // 8. Grant FEATURE_API_ACCESS entitlement override for testing
        await prisma.workspaceEntitlementOverride.create({
            data: {
                workspaceId,
                featureKey: "FEATURE_API_ACCESS",
                featureType: "BOOLEAN",
                overrideValueJson: true,
                reason: "Integration webhook testing",
                grantedByUserId: "test_admin",
            },
        });
    });

    afterAll(async () => {
        if (!prisma) return;
        try {
            clearAdapters();
            await prisma.integrationWebhookEvent.deleteMany({ where: { workspaceId } });
            await prisma.integrationExecution.deleteMany({ where: { workspaceId } });
            await prisma.integrationWebhook.deleteMany({ where: { workspaceId } });
            await prisma.integrationCredential.deleteMany({ where: { connection: { workspaceId } } });
            await prisma.integrationConnection.deleteMany({ where: { workspaceId } });
            await prisma.billingWebhookEvent.deleteMany({ where: { providerEventId: { contains: `bh_${runId}` } } });
            await prisma.subscriptionHistory.deleteMany({ where: { subscription: { workspaceId } } });
            await prisma.subscription.deleteMany({ where: { workspaceId } });
            await prisma.subscriptionPlan.deleteMany({ where: { code: { startsWith: `plan_wh_${runId}` } } });
            await prisma.platformBillingAccount.deleteMany({ where: { workspaceId } });
            await prisma.workspaceEntitlementOverride.deleteMany({ where: { workspaceId } });
            await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, tenantBWorkspaceId] } } });
        } catch (e) {
            console.error("Cleanup error in webhook hardening test:", e);
        } finally {
            await prisma.$disconnect();
        }
    });

    // =========================================================================
    // 1. Webhook Signature Verification Exhaustively (4 Schemes)
    // =========================================================================
    describe("1. Webhook Signature Verification (All 4 Cryptographic Schemes)", () => {
        const testPayload = JSON.stringify({
            eventId: `evt_sig_test_${runId}`,
            type: "email.delivered",
            data: { recipient: "client@example.com", timestamp: 1725000000 },
        });
        const rawBuffer = Buffer.from(testPayload, "utf-8");

        // --- Scheme 1: Stripe Timestamped Scheme (stripe-signature: t=...,v1=...) ---
        describe("Scheme 1: Stripe Timestamped HMAC-SHA256 (t=...,v1=...)", () => {
            const nowSeconds = Math.floor(Date.now() / 1000);
            const signedPayload = Buffer.concat([Buffer.from(`${nowSeconds}.`), rawBuffer]);
            const validStripeSig = crypto.createHmac("sha256", primarySigningSecret).update(signedPayload).digest("hex");

            it("(a) accepts correctly signed payload with valid timestamp and v1 hex signature", async () => {
                const headers = new Headers({
                    "stripe-signature": `t=${nowSeconds},v1=${validStripeSig}`,
                });

                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(true);
                expect(result.matchedCredential).toBeDefined();
            });

            it("(b) rejects payload with tampered body or invalid signature", async () => {
                const headers = new Headers({
                    "stripe-signature": `t=${nowSeconds},v1=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff`,
                });

                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(false);
                expect(result.reason).toContain("Cryptographic signature mismatch");
            });

            it("(c) rejects payload when signature header is missing", async () => {
                const headers = new Headers({});
                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(false);
                expect(result.reason).toBe("Missing webhook signature header");
            });

            it("(d) rejects payload signed with foreign tenant secret (cross-tenant secret confusion)", async () => {
                // Sign using Tenant B's secret
                const foreignSig = crypto.createHmac("sha256", tenantBSigningSecret).update(signedPayload).digest("hex");
                const headers = new Headers({
                    "stripe-signature": `t=${nowSeconds},v1=${foreignSig}`,
                });

                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(false);
                expect(result.reason).toContain("Cryptographic signature mismatch");
            });
        });

        // --- Scheme 2: Standard Hex HMAC-SHA256 (x-webhook-signature / x-hub-signature-256) ---
        describe("Scheme 2: Standard Hex HMAC-SHA256 (x-webhook-signature)", () => {
            const validHexSig = crypto.createHmac("sha256", primarySigningSecret).update(rawBuffer).digest("hex");

            it("(a) accepts raw hex and sha256= prefixed hex signatures", async () => {
                const headers1 = new Headers({ "x-webhook-signature": validHexSig });
                const headers2 = new Headers({ "x-hub-signature-256": `sha256=${validHexSig}` });

                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });

                const result1 = await verifyWebhookSignature(rawBuffer, headers1, credentials);
                const result2 = await verifyWebhookSignature(rawBuffer, headers2, credentials);

                expect(result1.valid).toBe(true);
                expect(result2.valid).toBe(true);
            });

            it("(b) rejects tampered hex signature", async () => {
                const headers = new Headers({ "x-webhook-signature": "deadbeef1234567890abcdef" });
                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(false);
                expect(result.reason).toContain("Cryptographic signature mismatch");
            });

            it("(c) rejects cross-tenant secret signing", async () => {
                const foreignHex = crypto.createHmac("sha256", tenantBSigningSecret).update(rawBuffer).digest("hex");
                const headers = new Headers({ "x-webhook-signature": foreignHex });
                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(false);
            });
        });

        // --- Scheme 3: Twilio Base64 HMAC-SHA256 (x-twilio-signature) ---
        describe("Scheme 3: Base64 HMAC-SHA256 (x-twilio-signature)", () => {
            const validBase64Sig = crypto.createHmac("sha256", primarySigningSecret).update(rawBuffer).digest("base64");

            it("(a) accepts valid Base64 signature", async () => {
                const headers = new Headers({ "x-twilio-signature": validBase64Sig });
                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(true);
            });

            it("(b) rejects invalid Base64 signature", async () => {
                const headers = new Headers({ "x-twilio-signature": "aW52YWxpZHNpZ25hdHVyZQ==" });
                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(false);
            });

            it("(c) rejects cross-tenant Base64 signature", async () => {
                const foreignBase64 = crypto.createHmac("sha256", tenantBSigningSecret).update(rawBuffer).digest("base64");
                const headers = new Headers({ "x-twilio-signature": foreignBase64 });
                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(false);
            });
        });

        // --- Scheme 4: Superseded Credential 24h Grace Period Fallback Scheme ---
        describe("Scheme 4: Superseded Credential Grace-Period Fallback Scheme", () => {
            let supersededCredId: string;

            beforeAll(async () => {
                const superseded = await prisma.integrationCredential.create({
                    data: {
                        connectionId,
                        version: 0,
                        status: IntegrationCredentialStatus.SUPERSEDED,
                        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
                        algorithm: "AES_256_GCM",
                        fingerprint: `fp_wh_old_${runId}`,
                        encryptedData: `plain:${oldSupersededSecret}`,
                        iv: "dGVzdF9pdl8xMjM0NTY=",
                        tag: "dGVzdF90YWdfMTIzNDU2",
                        updatedAt: new Date(Date.now() - 3600000 * 4), // Rotated 4 hours ago (< 24h grace period)
                    },
                });
                supersededCredId = superseded.id;
            });

            it("(a) accepts webhook signed with SUPERSEDED credential rotated 4 hours ago (< 24h grace window)", async () => {
                const supersededSig = crypto.createHmac("sha256", oldSupersededSecret).update(rawBuffer).digest("hex");
                const headers = new Headers({ "x-webhook-signature": supersededSig });

                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials);

                expect(result.valid).toBe(true);
                expect(result.matchedCredential?.id).toBe(supersededCredId);
            });

            it("(b) rejects webhook signed with SUPERSEDED credential rotated 26 hours ago (> 24h grace window)", async () => {
                // Simulate time 26 hours in the future
                const futureTime = new Date(Date.now() + 3600000 * 22); // 4h + 22h = 26h since rotation
                const supersededSig = crypto.createHmac("sha256", oldSupersededSecret).update(rawBuffer).digest("hex");
                const headers = new Headers({ "x-webhook-signature": supersededSig });

                const credentials = await prisma.integrationCredential.findMany({ where: { connectionId } });
                const result = await verifyWebhookSignature(rawBuffer, headers, credentials, {
                    now: futureTime,
                });

                expect(result.valid).toBe(false);
                expect(result.reason).toContain("Cryptographic signature mismatch");
            });
        });
    });

    // =========================================================================
    // 2. Webhook Replay & Out-of-Order Delivery Invariants
    // =========================================================================
    describe("2. Webhook Replay & Out-of-Order Delivery Invariants", () => {
        it("(a) exact same webhook event delivered twice in immediate succession returns REPLAY_DISCARDED / IDEMPOTENT_IGNORED with zero duplicate mutations", async () => {
            const eventPayload = {
                eventId: `evt_replay_race_${runId}_1`,
                type: "email.delivered",
                data: { messageId: `msg_${runId}_101`, recipient: "bob@example.com" },
            };
            const bodyStr = JSON.stringify(eventPayload);
            const buffer = Buffer.from(bodyStr, "utf-8");
            const sig = crypto.createHmac("sha256", primarySigningSecret).update(buffer).digest("hex");
            const headers = new Headers({
                "x-webhook-signature": sig,
                "x-delivery-id": `deliv_${runId}_101`,
            });

            // 1st delivery
            const result1 = await processInboundWebhook(endpointSlug, buffer, headers);
            expect(result1.outcome).toBe("SUCCESS");
            expect(result1.httpStatus).toBe(200);

            // 2nd immediate delivery (replay of identical nonce/delivery-id)
            const result2 = await processInboundWebhook(endpointSlug, buffer, headers);
            expect(result2.outcome).toBe("REPLAY_DISCARDED");
            expect(result2.httpStatus).toBe(200);

            // Invariant: Exactly 1 record exists in IntegrationWebhookEvent inbox
            const inboxRows = await prisma.integrationWebhookEvent.findMany({
                where: {
                    workspaceId,
                    providerEventId: `evt_replay_race_${runId}_1`,
                },
            });
            expect(inboxRows.length).toBe(1);
        });

        it("(b) rejects webhook replay exceeding the 300s timestamp-tolerance window with HTTP 400", async () => {
            const eventPayload = {
                eventId: `evt_stale_ts_${runId}`,
                type: "email.delivered",
            };
            const bodyStr = JSON.stringify(eventPayload);
            const buffer = Buffer.from(bodyStr, "utf-8");

            // Stale timestamp from 400 seconds ago (tolerance window is 300s)
            const staleTimestamp = Date.now() - 400 * 1000;
            const sig = crypto.createHmac("sha256", primarySigningSecret).update(buffer).digest("hex");

            const headers = new Headers({
                "x-webhook-signature": sig,
                "x-webhook-timestamp": String(staleTimestamp),
            });

            const result = await processInboundWebhook(endpointSlug, buffer, headers);

            expect(result.outcome).toBe("FAILED");
            expect(result.stage).toBe(2);
            expect(result.httpStatus).toBe(400);
            expect(result.message).toContain("Webhook timestamp outside tolerance window");
        });

        it("(c) out-of-order webhook delivery guard correctly discards stale older events without regressing subscription state", async () => {
            const billingAccount = await prisma.platformBillingAccount.create({
                data: {
                    workspaceId,
                    billingEmail: `billing-ooo-${runId}@example.com`,
                    provider: "STRIPE",
                    providerCustomerId: `cus_ooo_${runId}`,
                },
            });

            const plan = await prisma.subscriptionPlan.create({
                data: {
                    code: `plan_ooo_${runId}`,
                    name: "Out-of-Order Hardening Plan",
                    tier: "STARTER",
                    baseSeats: 1,
                },
            });

            const sub = await prisma.$transaction(async (tx) => {
                return createSubscription(tx, {
                    workspaceId,
                    accountId: billingAccount.id,
                    planId: plan.id,
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
                    triggerSource: "TEST:setup",
                });
            });

            const baseTime = Date.now();
            const timestampLate = new Date(baseTime + 7200000); // t = +2 hours
            const timestampEarly = new Date(baseTime + 3600000); // t = +1 hour (stale out-of-order)

            // Step 1: Process newer event first (sets subscription to PAST_DUE at t = +2h)
            await prisma.$transaction(async (tx) => {
                const res = await transitionSubscriptionStatus(tx, {
                    subscriptionId: sub.id,
                    toStatus: SubscriptionStatus.PAST_DUE,
                    triggerSource: "WEBHOOK:invoice.payment_failed",
                    providerEventTimestamp: timestampLate,
                });
                expect(res.outcome).toBe("APPLIED");
            });

            // Verify live DB updated lastSyncedProviderEventAt to timestampLate
            const dbSubLate = await prisma.subscription.findUnique({ where: { id: sub.id } });
            expect(dbSubLate!.status).toBe(SubscriptionStatus.PAST_DUE);
            expect(dbSubLate!.lastSyncedProviderEventAt).toEqual(timestampLate);

            // Step 2: Receive delayed out-of-order webhook for earlier state transition at t = +1h
            const outOfOrderResult = await prisma.$transaction(async (tx) => {
                return transitionSubscriptionStatus(tx, {
                    subscriptionId: sub.id,
                    toStatus: SubscriptionStatus.ACTIVE,
                    triggerSource: "WEBHOOK:invoice.payment_succeeded",
                    providerEventTimestamp: timestampEarly, // Older than timestampLate
                });
            });

            // Invariant: Out-of-order guard discards stale event and preserves PAST_DUE state
            expect(outOfOrderResult.outcome).toBe("IGNORED_OUT_OF_ORDER");
            if (outOfOrderResult.outcome === "IGNORED_OUT_OF_ORDER") {
                expect(outOfOrderResult.reason).toContain("is older than last synced timestamp");
            }

            const dbSubFinal = await prisma.subscription.findUnique({ where: { id: sub.id } });
            expect(dbSubFinal!.status).toBe(SubscriptionStatus.PAST_DUE); // Did NOT regress to ACTIVE
        });
    });

    // =========================================================================
    // 3. 8-Stage Webhook Pipeline Failure Injection (All 8 Stages)
    // =========================================================================
    describe("3. 8-Stage Webhook Pipeline Failure & Halt Injection (All 8 Stages)", () => {
        const payload = JSON.stringify({ eventId: `evt_stage_${runId}`, type: "email.delivered" });
        const buf = Buffer.from(payload, "utf-8");
        const validSig = crypto.createHmac("sha256", primarySigningSecret).update(buf).digest("hex");

        it("Stage 1 Failure: Invalid signature halts pipeline with HTTP 401", async () => {
            const badHeaders = new Headers({ "x-webhook-signature": "forged_signature_hex_12345" });
            const result = await processInboundWebhook(endpointSlug, buf, badHeaders);

            expect(result.stage).toBe(1);
            expect(result.outcome).toBe("FAILED");
            expect(result.httpStatus).toBe(401);
        });

        it("Stage 2 Failure: Timestamp delta > 300s halts pipeline with HTTP 400", async () => {
            const staleHeaders = new Headers({
                "x-webhook-signature": validSig,
                "x-webhook-timestamp": String(Date.now() - 350 * 1000), // 350s ago
            });
            const result = await processInboundWebhook(endpointSlug, buf, staleHeaders);

            expect(result.stage).toBe(2);
            expect(result.outcome).toBe("FAILED");
            expect(result.httpStatus).toBe(400);
        });

        it("Stage 3 Halt: Replay detected within sliding window halts pipeline at Stage 3 with REPLAY_DISCARDED (HTTP 200)", async () => {
            const replayPayload = JSON.stringify({ eventId: `evt_stage3_rep_${runId}`, type: "email.delivered" });
            const replayBuf = Buffer.from(replayPayload, "utf-8");
            const replaySig = crypto.createHmac("sha256", primarySigningSecret).update(replayBuf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": replaySig, "x-webhook-id": `nonce_st3_${runId}` });

            // 1st delivery
            const res1 = await processInboundWebhook(endpointSlug, replayBuf, headers);
            expect(res1.outcome).toBe("SUCCESS");

            // 2nd delivery
            const res2 = await processInboundWebhook(endpointSlug, replayBuf, headers);
            expect(res2.stage).toBe(3);
            expect(res2.outcome).toBe("REPLAY_DISCARDED");
            expect(res2.httpStatus).toBe(200);
        });

        it("Stage 4 Failure: Nonexistent endpoint slug halts pipeline with HTTP 404", async () => {
            const headers = new Headers({ "x-webhook-signature": validSig });
            const result = await processInboundWebhook(`nonexistent-slug-${runId}`, buf, headers);

            expect(result.stage).toBe(4);
            expect(result.outcome).toBe("FAILED");
            expect(result.httpStatus).toBe(404);
            expect(result.message).toContain("No registered webhook found");
        });

        it("Stage 5 Failure: Connection in ERROR status halts pipeline with HTTP 503 and Retry-After header", async () => {
            // Temporarily set connection status to ERROR
            await prisma.integrationConnection.update({
                where: { id: connectionId },
                data: { status: IntegrationConnectionStatus.ERROR },
            });

            const headers = new Headers({ "x-webhook-signature": validSig });
            const result = await processInboundWebhook(endpointSlug, buf, headers);

            expect(result.stage).toBe(5);
            expect(result.outcome).toBe("FAILED");
            expect(result.httpStatus).toBe(503);
            expect(result.responseHeaders?.["Retry-After"]).toBe("300");

            // Restore connection status to CONNECTED
            await prisma.integrationConnection.update({
                where: { id: connectionId },
                data: { status: IntegrationConnectionStatus.CONNECTED },
            });
        });

        it("Stage 6 Failure: Malformed non-JSON payload halts pipeline with HTTP 400", async () => {
            const malformedBuf = Buffer.from("{malformed: json:: missing quotes", "utf-8");
            const malformedSig = crypto.createHmac("sha256", primarySigningSecret).update(malformedBuf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": malformedSig });

            const result = await processInboundWebhook(endpointSlug, malformedBuf, headers);

            expect(result.stage).toBe(6);
            expect(result.outcome).toBe("FAILED");
            expect(result.httpStatus).toBe(400);
            expect(result.message).toContain("Malformed JSON payload");
        });

        it("Stage 7 Halt: Unhandled / declined event from adapter halts at Stage 7 with IGNORED status (HTTP 200)", async () => {
            // Send unknown event type that MockEmailAdapter returns null for
            const unhandledPayload = JSON.stringify({
                eventId: `evt_unhandled_st7_${runId}`,
                eventType: "unhandled.event",
                simulateIgnored: true,
                data: {},
            });
            const unhandledBuf = Buffer.from(unhandledPayload, "utf-8");
            const unhandledSig = crypto.createHmac("sha256", primarySigningSecret).update(unhandledBuf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": unhandledSig });

            const result = await processInboundWebhook(endpointSlug, unhandledBuf, headers);

            expect(result.stage).toBe(7);
            expect(result.outcome).toBe("IGNORED");
            expect(result.httpStatus).toBe(200);

            // Verify inbox state is updated to IGNORED
            const inbox = await prisma.integrationWebhookEvent.findUnique({
                where: { id: result.webhookEventRecordId! },
            });
            expect(inbox?.status).toBe("IGNORED");
        });

        it("Stage 8 Failure: Injected domain event dispatch transaction abort leaves zero partial side effects", async () => {
            const dispatchFailPayload = JSON.stringify({
                eventId: `evt_st8_fail_${runId}`,
                type: "email.delivered",
                data: { recipient: "dispatch-fail@example.com" },
            });
            const dispatchBuf = Buffer.from(dispatchFailPayload, "utf-8");
            const dispatchSig = crypto.createHmac("sha256", primarySigningSecret).update(dispatchBuf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": dispatchSig });

            // Spy on ingestAutomationEvent to inject transaction failure during Stage 8 dispatch
            const ingestSpy = vi.spyOn(autoIngest, "ingestAutomationEvent").mockRejectedValueOnce(
                new Error("INJECTED_STAGE_8_DISPATCH_FAILURE")
            );

            await expect(
                processInboundWebhook(endpointSlug, dispatchBuf, headers)
            ).rejects.toThrow("INJECTED_STAGE_8_DISPATCH_FAILURE");

            ingestSpy.mockRestore();

            // Invariant: Inbox record remains in RECEIVED status (transaction was aborted before PROCESSED commit)
            const inbox = await prisma.integrationWebhookEvent.findFirst({
                where: { workspaceId, providerEventId: `evt_st8_fail_${runId}` },
            });
            expect(inbox?.status).toBe("RECEIVED");
        });
    });

    // =========================================================================
    // 4. Outbound Execution Idempotency under Webhook-Triggered Retries
    // =========================================================================
    describe("4. Outbound Execution Idempotency under Webhook-Triggered Retries (retryOrchestrator)", () => {
        it("drives a failed dispatch through real retryOrchestrator with exponential backoff and preserves UUIDv5 idempotency ledger across attempts", async () => {
            const idempotencyKey = `idemp_outbound_retry_${runId}`;
            const payload = { to: "retry-recipient@domain.com", subject: "Webhook Retry", body: "Retrying outbound action" };

            // Create custom adapter that fails on attempt 1 with retryable 503, succeeds on attempt 2
            let attemptCount = 0;
            const retryMockAdapter = new MockEmailAdapter("resend", "Resend Retry Adapter");
            const originalExecute = retryMockAdapter.execute.bind(retryMockAdapter);

            retryMockAdapter.execute = async (req) => {
                attemptCount++;
                if (attemptCount === 1) {
                    return {
                        success: false,
                        capability: req.capability,
                        action: req.action,
                        durationMs: 45,
                        failure: {
                            code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
                            message: "503 Service Unavailable on remote gateway",
                            isRetryable: true,
                        },
                    };
                }
                return originalExecute(req);
            };

            clearAdapters();
            registerAdapter(retryMockAdapter);

            // Execute through real executeCapabilityWithRetry with mocked sleepFn for instant backoff
            const sleepSpy = vi.fn().mockResolvedValue(undefined);
            const res = await executeCapabilityWithRetry(
                workspaceId,
                IntegrationCapability.EMAIL_SEND,
                "send_email",
                payload,
                {
                    idempotencyKeyOverride: idempotencyKey,
                    maxAttempts: 3,
                    baseDelayMs: 10,
                    sleepFn: sleepSpy,
                }
            );

            // Verify execution succeeded on retry
            expect(res.success).toBe(true);
            expect(attemptCount).toBe(2);
            expect(sleepSpy).toHaveBeenCalledTimes(1);

            // Verify audit ledger invariant: 2 IntegrationExecution rows sharing the exact same idempotencyKey and correlationId
            const executions = await prisma.integrationExecution.findMany({
                where: {
                    workspaceId,
                    idempotencyKey,
                },
                orderBy: { attemptNumber: "asc" },
            });

            expect(executions.length).toBe(2);
            expect(executions[0].attemptNumber).toBe(1);
            expect(executions[0].status).toBe("FAILED");
            expect(executions[1].attemptNumber).toBe(2);
            expect(executions[1].status).toBe("COMPLETED");
            expect(executions[0].correlationId).toBe(executions[1].correlationId);

            // Restore standard MockEmailAdapter
            clearAdapters();
            registerAdapter(new MockEmailAdapter("resend", "Resend Test Adapter"));
        });
    });

    // =========================================================================
    // 5. Malformed & Adversarial Webhook Payloads
    // =========================================================================
    describe("5. Malformed & Adversarial Webhook Payloads", () => {
        it("(a) missing required fields in payload is handled cleanly without uncaught exceptions", async () => {
            const missingFieldsPayload = JSON.stringify({
                // Missing eventType / type and missing data
                randomField: "unexpected",
                simulateIgnored: true,
            });
            const missingBuf = Buffer.from(missingFieldsPayload, "utf-8");
            const missingSig = crypto.createHmac("sha256", primarySigningSecret).update(missingBuf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": missingSig });

            const result = await processInboundWebhook(endpointSlug, missingBuf, headers);

            // Pipeline parses payload cleanly, adapter ignores unknown event type, halts at Stage 7 with HTTP 200 IGNORED
            expect(result.httpStatus).toBe(200);
            expect(result.outcome).toBe("IGNORED");
        });

        it("(b) wrong data types in payload (number for eventId, string for data) is sanitized and handled cleanly", async () => {
            const wrongTypesPayload = JSON.stringify({
                eventId: 987654, // number instead of string
                type: "email.delivered",
                data: "not-an-object", // string instead of object
            });
            const wrongBuf = Buffer.from(wrongTypesPayload, "utf-8");
            const wrongSig = crypto.createHmac("sha256", primarySigningSecret).update(wrongBuf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": wrongSig });

            const result = await processInboundWebhook(endpointSlug, wrongBuf, headers);

            // Sanitized to string providerEventId "987654" and processed cleanly
            expect(result.httpStatus).toBe(200);
            expect(result.outcome).toBe("SUCCESS");
        });

        it("(c) payload referencing a nonexistent local resource ID fails safely without crashing", async () => {
            // Deliver Stripe billing webhook referencing nonexistent customer / subscription ID
            const nonExistentBillingPayload = {
                id: `evt_bh_nonexist_${runId}`,
                provider: BillingProviderType.STRIPE,
                eventType: "customer.subscription.deleted",
                timestamp: new Date(),
                data: {
                    id: `sub_nonexistent_foreign_id_${runId}`,
                    customer: `cus_nonexistent_foreign_id_${runId}`,
                },
                rawEvent: { id: `evt_bh_nonexist_${runId}` },
            };

            const result = await processBillingWebhookEvent(prisma, nonExistentBillingPayload);

            // Handled cleanly with outcome "IGNORED" and classified message
            expect(result.received).toBe(true);
            expect(result.processed).toBe(false);
            expect(result.outcome).toContain("No matching subscription found");
        });

        it("(d) payload for a suspended or deleted tenant/connection halts cleanly with classified HTTP status", async () => {
            // 1. Connection in SUSPENDED_ENTITLEMENT
            await prisma.integrationConnection.update({
                where: { id: connectionId },
                data: { status: IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT },
            });

            const buf = Buffer.from(JSON.stringify({ eventId: `evt_susp_${runId}`, type: "email.delivered" }), "utf-8");
            const sig = crypto.createHmac("sha256", primarySigningSecret).update(buf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": sig });

            const resultSusp = await processInboundWebhook(endpointSlug, buf, headers);

            expect(resultSusp.stage).toBe(5);
            expect(resultSusp.outcome).toBe("FAILED");
            expect(resultSusp.httpStatus).toBe(402);
            expect(resultSusp.message).toContain("SUSPENDED_ENTITLEMENT");

            // Restore connection
            await prisma.integrationConnection.update({
                where: { id: connectionId },
                data: { status: IntegrationConnectionStatus.CONNECTED },
            });

            // 2. Deleted tenant endpoint slug (Stage 4)
            const resultDeleted = await processInboundWebhook(`deleted-tenant-slug-${runId}`, buf, headers);
            expect(resultDeleted.stage).toBe(4);
            expect(resultDeleted.httpStatus).toBe(404);
        });

        it("(e) handles huge payload bodies (> 1MB) without crashing", async () => {
            const hugeData = "A".repeat(1024 * 1024); // 1 MB payload
            const largePayload = JSON.stringify({
                eventId: `evt_large_${runId}`,
                type: "email.delivered",
                data: { bigString: hugeData },
            });
            const largeBuf = Buffer.from(largePayload, "utf-8");
            const sig = crypto.createHmac("sha256", primarySigningSecret).update(largeBuf).digest("hex");
            const headers = new Headers({ "x-webhook-signature": sig });

            const result = await processInboundWebhook(endpointSlug, largeBuf, headers);

            // Invariant: Pipeline completes cleanly without out-of-memory or uncaught crash
            expect(result.httpStatus).toBe(200);
            expect(result.outcome).toBe("SUCCESS");
        });

        it("(f) fails cleanly with HTTP 410 when endpoint is DISABLED", async () => {
            const disabledSlug = `wh-disabled-${runId}`;
            await prisma.integrationWebhook.create({
                data: {
                    workspaceId,
                    connectionId,
                    endpointSlug: disabledSlug,
                    status: IntegrationWebhookStatus.DISABLED,
                },
            });

            const buf = Buffer.from(JSON.stringify({ eventId: "e1" }), "utf-8");
            const headers = new Headers({});
            const result = await processInboundWebhook(disabledSlug, buf, headers);

            expect(result.stage).toBe(4);
            expect(result.outcome).toBe("FAILED");
            expect(result.httpStatus).toBe(410);
            expect(result.message).toContain("is DISABLED");
        });
    });

    // =========================================================================
    // 6. OAuth2 Token Refresh Race under Concurrent Webhook / API Activity
    // =========================================================================
    describe("6. OAuth2 Token Refresh Race under Concurrent Webhook / API Activity", () => {
        it("deduplicates concurrent refresh requests via in-flight mutex so only 1 refresh HTTP call is executed", async () => {
            let refreshHttpCallCount = 0;

            // Mock global fetch for token refresh endpoint
            const originalFetch = global.fetch;
            global.fetch = vi.fn().mockImplementation(async (url: string) => {
                if (url.includes("oauth/token")) {
                    refreshHttpCallCount++;
                    // Introduce artificial delay to simulate real network roundtrip
                    await new Promise((r) => setTimeout(r, 60));
                    return new Response(
                        JSON.stringify({
                            access_token: `access_token_refreshed_${runId}_${refreshHttpCallCount}`,
                            refresh_token: `refresh_token_refreshed_${runId}_${refreshHttpCallCount}`,
                            expires_in: 3600,
                            token_type: "bearer",
                        }),
                        { status: 200, headers: { "Content-Type": "application/json" } }
                    );
                }
                return originalFetch(url);
            });

            const expiredTokens: OAuth2TokenPayload = {
                accessToken: "old_expired_access_token",
                refreshToken: "valid_single_use_refresh_token_123",
                expiresAt: Date.now() - 10000, // Expired 10s ago
            };

            const sharedOptions = {
                connectionId: `conn_oauth_race_${runId}`,
                tokenEndpoint: "https://auth.provider.com/oauth/token",
                clientId: "client_id_123",
                clientSecret: "client_secret_456",
                currentTokens: expiredTokens,
            };

            // Simulate 2 concurrent callers (1 inbound webhook thread, 1 outbound API call thread)
            const [caller1Result, caller2Result] = await Promise.all([
                refreshOAuth2TokenWithMutex(sharedOptions),
                refreshOAuth2TokenWithMutex(sharedOptions),
            ]);

            global.fetch = originalFetch;

            // Invariant 1: Exactly 1 refresh HTTP network call was executed
            expect(refreshHttpCallCount).toBe(1);

            // Invariant 2: Both concurrent callers received the exact same fresh access token
            expect(caller1Result.accessToken).toBe(caller2Result.accessToken);
            expect(caller1Result.accessToken).toContain(`access_token_refreshed_${runId}_1`);
        });
    });
});
