import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  IntegrationStatus,
  IntegrationConnectionStatus,
  IntegrationCredentialStatus,
  IntegrationWebhookStatus,
  IntegrationExecutionStatus,
  IntegrationCapability,
  IntegrationFailureCode,
} from "@/lib/integrations";

describe("Phase 1.17.2 — Integration Data Model & Schema Invariants", () => {
  let prisma: PrismaClient;
  const runId = `int_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_${runId}`;
  const testIntegrationId = `test_prov_${runId}`;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // Create test workspace
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: "Integration Test Workspace",
        slug: `slug-${runId}`,
      },
    });

    // Create test global integration catalog record
    await prisma.integration.create({
      data: {
        id: testIntegrationId,
        name: "Test Custom Provider",
        description: "Provider for data model verification",
        status: IntegrationStatus.ACTIVE,
        capabilities: [
          IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
          IntegrationCapability.EMAIL_SEND,
        ],
        authType: "API_KEY",
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      // Clean up workspace (cascades to all children)
      await prisma.workspace.deleteMany({ where: { id: wsId } });
      await prisma.integration.deleteMany({ where: { id: testIntegrationId } });
      await prisma.$disconnect();
    }
  });

  it("1. should create and manage IntegrationConnection with composite unique key", async () => {
    const conn = await prisma.integrationConnection.create({
      data: {
        workspaceId: wsId,
        integrationId: testIntegrationId,
        connectionKey: "default",
        status: IntegrationConnectionStatus.CONNECTING,
        configJson: { region: "us-east-1" },
        metadataJson: { connectedBy: "user_test" },
      },
    });

    expect(conn.id).toBeDefined();
    expect(conn.status).toBe(IntegrationConnectionStatus.CONNECTING);
    expect(conn.connectionKey).toBe("default");

    // Enforce @@unique([workspaceId, integrationId, connectionKey])
    await expect(
      prisma.integrationConnection.create({
        data: {
          workspaceId: wsId,
          integrationId: testIntegrationId,
          connectionKey: "default",
          status: IntegrationConnectionStatus.CONNECTING,
        },
      })
    ).rejects.toThrow();
  });

  it("2. should enforce Single Active Credential Invariant via partial unique index", async () => {
    const conn = await prisma.integrationConnection.findFirstOrThrow({
      where: { workspaceId: wsId, integrationId: testIntegrationId },
    });

    // Create first ACTIVE credential
    const cred1 = await prisma.integrationCredential.create({
      data: {
        connectionId: conn.id,
        version: 1,
        status: IntegrationCredentialStatus.ACTIVE,
        keyVaultProvider: "AWS_KMS",
        algorithm: "AES_256_GCM",
        iv: "iv_test_123",
        tag: "tag_test_123",
        encryptedData: "encrypted_ciphertext_payload",
        fingerprint: "sha256:abcd1234efgh5678",
      },
    });

    expect(cred1.version).toBe(1);
    expect(cred1.status).toBe(IntegrationCredentialStatus.ACTIVE);

    // Creating a second credential in ROTATING status on the same connection is allowed
    const credRotating = await prisma.integrationCredential.create({
      data: {
        connectionId: conn.id,
        version: 2,
        status: IntegrationCredentialStatus.ROTATING,
        keyVaultProvider: "AWS_KMS",
        algorithm: "AES_256_GCM",
        iv: "iv_test_456",
        tag: "tag_test_456",
        encryptedData: "encrypted_rotating_payload",
        fingerprint: "sha256:ijkl9012mnop3456",
      },
    });
    expect(credRotating.status).toBe(IntegrationCredentialStatus.ROTATING);

    // Attempting to create a second ACTIVE credential on the same connection must fail
    // due to the partial unique index: unique_active_credential_per_connection
    await expect(
      prisma.integrationCredential.create({
        data: {
          connectionId: conn.id,
          version: 3,
          status: IntegrationCredentialStatus.ACTIVE,
          keyVaultProvider: "AWS_KMS",
          algorithm: "AES_256_GCM",
          iv: "iv_test_789",
          tag: "tag_test_789",
          encryptedData: "encrypted_second_active_payload",
          fingerprint: "sha256:qrst5678uvwx9012",
        },
      })
    ).rejects.toThrow();
  });

  it("3. should create and enforce uniqueness on IntegrationWebhook endpointSlug", async () => {
    const conn = await prisma.integrationConnection.findFirstOrThrow({
      where: { workspaceId: wsId, integrationId: testIntegrationId },
    });

    const slug = `wh_${runId}_endpoint`;
    const webhook = await prisma.integrationWebhook.create({
      data: {
        workspaceId: wsId,
        connectionId: conn.id,
        endpointSlug: slug,
        description: "Inbound invoice events",
        status: IntegrationWebhookStatus.ACTIVE,
        enabledEvents: ["invoice.paid", "invoice.voided"],
      },
    });

    expect(webhook.id).toBeDefined();
    expect(webhook.endpointSlug).toBe(slug);

    // Slug must be globally unique
    await expect(
      prisma.integrationWebhook.create({
        data: {
          workspaceId: wsId,
          connectionId: conn.id,
          endpointSlug: slug,
        },
      })
    ).rejects.toThrow();
  });

  it("4. should record append-only IntegrationExecution audit ledger entries", async () => {
    const conn = await prisma.integrationConnection.findFirstOrThrow({
      where: { workspaceId: wsId, integrationId: testIntegrationId },
    });

    const exec = await prisma.integrationExecution.create({
      data: {
        workspaceId: wsId,
        connectionId: conn.id,
        capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        action: "syncInvoice",
        status: IntegrationExecutionStatus.COMPLETED,
        idempotencyKey: `idemp_${runId}_001`,
        correlationId: `corr_${runId}_001`,
        attemptNumber: 1,
        rawResponseStatus: 200,
        providerRequestId: "req_qb_987654",
        durationMs: 420,
        requestSnapshotJson: { invoiceId: "inv_123", amount: 25000 },
        responseSnapshotJson: { externalInvoiceId: "qb_doc_111" },
      },
    });

    expect(exec.id).toBeDefined();
    expect(exec.capability).toBe(IntegrationCapability.ACCOUNTING_INVOICE_SYNC);
    expect(exec.status).toBe(IntegrationExecutionStatus.COMPLETED);
    expect(exec.durationMs).toBe(420);

    // Also support recording failure classifications
    const failedExec = await prisma.integrationExecution.create({
      data: {
        workspaceId: wsId,
        connectionId: conn.id,
        capability: IntegrationCapability.EMAIL_SEND,
        action: "sendNotification",
        status: IntegrationExecutionStatus.FAILED,
        idempotencyKey: `idemp_${runId}_002`,
        correlationId: `corr_${runId}_002`,
        failureCode: IntegrationFailureCode.RATE_LIMITED,
        failureJson: { retryAfterSeconds: 60, message: "Too many requests" },
      },
    });

    expect(failedExec.failureCode).toBe(IntegrationFailureCode.RATE_LIMITED);
    expect(failedExec.status).toBe(IntegrationExecutionStatus.FAILED);
  });

  it("5. should persist and enforce idempotency on IntegrationWebhookEvent inbox", async () => {
    const conn = await prisma.integrationConnection.findFirstOrThrow({
      where: { workspaceId: wsId, integrationId: testIntegrationId },
    });

    const providerEventId = `evt_stripe_${runId}_1001`;
    const event = await prisma.integrationWebhookEvent.create({
      data: {
        workspaceId: wsId,
        connectionId: conn.id,
        providerEventId,
        eventType: "invoice.payment_succeeded",
        status: "PROCESSED",
        headersJson: { "content-type": "application/json" },
        payloadJson: { id: providerEventId, amount: 5000 },
        processedAt: new Date(),
      },
    });

    expect(event.id).toBeDefined();
    expect(event.providerEventId).toBe(providerEventId);

    // Enforce @@unique([connectionId, providerEventId])
    await expect(
      prisma.integrationWebhookEvent.create({
        data: {
          workspaceId: wsId,
          connectionId: conn.id,
          providerEventId,
          status: "RECEIVED",
        },
      })
    ).rejects.toThrow();
  });

  it("6. should enforce Exclusive Capability Singleton Invariant via WorkspaceActiveExclusiveCapability", async () => {
    const conn = await prisma.integrationConnection.findFirstOrThrow({
      where: { workspaceId: wsId, integrationId: testIntegrationId },
    });

    // Register active exclusive capability for this workspace
    const activeCap = await prisma.workspaceActiveExclusiveCapability.create({
      data: {
        workspaceId: wsId,
        capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        connectionId: conn.id,
      },
    });

    expect(activeCap.capability).toBe(IntegrationCapability.ACCOUNTING_INVOICE_SYNC);

    // Attempting to register a competing active exclusive capability in the same workspace fails
    await expect(
      prisma.workspaceActiveExclusiveCapability.create({
        data: {
          workspaceId: wsId,
          capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
          connectionId: "conn_competing_provider",
        },
      })
    ).rejects.toThrow();
  });

  it("7. should manage WorkspaceIntegrationSetting with unique 1:1 workspace relationship", async () => {
    const setting = await prisma.workspaceIntegrationSetting.create({
      data: {
        workspaceId: wsId,
        defaultProvidersJson: {
          [IntegrationCapability.EMAIL_SEND]: "conn_resend_default",
          [IntegrationCapability.ACCOUNTING_INVOICE_SYNC]: "conn_qb_default",
        },
        settingsJson: {
          autoSyncInvoices: true,
        },
      },
    });

    expect(setting.id).toBeDefined();
    expect(setting.workspaceId).toBe(wsId);

    // Enforce 1:1 unique workspace constraint
    await expect(
      prisma.workspaceIntegrationSetting.create({
        data: {
          workspaceId: wsId,
          defaultProvidersJson: {},
        },
      })
    ).rejects.toThrow();
  });

  it("8. should cascade delete child integration records when Workspace is deleted", async () => {
    const tempWsId = `ws_cascade_${Date.now()}`;
    await prisma.workspace.create({
      data: {
        id: tempWsId,
        name: "Temporary Workspace for Cascade Test",
        slug: `slug-cascade-${Date.now()}`,
      },
    });

    const conn = await prisma.integrationConnection.create({
      data: {
        workspaceId: tempWsId,
        integrationId: testIntegrationId,
        connectionKey: "default",
        status: IntegrationConnectionStatus.CONNECTED,
      },
    });

    await prisma.integrationCredential.create({
      data: {
        connectionId: conn.id,
        version: 1,
        status: IntegrationCredentialStatus.ACTIVE,
        iv: "iv_1",
        tag: "tag_1",
        encryptedData: "cipher_1",
        fingerprint: "sha256:temp",
      },
    });

    await prisma.workspaceActiveExclusiveCapability.create({
      data: {
        workspaceId: tempWsId,
        capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
        connectionId: conn.id,
      },
    });

    await prisma.workspaceIntegrationSetting.create({
      data: {
        workspaceId: tempWsId,
        defaultProvidersJson: {},
      },
    });

    // Delete workspace
    await prisma.workspace.delete({ where: { id: tempWsId } });

    // Verify all child records are purged
    const connCheck = await prisma.integrationConnection.findMany({ where: { workspaceId: tempWsId } });
    expect(connCheck).toHaveLength(0);

    const credCheck = await prisma.integrationCredential.findMany({ where: { connectionId: conn.id } });
    expect(credCheck).toHaveLength(0);

    const capCheck = await prisma.workspaceActiveExclusiveCapability.findMany({ where: { workspaceId: tempWsId } });
    expect(capCheck).toHaveLength(0);

    const settingCheck = await prisma.workspaceIntegrationSetting.findMany({ where: { workspaceId: tempWsId } });
    expect(settingCheck).toHaveLength(0);
  });
});
