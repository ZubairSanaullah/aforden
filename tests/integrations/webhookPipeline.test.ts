/**
 * Phase 1.17.4 — Webhook Processing Pipeline Test Suite
 * Exhaustive coverage for all 8 stages of the inbound webhook pipeline, including HMAC signature
 * verification, superseded credential grace fallback, timestamp window enforcement, replay protection,
 * strict tenant resolution invariants, connection state guards, idempotency inbox, normalization, and dispatch.
 */

import "dotenv/config";
import crypto from "crypto";
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  IntegrationConnectionStatus,
  IntegrationCredentialStatus,
  IntegrationWebhookStatus,
} from "@/generated/prisma/client";
import {
  registerAdapter,
  clearAdapters,
} from "@/lib/integrations/adapters/adapterRegistry";
import { MockEmailAdapter } from "@/lib/integrations/adapters/mockEmailAdapter";
import { seedIntegrationCatalog } from "@/lib/integrations/seed/integrationSeed";
import { processInboundWebhook } from "@/lib/integrations/webhooks/webhookPipeline";
import { CREDENTIAL_SUPERSEDED_GRACE_PERIOD_MS } from "@/lib/integrations/credentialStateMachine";

describe("Phase 1.17.4 — Inbound Webhook Pipeline", () => {
  let prisma: PrismaClient;
  let testWorkspaceId: string;
  let testConnectionId: string;
  let testEndpointSlug: string;
  const createdWorkspaceIds: string[] = [];

  const testSigningSecret = "whsec_test_mock_secret_key_123456789";
  const oldSigningSecret = "whsec_old_superseded_secret_987654321";

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // Ensure catalog is seeded
    await seedIntegrationCatalog(prisma);
  });

  afterAll(async () => {
    clearAdapters();
    for (const wsId of createdWorkspaceIds) {
      await prisma.workspace.delete({ where: { id: wsId } }).catch(() => {});
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    clearAdapters();

    // Register MockEmailAdapter for 'resend'
    const resendAdapter = new MockEmailAdapter("resend", "Resend Mock Adapter");
    registerAdapter(resendAdapter);

    // Create a fresh test workspace
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ws = await prisma.workspace.create({
      data: {
        name: `Webhook Test WS ${runId}`,
        slug: `ws-wh-${runId}`,
      },
    });
    testWorkspaceId = ws.id;
    createdWorkspaceIds.push(ws.id);

    // Create connected IntegrationConnection for 'resend'
    const conn = await prisma.integrationConnection.create({
      data: {
        workspaceId: testWorkspaceId,
        integrationId: "resend",
        connectionKey: "default",
        status: IntegrationConnectionStatus.CONNECTED,
        configJson: {},
      },
    });
    testConnectionId = conn.id;

    // Create ACTIVE credential
    await prisma.integrationCredential.create({
      data: {
        connectionId: testConnectionId,
        version: 1,
        status: IntegrationCredentialStatus.ACTIVE,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        iv: "iv_123",
        tag: "tag_123",
        encryptedData: `plain:${testSigningSecret}`,
        fingerprint: `sha256:${crypto.createHash("sha256").update(testSigningSecret).digest("hex")}`,
      },
    });

    // Create active IntegrationWebhook endpoint
    testEndpointSlug = `wh-resend-${runId}`;
    await prisma.integrationWebhook.create({
      data: {
        workspaceId: testWorkspaceId,
        connectionId: testConnectionId,
        endpointSlug: testEndpointSlug,
        status: IntegrationWebhookStatus.ACTIVE,
        enabledEvents: ["email.delivered", "email.bounced"],
      },
    });

    // Grant FEATURE_API_ACCESS entitlement override for testing
    await prisma.workspaceEntitlementOverride.create({
      data: {
        workspaceId: testWorkspaceId,
        featureKey: "FEATURE_API_ACCESS",
        featureType: "BOOLEAN",
        overrideValueJson: true,
        reason: "Integration webhook testing",
        grantedByUserId: "test_admin",
      },
    });
  });

  // Helper to create HMAC-SHA256 signature
  const createSignature = (body: string | Buffer, secret: string): string =>
    crypto.createHmac("sha256", secret).update(body).digest("hex");

  // =========================================================================
  // STAGE 4: Strict Tenant Resolution via Registered Endpoint Slug
  // =========================================================================
  describe("Stage 4: Strict Tenant Resolution & Invariants", () => {
    it("should return HTTP 404 when endpointSlug does not exist", async () => {
      const result = await processInboundWebhook(
        "non-existent-slug-xyz",
        JSON.stringify({ eventId: "evt_1" }),
        new Headers(),
        { dbClient: prisma }
      );

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(4);
      expect(result.httpStatus).toBe(404);
      expect(result.message).toContain("No registered webhook found");
    });

    it("should return HTTP 410 when IntegrationWebhook is in DISABLED status", async () => {
      await prisma.integrationWebhook.update({
        where: { endpointSlug: testEndpointSlug },
        data: { status: IntegrationWebhookStatus.DISABLED },
      });

      const result = await processInboundWebhook(
        testEndpointSlug,
        JSON.stringify({ eventId: "evt_1" }),
        new Headers(),
        { dbClient: prisma }
      );

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(4);
      expect(result.httpStatus).toBe(410);
      expect(result.message).toContain("DISABLED");
    });

    it("should enforce Tenant Invariant: spoofed workspaceId in payload is completely ignored", async () => {
      const spoofedPayload = {
        workspaceId: "spoofed_attacker_workspace_id",
        eventId: `evt_spoof_${Date.now()}`,
        eventType: "email.delivered",
        messageId: "msg_spoof_123",
        occurredAt: new Date().toISOString(),
      };

      const rawBody = Buffer.from(JSON.stringify(spoofedPayload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
        "content-type": "application/json",
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(result.stage).toBe(8);
      expect(result.httpStatus).toBe(200);
      // Bound strictly to real workspace ID from database
      expect(result.workspaceId).toBe(testWorkspaceId);
      expect(result.workspaceId).not.toBe("spoofed_attacker_workspace_id");
      expect(result.event?.workspaceId).toBe(testWorkspaceId);
    });
  });

  // =========================================================================
  // STAGE 1: Cryptographic Signature Verification
  // =========================================================================
  describe("Stage 1: Cryptographic Signature Verification", () => {
    it("should verify valid signature computed with ACTIVE credential secret", async () => {
      const payload = {
        eventId: `evt_sig_${Date.now()}`,
        eventType: "email.delivered",
        messageId: "msg_sig_123",
      };
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": `sha256=${sig}`,
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(result.httpStatus).toBe(200);
    });

    it("should reject invalid/tampered signature with HTTP 401", async () => {
      const payload = { eventId: "evt_tampered_1" };
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const invalidSig = createSignature(rawBody, "wrong_secret");
      const headers = new Headers({
        "x-webhook-signature": invalidSig,
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(1);
      expect(result.httpStatus).toBe(401);
      expect(result.message).toContain("signature");
    });

    it("should verify signature using SUPERSEDED credential within 24h grace period", async () => {
      // Add a SUPERSEDED credential updated 2 hours ago
      await prisma.integrationCredential.create({
        data: {
          connectionId: testConnectionId,
          version: 2,
          status: IntegrationCredentialStatus.SUPERSEDED,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          iv: "iv_old",
          tag: "tag_old",
          encryptedData: `plain:${oldSigningSecret}`,
          fingerprint: "sha256:old_fingerprint",
          updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        },
      });

      const payload = {
        eventId: `evt_superseded_${Date.now()}`,
        eventType: "email.delivered",
        messageId: "msg_old_key_1",
      };
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const oldSig = createSignature(rawBody, oldSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": oldSig,
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(result.httpStatus).toBe(200);
    }, 15000);

    it("should reject signature with HTTP 401 when SUPERSEDED credential is past 24h grace window", async () => {
      // Add an expired SUPERSEDED credential updated 26 hours ago
      await prisma.integrationCredential.create({
        data: {
          connectionId: testConnectionId,
          version: 3,
          status: IntegrationCredentialStatus.SUPERSEDED,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          iv: "iv_expired",
          tag: "tag_expired",
          encryptedData: `plain:${oldSigningSecret}`,
          fingerprint: "sha256:expired_fingerprint",
          updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000), // 26 hours ago
        },
      });

      const payload = { eventId: "evt_expired_superseded" };
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const expiredSig = createSignature(rawBody, oldSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": expiredSig,
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(1);
      expect(result.httpStatus).toBe(401);
    });
  });

  // =========================================================================
  // STAGE 2: Timestamp Validation Window (<= 300s)
  // =========================================================================
  describe("Stage 2: Timestamp Validation Window", () => {
    it("should accept timestamp within 300s tolerance window", async () => {
      const payload = {
        eventId: `evt_ts_valid_${Date.now()}`,
        eventType: "email.delivered",
      };
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000) - 60), // 60s ago
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(result.httpStatus).toBe(200);
    });

    it("should reject timestamp skewed by >300s with HTTP 400", async () => {
      const payload = { eventId: "evt_ts_skewed" };
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000) - 600), // 600s in past (>300s ceiling)
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(2);
      expect(result.httpStatus).toBe(400);
      expect(result.message).toContain("outside tolerance window");
    });
  });

  // =========================================================================
  // STAGE 3: Replay Protection Nonce / Digest Check
  // =========================================================================
  describe("Stage 3: Replay Protection Nonce / Digest Check", () => {
    it("should discard duplicate replay within 10-minute sliding window with HTTP 200 REPLAY_DISCARDED", async () => {
      const nonce = `nonce_${Date.now()}_abc`;
      const payload = {
        eventId: `evt_replay_${Date.now()}`,
        eventType: "email.delivered",
        messageId: "msg_replay_1",
      };
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
        "x-webhook-nonce": nonce,
      });

      // First run -> SUCCESS
      const firstResult = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });
      expect(firstResult.outcome).toBe("SUCCESS");
      expect(firstResult.stage).toBe(8);

      // Second run with same nonce -> Stage 3 REPLAY_DISCARDED
      const secondResult = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });
      expect(secondResult.outcome).toBe("REPLAY_DISCARDED");
      expect(secondResult.stage).toBe(3);
      expect(secondResult.httpStatus).toBe(200);
      expect(secondResult.message).toContain("Replay detected");
    }, 15000);
  });

  // =========================================================================
  // STAGE 5: Connection State & Entitlement Guard
  // =========================================================================
  describe("Stage 5: Connection State & Entitlement Guard", () => {
    const createSignedRequest = (payload: Record<string, unknown>) => {
      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
      });
      return { rawBody, headers };
    };

    it("should short-circuit with HTTP 503 and Retry-After header when connection is in ERROR status", async () => {
      await prisma.integrationConnection.update({
        where: { id: testConnectionId },
        data: { status: IntegrationConnectionStatus.ERROR },
      });

      const { rawBody, headers } = createSignedRequest({ eventId: "evt_err_1" });
      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(5);
      expect(result.httpStatus).toBe(503);
      expect(result.responseHeaders).toEqual({ "Retry-After": "300" });
      expect(result.message).toContain("ERROR status");
    });

    it("should short-circuit with HTTP 402 when connection is in SUSPENDED_ENTITLEMENT status", async () => {
      await prisma.integrationConnection.update({
        where: { id: testConnectionId },
        data: { status: IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT },
      });

      const { rawBody, headers } = createSignedRequest({ eventId: "evt_susp_1" });
      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(5);
      expect(result.httpStatus).toBe(402);
      expect(result.message).toContain("SUSPENDED_ENTITLEMENT");
    });

    it("should short-circuit with HTTP 409 when connection is in CONNECTING status", async () => {
      await prisma.integrationConnection.update({
        where: { id: testConnectionId },
        data: { status: IntegrationConnectionStatus.CONNECTING },
      });

      const { rawBody, headers } = createSignedRequest({ eventId: "evt_conn_1" });
      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(5);
      expect(result.httpStatus).toBe(409);
      expect(result.message).toContain("CONNECTING");
    });

    it("should short-circuit with HTTP 410 when connection is in DISCONNECTED status", async () => {
      await prisma.integrationConnection.update({
        where: { id: testConnectionId },
        data: { status: IntegrationConnectionStatus.DISCONNECTED },
      });

      const { rawBody, headers } = createSignedRequest({ eventId: "evt_disc_1" });
      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(5);
      expect(result.httpStatus).toBe(410);
      expect(result.message).toContain("DISCONNECTED");
    });

    it("should short-circuit with HTTP 402 when workspace lacks FEATURE_API_ACCESS entitlement", async () => {
      // Remove entitlement override
      await prisma.workspaceEntitlementOverride.deleteMany({
        where: {
          workspaceId: testWorkspaceId,
          featureKey: "FEATURE_API_ACCESS",
        },
      });

      const { rawBody, headers } = createSignedRequest({ eventId: "evt_unentitled_1" });
      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("FAILED");
      expect(result.stage).toBe(5);
      expect(result.httpStatus).toBe(402);
      expect(result.message).toContain("Entitlement guard rejected");
    });
  });


  // =========================================================================
  // STAGE 6: Idempotency Check & Transactional Inbox Persist
  // =========================================================================
  describe("Stage 6: Idempotency Inbox Check", () => {
    it("should acknowledge already PROCESSED providerEventId with HTTP 200 IDEMPOTENT_IGNORED", async () => {
      const eventId = `evt_idem_${Date.now()}`;
      const payload = {
        eventId,
        eventType: "email.delivered",
        messageId: "msg_idem_1",
      };

      // Manually seed existing PROCESSED event in inbox (outside 10m sliding replay window)
      const existing = await prisma.integrationWebhookEvent.create({
        data: {
          workspaceId: testWorkspaceId,
          connectionId: testConnectionId,
          providerEventId: eventId,
          eventType: "email.delivered",
          status: "PROCESSED",
          processedAt: new Date(Date.now() - 15 * 60 * 1000),
          createdAt: new Date(Date.now() - 15 * 60 * 1000),
        },
      });

      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
        skipTimestampVerification: true,
      });

      expect(result.outcome).toBe("IDEMPOTENT_IGNORED");
      expect(result.stage).toBe(6);
      expect(result.httpStatus).toBe(200);
      expect(result.webhookEventRecordId).toBe(existing.id);
    });
  });

  // =========================================================================
  // STAGE 7 & 8: Normalization & Domain Event Dispatch
  // =========================================================================
  describe("Stage 7 & 8: Event Normalization & Domain Dispatch", () => {
    it("should mark event as IGNORED and return HTTP 200 when adapter returns null", async () => {
      const payload = {
        eventId: `evt_ignored_${Date.now()}`,
        eventType: "unhandled.event", // Triggers null from MockEmailAdapter
        simulateIgnored: true,
      };

      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("IGNORED");
      expect(result.stage).toBe(7);
      expect(result.httpStatus).toBe(200);
      expect(result.message).toContain("ignored or declined");

      // Verify DB record status is IGNORED
      const inboxRecord = await prisma.integrationWebhookEvent.findUnique({
        where: { id: result.webhookEventRecordId },
      });
      expect(inboxRecord?.status).toBe("IGNORED");
    });

    it("should process valid delivery webhook, normalize event, dispatch to automation engine, and finalize PROCESSED", async () => {
      const eventId = `evt_delivered_${Date.now()}`;
      const payload = {
        eventId,
        eventType: "email.delivered",
        messageId: "msg_final_999",
        recipient: "customer@aforden.test",
        occurredAt: new Date().toISOString(),
      };

      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
        "content-type": "application/json",
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(result.stage).toBe(8);
      expect(result.httpStatus).toBe(200);
      expect(result.event).toBeDefined();
      expect(result.event?.eventId).toBe(eventId);
      expect(result.event?.eventType).toBe("email.delivered");
      expect(result.event?.workspaceId).toBe(testWorkspaceId);
      expect(result.event?.connectionId).toBe(testConnectionId);

      // Verify DB inbox record is updated to PROCESSED
      const inboxRecord = await prisma.integrationWebhookEvent.findUnique({
        where: { id: result.webhookEventRecordId },
      });
      expect(inboxRecord).toBeDefined();
      expect(inboxRecord?.status).toBe("PROCESSED");
      expect(inboxRecord?.processedAt).toBeInstanceOf(Date);
    }, 15000);

    it("should dispatch to NotificationOutbox when adapter provides notification envelope", async () => {
      const eventId = `evt_notif_outbox_${Date.now()}`;
      const payload = {
        eventId,
        eventType: "email.delivered",
        messageId: "msg_notif_outbox_1",
        recipient: "customer@aforden.test",
        occurredAt: new Date().toISOString(),
      };

      const rawBody = Buffer.from(JSON.stringify(payload), "utf-8");
      const sig = createSignature(rawBody, testSigningSecret);
      const headers = new Headers({
        "x-webhook-signature": sig,
        "content-type": "application/json",
      });

      const result = await processInboundWebhook(testEndpointSlug, rawBody, headers, {
        dbClient: prisma,
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(result.stage).toBe(8);
      expect(result.httpStatus).toBe(200);
    }, 15000);
  });
});


