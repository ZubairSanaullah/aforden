/**
 * Phase 1.17.9 — Integration Management Service Layer
 * Business logic for integration catalog discovery, connection lifecycle,
 * credential management, execution ledger querying, and webhooks.
 */

import crypto from "crypto";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationCredentialStatus,
} from "@/generated/prisma/enums";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { SEED_INTEGRATIONS } from "@/lib/integrations/seed/integrationSeed";
import { AdapterRegistry } from "@/lib/integrations/adapters/adapterRegistry";
import { CAPABILITY_REGISTRY } from "@/lib/integrations/registry";
import {
  ConnectionNotFoundError,
  IntegrationNotFoundError,
  AdapterNotRegisteredError,
  maskCredentialSummary,
  sanitizePayload,
} from "@/lib/utils/integrationApiError";
import { resolveAndDecryptCredential } from "@/lib/integrations/execution/secretDecryption";
import { encryptSecretPayload } from "@/lib/services/security/credentialEncryptionService";

export interface ListExecutionsQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  capability?: string;
  sortBy?: "createdAt" | "startedAt" | "durationMs" | "attemptNumber";
  sortOrder?: "asc" | "desc";
}

export class IntegrationManagementService {
  /**
   * Lists catalog integrations merged with workspace connection status.
   */
  public static async listIntegrationsWithStatus(
    workspaceId: string,
    db: PrismaClient | Prisma.TransactionClient = defaultPrisma
  ) {
    const connections = await db.integrationConnection.findMany({
      where: { workspaceId },
      include: {
        credentials: {
          where: { status: IntegrationCredentialStatus.ACTIVE },
          take: 1,
        },
        activeExclusiveCapabilities: true,
      },
    });

    const connMap = new Map(connections.map((c) => [c.integrationId, c]));

    const settings = await db.workspaceIntegrationSetting.findUnique({
      where: { workspaceId },
    });
    const defaultProviders = (settings?.defaultProvidersJson as Record<string, string>) || {};

    const items = SEED_INTEGRATIONS.map((catalogItem) => {
      const conn = connMap.get(catalogItem.id);
      const activeCred = conn?.credentials[0];

      return {
        id: catalogItem.id,
        name: catalogItem.name,
        description: catalogItem.description,
        logoUrl: catalogItem.logoUrl,
        status: catalogItem.status,
        capabilities: catalogItem.capabilities,
        authType: catalogItem.authType,
        connection: conn
          ? {
              id: conn.id,
              status: conn.status,
              connectionKey: conn.connectionKey,
              externalAccountId: conn.externalAccountId,
              externalAccountName: conn.externalAccountName,
              lastTestedAt: conn.lastTestedAt,
              lastErrorJson: conn.lastErrorJson,
              createdAt: conn.createdAt,
              updatedAt: conn.updatedAt,
              activeCredential: activeCred ? maskCredentialSummary(activeCred as unknown as Record<string, unknown>) : null,
              activeExclusiveCapabilities: conn.activeExclusiveCapabilities.map((ec) => ec.capability),
            }
          : null,
        defaultForCapabilities: Object.entries(defaultProviders)
          .filter(([_, providerId]) => providerId === catalogItem.id)
          .map(([cap]) => cap),
      };
    });

    return {
      items,
      totalCount: items.length,
    };
  }

