/**
 * Phase 1.17.9 — Integration Management REST API Test Suite
 * Tests RBAC permissions per role (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN),
 * granular credential-bearing checks, tenant isolation, zero credential leakage,
 * execution ledger pagination, and connection lifecycle endpoints.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as listIntegrationsRoute } from "@/app/api/integrations/route";
import { GET as getIntegrationRoute } from "@/app/api/integrations/[integrationId]/route";
import { POST as connectRoute } from "@/app/api/integrations/[integrationId]/connect/route";
import { POST as disconnectRoute } from "@/app/api/integrations/[integrationId]/disconnect/route";
import { POST as testRoute } from "@/app/api/integrations/[integrationId]/test/route";
import { GET as listExecutionsRoute } from "@/app/api/integrations/[integrationId]/executions/route";
import { GET as listWebhooksRoute } from "@/app/api/integrations/[integrationId]/webhooks/route";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { PERMISSIONS } from "@/lib/auth/permissions";

// Mock workspace authorization & permissions
vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
  requireWorkspaceAuthorization: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn(),
}));

// Mock service layer
vi.mock("@/lib/integrations/api/integrationManagementService", () => ({
  IntegrationManagementService: {
    listIntegrationsWithStatus: vi.fn(),
    getIntegrationDetail: vi.fn(),
    connectIntegration: vi.fn(),
    disconnectIntegration: vi.fn(),
    testIntegrationConnection: vi.fn(),
    listIntegrationExecutions: vi.fn(),
    listIntegrationWebhooks: vi.fn(),
  },
}));

import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { requirePermission } from "@/lib/auth/authorization";
import { IntegrationManagementService } from "@/lib/integrations/api/integrationManagementService";

describe("Phase 1.17.9 — Integration Management REST API", () => {
  const workspaceId = "ws_test_integrations_123";
  const integrationId = "resend";
  const paramsPromise = Promise.resolve({ integrationId });

  const mockUser = { id: "user_owner", email: "owner@aforden.com", name: "Owner User" };
  const mockWorkspace = { id: workspaceId, name: "Aforden HVAC" };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireWorkspaceAuthorization).mockResolvedValue({
      membership: { role: "OWNER" as any, workspaceId, id: "mem_1", status: "ACTIVE" } as any,
      user: mockUser as any,
      workspace: mockWorkspace as any,
    });

    vi.mocked(requirePermission).mockResolvedValue({
      role: "OWNER" as any,
      userId: mockUser.id,
      workspaceId,
    });
  });

  describe("1. RBAC Matrix & Role-Level Access Enforcement", () => {
    it("rejects unauthenticated requests with HTTP 401 UNAUTHORIZED", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockRejectedValueOnce(
        new UnauthorizedError("Authentication required.")
      );

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceId}`);
      const res = await listIntegrationsRoute(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects unauthorized workspace access attempts (tenant isolation)", async () => {
      vi.mocked(requirePermission).mockRejectedValueOnce(
        new ForbiddenError("Access forbidden.")
      );

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceId}`);
      const res = await listIntegrationsRoute(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("allows MANAGER to view status and executions, but rejects connect/disconnect/test", async () => {
      // Setup mock to fail when requirePermission is called for MANAGE_CONNECTION
      vi.mocked(requirePermission).mockImplementation(async (_userId, _wsId, perm) => {
        if (perm === PERMISSIONS.INTEGRATIONS_MANAGE_CONNECTION) {
          throw new ForbiddenError();
        }
        return { role: "MANAGER" as any, userId: "u_mgr", workspaceId };
      });

      // 1. GET /api/integrations - Allowed
      vi.mocked(IntegrationManagementService.listIntegrationsWithStatus).mockResolvedValueOnce({
        items: [],
        totalCount: 0,
      });
      const getReq = new Request(`http://localhost/api/integrations?workspaceId=${workspaceId}`);
      const getRes = await listIntegrationsRoute(getReq);
      expect(getRes.status).toBe(200);

      // 2. POST /api/integrations/[id]/connect - Forbidden
      const connectReq = new Request(`http://localhost/api/integrations/${integrationId}/connect?workspaceId=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify({ config: { test: true } }),
      });
      const connectRes = await connectRoute(connectReq, { params: paramsPromise });
      expect(connectRes.status).toBe(403);

      // 3. POST /api/integrations/[id]/disconnect - Forbidden
      const discReq = new Request(`http://localhost/api/integrations/${integrationId}/disconnect?workspaceId=${workspaceId}`, {
        method: "POST",
      });
      const discRes = await disconnectRoute(discReq, { params: paramsPromise });
      expect(discRes.status).toBe(403);
    });

    it("allows ACCOUNTANT to view status and webhooks, but rejects execution history and manage routes", async () => {
      vi.mocked(requirePermission).mockImplementation(async (_userId, _wsId, perm) => {
        if (perm === PERMISSIONS.INTEGRATIONS_VIEW_HISTORY || perm === PERMISSIONS.INTEGRATIONS_MANAGE_CONNECTION) {
          throw new ForbiddenError();
        }
        return { role: "ACCOUNTANT" as any, userId: "u_acct", workspaceId };
      });

      // 1. GET /api/integrations - Allowed
      vi.mocked(IntegrationManagementService.listIntegrationsWithStatus).mockResolvedValueOnce({
        items: [],
        totalCount: 0,
      });
      const getReq = new Request(`http://localhost/api/integrations?workspaceId=${workspaceId}`);
      const getRes = await listIntegrationsRoute(getReq);
      expect(getRes.status).toBe(200);

      // 2. GET /api/integrations/[id]/webhooks - Allowed
      vi.mocked(IntegrationManagementService.listIntegrationWebhooks).mockResolvedValueOnce({
        items: [],
        totalCount: 0,
      });
      const webhookReq = new Request(`http://localhost/api/integrations/${integrationId}/webhooks?workspaceId=${workspaceId}`);
      const webhookRes = await listWebhooksRoute(webhookReq, { params: paramsPromise });
      expect(webhookRes.status).toBe(200);

      // 3. GET /api/integrations/[id]/executions - Forbidden
      const execReq = new Request(`http://localhost/api/integrations/${integrationId}/executions?workspaceId=${workspaceId}`);
      const execRes = await listExecutionsRoute(execReq, { params: paramsPromise });
      expect(execRes.status).toBe(403);
    });

    it("rejects DISPATCHER from all integration routes (view_status: Deny per 1.17.1 §4.4)", async () => {
      vi.mocked(requirePermission).mockRejectedValue(new ForbiddenError("Access forbidden."));

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceId}`);
      const res = await listIntegrationsRoute(req);
      expect(res.status).toBe(403);
    });

    it("rejects TECHNICIAN from all integration routes", async () => {
      vi.mocked(requirePermission).mockRejectedValue(new ForbiddenError());

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceId}`);
      const res = await listIntegrationsRoute(req);
      expect(res.status).toBe(403);
    });

    it("enforces granular check: credential-bearing connect requires INTEGRATIONS_MANAGE_CREDENTIALS", async () => {
      vi.mocked(requirePermission).mockImplementation(async (_userId, _wsId, perm) => {
        if (perm === PERMISSIONS.INTEGRATIONS_MANAGE_CREDENTIALS) {
          throw new ForbiddenError("Requires credentials management permission.");
        }
        return { role: "ADMIN" as any, userId: "u_admin", workspaceId };
      });

      const credReq = new Request(`http://localhost/api/integrations/${integrationId}/connect?workspaceId=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify({ apiKey: "re_live_secret_key_123" }),
      });

      const res = await connectRoute(credReq, { params: paramsPromise });
      expect(res.status).toBe(403);
      expect(requirePermission).toHaveBeenCalledWith(
        mockUser.id,
        workspaceId,
        PERMISSIONS.INTEGRATIONS_MANAGE_CREDENTIALS
      );
    });
  });

  describe("2. Zero Credential Leakage & Masking", () => {
    it("asserts GET /api/integrations never leaks decrypted secrets or encryption internals", async () => {
      vi.mocked(IntegrationManagementService.listIntegrationsWithStatus).mockResolvedValueOnce({
        items: [
          {
            id: "resend",
            name: "Resend",
            description: "Email",
            logoUrl: undefined,
            status: "AVAILABLE" as any,
            capabilities: ["EMAIL_SEND" as any],
            authType: "API_KEY" as any,
            connection: {
              id: "conn_1",
              status: "CONNECTED" as any,
              connectionKey: "primary",
              externalAccountId: null,
              externalAccountName: null,
              lastTestedAt: new Date(),
              lastErrorJson: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              activeCredential: {
                id: "cred_1",
                version: 1,
                status: "ACTIVE",
                keyVaultProvider: "LOCAL_ENCRYPTED_DB",
                algorithm: "AES_256_GCM",
                fingerprint: "sha256:abcd1234efgh5678",
                expiresAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              activeExclusiveCapabilities: [],
            },
            defaultForCapabilities: ["EMAIL_SEND"],
          },
        ],
        totalCount: 1,
      });

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceId}`);
      const res = await listIntegrationsRoute(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const bodyStr = JSON.stringify(json);
      expect(bodyStr).not.toContain('"encryptedData":');
      expect(bodyStr).not.toContain('"encryptedDek":');
      expect(bodyStr).not.toContain('"secretPayload":');
      expect(bodyStr).not.toContain('"iv":');
      expect(bodyStr).not.toContain('"tag":');
      expect(bodyStr).toContain("sha256:abcd1234efgh5678");
    });

    it("asserts GET /api/integrations/[id] detail returns masked credentials and sanitized config", async () => {
      vi.mocked(IntegrationManagementService.getIntegrationDetail).mockResolvedValueOnce({
        integration: {
          id: "resend",
          name: "Resend",
          description: "Email delivery",
          logoUrl: undefined,
          capabilities: ["EMAIL_SEND" as any],
          authType: "API_KEY" as any,
          configSchemaJson: {},
        },
        connection: {
          id: "conn_1",
          status: "CONNECTED" as any,
          connectionKey: "primary",
          externalAccountId: null,
          externalAccountName: null,
          configJson: { webhookUrl: "https://aforden.com/hook", secretKey: "[REDACTED]" },
          lastTestedAt: new Date(),
          lastErrorJson: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          credentials: [
            {
              id: "cred_1",
              version: 1,
              status: "ACTIVE",
              keyVaultProvider: "LOCAL_ENCRYPTED_DB",
              algorithm: "AES_256_GCM",
              fingerprint: "sha256:abcd1234",
              expiresAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          webhooks: [],
          activeExclusiveCapabilities: [],
        },
      });

      const req = new Request(`http://localhost/api/integrations/${integrationId}?workspaceId=${workspaceId}`);
      const res = await getIntegrationRoute(req, { params: paramsPromise });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.connection.configJson.secretKey).toBe("[REDACTED]");
      expect(json.data.connection.credentials[0].fingerprint).toBe("sha256:abcd1234");
    });
  });

  describe("3. Execution History Pagination & Sorting", () => {
    it("parses query parameters and returns paginated execution records", async () => {
      vi.mocked(IntegrationManagementService.listIntegrationExecutions).mockResolvedValueOnce({
        items: [
          {
            id: "exec_1",
            capability: "EMAIL_SEND" as any,
            action: "sendEmail",
            status: "COMPLETED" as any,
            attemptNumber: 1,
            idempotencyKey: "idem_123",
            correlationId: "corr_456",
            durationMs: 142,
            requestSnapshot: { to: "user@example.com", apiKey: "[REDACTED]" },
            responseSnapshot: { messageId: "msg_789" },
            failureCode: null,
            failureJson: null,
            createdAt: new Date(),
          },
        ],
        totalCount: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      const req = new Request(
        `http://localhost/api/integrations/${integrationId}/executions?workspaceId=${workspaceId}&page=1&pageSize=10&status=COMPLETED&sortBy=durationMs&sortOrder=asc`
      );
      const res = await listExecutionsRoute(req, { params: paramsPromise });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.items[0].requestSnapshot.apiKey).toBe("[REDACTED]");
      expect(IntegrationManagementService.listIntegrationExecutions).toHaveBeenCalledWith(
        workspaceId,
        integrationId,
        expect.objectContaining({
          page: 1,
          pageSize: 10,
          status: "COMPLETED",
          sortBy: "durationMs",
          sortOrder: "asc",
        })
      );
    });
  });

  describe("4. Connection Lifecycle Endpoints", () => {
    it("handles OAuth initiation via POST /connect", async () => {
      vi.mocked(IntegrationManagementService.connectIntegration).mockResolvedValueOnce({
        action: "initiate",
        authorizationUrl: "https://appcenter.intuit.com/connect/oauth2?client_id=...",
        state: "encoded_state_token",
      });

      const req = new Request(`http://localhost/api/integrations/quickbooks_online/connect?workspaceId=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify({ action: "initiate" }),
      });

      const res = await connectRoute(req, {
        params: Promise.resolve({ integrationId: "quickbooks_online" }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.action).toBe("initiate");
      expect(json.data.authorizationUrl).toContain("appcenter.intuit.com");
    });

    it("disconnects integration via POST /disconnect", async () => {
      vi.mocked(IntegrationManagementService.disconnectIntegration).mockResolvedValueOnce({
        success: true,
        connectionStatus: "DISCONNECTED" as any,
      });

      const req = new Request(`http://localhost/api/integrations/${integrationId}/disconnect?workspaceId=${workspaceId}`, {
        method: "POST",
      });

      const res = await disconnectRoute(req, { params: paramsPromise });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.connectionStatus).toBe("DISCONNECTED");
    });

    it("runs health test via POST /test", async () => {
      vi.mocked(IntegrationManagementService.testIntegrationConnection).mockResolvedValueOnce({
        success: true,
        latencyMs: 85,
        checkedAt: new Date(),
      });

      const req = new Request(`http://localhost/api/integrations/${integrationId}/test?workspaceId=${workspaceId}`, {
        method: "POST",
      });

      const res = await testRoute(req, { params: paramsPromise });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.latencyMs).toBe(85);
    });
  });
});
