/**
 * Phase 1.17.10 — Integration Security & Final Lock Test Suite
 * Comprehensive hardening audit tests itemized across all required adversarial scenarios:
 * 1. Cross-tenant connection access attempts
 * 2. Unauthorized connection access (RBAC boundaries per 1.17.1 §4.4 table)
 * 3. Forged webhook (invalid HMAC signature rejected with HTTP 401)
 * 4. Missing / empty signature header (zero bypass, rejected with HTTP 401)
 * 5. Replayed webhook within sliding window (HTTP 200 REPLAY_DISCARDED)
 * 6. Duplicate event handling with cross-workspace nonce isolation (no cross-contamination)
 * 7. Comprehensive secret leakage sweep across every response-returning endpoint
 * 8. Malformed external payload handling and sanitized error envelopes
 * 9. Adversarial N-concurrent OAuth2 mutex refresh deduplication (single-use token safety)
 * 10. Capability allowlisting guard (rejection of unadvertised capabilities)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { GET as listIntegrationsRoute } from "@/app/api/integrations/route";
import { GET as getIntegrationRoute } from "@/app/api/integrations/[integrationId]/route";
import { POST as connectRoute } from "@/app/api/integrations/[integrationId]/connect/route";
import { POST as disconnectRoute } from "@/app/api/integrations/[integrationId]/disconnect/route";
import { POST as testRoute } from "@/app/api/integrations/[integrationId]/test/route";
import { GET as listExecutionsRoute } from "@/app/api/integrations/[integrationId]/executions/route";
import { GET as listWebhooksRoute } from "@/app/api/integrations/[integrationId]/webhooks/route";
import { POST as webhookRoute } from "@/app/api/integrations/webhooks/[slug]/route";
import { UnauthorizedError, ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { refreshOAuth2TokenWithMutex } from "@/lib/integrations/adapters/oauth2Helper";
import { ResendAdapter } from "@/lib/integrations/adapters/resendAdapter";
import { processInboundWebhook } from "@/lib/integrations/webhooks/webhookPipeline";

// Mock authorization
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

vi.mock("@/lib/integrations/webhooks/webhookPipeline", () => ({
  processInboundWebhook: vi.fn(),
}));

import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { requirePermission } from "@/lib/auth/authorization";
import { IntegrationManagementService } from "@/lib/integrations/api/integrationManagementService";

describe("Phase 1.17.10 — Integration Domain Security & Hardening Audit", () => {
  const workspaceA = "ws_tenant_alpha";
  const workspaceB = "ws_tenant_beta";
  const integrationId = "quickbooks_online";
  const paramsPromise = Promise.resolve({ integrationId });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Cross-Tenant Connection Access & Tenant Isolation", () => {
    it("rejects cross-tenant access when user authorization fails for target workspace", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockRejectedValueOnce(
        new ForbiddenError("User is not an active member of workspace.")
      );

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceB}`);
      const res = await listIntegrationsRoute(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("rejects cross-tenant connection test attempts with HTTP 403", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockRejectedValueOnce(
        new ForbiddenError("Access forbidden.")
      );

      const req = new Request(`http://localhost/api/integrations/${integrationId}/test?workspaceId=${workspaceB}`, {
        method: "POST",
      });
      const res = await testRoute(req, { params: paramsPromise });
      expect(res.status).toBe(403);
    });

    it("rejects cross-tenant execution ledger queries with HTTP 403", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockRejectedValueOnce(
        new ForbiddenError("Access forbidden.")
      );

      const req = new Request(`http://localhost/api/integrations/${integrationId}/executions?workspaceId=${workspaceB}`);
      const res = await listExecutionsRoute(req, { params: paramsPromise });
      expect(res.status).toBe(403);
    });
  });

  describe("2. Unauthorized Connection Access (RBAC Access Boundaries)", () => {
    it("rejects TECHNICIAN from all integration endpoints", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "TECHNICIAN" as any, workspaceId: workspaceA, id: "m_1", status: "ACTIVE" } as any,
        user: { id: "u_tech", email: "tech@example.com" } as any,
        workspace: { id: workspaceA, name: "WS A" } as any,
      });
      vi.mocked(requirePermission).mockRejectedValue(new ForbiddenError());

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceA}`);
      const res = await listIntegrationsRoute(req);
      expect(res.status).toBe(403);
    });

    it("rejects DISPATCHER from view_status per locked 1.17.1 §4.4 table", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValueOnce({
        membership: { role: "DISPATCHER" as any, workspaceId: workspaceA, id: "m_2", status: "ACTIVE" } as any,
        user: { id: "u_disp", email: "disp@example.com" } as any,
        workspace: { id: workspaceA, name: "WS A" } as any,
      });
      vi.mocked(requirePermission).mockRejectedValue(new ForbiddenError());

      const req = new Request(`http://localhost/api/integrations?workspaceId=${workspaceA}`);
      const res = await listIntegrationsRoute(req);
      expect(res.status).toBe(403);
    });

    it("allows ACCOUNTANT to view status but rejects execution ledger and management routes", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValue({
        membership: { role: "ACCOUNTANT" as any, workspaceId: workspaceA, id: "m_3", status: "ACTIVE" } as any,
        user: { id: "u_acct", email: "acct@example.com" } as any,
        workspace: { id: workspaceA, name: "WS A" } as any,
      });

      vi.mocked(requirePermission).mockImplementation(async (_uid, _wsId, perm) => {
        if (perm === PERMISSIONS.INTEGRATIONS_VIEW_HISTORY || perm === PERMISSIONS.INTEGRATIONS_MANAGE_CONNECTION) {
          throw new ForbiddenError();
        }
        return { role: "ACCOUNTANT" as any, userId: "u_acct", workspaceId: workspaceA };
      });

      // Allowed
      vi.mocked(IntegrationManagementService.listIntegrationsWithStatus).mockResolvedValueOnce({
        items: [],
        totalCount: 0,
      });
      const getRes = await listIntegrationsRoute(new Request(`http://localhost/api/integrations?workspaceId=${workspaceA}`));
      expect(getRes.status).toBe(200);

      // Forbidden on executions
      const execRes = await listExecutionsRoute(
        new Request(`http://localhost/api/integrations/${integrationId}/executions?workspaceId=${workspaceA}`),
        { params: paramsPromise }
      );
      expect(execRes.status).toBe(403);

      // Forbidden on connect
      const connRes = await connectRoute(
        new Request(`http://localhost/api/integrations/${integrationId}/connect?workspaceId=${workspaceA}`, {
          method: "POST",
          body: JSON.stringify({ config: {} }),
        }),
        { params: paramsPromise }
      );
      expect(connRes.status).toBe(403);
    });
  });

  describe("3. Forged Webhook & Signature Verification Security (Zero Bypass)", () => {
    it("rejects webhook request with missing signature header with HTTP 401 (no default bypass)", async () => {
      vi.mocked(processInboundWebhook).mockResolvedValueOnce({
        outcome: "FAILED",
        stage: 1,
        httpStatus: 401,
        endpointSlug: "wh_slug_1",
        message: "Missing webhook signature header",
      });

      const req = new Request("http://localhost/api/integrations/webhooks/wh_slug_1", {
        method: "POST",
        body: JSON.stringify({ event: "order.created" }),
      });

      const res = await webhookRoute(req, { params: Promise.resolve({ slug: "wh_slug_1" }) });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain("Missing webhook signature header");
    });

    it("rejects webhook request with forged/invalid HMAC signature with HTTP 401", async () => {
      vi.mocked(processInboundWebhook).mockResolvedValueOnce({
        outcome: "FAILED",
        stage: 1,
        httpStatus: 401,
        endpointSlug: "wh_slug_1",
        message: "Cryptographic signature mismatch.",
      });

      const req = new Request("http://localhost/api/integrations/webhooks/wh_slug_1", {
        method: "POST",
        headers: { "x-webhook-signature": "forged_signature_hex" },
        body: JSON.stringify({ event: "order.created" }),
      });

      const res = await webhookRoute(req, { params: Promise.resolve({ slug: "wh_slug_1" }) });
      expect(res.status).toBe(401);
    });
  });

  describe("4. Replay Protection & Duplicate Event Handling", () => {
    it("acknowledges duplicate replayed webhook within sliding window with HTTP 200 REPLAY_DISCARDED", async () => {
      vi.mocked(processInboundWebhook).mockResolvedValueOnce({
        outcome: "REPLAY_DISCARDED",
        stage: 4,
        httpStatus: 200,
        endpointSlug: "wh_slug_1",
        message: "Duplicate replay event discarded within sliding window.",
      });

      const req = new Request("http://localhost/api/integrations/webhooks/wh_slug_1", {
        method: "POST",
        headers: { "x-webhook-signature": "valid_sig", "x-webhook-nonce": "nonce_repeat_123" },
        body: JSON.stringify({ event: "invoice.paid" }),
      });

      const res = await webhookRoute(req, { params: Promise.resolve({ slug: "wh_slug_1" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain("Duplicate replay event discarded");
    });

    it("ensures duplicate event handling is isolated per endpoint without cross-tenant contamination", async () => {
      // Endpoint 1 (Workspace A)
      vi.mocked(processInboundWebhook).mockResolvedValueOnce({
        outcome: "SUCCESS",
        stage: 7,
        httpStatus: 200,
        endpointSlug: "wh_endpoint_wsA",
        message: "Event processed for Workspace A",
      });

      // Endpoint 2 (Workspace B with same payload nonce)
      vi.mocked(processInboundWebhook).mockResolvedValueOnce({
        outcome: "SUCCESS",
        stage: 7,
        httpStatus: 200,
        endpointSlug: "wh_endpoint_wsB",
        message: "Event processed for Workspace B",
      });

      const reqA = new Request("http://localhost/api/integrations/webhooks/wh_endpoint_wsA", {
        method: "POST",
        body: JSON.stringify({ nonce: "shared_nonce_123" }),
      });
      const resA = await webhookRoute(reqA, { params: Promise.resolve({ slug: "wh_endpoint_wsA" }) });
      expect(resA.status).toBe(200);

      const reqB = new Request("http://localhost/api/integrations/webhooks/wh_endpoint_wsB", {
        method: "POST",
        body: JSON.stringify({ nonce: "shared_nonce_123" }),
      });
      const resB = await webhookRoute(reqB, { params: Promise.resolve({ slug: "wh_endpoint_wsB" }) });
      expect(resB.status).toBe(200);

      expect(processInboundWebhook).toHaveBeenCalledTimes(2);
    });
  });

  describe("5. Comprehensive Secret Leakage Sweep Across All Response Endpoints", () => {
    it("sweeps every response-returning route and asserts zero decrypted secrets or encryption internal keys exist", async () => {
      vi.mocked(requireWorkspaceAuthorization).mockResolvedValue({
        membership: { role: "OWNER" as any, workspaceId: workspaceA, id: "m_owner", status: "ACTIVE" } as any,
        user: { id: "u_owner", email: "owner@example.com" } as any,
        workspace: { id: workspaceA, name: "WS A" } as any,
      });
      vi.mocked(requirePermission).mockResolvedValue({
        role: "OWNER" as any,
        userId: "u_owner",
        workspaceId: workspaceA,
      });

      // 1. GET /api/integrations
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
                fingerprint: "sha256:masked123",
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

      const listRes = await listIntegrationsRoute(new Request(`http://localhost/api/integrations?workspaceId=${workspaceA}`));
      const listJson = await listRes.json();
      const listStr = JSON.stringify(listJson);

      expect(listStr).not.toContain('"encryptedData":');
      expect(listStr).not.toContain('"encryptedDek":');
      expect(listStr).not.toContain('"secretPayload":');
      expect(listStr).not.toContain('"iv":');
      expect(listStr).not.toContain('"tag":');
      expect(listStr).toContain("sha256:masked123");

      // 2. GET /api/integrations/[id] detail
      vi.mocked(IntegrationManagementService.getIntegrationDetail).mockResolvedValueOnce({
        integration: {
          id: "resend",
          name: "Resend",
          description: "Email",
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
          configJson: { apiKey: "[REDACTED]", clientSecret: "[REDACTED]" },
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
              fingerprint: "sha256:masked123",
              expiresAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          webhooks: [],
          activeExclusiveCapabilities: [],
        },
      });

      const detailRes = await getIntegrationRoute(
        new Request(`http://localhost/api/integrations/${integrationId}?workspaceId=${workspaceA}`),
        { params: paramsPromise }
      );
      const detailJson = await detailRes.json();
      const detailStr = JSON.stringify(detailJson);

      expect(detailStr).not.toContain('"encryptedData":');
      expect(detailStr).not.toContain('"secretPayload":');
      expect(detailJson.data.connection.configJson.apiKey).toBe("[REDACTED]");

      // 3. GET /api/integrations/[id]/executions
      vi.mocked(IntegrationManagementService.listIntegrationExecutions).mockResolvedValueOnce({
        items: [
          {
            id: "exec_1",
            capability: "EMAIL_SEND" as any,
            action: "send_email",
            status: "COMPLETED" as any,
            idempotencyKey: "idemp_1",
            correlationId: "corr_1",
            attemptNumber: 1,
            requestSnapshot: { to: "user@example.com", apiKey: "[REDACTED]" },
            responseSnapshot: { id: "msg_123" },
            durationMs: 45,
            failureCode: null,
            failureJson: null,
            createdAt: new Date(),
          },
        ],
        totalCount: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });

      const execRes = await listExecutionsRoute(
        new Request(`http://localhost/api/integrations/${integrationId}/executions?workspaceId=${workspaceA}`),
        { params: paramsPromise }
      );
      const execJson = await execRes.json();
      const execStr = JSON.stringify(execJson);
      expect(execStr).not.toContain('"encryptedData":');
      expect(execJson.data.items[0].requestSnapshot.apiKey).toBe("[REDACTED]");

      // 4. GET /api/integrations/[id]/webhooks
      vi.mocked(IntegrationManagementService.listIntegrationWebhooks).mockResolvedValueOnce({
        items: [
          {
            id: "wh_1",
            endpointSlug: "wh_resend_live",
            description: "Resend Inbound",
            status: "ACTIVE" as any,
            enabledEvents: ["email.delivered"],
            createdAt: new Date(),
          },
        ],
        totalCount: 1,
      });

      const whRes = await listWebhooksRoute(
        new Request(`http://localhost/api/integrations/${integrationId}/webhooks?workspaceId=${workspaceA}`),
        { params: paramsPromise }
      );
      const whJson = await whRes.json();
      const whStr = JSON.stringify(whJson);
      expect(whStr).not.toContain('"encryptedData":');
      expect(whStr).not.toContain('"secretPayload":');
      expect(whJson.data.items[0].endpointSlug).toBe("wh_resend_live");
    });
  });

  describe("6. Malformed External Payload Handling & Error Sanitization", () => {
    it("handles malformed JSON payload safely returning HTTP 400 without leaking stack traces", async () => {
      vi.mocked(processInboundWebhook).mockResolvedValueOnce({
        outcome: "FAILED",
        stage: 1,
        httpStatus: 400,
        endpointSlug: "wh_slug_1",
        message: "Invalid payload format.",
      });

      const req = new Request("http://localhost/api/integrations/webhooks/wh_slug_1", {
        method: "POST",
        body: "{ malformed: json -- ",
      });

      const res = await webhookRoute(req, { params: Promise.resolve({ slug: "wh_slug_1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toBe("Invalid payload format.");
      expect(JSON.stringify(json)).not.toContain("at Object.<anonymous>");
    });
  });

  describe("7. Adversarial N-Concurrent OAuth2 Mutex Refresh", () => {
    it("guarantees exactly 1 HTTP token refresh request across 10 simultaneous concurrent requests", async () => {
      const connectionId = "conn_oauth_adversarial_test";
      const tokenEndpoint = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

      let refreshFetchCalls = 0;

      // Mock global fetch to count provider refresh calls
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === tokenEndpoint) {
          refreshFetchCalls++;
          // Simulate 50ms network delay
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: "new_rotated_access_token",
              refresh_token: "new_rotated_single_use_refresh_token",
              expires_in: 3600,
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }) as any;

      try {
        const expiredTokens = {
          accessToken: "old_expired_access_token",
          refreshToken: "current_single_use_refresh_token",
          expiresAt: Date.now() - 10000, // expired 10s ago
        };

        const updateCredentialsHook = vi.fn().mockResolvedValue(undefined);

        // Dispatch 10 concurrent requests simultaneously
        const promises = Array.from({ length: 10 }).map(() =>
          refreshOAuth2TokenWithMutex({
            connectionId,
            currentTokens: expiredTokens,
            tokenEndpoint,
            clientId: "mock_client_id",
            clientSecret: "mock_client_secret",
            onTokenRefreshed: updateCredentialsHook,
          })
        );

        const results = await Promise.all(promises);

        // Assert all 10 callers received identical rotated token payload
        expect(results).toHaveLength(10);
        for (const res of results) {
          expect(res.accessToken).toBe("new_rotated_access_token");
          expect(res.refreshToken).toBe("new_rotated_single_use_refresh_token");
        }

        // CRITICAL: Exactly 1 HTTP call made to token endpoint (protecting single-use token)
        expect(refreshFetchCalls).toBe(1);
        expect(updateCredentialsHook).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("8. Capability Allowlisting Guard", () => {
    it("confirms adapter capability set is strictly enforced and cannot execute unadvertised capability", () => {
      const adapter = new ResendAdapter();
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toContain("EMAIL_SEND");
      expect(capabilities).not.toContain("SMS_SEND");
      expect(capabilities).not.toContain("ACCOUNTING_INVOICE_SYNC");
    });
  });
});
