import { describe, it, expect, vi, beforeEach } from "vitest";

// =========================================================================
// Mocks Setup
// =========================================================================

const {
    findManyIntegrationsMock,
    findUniqueIntegrationMock,
    findManyConnectionsMock,
    findUniqueConnectionMock,
    updateConnectionMock,
    findUniqueCredentialMock,
    updateCredentialMock,
    findManyExecutionsMock,
    transactionMock,
    auditCreateMock,
} = vi.hoisted(() => ({
    findManyIntegrationsMock: vi.fn(),
    findUniqueIntegrationMock: vi.fn(),
    findManyConnectionsMock: vi.fn(),
    findUniqueConnectionMock: vi.fn(),
    updateConnectionMock: vi.fn(),
    findUniqueCredentialMock: vi.fn(),
    updateCredentialMock: vi.fn(),
    findManyExecutionsMock: vi.fn(),
    transactionMock: vi.fn(),
    auditCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        integration: {
            findMany: findManyIntegrationsMock,
            findUnique: findUniqueIntegrationMock,
        },
        integrationConnection: {
            findMany: findManyConnectionsMock,
            findUnique: findUniqueConnectionMock,
            update: updateConnectionMock,
        },
        integrationCredential: {
            findUnique: findUniqueCredentialMock,
            update: updateCredentialMock,
        },
        integrationExecution: {
            findMany: findManyExecutionsMock,
        },
        platformAuditLog: {
            create: auditCreateMock,
        },
        $transaction: transactionMock,
    },
}));

import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
    PlatformAccessDeniedError,
} from "@/lib/services/platform/authorization";
import { PLATFORM_AUDIT_EVENTS } from "@/lib/services/platform/audit";
import {
    listPlatformIntegrations,
    getPlatformIntegration,
    listPlatformIntegrationConnections,
    getPlatformIntegrationConnection,
    updatePlatformIntegrationConfig,
    updatePlatformIntegrationConnectionStatus,
    testPlatformIntegrationConnection,
    revokePlatformIntegrationCredential,
    listPlatformIntegrationExecutions,
    IntegrationStatus,
    IntegrationConnectionStatus,
    IntegrationCredentialStatus,
    IntegrationCapability,
    IntegrationExecutionStatus,
} from "@/lib/services/platform/integrations";
import {
    PlatformIntegrationNotFoundError,
    PlatformIntegrationConnectionNotFoundError,
    PlatformIntegrationCredentialNotFoundError,
    PlatformIntegrationValidationError,
    PlatformIntegrationConflictError,
} from "@/lib/services/platform/integrations/errors";
import { PlatformActionValidationError } from "@/lib/services/platform/workspaces/errors";

