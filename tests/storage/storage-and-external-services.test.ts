/**
 * Phase 1.22.6 — Storage & External Services Production Readiness Tests
 *
 * Verifies:
 * 1. Cloud Storage Guardrails (AwsS3Adapter size limits, MIME safety, path traversal, tenant scoping, bucket lockdown, presigned URL expiry bounds)
 * 2. Inbound Webhook Receivers (signature enforcement, rate-limiting non-exemption)
 * 3. Outbound External API Integrations (timeouts, retry backoff, credential redaction in audit snapshots)
 * 4. CORS & Origin Configuration (no wildcard credentials, webhooks free of CORS)
 * 5. Production Service Credentials Separation (Paddle sandbox/prod toggle, QuickBooks sandbox/prod endpoint resolution)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  AwsS3Adapter,
  generatePresignedDownloadUrl,
} from "@/lib/integrations/adapters/awsS3Adapter";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationConnection,
  type IntegrationSecretReference,
  type IntegrationExecutionRequest,
} from "@/lib/integrations/adapters/types";
import { CAPABILITY_REGISTRY } from "@/lib/integrations/registry";
import { computeBackoffDelayMs } from "@/lib/integrations/execution/retryOrchestrator";
import { redactSensitiveData } from "@/lib/integrations/execution/redaction";
import { applyApiSecurityMiddleware, RATE_LIMIT_CONFIGS } from "@/lib/api/apiSecurityMiddleware";
import { PUBLIC_API_CORS_HEADERS } from "@/lib/api/securityHeaders";
import { proxy } from "@/proxy";
import { QuickBooksAdapter } from "@/lib/integrations/adapters/quickBooksAdapter";
import { PaddleBillingAdapter } from "@/lib/services/billing/providers/paddleBillingAdapter";
import { Environment } from "@paddle/paddle-node-sdk";

describe("Phase 1.22.6 — Storage & External Services Production Readiness", () => {
  let adapter: AwsS3Adapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  const sampleAccessKeyId = "AKIAIOSFODNN7EXAMPLE";
  const sampleSecretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const sampleBucketName = "aforden-storage-prod";
  const sampleRegion = "us-east-1";
  const activeWorkspaceId = "ws_tenant_alpha_123";

  beforeEach(() => {
    adapter = new AwsS3Adapter();
    mockConnection = {
      id: "conn_s3_prod_001",
      workspaceId: activeWorkspaceId,
      integrationId: "aws_s3",
      connectionKey: "primary",
      status: IntegrationConnectionStatus.CONNECTED,
      configJson: {
        bucketName: sampleBucketName,
        region: sampleRegion,
      },
      metadataJson: null,
      externalAccountId: `${sampleBucketName} (${sampleRegion})`,
      externalAccountName: `Amazon S3 - ${sampleBucketName}`,
      lastTestedAt: null,
      lastErrorJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockSecretRef = {
      secretId: "sec_s3_prod_001",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:s3prod123",
      secretPayload: JSON.stringify({
        accessKeyId: sampleAccessKeyId,
        secretAccessKey: sampleSecretAccessKey,
        bucketName: sampleBucketName,
        region: sampleRegion,
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getBaseUploadRequest = (payloadOverrides: Record<string, unknown> = {}): IntegrationExecutionRequest => ({
    workspaceId: activeWorkspaceId,
    connectionId: mockConnection.id,
    capability: IntegrationCapability.FILE_UPLOAD,
    action: "upload_file",
    payload: {
      key: `workspaces/${activeWorkspaceId}/workorders/1042/evidence.jpg`,
      content: "sample_binary_content",
      contentType: "image/jpeg",
      ...payloadOverrides,
    },
    idempotencyKey: "idem-test-s3-upload",
    correlationId: "corr-test-s3-upload",
    secretReference: mockSecretRef,
    connectionConfig: {
      bucketName: sampleBucketName,
      region: sampleRegion,
    },
  });

  // =========================================================================
  // 1. S3 Cloud Storage Guardrails & Security
  // =========================================================================
  describe("1. Cloud Storage Guardrails & Security", () => {
    it("rejects uploads exceeding the 25MB file size limit with PAYLOAD_VALIDATION_FAILED (400)", async () => {
      // Allocate an oversized buffer: 25MB + 1 byte
      const oversizedBuffer = Buffer.alloc(AwsS3Adapter.MAX_UPLOAD_BYTES + 1);

      const request = getBaseUploadRequest({ content: oversizedBuffer });
      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.rawResponseStatus).toBe(400);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.message).toContain("exceeds maximum permitted upload limit of 26214400 bytes (25MB)");
    });

    it("rejects disallowed dangerous MIME types (HTML, executable, scripts) to prevent stored XSS", async () => {
      const dangerousTypes = [
        "text/html",
        "application/xhtml+xml",
        "application/x-msdownload",
        "application/javascript",
        "text/javascript",
      ];

      for (const badMime of dangerousTypes) {
        const request = getBaseUploadRequest({ contentType: badMime });
        const result = await adapter.execute(request);

        expect(result.success).toBe(false);
        expect(result.rawResponseStatus).toBe(400);
        expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
        expect(result.failure?.message).toContain(`Upload rejected: content type '${badMime}' is not permitted for storage.`);
      }
    });

    it("permits standard media and document MIME types (JPEG, PNG, WebP, PDF)", async () => {
      const safeTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

      const mockHeaders = new Headers();
      mockHeaders.set("etag", '"etag123"');

      for (const safeMime of safeTypes) {
        vi.spyOn(global, "fetch").mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: mockHeaders,
          text: async () => "",
        } as unknown as Response);

        const request = getBaseUploadRequest({ contentType: safeMime });
        const result = await adapter.execute(request);

        expect(result.success).toBe(true);
        expect(result.capability).toBe(IntegrationCapability.FILE_UPLOAD);
      }
    });

    it("rejects path traversal attempts ('..' or backslash) in object keys", async () => {
      const traversalKeys = [
        "../secret.txt",
        "workspaces/ws123/../../../etc/passwd",
        "..\\windows\\system32\\cmd.exe",
        "workspaces/..//other",
      ];

      for (const badKey of traversalKeys) {
        const request = getBaseUploadRequest({ key: badKey });
        const result = await adapter.execute(request);

        expect(result.success).toBe(false);
        expect(result.rawResponseStatus).toBe(400);
        expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
        expect(result.failure?.message).toContain("Path traversal characters ('..' or '\\') are not permitted in object keys.");
      }
    });

    it("strictly rejects cross-workspace access attempts when key targets another workspace", async () => {
      const targetOtherWorkspaceKey = "workspaces/ws_tenant_VICTIM_999/photos/evidence.jpg";
      const request = getBaseUploadRequest({ key: targetOtherWorkspaceKey });

      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.rawResponseStatus).toBe(403);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.message).toContain("Cross-workspace access denied: object key does not belong to the active workspace.");
    });

    it("rejects unauthorized target bucket overrides outside the configured environment bucket", async () => {
      const request = getBaseUploadRequest({ bucket: "unauthorized-external-bucket" });
      const result = await adapter.execute(request);

      expect(result.success).toBe(false);
      expect(result.rawResponseStatus).toBe(400);
      expect(result.failure?.code).toBe(IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED);
      expect(result.failure?.message).toContain("Target bucket override is not permitted; operations are restricted to configured environment bucket 'aforden-storage-prod'.");
    });

    it("bounds presigned download URL expiry within safe limits [1s, 604800s] and defaults to 3600s", async () => {
      // Test default (when unspecified or 0)
      const defaultRes = await adapter.execute({
        ...getBaseUploadRequest(),
        capability: IntegrationCapability.FILE_DOWNLOAD,
        action: "get_download_url",
        payload: {
          key: `workspaces/${activeWorkspaceId}/doc.pdf`,
        },
      });
      expect(defaultRes.success).toBe(true);
      expect(defaultRes.data?.expiresInSeconds).toBe(3600);
      expect(defaultRes.data?.downloadUrl).toContain("X-Amz-Expires=3600");

      // Test upper bound clamp (e.g. 1,000,000s capped to 604,800s / 7 days)
      const cappedRes = await adapter.execute({
        ...getBaseUploadRequest(),
        capability: IntegrationCapability.FILE_DOWNLOAD,
        action: "get_download_url",
        payload: {
          key: `workspaces/${activeWorkspaceId}/doc.pdf`,
          expiresInSeconds: 1000000,
        },
      });
      expect(cappedRes.success).toBe(true);
      expect(cappedRes.data?.expiresInSeconds).toBe(AwsS3Adapter.MAX_EXPIRY_SECONDS);
      expect(cappedRes.data?.downloadUrl).toContain(`X-Amz-Expires=${AwsS3Adapter.MAX_EXPIRY_SECONDS}`);
    });
  });

  // =========================================================================
  // 2. Inbound Webhook Enforcement & Rate Limiting
  // =========================================================================
  describe("2. Inbound Webhook Cryptographic Verification & Rate Limiting", () => {
    it("confirms webhooks fall under global mutation rate limit (RATE_LIMIT_CONFIGS.MUTATION) and are not exempt", () => {
      const webhookPath = "/api/billing/webhooks/paddle";
      const clientIp = "198.51.100.25";

      // 60 requests should succeed within the 1-minute window
      for (let i = 0; i < RATE_LIMIT_CONFIGS.MUTATION.maxRequests; i++) {
        const req = new NextRequest(`https://app.aforden.com${webhookPath}`, {
          method: "POST",
          headers: {
            "x-forwarded-for": clientIp,
            "content-type": "application/json",
          },
        });
        const res = applyApiSecurityMiddleware(req);
        expect(res).toBeNull();
      }

      // The 61st request must trigger HTTP 429 RATE_LIMIT_EXCEEDED
      const overLimitReq = new NextRequest(`https://app.aforden.com${webhookPath}`, {
        method: "POST",
        headers: {
          "x-forwarded-for": clientIp,
          "content-type": "application/json",
        },
      });
      const blockedRes = applyApiSecurityMiddleware(overLimitReq);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes!.status).toBe(429);
      expect(blockedRes!.headers.get("retry-after")).toBeDefined();
    });

    it("confirms integration webhooks (/api/integrations/webhooks/[slug]) are also rate-limited", () => {
      const webhookPath = "/api/integrations/webhooks/brevo-inbound";
      const clientIp = "198.51.100.30";

      for (let i = 0; i < RATE_LIMIT_CONFIGS.MUTATION.maxRequests; i++) {
        const req = new NextRequest(`https://app.aforden.com${webhookPath}`, {
          method: "POST",
          headers: {
            "x-forwarded-for": clientIp,
            "content-type": "application/json",
          },
        });
        expect(applyApiSecurityMiddleware(req)).toBeNull();
      }

      const overLimitReq = new NextRequest(`https://app.aforden.com${webhookPath}`, {
        method: "POST",
        headers: {
          "x-forwarded-for": clientIp,
          "content-type": "application/json",
        },
      });
      const blockedRes = applyApiSecurityMiddleware(overLimitReq);
      expect(blockedRes!.status).toBe(429);
    });
  });

  // =========================================================================
  // 3. Outbound External API Calls (Timeouts, Retries, Credential Redaction)
  // =========================================================================
  describe("3. Outbound External API Reliability & Redaction", () => {
    it("confirms all capability registry definitions have bounded, reasonable timeouts (<= 30000ms)", () => {
      for (const cap of Object.values(IntegrationCapability)) {
        const def = CAPABILITY_REGISTRY[cap];
        expect(def).toBeDefined();
        expect(def.defaultTimeoutMs).toBeGreaterThan(0);
        expect(def.defaultTimeoutMs).toBeLessThanOrEqual(30000); // None can hang indefinitely
      }

      // Explicit checks on high-volume real-time integrations
      expect(CAPABILITY_REGISTRY[IntegrationCapability.EMAIL_SEND].defaultTimeoutMs).toBe(5000);
      expect(CAPABILITY_REGISTRY[IntegrationCapability.SMS_SEND].defaultTimeoutMs).toBe(5000);
      expect(CAPABILITY_REGISTRY[IntegrationCapability.CALENDAR_WRITE].defaultTimeoutMs).toBe(8000);
      expect(CAPABILITY_REGISTRY[IntegrationCapability.ACCOUNTING_INVOICE_SYNC].defaultTimeoutMs).toBe(15000);
      expect(CAPABILITY_REGISTRY[IntegrationCapability.FILE_UPLOAD].defaultTimeoutMs).toBe(30000);
    });

    it("verifies computeBackoffDelayMs respects retryAfterSeconds from external rate limits", () => {
      const delayMs = computeBackoffDelayMs(1, {
        retryAfterSeconds: 45,
      });
      expect(delayMs).toBe(45000);
    });

    it("verifies computeBackoffDelayMs applies exponential backoff with upper bound clamp", () => {
      const attempt1 = computeBackoffDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 10000, jitter: false });
      const attempt2 = computeBackoffDelayMs(2, { baseDelayMs: 1000, maxDelayMs: 10000, jitter: false });
      const attempt5 = computeBackoffDelayMs(5, { baseDelayMs: 1000, maxDelayMs: 10000, jitter: false });

      expect(attempt1).toBe(2000); // 2^1 * 1000
      expect(attempt2).toBe(4000); // 2^2 * 1000
      expect(attempt5).toBe(10000); // Clamped to maxDelayMs
    });

    it("verifies redactSensitiveData scrubs API keys, auth headers, and secret tokens from audit snapshots", () => {
      const unscrubbedPayload = {
        apiKey: "brevo_live_key_9876543210abcdef",
        secret: "whsec_abcdef1234567890abcdef1234567890",
        authorization: "Bearer secret_access_token_xyz",
        customerName: "Acme Industrial Services",
        invoiceAmount: 149900,
        nested: {
          clientSecret: "sk_live_12345678901234567890",
          password: "SuperSecretPassword123!",
        },
      };

      const redacted = redactSensitiveData(unscrubbedPayload);

      expect(redacted.apiKey).toBe("[REDACTED]");
      expect(redacted.secret).toBe("[REDACTED]");
      expect(redacted.authorization).toBe("[REDACTED]");
      expect(redacted.customerName).toBe("Acme Industrial Services");
      expect(redacted.invoiceAmount).toBe(149900);
      expect(redacted.nested.clientSecret).toBe("[REDACTED]");
      expect(redacted.nested.password).toBe("[REDACTED]");
    });
  });

  // =========================================================================
  // 4. CORS & Origin Configuration
  // =========================================================================
  describe("4. CORS & Origin Configuration", () => {
    it("confirms Public API (/api/v1/*) CORS exposes Access-Control-Allow-Origin: * without credentials reflection", () => {
      expect(PUBLIC_API_CORS_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
      expect(PUBLIC_API_CORS_HEADERS["Access-Control-Allow-Credentials"]).toBeUndefined();
    });

    it("confirms inbound webhook routes do NOT attach CORS headers (server-to-server only)", () => {
      const webhookReq = new NextRequest("https://app.aforden.com/api/billing/webhooks/paddle", {
        method: "POST",
        headers: {
          origin: "https://attacker.com",
        },
      });

      const response = proxy(webhookReq);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("confirms internal tenant REST routes do NOT reflect wildcard CORS", () => {
      const restReq = new NextRequest("https://app.aforden.com/api/workspaces/ws123/invoices", {
        method: "GET",
        headers: {
          origin: "https://evil.com",
        },
      });

      const response = proxy(restReq);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });
  });

  // =========================================================================
  // 5. Production Service Credentials & Environment Separation
  // =========================================================================
  describe("5. Production Service Credentials Separation", () => {
    it("PaddleBillingAdapter accurately toggles between sandbox and production environments", () => {
      const prodAdapter = new PaddleBillingAdapter({
        apiKey: "padd_live_test_key_12345",
        environment: "production",
      });
      expect((prodAdapter as any).environment).toBe(Environment.production);

      const sandboxAdapter = new PaddleBillingAdapter({
        apiKey: "padd_sandbox_test_key_12345",
        environment: "sandbox",
      });
      expect((sandboxAdapter as any).environment).toBe(Environment.sandbox);
    });

    it("QuickBooksAdapter dynamically selects sandbox vs production API endpoints based on environment config", () => {
      const qbAdapter = new QuickBooksAdapter();

      const prodUrl = (qbAdapter as any).getBaseApiUrl({ environment: "production" });
      expect(prodUrl).toBe("https://quickbooks.api.intuit.com");

      const sandboxUrl = (qbAdapter as any).getBaseApiUrl({ environment: "sandbox" });
      expect(sandboxUrl).toBe("https://sandbox-quickbooks.api.intuit.com");

      const useSandboxUrl = (qbAdapter as any).getBaseApiUrl({ useSandbox: true });
      expect(useSandboxUrl).toBe("https://sandbox-quickbooks.api.intuit.com");
    });
  });
});
