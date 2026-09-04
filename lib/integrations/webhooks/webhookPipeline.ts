/**
 * Phase 1.17.4 — Inbound Webhook Processing Pipeline
 * Implements the full 8-stage inbound webhook pipeline locked in Phase 1.17.1 §5:
 *
 * 1. Cryptographic Signature Verification (HMAC-SHA256 with SUPERSEDED grace fallback)
 * 2. Timestamp Validation Window (|now - timestamp| <= 300s)
 * 3. Replay Protection Nonce / Digest Check
 * 4. Strict Tenant Resolution via Registered Endpoint Slug (DB-bound workspaceId)
 * 5. Connection State & Entitlement Guard (409/402/423/410/404/503 mapping)
 * 6. Idempotency Check & Transactional Inbox Persist (IntegrationWebhookEvent)
 * 7. Event Normalization (Adapter Delegation)
 * 8. Domain Event Dispatch (Phase 1.16 Automation Trigger Ingestion Engine)
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  Prisma,
  IntegrationConnectionStatus,
  IntegrationWebhookStatus,
  IntegrationCredentialStatus,
} from "@/generated/prisma/client";
import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
import {
  PlanFeatureNotEnabledError,
  QuotaExceededError,
} from "@/lib/services/billing/billingErrors";
import { ingestAutomationEvent } from "@/lib/services/automation/eventIngestionService";
import { emitNotificationEvent } from "@/lib/services/notification/eventIngestionService";
import type { EmitNotificationEventInput } from "@/lib/services/notification/notification.types";
import { getAdapterForConnection } from "../adapters/adapterResolution";
import { CREDENTIAL_SUPERSEDED_GRACE_PERIOD_MS } from "../credentialStateMachine";
import {
  verifyWebhookSignature,
  extractSignatureAndTimestamp,
  resolveCredentialSecret,
} from "./signatureVerification";
import type {
  WebhookProcessingResult,
  WebhookPipelineOptions,
  DbClient,
} from "./types";
import type { IntegrationSecretReference } from "../adapters/types";

/**
 * Main entry point for inbound webhook processing.
 * Callable service function designed for Next.js route handlers in Phase 1.17.9.
 */
