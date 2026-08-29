/**
 * Phase 1.17.8 — AwsS3Adapter Contract, File Upload/Download, SigV4 & Error Translation Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  AwsS3Adapter,
  computeSigV4Headers,
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
import { SEED_INTEGRATIONS } from "@/lib/integrations/seed/integrationSeed";
import { AdapterRegistry } from "@/lib/integrations/adapters/adapterRegistry";

describe("Phase 1.17.8 — AwsS3Adapter Unit & Contract Tests", () => {
  let adapter: AwsS3Adapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  const sampleAccessKeyId = "AKIAIOSFODNN7EXAMPLE";
  const sampleSecretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const sampleBucketName = "aforden-workorder-photos";
  const sampleRegion = "us-east-1";

  beforeEach(() => {
    adapter = new AwsS3Adapter();
    mockConnection = {
      id: "conn_s3_test_123",
      workspaceId: "ws_test_456",
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
      secretId: "sec_s3_123",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:s312345",
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

  describe("1. Identity & Capability Registration", () => {
    it("should report correct identity metadata and file storage capabilities", () => {
      expect(adapter.integrationId).toBe("aws_s3");
      expect(adapter.displayName).toBe("Amazon S3");
      expect(adapter.version).toBe("1.0.0");
      expect(adapter.getCapabilities()).toEqual([
        IntegrationCapability.FILE_UPLOAD,
        IntegrationCapability.FILE_DOWNLOAD,
      ]);
    });

    it("should register successfully and pass catalog consistency checks", () => {
      AdapterRegistry.clearAdapters();
      AdapterRegistry.registerAdapter(adapter);
      expect(AdapterRegistry.hasAdapter("aws_s3")).toBe(true);

      // Verify declared capabilities form a valid subset of catalog definition
      expect(() =>
        AdapterRegistry.validateAdapterCatalogConsistency(SEED_INTEGRATIONS)
      ).not.toThrow();
    });
  });

  describe("2. AWS SigV4 Header & Presigned URL Computation", () => {
    it("should compute valid SigV4 Authorization headers", () => {
      const fixedDate = new Date("2026-08-29T12:00:00.000Z");
      const headers = computeSigV4Headers({
        method: "PUT",
        host: "aforden-bucket.s3.us-east-1.amazonaws.com",
        path: "/evidence/photo1.jpg",
        bodyBuffer: Buffer.from("image_data_bytes"),
        contentType: "image/jpeg",
        accessKeyId: sampleAccessKeyId,
        secretAccessKey: sampleSecretAccessKey,
        region: "us-east-1",
        service: "s3",
        now: fixedDate,
      });

      expect(headers.Host).toBe("aforden-bucket.s3.us-east-1.amazonaws.com");
      expect(headers["x-amz-date"]).toBe("20260829T120000Z");
      expect(headers.Authorization).toContain("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260829/us-east-1/s3/aws4_request");
      expect(headers.Authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
      expect(headers.Authorization).toContain("Signature=");
    });

    it("should generate valid SigV4 presigned download URL", () => {
      const fixedDate = new Date("2026-08-29T12:00:00.000Z");
      const presignedUrl = generatePresignedDownloadUrl({
        host: "aforden-bucket.s3.us-east-1.amazonaws.com",
        path: "/evidence/photo1.jpg",
        accessKeyId: sampleAccessKeyId,
        secretAccessKey: sampleSecretAccessKey,
        region: "us-east-1",
        expiresInSeconds: 3600,
        now: fixedDate,
      });

      expect(presignedUrl).toContain("https://aforden-bucket.s3.us-east-1.amazonaws.com/evidence/photo1.jpg?");
      expect(presignedUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
      expect(presignedUrl).toContain("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260829%2Fus-east-1%2Fs3%2Faws4_request");
      expect(presignedUrl).toContain("X-Amz-Expires=3600");
      expect(presignedUrl).toContain("X-Amz-Signature=");
    });
  });

  describe("3. connect() Handshake", () => {
    it("should fail connect() when access keys are missing", async () => {
      const connWithoutCreds = { ...mockConnection, configJson: {} };
      const prevId = process.env.AWS_ACCESS_KEY_ID;
      const prevKey = process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      try {
        const result = await adapter.connect(connWithoutCreds);
        expect(result.success).toBe(false);
        expect(result.connectionStatus).toBe(IntegrationConnectionStatus.ERROR);
        expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      } finally {
        if (prevId) process.env.AWS_ACCESS_KEY_ID = prevId;
        if (prevKey) process.env.AWS_SECRET_ACCESS_KEY = prevKey;
      }
    });

    it("should return CONNECTED on successful bucket location query", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "<LocationConstraint>us-east-1</LocationConstraint>",
      } as unknown as Response);

      const result = await adapter.connect(mockConnection, {
        accessKeyId: sampleAccessKeyId,
        secretAccessKey: sampleSecretAccessKey,
      });

      expect(result.success).toBe(true);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(result.externalAccountId).toBe(`${sampleBucketName} (${sampleRegion})`);
    });
  });

  describe("4. execute() File Upload/Download & Error Translations", () => {
    const getBaseRequest = (): IntegrationExecutionRequest => ({
      workspaceId: "ws_test_456",
      connectionId: "conn_s3_test_123",
      capability: IntegrationCapability.FILE_UPLOAD,
      action: "upload_file",
      payload: {
        key: "workorders/1042/evidence/compressor_diagnostic.jpg",
        content: "base64_image_content_mock",
        contentType: "image/jpeg",
      },
      idempotencyKey: "uuidv5-s3-test-key",
      correlationId: "corr-s3-1234",
      secretReference: mockSecretRef,
      connectionConfig: {
        bucketName: sampleBucketName,
        region: sampleRegion,
      },
    });

    it("should successfully upload file via FILE_UPLOAD", async () => {
      const mockHeaders = new Headers();
      mockHeaders.set("etag", '"e9b563da2b7f44d1536b8d147da4f1dc"');

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders,
        text: async () => "",
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.FILE_UPLOAD);
      expect(result.data?.objectKey).toBe("workorders/1042/evidence/compressor_diagnostic.jpg");
      expect(result.data?.etag).toBe("e9b563da2b7f44d1536b8d147da4f1dc");
      expect(result.data?.location).toBe(
        "https://aforden-workorder-photos.s3.us-east-1.amazonaws.com/workorders/1042/evidence/compressor_diagnostic.jpg"
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://aforden-workorder-photos.s3.us-east-1.amazonaws.com/workorders/1042/evidence/compressor_diagnostic.jpg",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("AWS4-HMAC-SHA256"),
          }),
        })
      );
    });

    it("should successfully generate presigned download URL via FILE_DOWNLOAD", async () => {
      const result = await adapter.execute({
        ...getBaseRequest(),
        capability: IntegrationCapability.FILE_DOWNLOAD,
        action: "get_download_url",
        payload: {
          key: "workorders/1042/evidence/compressor_diagnostic.jpg",
          expiresInSeconds: 7200,
        },
      });

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.FILE_DOWNLOAD);
      expect(result.data?.objectKey).toBe("workorders/1042/evidence/compressor_diagnostic.jpg");
      expect(result.data?.downloadUrl).toContain("X-Amz-Signature=");
      expect(result.data?.expiresInSeconds).toBe(7200);
    });

    it("should translate S3 AccessDenied XML error to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => `
          <Error>
            <Code>AccessDenied</Code>
            <Message>Access Denied</Message>
            <RequestId>3HL8EXAMPLE</RequestId>
            <HostId>hostIdExample</HostId>
          </Error>
        `,
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
      expect(result.failure?.providerRawCode).toBe("AccessDenied");
    });

    it("should translate S3 NoSuchKey XML error to RESOURCE_NOT_FOUND", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => `
          <Error>
            <Code>NoSuchKey</Code>
            <Message>The specified key does not exist.</Message>
            <Key>missing_file.jpg</Key>
          </Error>
        `,
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RESOURCE_NOT_FOUND);
      expect(result.failure?.isRetryable).toBe(false);
    });

    it("should translate S3 SlowDown error to RATE_LIMITED (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => `
          <Error>
            <Code>SlowDown</Code>
            <Message>Please reduce your request rate.</Message>
          </Error>
        `,
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.retryAfterSeconds).toBe(30);
    });
  });

  describe("5. handleWebhook() Contract Compliance", () => {
    it("should return null on handleWebhook() satisfying contract", async () => {
      const event = await adapter.handleWebhook({}, new Headers(), mockSecretRef, mockConnection);
      expect(event).toBeNull();
    });
  });
});
