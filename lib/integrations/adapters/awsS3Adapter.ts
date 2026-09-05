/**
 * Phase 1.17.8 — Amazon S3 File Storage Provider Adapter
 * Real, network-facing provider adapter implementing IntegrationAdapter for:
 * - FILE_UPLOAD
 * - FILE_DOWNLOAD
 *
 * Implements AWS SigV4 signature calculation, S3 REST API dispatch, and presigned download URL generation.
 */

import crypto from "crypto";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationAdapter,
  type IntegrationConnection,
  type IntegrationSecretReference,
  type ConnectResult,
  type TestResult,
  type IntegrationExecutionRequest,
  type IntegrationExecutionResult,
  type IntegrationEvent,
  type IntegrationFailure,
} from "./types";

export interface AwsS3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  bucketName?: string;
  region?: string;
}

export class AwsS3Adapter implements IntegrationAdapter {
  public readonly integrationId = "aws_s3";
  public readonly displayName = "Amazon S3";
  public readonly version = "1.0.0";

  public getCapabilities(): readonly IntegrationCapability[] {
    return [
      IntegrationCapability.FILE_UPLOAD,
      IntegrationCapability.FILE_DOWNLOAD,
    ];
  }

  /**
   * Handshake validating AWS access keys and bucket accessibility.
   */
  public async connect(
    connection: IntegrationConnection,
    authPayload?: unknown
  ): Promise<ConnectResult> {
    const start = Date.now();
    const creds = this.extractCredentials(authPayload, connection);

    if (!creds.accessKeyId || !creds.secretAccessKey) {
      return {
        success: false,
        connectionStatus: IntegrationConnectionStatus.ERROR,
        credentialReference: {
          secretId: "missing",
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: "sha256:missing",
        },
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "AWS accessKeyId and secretAccessKey are required.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const bucketName = creds.bucketName || "aforden-storage";
    const region = creds.region || "us-east-1";

    try {
      const host = `${bucketName}.s3.${region}.amazonaws.com`;
      const url = `https://${host}/?location`;

      const signedHeaders = computeSigV4Headers({
        method: "GET",
        host,
        path: "/",
        queryParams: "location",
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region,
        service: "s3",
      });

      const response = await fetch(url, {
        method: "GET",
        headers: signedHeaders,
      });

      if (!response.ok && response.status !== 200) {
        const errorText = await response.text().catch(() => "");
        const failure = this.translateS3Error(response.status, errorText);
        return {
          success: false,
          connectionStatus: IntegrationConnectionStatus.ERROR,
          credentialReference: {
            secretId: `sec_s3_${connection.id.slice(0, 8)}`,
            version: 1,
            keyVaultProvider: "LOCAL_ENCRYPTED_DB",
            algorithm: "AES_256_GCM",
            fingerprint: `sha256:${crypto.createHash("sha256").update(creds.accessKeyId).digest("hex").slice(0, 16)}`,
          },
          failure,
        };
      }

      return {
        success: true,
        connectionStatus: IntegrationConnectionStatus.CONNECTED,
        externalAccountId: `${bucketName} (${region})`,
        externalAccountName: `Amazon S3 - ${bucketName}`,
        credentialReference: {
          secretId: `sec_s3_${connection.id.slice(0, 8)}`,
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: `sha256:${crypto.createHash("sha256").update(creds.accessKeyId).digest("hex").slice(0, 16)}`,
          secretPayload: JSON.stringify(creds),
        },
        metadata: {
          bucketName,
          region,
          connectedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        connectionStatus: IntegrationConnectionStatus.ERROR,
        credentialReference: {
          secretId: "error",
          version: 1,
          keyVaultProvider: "LOCAL_ENCRYPTED_DB",
          algorithm: "AES_256_GCM",
          fingerprint: "sha256:error",
        },
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error connecting to Amazon S3.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  public async disconnect(
    _connection: IntegrationConnection,
    _secretReference: IntegrationSecretReference
  ): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Health check ping against S3 bucket.
   */
  public async testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult> {
    const start = Date.now();
    const creds = this.extractCredentialsFromSecret(secretReference, connection);

    if (!creds.accessKeyId || !creds.secretAccessKey) {
      return {
        success: false,
        latencyMs: 0,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "No valid AWS credentials found in secret reference.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    const bucketName = creds.bucketName || "aforden-storage";
    const region = creds.region || "us-east-1";

    try {
      const host = `${bucketName}.s3.${region}.amazonaws.com`;
      const url = `https://${host}/?location`;

      const signedHeaders = computeSigV4Headers({
        method: "GET",
        host,
        path: "/",
        queryParams: "location",
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region,
        service: "s3",
      });

      const response = await fetch(url, {
        method: "GET",
        headers: signedHeaders,
      });

      const latencyMs = Date.now() - start;

      if (!response.ok && response.status !== 200) {
        const errorText = await response.text().catch(() => "");
        const failure = this.translateS3Error(response.status, errorText);
        return {
          success: false,
          latencyMs,
          checkedAt: new Date(),
          failure,
        };
      }

      return {
        success: true,
        latencyMs,
        checkedAt: new Date(),
        details: {
          bucketName,
          region,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
        failure: {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: err instanceof Error ? err.message : "S3 health check failed.",
          isRetryable: true,
          httpStatusCode: 503,
        },
      };
    }
  }

  /**
   * Executes S3 file operations:
   * - FILE_UPLOAD
   * - FILE_DOWNLOAD
   */
  public async execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult> {
    const start = Date.now();
    const config = (request.connectionConfig as Record<string, unknown>) || {};
    const creds = this.extractCredentialsFromSecret(
      request.secretReference,
      { id: request.connectionId, configJson: config } as unknown as IntegrationConnection
    );

    if (!creds.accessKeyId || !creds.secretAccessKey) {
      return {
        success: false,
        capability: request.capability,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 401,
        failure: {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: "AWS S3 credentials not configured.",
          isRetryable: false,
          httpStatusCode: 401,
        },
      };
    }

    switch (request.capability) {
      case IntegrationCapability.FILE_UPLOAD:
        return this.executeUpload(request, creds, start);
      case IntegrationCapability.FILE_DOWNLOAD:
        return this.executeDownload(request, creds, start);
      default:
        return {
          success: false,
          capability: request.capability,
          action: request.action,
          durationMs: Date.now() - start,
          failure: {
            code: IntegrationFailureCode.CAPABILITY_UNSUPPORTED,
            message: `Capability '${request.capability}' is not supported by AwsS3Adapter.`,
            isRetryable: false,
            httpStatusCode: 400,
          },
        };
    }
  }

  /**
   * Webhook handler satisfies interface contract (no-op returning null).
   */
  public async handleWebhook(
    _payload: unknown,
    _headers: Headers,
    _secretReference: IntegrationSecretReference,
    _connection: IntegrationConnection
  ): Promise<IntegrationEvent | null> {
    return null;
  }

  // =========================================================================
  // Storage Security Constraints & Guardrails
  // =========================================================================
  public static readonly MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB max upload
  public static readonly MAX_EXPIRY_SECONDS = 604800; // 7 days (AWS SigV4 maximum)
  public static readonly DEFAULT_EXPIRY_SECONDS = 3600; // 1 hour

  public static readonly DISALLOWED_MIME_TYPES = new Set([
    "text/html",
    "application/xhtml+xml",
    "application/x-msdownload",
    "application/x-executable",
    "application/javascript",
    "text/javascript",
  ]);

  private validateObjectKey(objectKey: string, workspaceId: string): { cleanKey?: string; error?: string; isForbidden?: boolean } {
    const cleanKey = objectKey.startsWith("/") ? objectKey.slice(1) : objectKey;

    // 1. Path traversal guard
    if (cleanKey.includes("..") || cleanKey.includes("\\")) {
      return { error: "Path traversal characters ('..' or '\\') are not permitted in object keys." };
    }

    // 2. Cross-workspace scoping guard
    if (cleanKey.startsWith("workspaces/") || cleanKey.startsWith("tenants/")) {
      const parts = cleanKey.split("/");
      const pathWorkspaceId = parts[1];
      if (pathWorkspaceId && workspaceId && pathWorkspaceId !== workspaceId) {
        return {
          error: "Cross-workspace access denied: object key does not belong to the active workspace.",
          isForbidden: true,
        };
      }
    }

    return { cleanKey };
  }

  // =========================================================================
  // Private Subsystem Execution Methods
  // =========================================================================

  private async executeUpload(
    request: IntegrationExecutionRequest,
    creds: AwsS3Credentials,
    start: number
  ): Promise<IntegrationExecutionResult> {
    const payload = (request.payload || {}) as Record<string, unknown>;
    const objectKey = (payload.key as string) || (payload.objectKey as string);

    if (!objectKey || typeof objectKey !== "string" || objectKey.trim().length === 0) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_UPLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'key' (or 'objectKey') is required for S3 upload.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const keyValidation = this.validateObjectKey(objectKey, request.workspaceId);
    if (keyValidation.error) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_UPLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: keyValidation.isForbidden ? 403 : 400,
        failure: {
          code: keyValidation.isForbidden
            ? IntegrationFailureCode.AUTHENTICATION_FAILED
            : IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: keyValidation.error,
          isRetryable: false,
          httpStatusCode: keyValidation.isForbidden ? 403 : 400,
        },
      };
    }
    const cleanKey = keyValidation.cleanKey!;

    const configuredBucket = creds.bucketName || "aforden-storage";
    if (payload.bucket && payload.bucket !== configuredBucket) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_UPLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: `Target bucket override is not permitted; operations are restricted to configured environment bucket '${configuredBucket}'.`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const bucketName = configuredBucket;
    const region = (payload.region as string) || creds.region || "us-east-1";
    const contentType = (payload.contentType as string) || "application/octet-stream";

    const normalizedMime = contentType.toLowerCase().trim();
    if (AwsS3Adapter.DISALLOWED_MIME_TYPES.has(normalizedMime)) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_UPLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: `Upload rejected: content type '${contentType}' is not permitted for storage.`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    let bodyBuffer: Buffer;
    if (typeof payload.content === "string") {
      bodyBuffer = payload.isBase64
        ? Buffer.from(payload.content, "base64")
        : Buffer.from(payload.content, "utf-8");
    } else if (Buffer.isBuffer(payload.content)) {
      bodyBuffer = payload.content;
    } else {
      bodyBuffer = Buffer.from(JSON.stringify(payload.content || ""));
    }

    if (bodyBuffer.length > AwsS3Adapter.MAX_UPLOAD_BYTES) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_UPLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: `File size (${bodyBuffer.length} bytes) exceeds maximum permitted upload limit of ${AwsS3Adapter.MAX_UPLOAD_BYTES} bytes (25MB).`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const host = `${bucketName}.s3.${region}.amazonaws.com`;
    const url = `https://${host}/${cleanKey}`;

    try {
      const signedHeaders = computeSigV4Headers({
        method: "PUT",
        host,
        path: `/${cleanKey}`,
        bodyBuffer,
        contentType,
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region,
        service: "s3",
      });

      const response = await fetch(url, {
        method: "PUT",
        headers: signedHeaders,
        body: new Uint8Array(bodyBuffer),
      });

      const durationMs = Date.now() - start;

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const failure = this.translateS3Error(response.status, errorText);
        return {
          success: false,
          capability: IntegrationCapability.FILE_UPLOAD,
          action: request.action,
          durationMs,
          rawResponseStatus: response.status,
          failure,
        };
      }

      const etag = response.headers.get("etag")?.replace(/"/g, "") || `etag_${crypto.randomUUID().slice(0, 8)}`;

      return {
        success: true,
        capability: IntegrationCapability.FILE_UPLOAD,
        action: request.action,
        durationMs,
        rawResponseStatus: response.status,
        providerRequestId: etag,
        data: {
          objectKey: cleanKey,
          bucket: bucketName,
          region,
          location: url,
          etag,
          sizeBytes: bodyBuffer.length,
          idempotencyKey: request.idempotencyKey,
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_UPLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 504,
        failure: {
          code: IntegrationFailureCode.NETWORK_TIMEOUT,
          message: err instanceof Error ? err.message : "Network error uploading file to S3.",
          isRetryable: true,
          httpStatusCode: 504,
        },
      };
    }
  }

  private async executeDownload(
    request: IntegrationExecutionRequest,
    creds: AwsS3Credentials,
    start: number
  ): Promise<IntegrationExecutionResult> {
    const payload = (request.payload || {}) as Record<string, unknown>;
    const objectKey = (payload.key as string) || (payload.objectKey as string);

    if (!objectKey || typeof objectKey !== "string" || objectKey.trim().length === 0) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_DOWNLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: "Field 'key' (or 'objectKey') is required for S3 download.",
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const keyValidation = this.validateObjectKey(objectKey, request.workspaceId);
    if (keyValidation.error) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_DOWNLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: keyValidation.isForbidden ? 403 : 400,
        failure: {
          code: keyValidation.isForbidden
            ? IntegrationFailureCode.AUTHENTICATION_FAILED
            : IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: keyValidation.error,
          isRetryable: false,
          httpStatusCode: keyValidation.isForbidden ? 403 : 400,
        },
      };
    }
    const cleanKey = keyValidation.cleanKey!;

    const configuredBucket = creds.bucketName || "aforden-storage";
    if (payload.bucket && payload.bucket !== configuredBucket) {
      return {
        success: false,
        capability: IntegrationCapability.FILE_DOWNLOAD,
        action: request.action,
        durationMs: Date.now() - start,
        rawResponseStatus: 400,
        failure: {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: `Target bucket override is not permitted; operations are restricted to configured environment bucket '${configuredBucket}'.`,
          isRetryable: false,
          httpStatusCode: 400,
        },
      };
    }

    const bucketName = configuredBucket;
    const region = (payload.region as string) || creds.region || "us-east-1";
    const requestedExpiry = Number(payload.expiresInSeconds);
    const expiresInSeconds = isNaN(requestedExpiry) || requestedExpiry <= 0
      ? AwsS3Adapter.DEFAULT_EXPIRY_SECONDS
      : Math.min(requestedExpiry, AwsS3Adapter.MAX_EXPIRY_SECONDS);

    const host = `${bucketName}.s3.${region}.amazonaws.com`;
    const presignedUrl = generatePresignedDownloadUrl({
      host,
      path: `/${cleanKey}`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      region,
      expiresInSeconds,
    });

    return {
      success: true,
      capability: IntegrationCapability.FILE_DOWNLOAD,
      action: request.action,
      durationMs: Date.now() - start,
      rawResponseStatus: 200,
      data: {
        objectKey: cleanKey,
        bucket: bucketName,
        region,
        downloadUrl: presignedUrl,
        expiresInSeconds,
        idempotencyKey: request.idempotencyKey,
      },
    };
  }

  // =========================================================================
  // Private Helper & Credential Methods
  // =========================================================================

  private extractCredentials(authPayload: unknown, connection: IntegrationConnection): AwsS3Credentials {
    const config = (connection.configJson as Record<string, unknown>) || {};
    let creds: Partial<AwsS3Credentials> = {};

    if (typeof authPayload === "string") {
      try {
        creds = JSON.parse(authPayload);
      } catch {
        // raw secret string
      }
    } else if (authPayload && typeof authPayload === "object") {
      creds = authPayload as Partial<AwsS3Credentials>;
    }

    return {
      accessKeyId:
        creds.accessKeyId ||
        (config.accessKeyId as string) ||
        process.env.AWS_ACCESS_KEY_ID ||
        "",
      secretAccessKey:
        creds.secretAccessKey ||
        (config.secretAccessKey as string) ||
        process.env.AWS_SECRET_ACCESS_KEY ||
        "",
      bucketName: creds.bucketName || (config.bucketName as string) || process.env.AWS_S3_BUCKET || "aforden-storage",
      region: creds.region || (config.region as string) || process.env.AWS_REGION || "us-east-1",
    };
  }

  private extractCredentialsFromSecret(
    secretReference: IntegrationSecretReference | undefined,
    connection: IntegrationConnection
  ): AwsS3Credentials {
    return this.extractCredentials(secretReference?.secretPayload, connection);
  }

  /**
   * Exhaustively translates S3 XML/HTTP errors to standardized IntegrationFailure.
   */
  public translateS3Error(
    statusCode: number,
    errorBody: string
  ): IntegrationFailure {
    let errorCode = String(statusCode);
    let errorMessage = `Amazon S3 error HTTP ${statusCode}`;

    const codeMatch = errorBody.match(/<Code>(.*?)<\/Code>/i);
    const messageMatch = errorBody.match(/<Message>(.*?)<\/Message>/i);

    if (codeMatch && codeMatch[1]) errorCode = codeMatch[1];
    if (messageMatch && messageMatch[1]) errorMessage = messageMatch[1];

    switch (errorCode) {
      case "AccessDenied":
      case "InvalidAccessKeyId":
      case "SignatureDoesNotMatch":
      case "InvalidToken":
        return {
          code: IntegrationFailureCode.AUTHENTICATION_FAILED,
          message: errorMessage,
          isRetryable: false,
          httpStatusCode: 403,
          providerRawCode: errorCode,
          providerRawMessage: errorMessage,
        };
      case "NoSuchKey":
      case "NoSuchBucket":
        return {
          code: IntegrationFailureCode.RESOURCE_NOT_FOUND,
          message: errorMessage,
          isRetryable: false,
          httpStatusCode: 404,
          providerRawCode: errorCode,
          providerRawMessage: errorMessage,
        };
      case "InvalidArgument":
      case "InvalidRequest":
        return {
          code: IntegrationFailureCode.PAYLOAD_VALIDATION_FAILED,
          message: errorMessage,
          isRetryable: false,
          httpStatusCode: 400,
          providerRawCode: errorCode,
          providerRawMessage: errorMessage,
        };
      case "SlowDown":
        return {
          code: IntegrationFailureCode.RATE_LIMITED,
          message: errorMessage,
          isRetryable: true,
          retryAfterSeconds: 30,
          httpStatusCode: 503,
          providerRawCode: errorCode,
          providerRawMessage: errorMessage,
        };
      case "InternalError":
      case "ServiceUnavailable":
        return {
          code: IntegrationFailureCode.SERVICE_UNAVAILABLE,
          message: errorMessage,
          isRetryable: true,
          httpStatusCode: 503,
          providerRawCode: errorCode,
          providerRawMessage: errorMessage,
        };
      default:
        return {
          code: statusCode >= 500 ? IntegrationFailureCode.SERVICE_UNAVAILABLE : IntegrationFailureCode.BAD_REQUEST,
          message: errorMessage,
          isRetryable: statusCode >= 500,
          httpStatusCode: statusCode,
          providerRawCode: errorCode,
          providerRawMessage: errorMessage,
        };
    }
  }
}

/**
 * Computes AWS SigV4 headers for standard S3 REST API calls.
 */
export function computeSigV4Headers(options: {
  method: string;
  host: string;
  path: string;
  queryParams?: string;
  bodyBuffer?: Buffer;
  contentType?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now?: Date;
}): Record<string, string> {
  const now = options.now || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = crypto
    .createHash("sha256")
    .update(options.bodyBuffer || Buffer.alloc(0))
    .digest("hex");

  const canonicalHeaders = `host:${options.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    options.method,
    options.path,
    options.queryParams || "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const kDate = crypto.createHmac("sha256", `AWS4${options.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(options.region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(options.service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Host: options.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authorizationHeader,
    ...(options.contentType ? { "Content-Type": options.contentType } : {}),
  };
}

/**
 * Generates an AWS SigV4 presigned download URL.
 */
export function generatePresignedDownloadUrl(options: {
  host: string;
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresInSeconds: number;
  now?: Date;
}): string {
  const now = options.now || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${options.region}/s3/aws4_request`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${options.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(options.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  });

  const canonicalQuery = queryParams.toString();
  const canonicalHeaders = `host:${options.host}\n`;
  const signedHeaders = "host";

  const canonicalRequest = [
    "GET",
    options.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const kDate = crypto.createHmac("sha256", `AWS4${options.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(options.region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  queryParams.set("X-Amz-Signature", signature);

  return `https://${options.host}${options.path}?${queryParams.toString()}`;
}