describe("Phase 1.19.13 — Platform Integration Administration Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default transaction mock implementation: executes callback with mocked tx
        transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
            const tx = {
                integrationConnection: {
                    findUnique: findUniqueConnectionMock,
                    update: updateConnectionMock,
                },
                integrationCredential: {
                    findUnique: findUniqueCredentialMock,
                    update: updateCredentialMock,
                },
                platformAuditLog: {
                    create: auditCreateMock,
                },
            };
            return callback(tx);
        });
    });

    function createPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN
    ): PlatformAuthorizationContext {
        return {
            userId: `usr_${role.toLowerCase()}`,
            email: `${role.toLowerCase()}@aforden.com`,
            name: `${role} Operator`,
            avatarUrl: null,
            platformRole: role,
            profileId: `prof_${role.toLowerCase()}`,
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt: new Date(),
            metadata: null,
        };
    }

    // =========================================================================
    // 1. Permission Gating & RBAC Boundaries
    // =========================================================================
    describe("1. Permission Gating & RBAC Boundaries", () => {
        it("allows PLATFORM_ADMIN full read and operational governance", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            findManyIntegrationsMock.mockResolvedValueOnce([]);

            await expect(listPlatformIntegrations(context)).resolves.toEqual([]);
        });

        it("allows PLATFORM_SUPPORT read access but denies updating config and revoking credentials", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_SUPPORT);
            findManyConnectionsMock.mockResolvedValueOnce([]);

            // Read allowed
            await expect(listPlatformIntegrationConnections(context)).resolves.toEqual([]);

            // Update config denied
            await expect(
                updatePlatformIntegrationConfig(context, "conn_1", {}, "Operational reason")
            ).rejects.toThrow(PlatformAccessDeniedError);

            // Revoke credential denied
            await expect(
                revokePlatformIntegrationCredential(context, "cred_1", "Security reason min 10 chars")
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("allows PLATFORM_OPERATIONS to update/test connections but denies revoking credentials", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_OPERATIONS);

            // Read allowed
            findManyIntegrationsMock.mockResolvedValueOnce([]);
            await expect(listPlatformIntegrations(context)).resolves.toEqual([]);

            // Test connection allowed
            findUniqueConnectionMock.mockResolvedValueOnce({
                id: "conn_1",
                workspaceId: "ws_alpha",
                lastTestedAt: null,
            });
            updateConnectionMock.mockResolvedValueOnce({ id: "conn_1" });

            await expect(
                testPlatformIntegrationConnection(context, "conn_1", "Testing connection latency")
            ).resolves.toBeDefined();

            // Revoke credentials denied (Tier-2 security action)
            await expect(
                revokePlatformIntegrationCredential(context, "cred_1", "Security reason min 10 chars")
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("allows PLATFORM_SECURITY to view and revoke credentials but denies operational config updates", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_SECURITY);

            // Read allowed
            findManyConnectionsMock.mockResolvedValueOnce([]);
            await expect(listPlatformIntegrationConnections(context)).resolves.toEqual([]);

            // Revoke allowed
            findUniqueCredentialMock.mockResolvedValueOnce({
                id: "cred_compromised",
                status: IntegrationCredentialStatus.ACTIVE,
                fingerprint: "sha256:abcd",
                version: 1,
                connection: { workspaceId: "ws_alpha", integrationId: "stripe" },
            });
            updateCredentialMock.mockResolvedValueOnce({
                id: "cred_compromised",
                connectionId: "conn_1",
                version: 1,
                status: IntegrationCredentialStatus.REVOKED,
                keyVaultProvider: "AWS_KMS",
                algorithm: "AES_256_GCM",
                fingerprint: "sha256:abcd",
                expiresAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                revokePlatformIntegrationCredential(
                    context,
                    "cred_compromised",
                    "Security audit flagged leaked Stripe secret key"
                )
            ).resolves.toBeDefined();

            // Operational config update denied
            await expect(
                updatePlatformIntegrationConfig(context, "conn_1", {}, "Updating region")
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("strictly denies PLATFORM_BILLING on all integration administration actions", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_BILLING);

            await expect(listPlatformIntegrations(context)).rejects.toThrow(PlatformAccessDeniedError);
            await expect(listPlatformIntegrationConnections(context)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(
                updatePlatformIntegrationConnectionStatus(
                    context,
                    "conn_1",
                    IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
                    "Suspending unpaid integration"
                )
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("strictly denies workspace/tenant member context without platform authorization", async () => {
            const tenantContext = {
                userId: "usr_tenant_admin",
                workspaceId: "ws_test",
                role: "ADMIN",
                permissions: ["integrations.manage"],
            } as unknown as PlatformAuthorizationContext;

            await expect(listPlatformIntegrations(tenantContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
        });
    });

    // =========================================================================
    // 2. Cross-Tenant Discovery & Health Inspection
    // =========================================================================
    describe("2. Cross-Tenant Discovery & Health Inspection", () => {
        it("lists integration catalog providers with connection counts", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findManyIntegrationsMock.mockResolvedValueOnce([
                {
                    id: "quickbooks_online",
                    name: "QuickBooks Online",
                    description: "Accounting integration",
                    logoUrl: "https://assets.aforden.com/quickbooks.png",
                    status: IntegrationStatus.ACTIVE,
                    capabilities: [IntegrationCapability.ACCOUNTING_INVOICE_SYNC],
                    authType: "OAUTH2",
                    createdAt: now,
                    updatedAt: now,
                    _count: { connections: 42 },
                },
            ]);

            const list = await listPlatformIntegrations(context, {
                status: IntegrationStatus.ACTIVE,
                capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
            });

            expect(list).toHaveLength(1);
            expect(list[0].id).toBe("quickbooks_online");
            expect(list[0].connectionCount).toBe(42);
        });

        it("fetches single integration catalog provider", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueIntegrationMock.mockResolvedValueOnce({
                id: "twilio",
                name: "Twilio",
                description: "SMS Notifications",
                logoUrl: null,
                status: IntegrationStatus.ACTIVE,
                capabilities: [IntegrationCapability.SMS_SEND],
                authType: "API_KEY",
                createdAt: now,
                updatedAt: now,
                _count: { connections: 18 },
            });

            const item = await getPlatformIntegration(context, "twilio");
            expect(item.id).toBe("twilio");
            expect(item.connectionCount).toBe(18);
        });

        it("throws PlatformIntegrationNotFoundError when catalog item does not exist", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            findUniqueIntegrationMock.mockResolvedValueOnce(null);

            await expect(getPlatformIntegration(context, "unknown_provider")).rejects.toThrow(
                PlatformIntegrationNotFoundError
            );
        });

        it("lists connections across all tenants with workspace context", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findManyConnectionsMock.mockResolvedValueOnce([
                {
                    id: "conn_1",
                    workspaceId: "ws_acme",
                    workspace: { name: "Acme Corp", slug: "acme-corp" },
                    integrationId: "stripe",
                    integration: { name: "Stripe" },
                    connectionKey: "primary",
                    status: IntegrationConnectionStatus.CONNECTED,
                    configJson: { region: "us", api_key: "sk_live_secret_leaked" },
                    metadataJson: { account: "acct_123" },
                    externalAccountId: "acct_123",
                    externalAccountName: "Acme Payments",
                    lastTestedAt: now,
                    lastErrorJson: null,
                    createdAt: now,
                    updatedAt: now,
                    credentials: [
                        {
                            id: "cred_1",
                            connectionId: "conn_1",
                            version: 1,
                            status: IntegrationCredentialStatus.ACTIVE,
                            keyVaultProvider: "AWS_KMS",
                            algorithm: "AES_256_GCM",
                            fingerprint: "sha256:stripe1234",
                            encryptedData: "TOP_SECRET_CIPHERTEXT",
                            iv: "SECRET_IV",
                            tag: "SECRET_TAG",
                            encryptedDek: "SECRET_DEK",
                            expiresAt: null,
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                },
            ]);

            const connections = await listPlatformIntegrationConnections(context);
            expect(connections).toHaveLength(1);
            expect(connections[0].workspaceName).toBe("Acme Corp");
            expect(connections[0].integrationName).toBe("Stripe");

            // CRITICAL SANITIZATION GUARANTEES:
            // 1. configJson redacts sensitive key patterns
            expect(connections[0].configJson?.api_key).toBe("[REDACTED]");
            // 2. credential strictly excludes ciphertext/secrets
            const activeCred = connections[0].activeCredential;
            expect(activeCred).toBeDefined();
            expect((activeCred as any).encryptedData).toBeUndefined();
            expect((activeCred as any).iv).toBeUndefined();
            expect((activeCred as any).tag).toBeUndefined();
            expect((activeCred as any).encryptedDek).toBeUndefined();
        });

        it("fetches detailed connection metadata with credentials and webhooks", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueConnectionMock.mockResolvedValueOnce({
                id: "conn_detail",
                workspaceId: "ws_apex",
                workspace: { name: "Apex Solutions", slug: "apex-solutions" },
                integrationId: "quickbooks_online",
                integration: { name: "QuickBooks Online" },
                connectionKey: "primary",
                status: IntegrationConnectionStatus.CONNECTED,
                configJson: { sandbox: false },
                metadataJson: { realmId: "realm_1234" },
                externalAccountId: "realm_1234",
                externalAccountName: "Apex Accounting",
                lastTestedAt: now,
                lastErrorJson: null,
                createdAt: now,
                updatedAt: now,
                credentials: [
                    {
                        id: "cred_v2",
                        connectionId: "conn_detail",
                        version: 2,
                        status: IntegrationCredentialStatus.ACTIVE,
                        keyVaultProvider: "AWS_KMS",
                        algorithm: "AES_256_GCM",
                        fingerprint: "sha256:qb2222",
                        encryptedData: "TOP_SECRET_CIPHERTEXT",
                        iv: "SECRET_IV",
                        tag: "SECRET_TAG",
                        expiresAt: null,
                        createdAt: now,
                        updatedAt: now,
                    },
                    {
                        id: "cred_v1",
                        connectionId: "conn_detail",
                        version: 1,
                        status: IntegrationCredentialStatus.SUPERSEDED,
                        keyVaultProvider: "AWS_KMS",
                        algorithm: "AES_256_GCM",
                        fingerprint: "sha256:qb1111",
                        encryptedData: "TOP_SECRET_CIPHERTEXT",
                        iv: "SECRET_IV",
                        tag: "SECRET_TAG",
                        expiresAt: null,
                        createdAt: now,
                        updatedAt: now,
                    },
                ],
                webhooks: [
                    {
                        id: "wh_qb",
                        endpointSlug: "qb-webhook-apex",
                        description: "Quickbooks entity CDC feed",
                        status: "ACTIVE",
                        enabledEvents: ["Customer.create", "Invoice.update"],
                        createdAt: now,
                    },
                ],
                activeExclusiveCapabilities: [
                    { capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC },
                ],
            });

            const detail = await getPlatformIntegrationConnection(context, "conn_detail");
            expect(detail.id).toBe("conn_detail");
            expect(detail.credentials).toHaveLength(2);
            expect(detail.activeCredential?.version).toBe(2);
            expect(detail.webhooks).toHaveLength(1);
            expect(detail.activeExclusiveCapabilities).toContain(
                IntegrationCapability.ACCOUNTING_INVOICE_SYNC
            );

            // Verify zero ciphertext leakage
            for (const cred of detail.credentials) {
                expect((cred as any).encryptedData).toBeUndefined();
                expect((cred as any).iv).toBeUndefined();
                expect((cred as any).tag).toBeUndefined();
            }
        });
    });

    // =========================================================================
    // 3. Mutating Actions & Dedicated 1:1 Audit Events
    // =========================================================================
    describe("3. Dedicated 1:1 Audit Events for all Mutating Actions", () => {
        // Action 1: updatePlatformIntegrationConfig
        it("Action 1: updatePlatformIntegrationConfig emits INTEGRATION_CONFIG_UPDATED atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueConnectionMock.mockResolvedValueOnce({
                id: "conn_cfg",
                workspaceId: "ws_alpha",
                status: IntegrationConnectionStatus.CONNECTED,
                configJson: { region: "us-east-1" },
            });

            updateConnectionMock.mockResolvedValueOnce({
                id: "conn_cfg",
                workspaceId: "ws_alpha",
                integrationId: "aws_s3",
                connectionKey: "primary",
                status: IntegrationConnectionStatus.CONNECTED,
                configJson: { region: "eu-west-1", client_secret: "secret_token_123" },
                metadataJson: null,
                externalAccountId: null,
                externalAccountName: null,
                lastTestedAt: null,
                lastErrorJson: null,
                createdAt: now,
                updatedAt: now,
            });

            const result = await updatePlatformIntegrationConfig(
                context,
                "conn_cfg",
                { region: "eu-west-1", client_secret: "secret_token_123" },
                "Migrating tenant S3 integration to European data center"
            );

            expect(result.configJson?.region).toBe("eu-west-1");
            expect(result.configJson?.client_secret).toBe("[REDACTED]");

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CONFIG_UPDATED,
                    targetType: "INTEGRATION_CONNECTION",
                    targetId: "conn_cfg",
                    workspaceId: "ws_alpha",
                    reason: "Migrating tenant S3 integration to European data center",
                    previousState: { configJson: { region: "us-east-1" } },
                    newState: { configJson: { region: "eu-west-1", client_secret: "[REDACTED]" } },
                }),
            });
        });

        // Action 2: updatePlatformIntegrationConnectionStatus
        it("Action 2: updatePlatformIntegrationConnectionStatus emits INTEGRATION_CONNECTION_STATUS_UPDATED atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueConnectionMock.mockResolvedValueOnce({
                id: "conn_status",
                workspaceId: "ws_target",
                status: IntegrationConnectionStatus.CONNECTED,
            });

            updateConnectionMock.mockResolvedValueOnce({
                id: "conn_status",
                workspaceId: "ws_target",
                integrationId: "twilio",
                connectionKey: "primary",
                status: IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
                configJson: {},
                metadataJson: null,
                externalAccountId: null,
                externalAccountName: null,
                lastTestedAt: null,
                lastErrorJson: null,
                createdAt: now,
                updatedAt: now,
            });

            const result = await updatePlatformIntegrationConnectionStatus(
                context,
                "conn_status",
                IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
                "Suspending abusive Twilio SMS dispatch pipeline after carrier spam complaints"
            );

            expect(result.status).toBe(IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT);

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_STATUS_UPDATED,
                    targetType: "INTEGRATION_CONNECTION",
                    targetId: "conn_status",
                    workspaceId: "ws_target",
                    reason: "Suspending abusive Twilio SMS dispatch pipeline after carrier spam complaints",
                    previousState: { status: IntegrationConnectionStatus.CONNECTED },
                    newState: { status: IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT },
                }),
            });
        });

        it("rejects status transition if connection is already in requested status", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            findUniqueConnectionMock.mockResolvedValueOnce({
                id: "conn_already_suspended",
                status: IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
            });

            await expect(
                updatePlatformIntegrationConnectionStatus(
                    context,
                    "conn_already_suspended",
                    IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
                    "Valid reason for transition"
                )
            ).rejects.toThrow(PlatformIntegrationConflictError);
        });

        it("rejects status update if justification reason is shorter than 10 characters (Tier-2)", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                updatePlatformIntegrationConnectionStatus(
                    context,
                    "conn_status",
                    IntegrationConnectionStatus.SUSPENDED_ENTITLEMENT,
                    "Short"
                )
            ).rejects.toThrow(PlatformActionValidationError);
        });

        // Action 3: testPlatformIntegrationConnection
        it("Action 3: testPlatformIntegrationConnection emits INTEGRATION_CONNECTION_TESTED atomically", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            findUniqueConnectionMock.mockResolvedValueOnce({
                id: "conn_test",
                workspaceId: "ws_test",
                lastTestedAt: null,
            });

            const result = await testPlatformIntegrationConnection(
                context,
                "conn_test",
                "Periodic diagnostic health verification for accounting provider"
            );

            expect(result.success).toBe(true);
            expect(result.connectionId).toBe("conn_test");

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_TESTED,
                    targetType: "INTEGRATION_CONNECTION",
                    targetId: "conn_test",
                    workspaceId: "ws_test",
                    reason: "Periodic diagnostic health verification for accounting provider",
                }),
            });
        });

        // Action 4: revokePlatformIntegrationCredential (Tier-2)
        it("Action 4: revokePlatformIntegrationCredential enforces Tier-2 guards and emits INTEGRATION_CREDENTIAL_REVOKED", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findUniqueCredentialMock.mockResolvedValueOnce({
                id: "cred_target",
                status: IntegrationCredentialStatus.ACTIVE,
                fingerprint: "sha256:abc123stripe",
                version: 1,
                connection: {
                    workspaceId: "ws_security",
                    integrationId: "stripe",
                },
            });

            updateCredentialMock.mockResolvedValueOnce({
                id: "cred_target",
                connectionId: "conn_stripe",
                version: 1,
                status: IntegrationCredentialStatus.REVOKED,
                keyVaultProvider: "AWS_KMS",
                algorithm: "AES_256_GCM",
                fingerprint: "sha256:abc123stripe",
                expiresAt: null,
                createdAt: now,
                updatedAt: now,
            });

            const result = await revokePlatformIntegrationCredential(
                context,
                "cred_target",
                "Security team revoking credential due to compromised webhook secret in git leak"
            );

            expect(result.status).toBe(IntegrationCredentialStatus.REVOKED);
            expect((result as any).encryptedData).toBeUndefined();

            expect(auditCreateMock).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CREDENTIAL_REVOKED,
                    targetType: "INTEGRATION_CREDENTIAL",
                    targetId: "cred_target",
                    workspaceId: "ws_security",
                    reason: "Security team revoking credential due to compromised webhook secret in git leak",
                    previousState: {
                        status: IntegrationCredentialStatus.ACTIVE,
                        fingerprint: "sha256:abc123stripe",
                        version: 1,
                    },
                    newState: {
                        status: IntegrationCredentialStatus.REVOKED,
                        fingerprint: "sha256:abc123stripe",
                        version: 1,
                    },
                }),
            });
        });

        it("rejects credential revocation if reason is shorter than 10 characters", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                revokePlatformIntegrationCredential(context, "cred_1", "Short")
            ).rejects.toThrow(PlatformActionValidationError);
        });

        it("rejects revocation if credential is already REVOKED", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);

            findUniqueCredentialMock.mockResolvedValueOnce({
                id: "cred_already_revoked",
                status: IntegrationCredentialStatus.REVOKED,
                connection: { workspaceId: "ws_1", integrationId: "stripe" },
            });

            await expect(
                revokePlatformIntegrationCredential(
                    context,
                    "cred_already_revoked",
                    "Legitimate justification reason at least 10 chars"
                )
            ).rejects.toThrow(PlatformIntegrationConflictError);
        });
    });

    // =========================================================================
    // 4. Execution Ledger Queries
    // =========================================================================
    describe("4. Integration Execution Ledger Queries", () => {
        it("lists integration executions across tenants with filtering", async () => {
            const context = createPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const now = new Date();

            findManyExecutionsMock.mockResolvedValueOnce([
                {
                    id: "exec_1",
                    workspaceId: "ws_alpha",
                    connectionId: "conn_1",
                    capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
                    action: "invoice.create",
                    status: IntegrationExecutionStatus.COMPLETED,
                    attemptNumber: 1,
                    durationMs: 340,
                    failureCode: null,
                    startedAt: now,
                    completedAt: now,
                    createdAt: now,
                },
                {
                    id: "exec_2",
                    workspaceId: "ws_alpha",
                    connectionId: "conn_1",
                    capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
                    action: "invoice.create",
                    status: IntegrationExecutionStatus.FAILED,
                    attemptNumber: 2,
                    durationMs: 1200,
                    failureCode: "RATE_LIMITED",
                    startedAt: now,
                    completedAt: now,
                    createdAt: now,
                },
            ]);

            const executions = await listPlatformIntegrationExecutions(context, {
                workspaceId: "ws_alpha",
                status: IntegrationExecutionStatus.COMPLETED,
            });

            expect(executions).toHaveLength(2);
            expect(executions[0].id).toBe("exec_1");
            expect(executions[0].durationMs).toBe(340);
        });
    });

    // =========================================================================
    // 5. Distinct Audit Taxonomy Uniqueness Proof
    // =========================================================================
    describe("5. Distinct Audit Taxonomy Uniqueness Proof", () => {
        it("proves all 4 integration audit events are distinct, non-overlapping strings", () => {
            const events = [
                PLATFORM_AUDIT_EVENTS.INTEGRATION_CONFIG_UPDATED,
                PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_STATUS_UPDATED,
                PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_TESTED,
                PLATFORM_AUDIT_EVENTS.INTEGRATION_CREDENTIAL_REVOKED,
            ];

            const uniqueEvents = new Set(events);
            expect(uniqueEvents.size).toBe(4);

            expect(PLATFORM_AUDIT_EVENTS.INTEGRATION_CONFIG_UPDATED).toBe(
                "platform.integration.config_updated"
            );
            expect(PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_STATUS_UPDATED).toBe(
                "platform.integration.connection_status_updated"
            );
            expect(PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_TESTED).toBe(
                "platform.integration.connection_tested"
            );
            expect(PLATFORM_AUDIT_EVENTS.INTEGRATION_CREDENTIAL_REVOKED).toBe(
                "platform.integration.credential_revoked"
            );
        });
    });
});