  /**
   * Returns single integration details with connection and configuration.
   */
  public static async getIntegrationDetail(
    workspaceId: string,
    integrationId: string,
    db: PrismaClient | Prisma.TransactionClient = defaultPrisma
  ) {
    const catalogItem = SEED_INTEGRATIONS.find((i) => i.id === integrationId);
    if (!catalogItem) {
      throw new IntegrationNotFoundError(integrationId);
    }

    const connection = await db.integrationConnection.findUnique({
      where: {
        workspaceId_integrationId_connectionKey: {
          workspaceId,
          integrationId,
          connectionKey: "primary",
        },
      },
      include: {
        credentials: {
          orderBy: { version: "desc" },
        },
        webhooks: true,
        activeExclusiveCapabilities: true,
      },
    });

    return {
      integration: {
        id: catalogItem.id,
        name: catalogItem.name,
        description: catalogItem.description,
        logoUrl: catalogItem.logoUrl,
        capabilities: catalogItem.capabilities,
        authType: catalogItem.authType,
        configSchemaJson: catalogItem.configSchemaJson,
      },
      connection: connection
        ? {
            id: connection.id,
            status: connection.status,
            connectionKey: connection.connectionKey,
            externalAccountId: connection.externalAccountId,
            externalAccountName: connection.externalAccountName,
            configJson: sanitizePayload(connection.configJson),
            lastTestedAt: connection.lastTestedAt,
            lastErrorJson: connection.lastErrorJson,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
            credentials: connection.credentials.map((cred) =>
              maskCredentialSummary(cred as unknown as Record<string, unknown>)
            ),
            webhooks: connection.webhooks.map((w) => ({
              id: w.id,
              endpointSlug: w.endpointSlug,
              description: w.description,
              status: w.status,
              enabledEvents: w.enabledEvents,
              createdAt: w.createdAt,
            })),
            activeExclusiveCapabilities: connection.activeExclusiveCapabilities.map((ec) => ec.capability),
          }
        : null,
    };
  }

