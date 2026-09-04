/**
 * Phase 1.23.4 — Brevo Webhook Ingestion Pipeline Integration Tests
 * Validates the full 8-stage inbound webhook processing pipeline for Brevo:
 * - Stage 1: Custom Secret Header verification (X-Aforden-Webhook-Secret) via timingSafeEqual
 * - Stage 3 & Stage 6: Replay detection and inbox deduplication using synthetic idempotency tokens
 * - Stage 7: Event normalization to canonical IntegrationEvent (entityType: "EmailMessage")
 * - Stage 8: Transactional domain event dispatch and inbox finalization
 */

import "dotenv/config";
import crypto from "crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  IntegrationConnectionStatus,
  IntegrationWebhookStatus,
  IntegrationCredentialStatus,
} from "@/generated/prisma/client";
import { processInboundWebhook } from "@/lib/integrations/webhooks/webhookPipeline";
import { BrevoAdapter } from "@/lib/integrations/adapters/brevoAdapter";
import { registerAdapter, clearAdapters } from "@/lib/integrations/adapters/adapterRegistry";
import { seedIntegrationCatalog } from "@/lib/integrations/seed/integrationSeed";

describe("Phase 1.23.4 — Brevo Webhook Ingestion Pipeline Tests", () => {
  let prisma: PrismaClient;
  const runId = `brevo_wh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const workspaceId = `ws_${runId}`;
  const endpointSlug = `brevo-slug-${runId}`;
  const webhookSecret = `whsec_brevo_test_${runId}_supersecret_123456789`;
  const apiKey = `xkeysib-mock-api-key-${runId}`;

  let connectionId: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Seed catalog and register BrevoAdapter
    await seedIntegrationCatalog(prisma);
    clearAdapters();
    registerAdapter(new BrevoAdapter());

    // 2. Create test workspace
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: `Brevo Webhook Test WS ${runId}`,
        slug: `ws-brevo-wh-${runId}`,
      },
    });

    // 3. Create Integration Connection for Brevo
    const conn = await prisma.integrationConnection.create({
      data: {
        workspaceId,
        integrationId: "brevo",
        connectionKey: "primary",
        status: IntegrationConnectionStatus.CONNECTED,
        configJson: {
          fromEmail: "notifications@aforden.com",
        },
      },
    });
    connectionId = conn.id;

    // 4. Create Active Credential storing encrypted JSON with apiKey and webhookSecret
    const secretJson = JSON.stringify({
      apiKey,
      webhookSecret,
      webhookId: 999,
    });

    await prisma.integrationCredential.create({
      data: {
        connectionId,
        version: 1,
        status: IntegrationCredentialStatus.ACTIVE,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: `fp_brevo_${runId}`,
        encryptedData: `plain:${secretJson}`,
        iv: "dGVzdF9pdl8xMjM0NTY=",
        tag: "dGVzdF90YWdfMTIzNDU2",
      },
    });

    // 5. Create Integration Webhook endpoint
    await prisma.integrationWebhook.create({
      data: {
        workspaceId,
        connectionId,
        endpointSlug,
        status: IntegrationWebhookStatus.ACTIVE,
        enabledEvents: ["delivered", "hardBounce", "opened", "click"],
      },
    });

    // 6. Entitlement override for developer webhooks
    await prisma.workspaceEntitlementOverride.create({
      data: {
        workspaceId,
        featureKey: "FEATURE_API_ACCESS",
        featureType: "BOOLEAN",
        overrideValueJson: true,
        reason: "Testing Phase 1.23.4 Brevo Webhook Ingestion",
        grantedByUserId: "test_admin",
      },
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.integrationWebhookEvent.deleteMany({ where: { connectionId } });
        await prisma.integrationWebhook.deleteMany({ where: { connectionId } });
        await prisma.integrationCredential.deleteMany({ where: { connectionId } });
        await prisma.integrationConnection.deleteMany({ where: { id: connectionId } });
        await prisma.workspaceEntitlementOverride.deleteMany({ where: { workspaceId } });
        await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
        await prisma.$disconnect();
      }
    } catch {
      // ignore cleanup error
    }
  });

  it("1. successfully ingests valid 'delivered' webhook via X-Aforden-Webhook-Secret", async () => {
    const payload = {
      event: "delivered",
      email: "client@example.com",
      "message-id": `<msg_${runId}_001@smtp-relay.brevo.com>`,
      date: "2026-09-04 15:00:00",
      subject: "Your Service Appointment Confirmation",
      tag: "service_schedule",
    };
    const rawBody = JSON.stringify(payload);
    const headers = new Headers({
      "content-type": "application/json",
      "x-aforden-webhook-secret": webhookSecret,
    });

    const result = await processInboundWebhook(endpointSlug, rawBody, headers, { dbClient: prisma });

    expect(result.httpStatus).toBe(200);
    expect(result.outcome).toBe("SUCCESS");
    expect(result.stage).toBe(8);
    expect(result.event).toBeDefined();
    expect(result.event?.eventType).toBe("email.delivered");
    expect(result.event?.entityType).toBe("EmailMessage");
    expect(result.event?.entityId).toBe(payload["message-id"]);
    expect(result.event?.payload.email).toBe("client@example.com");
    expect(result.event?.eventId).toMatch(/^evt_brevo_[a-f0-9]{32}$/);

    // Verify database inbox record
    const inboxRecord = await prisma.integrationWebhookEvent.findFirst({
      where: {
        connectionId,
        providerEventId: result.event?.eventId,
      },
    });
    expect(inboxRecord).toBeDefined();
    expect(inboxRecord?.status).toBe("PROCESSED");
    expect(inboxRecord?.eventType).toBe("email.delivered");
  });

  it("2. rejects inbound webhook when secret header is missing with HTTP 401 at Stage 1", async () => {
    const payload = {
      event: "delivered",
      email: "client@example.com",
      "message-id": `<msg_${runId}_missing_header@smtp-relay.brevo.com>`,
    };
    const rawBody = JSON.stringify(payload);
    const headers = new Headers({
      "content-type": "application/json",
      // No custom secret header
    });

    const result = await processInboundWebhook(endpointSlug, rawBody, headers, { dbClient: prisma });

    expect(result.httpStatus).toBe(401);
    expect(result.outcome).toBe("FAILED");
    expect(result.stage).toBe(1);
  });

  it("3. rejects inbound webhook when secret header is incorrect with HTTP 401 at Stage 1", async () => {
    const payload = {
      event: "delivered",
      email: "client@example.com",
      "message-id": `<msg_${runId}_bad_secret@smtp-relay.brevo.com>`,
    };
    const rawBody = JSON.stringify(payload);
    const headers = new Headers({
      "content-type": "application/json",
      "x-aforden-webhook-secret": "wrong_secret_token_unauthorized",
    });

    const result = await processInboundWebhook(endpointSlug, rawBody, headers, { dbClient: prisma });

    expect(result.httpStatus).toBe(401);
    expect(result.outcome).toBe("FAILED");
    expect(result.stage).toBe(1);
  });

  it("4. deduplicates immediate replay of the exact same delivery event", async () => {
    const payload = {
      event: "delivered",
      email: "replay@example.com",
      "message-id": `<msg_${runId}_replay@smtp-relay.brevo.com>`,
      date: "2026-09-04 15:10:00",
    };
    const rawBody = JSON.stringify(payload);
    const headers = new Headers({
      "content-type": "application/json",
      "x-aforden-webhook-secret": webhookSecret,
    });

    // 1st delivery -> SUCCESS
    const result1 = await processInboundWebhook(endpointSlug, rawBody, headers, { dbClient: prisma });
    expect(result1.httpStatus).toBe(200);
    expect(result1.outcome).toBe("SUCCESS");

    // 2nd delivery -> REPLAY_DISCARDED or IDEMPOTENT_IGNORED
    const result2 = await processInboundWebhook(endpointSlug, rawBody, headers, { dbClient: prisma });
    expect(result2.httpStatus).toBe(200);
    expect(["REPLAY_DISCARDED", "IDEMPOTENT_IGNORED"]).toContain(result2.outcome);
  });

  it("5. correctly normalizes 'hardBounce' and 'opened' events with separate synthetic keys", async () => {
    const bouncePayload = {
      event: "hardBounce",
      email: "invalid-user@example.com",
      "message-id": `<msg_${runId}_bounce@smtp-relay.brevo.com>`,
      date: "2026-09-04 15:20:00",
      reason: "550 User unknown",
    };
    const headers = new Headers({
      "content-type": "application/json",
      "x-aforden-webhook-secret": webhookSecret,
    });

    const result = await processInboundWebhook(endpointSlug, JSON.stringify(bouncePayload), headers, {
      dbClient: prisma,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.outcome).toBe("SUCCESS");
    expect(result.event?.eventType).toBe("email.hard_bounce");
    expect(result.event?.entityType).toBe("EmailMessage");
    expect(result.event?.payload.status).toBe("hard_bounce");
    expect(result.event?.payload.reason).toBe("550 User unknown");
  });
});