export async function processInboundWebhook(
  endpointSlug: string,
  rawBody: Buffer | string,
  headers: Headers,
  options: WebhookPipelineOptions = {}
): Promise<WebhookProcessingResult> {
  const db: DbClient = options.dbClient || prisma;
  const now = options.now || new Date();

  // Normalize rawBody to Buffer to preserve exact byte sequence for HMAC verification
  const bufferBody = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === "string" ? rawBody : "", "utf-8");

  // =========================================================================
  // STAGE 4: Strict Tenant Resolution via Registered Endpoint Slug
  // =========================================================================
  if (!endpointSlug || endpointSlug.trim().length === 0) {
    return {
      outcome: "FAILED",
      stage: 4,
      httpStatus: 404,
      message: "Missing or invalid endpointSlug parameter.",
      endpointSlug: endpointSlug || "",
    };
  }

  const webhook = await db.integrationWebhook.findUnique({
    where: { endpointSlug },
    include: {
      connection: {
        include: {
          credentials: true,
        },
      },
    },
  });

  if (!webhook) {
    return {
      outcome: "FAILED",
      stage: 4,
      httpStatus: 404,
      message: `No registered webhook found for endpointSlug '${endpointSlug}'.`,
      endpointSlug,
    };
  }

  if (webhook.status === IntegrationWebhookStatus.DISABLED) {
    return {
      outcome: "FAILED",
      stage: 4,
      httpStatus: 410,
      message: `Webhook endpoint '${endpointSlug}' is DISABLED.`,
      endpointSlug,
      workspaceId: webhook.workspaceId,
      connectionId: webhook.connectionId,
    };
  }

  const connection = webhook.connection;
  if (!connection) {
    return {
      outcome: "FAILED",
      stage: 4,
      httpStatus: 404,
      message: `Parent integration connection '${webhook.connectionId}' not found.`,
      endpointSlug,
      workspaceId: webhook.workspaceId,
      connectionId: webhook.connectionId,
    };
  }

  // STRICT INVARIANT: workspaceId is ALWAYS bound from DB record, NEVER from payload
  const workspaceId = webhook.workspaceId;
  const connectionId = connection.id;

  // =========================================================================
  // STAGE 1: Cryptographic Signature Verification
  // =========================================================================
  let extractedTimestamp: number | undefined;

  if (!options.skipSignatureVerification) {
    const sigResult = await verifyWebhookSignature(
      bufferBody,
      headers,
      connection.credentials || [],
      {
        gracePeriodMs: CREDENTIAL_SUPERSEDED_GRACE_PERIOD_MS,
        now,
        customSecretResolver: options.customSecretResolver,
      }
    );

    extractedTimestamp = sigResult.extractedTimestamp;

    if (!sigResult.valid) {
      return {
        outcome: "FAILED",
        stage: 1,
        httpStatus: 401,
        message: sigResult.reason || "Cryptographic webhook signature verification failed.",
        endpointSlug,
        workspaceId,
        connectionId,
      };
    }
  } else {
    // If skipping signature, still attempt to extract timestamp for Stage 2
    const extracted = extractSignatureAndTimestamp(headers);
    extractedTimestamp = extracted.timestamp;
  }

  // =========================================================================
  // STAGE 2: Timestamp Validation Window (<= 300s)
  // =========================================================================
  if (!options.skipTimestampVerification && typeof extractedTimestamp === "number") {
    const diffSeconds = Math.abs(now.getTime() - extractedTimestamp) / 1000;
    if (diffSeconds > 300) {
      return {
        outcome: "FAILED",
        stage: 2,
        httpStatus: 400,
        message: `Webhook timestamp outside tolerance window: delta of ${Math.round(diffSeconds)}s exceeds 300s ceiling.`,
        endpointSlug,
        workspaceId,
        connectionId,
        diagnostics: {
          extractedTimestamp,
          currentTimestamp: now.getTime(),
          diffSeconds,
        },
      };
    }
  }

  // =========================================================================
  // STAGE 3: Replay Protection Nonce / Digest Check
  // =========================================================================
  const nonceHeader =
    headers.get("x-webhook-nonce") ||
    headers.get("x-webhook-id") ||
    headers.get("x-delivery-id") ||
    headers.get("x-request-id");

  const payloadDigest = crypto
    .createHash("sha256")
    .update(bufferBody)
    .digest("hex");

  const candidateReplayKeys = [
    nonceHeader,
    `digest:${payloadDigest}`,
  ].filter(Boolean) as string[];

  // Also extract eventId from body preview for replay detection
  try {
    const preview = JSON.parse(bufferBody.toString("utf-8"));
    if (preview && typeof preview === "object") {
      const pEventId = preview.eventId || preview.id || preview.event_id;
      if (typeof pEventId === "string" && pEventId.trim().length > 0) {
        candidateReplayKeys.push(pEventId.trim());
      }
      // Synthetic event ID for Brevo transactional webhooks (message-id + event + date + link + reason)
      if (preview.event && (preview["message-id"] || preview.messageId)) {
        const msgId = preview["message-id"] || preview.messageId;
        const dt = preview.date || preview.ts_event || preview.ts || "";
        const link = typeof preview.link === "string" ? preview.link : "";
        const reason = typeof preview.reason === "string" ? preview.reason : "";
        const hash = crypto
          .createHash("sha256")
          .update(`${msgId}:${preview.event}:${dt}:${link}:${reason}`)
          .digest("hex")
          .slice(0, 32);
        candidateReplayKeys.push(`evt_brevo_${hash}`);
      }
    }
  } catch {
    // Ignore JSON parse error at preview stage
  }

  // Check 10-minute sliding window in IntegrationWebhookEvent inbox
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const replayMatch = await db.integrationWebhookEvent.findFirst({
    where: {
      connectionId,
      providerEventId: { in: candidateReplayKeys },
      status: "PROCESSED",
      createdAt: { gte: tenMinutesAgo },
    },
  });

  if (replayMatch) {
    return {
      outcome: "REPLAY_DISCARDED",
      stage: 3,
      httpStatus: 200,
      message: `Replay detected: delivery '${replayMatch.providerEventId}' already processed within 10-minute sliding window.`,
      endpointSlug,
      workspaceId,
      connectionId,
      webhookEventRecordId: replayMatch.id,
    };
  }

  // =========================================================================
  // STAGE 5: Connection State & Entitlement Guard
  // =========================================================================
  switch (connection.status) {
    case IntegrationConnectionStatus.ERROR:
      return {
        outcome: "FAILED",
        stage: 5,
        httpStatus: 503,
        responseHeaders: { "Retry-After": "300" },
        message: "Integration connection is in ERROR status; webhook processing is temporarily paused.",
        endpointSlug,
        workspaceId,
        connectionId,
      };

    case IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT:
      return {
        outcome: "FAILED",
        stage: 5,
        httpStatus: 402,
        message: "Integration connection is in SUSPENDED_ENTITLEMENT status; webhook processing is blocked.",
        endpointSlug,
        workspaceId,
        connectionId,
      };

    case IntegrationConnectionStatus.CONNECTING:
      return {
        outcome: "FAILED",
        stage: 5,
        httpStatus: 409,
        message: "Integration connection is still CONNECTING; handshake is incomplete.",
        endpointSlug,
        workspaceId,
        connectionId,
      };

    case IntegrationConnectionStatus.DISCONNECTED:
      return {
        outcome: "FAILED",
        stage: 5,
        httpStatus: 410,
        message: "Integration connection is DISCONNECTED.",
        endpointSlug,
        workspaceId,
        connectionId,
      };

    case IntegrationConnectionStatus.CONNECTED:
      // Proceed to entitlement verification
      break;

    default:
      return {
        outcome: "FAILED",
        stage: 5,
        httpStatus: 500,
        message: `Unknown connection status '${connection.status}'.`,
        endpointSlug,
        workspaceId,
        connectionId,
      };
  }

  // Entitlement Resolver Check (FEATURE_API_ACCESS for developer webhooks)
  try {
    await assertEntitlement(db, workspaceId, "FEATURE_API_ACCESS");
  } catch (entError) {
    if (
      entError instanceof PlanFeatureNotEnabledError ||
      entError instanceof QuotaExceededError
    ) {
      return {
        outcome: "FAILED",
        stage: 5,
        httpStatus: 402,
        message: `Entitlement guard rejected webhook: ${(entError as Error).message}`,
        endpointSlug,
        workspaceId,
        connectionId,
      };
    }
    throw entError;
  }

  // =========================================================================
  // STAGE 6: Idempotency Check & Transactional Inbox Persist
  // =========================================================================
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(bufferBody.toString("utf-8"));
  } catch {
    return {
      outcome: "FAILED",
      stage: 6,
      httpStatus: 400,
      message: "Malformed JSON payload body.",
      endpointSlug,
      workspaceId,
      connectionId,
    };
  }

  const brevoSyntheticEventId =
    parsedPayload.event && (parsedPayload["message-id"] || parsedPayload.messageId)
      ? `evt_brevo_${crypto
          .createHash("sha256")
          .update(
            `${parsedPayload["message-id"] || parsedPayload.messageId}:${parsedPayload.event}:${
              parsedPayload.date || parsedPayload.ts_event || parsedPayload.ts || ""
            }:${typeof parsedPayload.link === "string" ? parsedPayload.link : ""}:${
              typeof parsedPayload.reason === "string" ? parsedPayload.reason : ""
            }`
          )
          .digest("hex")
          .slice(0, 32)}`
      : undefined;

  const rawProviderEventId =
    (parsedPayload.eventId as string) ||
    (parsedPayload.event_id as string) ||
    brevoSyntheticEventId ||
    (typeof parsedPayload.id === "string" ? parsedPayload.id : undefined) ||
    candidateReplayKeys[0] ||
    `digest:${payloadDigest}`;

  const providerEventId = String(rawProviderEventId).slice(0, 255);

  // Check if event has already completed processing
  const existingInboxEvent = await db.integrationWebhookEvent.findUnique({
    where: {
      connectionId_providerEventId: {
        connectionId,
        providerEventId,
      },
    },
  });

  if (existingInboxEvent && existingInboxEvent.status === "PROCESSED") {
    return {
      outcome: "IDEMPOTENT_IGNORED",
      stage: 6,
      httpStatus: 200,
      message: `Event '${providerEventId}' was already PROCESSED for connection '${connectionId}'.`,
      endpointSlug,
      workspaceId,
      connectionId,
      webhookEventRecordId: existingInboxEvent.id,
    };
  }

  // Convert headers to plain JSON record
  const headersRecord: Record<string, string> = {};
  headers.forEach((value, key) => {
    headersRecord[key] = value;
  });

  const eventType =
    typeof parsedPayload.eventType === "string"
      ? parsedPayload.eventType
      : typeof parsedPayload.type === "string"
      ? parsedPayload.type
      : null;

  // Persist / update inbox record in RECEIVED state
  const inboxRecord = await db.integrationWebhookEvent.upsert({
    where: {
      connectionId_providerEventId: {
        connectionId,
        providerEventId,
      },
    },
    create: {
      workspaceId,
      connectionId,
      providerEventId,
      eventType: eventType ? eventType.slice(0, 128) : null,
      status: "RECEIVED",
      headersJson: headersRecord as Prisma.InputJsonValue,
      payloadJson: parsedPayload as Prisma.InputJsonValue,
    },
    update: {
      headersJson: headersRecord as Prisma.InputJsonValue,
      payloadJson: parsedPayload as Prisma.InputJsonValue,
    },
  });

  // =========================================================================
  // STAGE 7: Event Normalization (Adapter Delegation)
  // =========================================================================
  const { adapter } = await getAdapterForConnection(connectionId, db);

  const activeCred = (connection.credentials || []).find(
    (c) => c.status === IntegrationCredentialStatus.ACTIVE
  );

  let secretPayload: string | undefined;
  if (activeCred) {
    secretPayload = await resolveCredentialSecret(activeCred, options.customSecretResolver);
  }

  const secretRef: IntegrationSecretReference = activeCred
    ? {
        secretId: activeCred.id,
        version: activeCred.version,
        keyVaultProvider: activeCred.keyVaultProvider,
        algorithm: activeCred.algorithm,
        fingerprint: activeCred.fingerprint,
        expiresAt: activeCred.expiresAt,
        secretPayload,
      }
    : {
        secretId: "sec_placeholder",
        version: 1,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        fingerprint: "sha256:default",
      };

  const normalizedEvent = await adapter.handleWebhook(
    parsedPayload,
    headers,
    secretRef,
    connection
  );

  if (!normalizedEvent) {
    // Adapter declined or ignored this event type
    await db.integrationWebhookEvent.update({
      where: { id: inboxRecord.id },
      data: {
        status: "IGNORED",
        processedAt: new Date(),
      },
    });

    return {
      outcome: "IGNORED",
      stage: 7,
      httpStatus: 200,
      message: `Adapter '${adapter.integrationId}' ignored or declined event '${providerEventId}'.`,
      endpointSlug,
      workspaceId,
      connectionId,
      webhookEventRecordId: inboxRecord.id,
    };
  }

  // =========================================================================
  // STAGE 8: Domain Event Dispatch
  // =========================================================================
  // Dispatches domain event into Automation Trigger Ingestion Engine and finalizes inbox status
  const runTransaction = async (fn: (tx: DbClient) => Promise<void>) => {
    if (typeof (db as any).$transaction === "function") {
      await (db as any).$transaction(fn);
    } else {
      await fn(db);
    }
  };

  await runTransaction(async (tx) => {
    // 1. Finalize inbox state to PROCESSED
    await tx.integrationWebhookEvent.update({
      where: { id: inboxRecord.id },
      data: {
        status: "PROCESSED",
        eventType: normalizedEvent.eventType.slice(0, 128),
        processedAt: new Date(),
      },
    });

    // 2. Dispatch to Phase 1.16 Automation Trigger Ingestion Engine
    await ingestAutomationEvent(
      workspaceId,
      {
        workspaceId,
        eventType: normalizedEvent.eventType,
        sourceEntity: normalizedEvent.entityType,
        sourceId: normalizedEvent.entityId || normalizedEvent.eventId,
        payload: normalizedEvent.payload,
        eventTimestamp: normalizedEvent.occurredAt,
        correlationId: normalizedEvent.eventId,
      },
      tx
    );

    // 3. Dispatch to Phase 1.13 NotificationOutbox if event payload defines a direct operational notification envelope
    const notificationEnvelope = (normalizedEvent as unknown as { notificationEnvelope?: EmitNotificationEventInput }).notificationEnvelope;
    if (notificationEnvelope) {
      await emitNotificationEvent(tx as Prisma.TransactionClient, notificationEnvelope);
    }
  });

  return {
    outcome: "SUCCESS",
    stage: 8,
    httpStatus: 200,
    message: "Webhook processed and dispatched to domain engines successfully.",
    endpointSlug,
    workspaceId,
    connectionId,
    event: normalizedEvent,
    webhookEventRecordId: inboxRecord.id,
  };
}