  /**
   * Initiates or completes connection to a provider.
   */
  public static async connectIntegration(
    workspaceId: string,
    integrationId: string,
    payload: Record<string, unknown>,
    db: PrismaClient = defaultPrisma
  ) {
    const catalogItem = SEED_INTEGRATIONS.find((i) => i.id === integrationId);
    if (!catalogItem) {
      throw new IntegrationNotFoundError(integrationId);
    }

    // Handle OAuth initiation
    if (payload.action === "initiate" && catalogItem.authType === "OAUTH2") {
      const redirectUri =
        (payload.redirectUri as string) || "https://app.aforden.com/api/integrations/oauth/callback";
      const state = Buffer.from(
        JSON.stringify({
          workspaceId,
          integrationId,
          nonce: crypto.randomUUID(),
          timestamp: Date.now(),
        })
      ).toString("base64");

      let authorizationUrl = "";
      if (integrationId === "quickbooks_online") {
        const clientId = process.env.QUICKBOOKS_CLIENT_ID || "mock_qb_client_id";
        authorizationUrl = `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
      } else if (integrationId === "google_calendar") {
        const clientId = process.env.GOOGLE_CLIENT_ID || "mock_google_client_id";
        authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=https://www.googleapis.com/auth/calendar&access_type=offline&prompt=consent&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
      }

      return {
        action: "initiate",
        authorizationUrl,
        state,
      };
    }

    // Find or create connection record
    let connection = await db.integrationConnection.findUnique({
      where: {
        workspaceId_integrationId_connectionKey: {
          workspaceId,
          integrationId,
          connectionKey: "primary",
        },
      },
    });

    if (!connection) {
      connection = await db.integrationConnection.create({
        data: {
          workspaceId,
          integrationId,
          connectionKey: "primary",
          status: IntegrationConnectionStatus.CONNECTING,
          configJson: (payload.config as Prisma.InputJsonValue) || {},
        },
      });
    } else {
      connection = await db.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: IntegrationConnectionStatus.CONNECTING,
          configJson: payload.config
            ? (payload.config as Prisma.InputJsonValue)
            : (connection.configJson ?? Prisma.DbNull),
        },
      });
    }

    if (!AdapterRegistry.hasAdapter(integrationId)) {
      throw new AdapterNotRegisteredError(integrationId);
    }
    const adapter = AdapterRegistry.getAdapter(integrationId)!;

    const connectResult = await adapter.connect(
      connection as any,
      payload.authPayload || payload
    );

    if (!connectResult.success) {
      const updatedConn = await db.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: IntegrationConnectionStatus.ERROR,
          lastErrorJson: connectResult.failure as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        success: false,
        connectionStatus: updatedConn.status,
        failure: connectResult.failure,
      };
    }

    // Connect succeeded - Store active credential and provision capabilities in transaction
    const saved = await db.$transaction(async (tx) => {
      // 1. Supersede any existing ACTIVE credentials
      await tx.integrationCredential.updateMany({
        where: {
          connectionId: connection!.id,
          status: IntegrationCredentialStatus.ACTIVE,
        },
        data: {
          status: IntegrationCredentialStatus.SUPERSEDED,
        },
      });

      // 2. Insert new ACTIVE credential
      const secretPayload =
        connectResult.credentialReference.secretPayload ||
        JSON.stringify(payload.authPayload || payload);

      const secretStr =
        typeof secretPayload === "string" ? secretPayload : JSON.stringify(secretPayload);

      // Real AES-256-GCM authenticated encryption for database record
      const encryptedRecord = encryptSecretPayload(secretStr, {
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        version: 1,
      });

      const cred = await tx.integrationCredential.create({
        data: {
          connectionId: connection!.id,
          version: encryptedRecord.version,
          status: IntegrationCredentialStatus.ACTIVE,
          keyVaultProvider: encryptedRecord.keyVaultProvider,
          algorithm: encryptedRecord.algorithm,
          iv: encryptedRecord.iv,
          tag: encryptedRecord.tag,
          encryptedData: encryptedRecord.encryptedData,
          fingerprint: encryptedRecord.fingerprint,
        },
      });

      // 3. Update connection to CONNECTED
      const updated = await tx.integrationConnection.update({
        where: { id: connection!.id },
        data: {
          status: IntegrationConnectionStatus.CONNECTED,
          externalAccountId: connectResult.externalAccountId || connection!.externalAccountId,
          externalAccountName: connectResult.externalAccountName || connection!.externalAccountName,
          lastTestedAt: new Date(),
          lastErrorJson: Prisma.DbNull,
        },
      });

      // 4. Provision exclusive capabilities
      for (const cap of adapter.getCapabilities()) {
        const def = CAPABILITY_REGISTRY[cap as IntegrationCapability];
        if (def && !def.allowsMultipleActiveProviders) {
          await tx.workspaceActiveExclusiveCapability.upsert({
            where: {
              workspaceId_capability: {
                workspaceId,
                capability: cap as IntegrationCapability,
              },
            },
            create: {
              workspaceId,
              capability: cap as IntegrationCapability,
              connectionId: updated.id,
            },
            update: {
              connectionId: updated.id,
            },
          });
        }
      }

      return {
        connection: updated,
        credential: cred,
      };
    });

    return {
      success: true,
      connection: {
        id: saved.connection.id,
        status: saved.connection.status,
        externalAccountId: saved.connection.externalAccountId,
        externalAccountName: saved.connection.externalAccountName,
        lastTestedAt: saved.connection.lastTestedAt,
        credential: maskCredentialSummary(saved.credential as unknown as Record<string, unknown>),
      },
    };
  }

  /**
   * Disconnects an active integration connection and releases exclusive capabilities.
   */
  public static async disconnectIntegration(
    workspaceId: string,
    integrationId: string,
    db: PrismaClient = defaultPrisma
  ) {
    const connection = await db.integrationConnection.findUnique({
      where: {
        workspaceId_integrationId_connectionKey: {
          workspaceId,
          integrationId,
          connectionKey: "primary",
        },
      },
    });

    if (!connection) {
      throw new ConnectionNotFoundError(integrationId);
    }

    if (AdapterRegistry.hasAdapter(integrationId)) {
      const adapter = AdapterRegistry.getAdapter(integrationId)!;
      await adapter.disconnect(connection as any, {} as any).catch(() => {});
    }

    await db.$transaction(async (tx) => {
      // 1. Release active exclusive capabilities
      await tx.workspaceActiveExclusiveCapability.deleteMany({
        where: {
          connectionId: connection.id,
        },
      });

      // 2. Set connection status to DISCONNECTED
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: IntegrationConnectionStatus.DISCONNECTED,
        },
      });
    });

    return {
      success: true,
      connectionStatus: IntegrationConnectionStatus.DISCONNECTED,
    };
  }

  /**
   * Pings connection health via testConnection().
   */
  public static async testIntegrationConnection(
    workspaceId: string,
    integrationId: string,
    db: PrismaClient = defaultPrisma
  ) {
    const connection = await db.integrationConnection.findUnique({
      where: {
        workspaceId_integrationId_connectionKey: {
          workspaceId,
          integrationId,
          connectionKey: "primary",
        },
      },
    });

    if (!connection) {
      throw new ConnectionNotFoundError(integrationId);
    }

    if (!AdapterRegistry.hasAdapter(integrationId)) {
      throw new AdapterNotRegisteredError(integrationId);
    }
    const adapter = AdapterRegistry.getAdapter(integrationId)!;

    const { secretReference } = await resolveAndDecryptCredential(connection.id, workspaceId, db);
    const testResult = await adapter.testConnection(connection as any, secretReference);

    await db.integrationConnection.update({
      where: { id: connection.id },
      data: {
        lastTestedAt: new Date(),
        lastErrorJson: testResult.success
          ? Prisma.DbNull
          : (testResult.failure as unknown as Prisma.InputJsonValue),
      },
    });

    return testResult;
  }

  /**
   * Lists paginated execution records with payload redaction.
   */
  public static async listIntegrationExecutions(
    workspaceId: string,
    integrationId: string,
    query: ListExecutionsQuery,
    db: PrismaClient = defaultPrisma
  ) {
    const connection = await db.integrationConnection.findUnique({
      where: {
        workspaceId_integrationId_connectionKey: {
          workspaceId,
          integrationId,
          connectionKey: "primary",
        },
      },
    });

    if (!connection) {
      throw new ConnectionNotFoundError(integrationId);
    }

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const skip = (page - 1) * pageSize;
    const sortBy = query.sortBy || "createdAt";
    const sortOrder = query.sortOrder || "desc";

    const where: Prisma.IntegrationExecutionWhereInput = {
      workspaceId,
      connectionId: connection.id,
      ...(query.status ? { status: query.status as any } : {}),
      ...(query.capability ? { capability: query.capability as any } : {}),
    };

    const [totalCount, records] = await Promise.all([
      db.integrationExecution.count({ where }),
      db.integrationExecution.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
      }),
    ]);

    const sanitizedItems = records.map((rec) => ({
      id: rec.id,
      capability: rec.capability,
      action: rec.action,
      status: rec.status,
      attemptNumber: rec.attemptNumber,
      idempotencyKey: rec.idempotencyKey,
      correlationId: rec.correlationId,
      durationMs: rec.durationMs,
      requestSnapshot: sanitizePayload(rec.requestSnapshotJson),
      responseSnapshot: sanitizePayload(rec.responseSnapshotJson),
      failureCode: rec.failureCode,
      failureJson: rec.failureJson,
      createdAt: rec.createdAt,
    }));

    return {
      items: sanitizedItems,
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }

  /**
   * Lists registered webhooks for an integration connection.
   */
  public static async listIntegrationWebhooks(
    workspaceId: string,
    integrationId: string,
    db: PrismaClient = defaultPrisma
  ) {
    const connection = await db.integrationConnection.findUnique({
      where: {
        workspaceId_integrationId_connectionKey: {
          workspaceId,
          integrationId,
          connectionKey: "primary",
        },
      },
    });

    if (!connection) {
      throw new ConnectionNotFoundError(integrationId);
    }

    const webhooks = await db.integrationWebhook.findMany({
      where: {
        workspaceId,
        connectionId: connection.id,
      },
    });

    return {
      items: webhooks.map((w) => ({
        id: w.id,
        endpointSlug: w.endpointSlug,
        description: w.description,
        status: w.status,
        enabledEvents: w.enabledEvents,
        createdAt: w.createdAt,
      })),
      totalCount: webhooks.length,
    };
  }
}
