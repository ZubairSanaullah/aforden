/**
 * Phase 1.17.5 — Outbound Integration Engine: Execution Manager
 * Implements the centralized outbound execution lifecycle locked in Phase 1.17.1 §6:
 * Domain Service → Capability Resolver → Integration Execution Manager → Provider Adapter → External API
 *
 * Responsibilities:
 * 1. Resolves active connection and provider adapter.
 * 2. Derives deterministic UUIDv5 idempotency key and UUIDv4 correlation ID.
 * 3. Resolves and envelope-decrypts secret references.
 * 4. Applies timeout enforcement via AbortController and Promise.race.
 * 5. Manages append-only IntegrationExecution audit ledger lifecycle (PENDING -> RUNNING -> COMPLETED/FAILED/TIMED_OUT).
 * 6. Applies recursive credential and secret redaction on request/response audit snapshots.
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  Prisma,
  IntegrationCapability,
  IntegrationExecutionStatus,
  IntegrationFailureCode,
} from "@/generated/prisma/client";
import { CAPABILITY_REGISTRY } from "../registry";
import { getAdapterForConnection } from "../adapters/adapterResolution";
import type { IntegrationExecutionResult } from "../adapters/types";
import { resolveCapabilityConnection } from "./capabilityResolver";
import { generateOutboundIdempotencyKey } from "./idempotency";
import { resolveAndDecryptCredential } from "./secretDecryption";
import { redactSensitiveData } from "./redaction";
import type { ExecuteCapabilityOptions, DbClient } from "./types";

/**
 * Executes an outbound capability action through the standardized integration pipeline.
 *
 * @param workspaceId - Tenant workspace ID.
 * @param capability - The integration capability to execute (e.g. EMAIL_SEND).
 * @param action - Specific action verb (e.g. "send_email", "sync_invoice").
 * @param payload - Action-specific payload object.
 * @param options - Execution options (timeout, hint, correlation ID, dbClient).
 * @returns Standardized IntegrationExecutionResult from provider adapter.
 */
export async function executeCapability(
  workspaceId: string,
  capability: IntegrationCapability,
  action: string,
  payload: Record<string, unknown>,
  options?: ExecuteCapabilityOptions
): Promise<IntegrationExecutionResult> {
  const db: DbClient = options?.dbClient ?? prisma;

  // 1. Resolve active connection for capability
  const connection = await resolveCapabilityConnection(workspaceId, capability, {
    providerHint: options?.providerHint,
    dbClient: db,
  });

  // 2. Resolve registered provider adapter
  const { adapter } = await getAdapterForConnection(connection.id, db);

  // 3. Resolve and decrypt active credential
  const { secretReference } = await resolveAndDecryptCredential(
    connection.id,
    workspaceId,
    db
  );

  // 4. Generate deterministic UUIDv5 idempotency key & UUIDv4 correlation ID
  const idempotencyKey =
    options?.idempotencyKeyOverride ??
    generateOutboundIdempotencyKey(
      workspaceId,
      connection.id,
      capability,
      action,
      payload
    );
  const correlationId = options?.correlationId ?? crypto.randomUUID();

  // 5. Determine timeout threshold
  const capabilityDef = CAPABILITY_REGISTRY[capability];
  const timeoutMs =
    options?.timeoutMs ?? capabilityDef?.defaultTimeoutMs ?? 10000;

  // 6. Redact request payload for audit ledger
  const redactedRequestSnapshot = redactSensitiveData(payload);

  // 7. Initialize IntegrationExecution audit ledger record in PENDING state
  const executionRecord = await db.integrationExecution.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      capability,
      action,
      status: IntegrationExecutionStatus.PENDING,
      idempotencyKey,
      correlationId,
      attemptNumber: options?.attemptNumber ?? 1,
      requestSnapshotJson: redactedRequestSnapshot as Prisma.InputJsonValue,
    },
  });

  // Transition to RUNNING state as dispatch begins
  await db.integrationExecution.update({
    where: { id: executionRecord.id },
    data: {
      status: IntegrationExecutionStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  // 8. Execute adapter with timeout guard & AbortController
  const abortController = new AbortController();
  const startTime = Date.now();
  let timeoutTimer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      abortController.abort();
      const err = new Error(
        `Capability execution for '${capability}:${action}' timed out after ${timeoutMs}ms.`
      );
      (err as unknown as { isTimeout: boolean }).isTimeout = true;
      reject(err);
    }, timeoutMs);
  });

  let adapterResult: IntegrationExecutionResult;
  let finalStatus: IntegrationExecutionStatus;
  let failureCode: IntegrationFailureCode | null = null;
  let failureJson: Record<string, unknown> | null = null;

  try {
    adapterResult = await Promise.race([
      adapter.execute({
        workspaceId,
        connectionId: connection.id,
        capability,
        action,
        payload,
        idempotencyKey,
        correlationId,
        timeoutMs,
        secretReference,
        connectionConfig:
          (connection.configJson as Record<string, unknown>) ?? {},
      }),
      timeoutPromise,
    ]);

    if (adapterResult.success) {
      finalStatus = IntegrationExecutionStatus.COMPLETED;
    } else {
      finalStatus = IntegrationExecutionStatus.FAILED;
      failureCode =
        adapterResult.failure?.code ??
        IntegrationFailureCode.INTERNAL_ADAPTER_ERROR;
      failureJson =
        (adapterResult.failure as unknown as Record<string, unknown>) ?? null;
    }
  } catch (err: unknown) {
    const isTimeout = (err as unknown as { isTimeout?: boolean })?.isTimeout === true;
    const durationMs = Date.now() - startTime;

    if (isTimeout) {
      finalStatus = IntegrationExecutionStatus.TIMED_OUT;
      failureCode = IntegrationFailureCode.NETWORK_TIMEOUT;
      failureJson = {
        code: "NETWORK_TIMEOUT",
        message: `Execution timed out after ${timeoutMs}ms.`,
        isRetryable: true,
      };
      adapterResult = {
        success: false,
        capability,
        action,
        durationMs,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: `Execution timed out after ${timeoutMs}ms.`,
          isRetryable: true,
        },
      };
    } else {
      finalStatus = IntegrationExecutionStatus.FAILED;
      failureCode = IntegrationFailureCode.INTERNAL_ADAPTER_ERROR;
      const errMsg = err instanceof Error ? err.message : String(err);
      failureJson = {
        code: "INTERNAL_ADAPTER_ERROR",
        message: errMsg,
        isRetryable: false,
      };
      adapterResult = {
        success: false,
        capability,
        action,
        durationMs,
        failure: {
          code: IntegrationFailureCode.INTERNAL_ADAPTER_ERROR,
          message: errMsg,
          isRetryable: false,
        },
      };
    }
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  }

  // 9. Redact response data / failure payload for audit ledger
  const durationMs = Date.now() - startTime;
  const redactedResponseSnapshot = redactSensitiveData(
    adapterResult.data ?? adapterResult.failure ?? null
  );

  // 10. Finalize IntegrationExecution audit ledger record
  await db.integrationExecution.update({
    where: { id: executionRecord.id },
    data: {
      status: finalStatus,
      durationMs,
      rawResponseStatus: adapterResult.rawResponseStatus ?? null,
      providerRequestId: adapterResult.providerRequestId ?? null,
      responseSnapshotJson:
        (redactedResponseSnapshot as Prisma.InputJsonValue) ?? null,
      failureCode,
      failureJson: (failureJson
        ? redactSensitiveData(failureJson)
        : null) as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });

  return adapterResult;
}
