/**
 * Phase 1.17.4 — Webhook Signature Verification & Grace Period Fallback
 * Implements Stage 1 HMAC-SHA256 cryptographic verification and Stage 2 timestamp extraction.
 * Supports active credential matching with 24h grace period fallback to SUPERSEDED credentials.
 */

import crypto from "crypto";
import type { IntegrationCredential } from "@/generated/prisma/client";
import { IntegrationCredentialStatus, CREDENTIAL_SUPERSEDED_GRACE_PERIOD_MS } from "../credentialStateMachine";

export interface SignatureVerificationResult {
  readonly valid: boolean;
  readonly matchedCredential?: IntegrationCredential;
  readonly reason?: string;
  readonly extractedTimestamp?: number;
}

export interface VerifySignatureOptions {
  readonly gracePeriodMs?: number;
  readonly now?: Date;
  readonly customSecretResolver?: (credential: IntegrationCredential) => string | Promise<string>;
}

/**
 * Extracts raw signature and optional timestamp from various incoming webhook header formats.
 */
export function extractSignatureAndTimestamp(headers: Headers): {
  signature?: string;
  timestamp?: number;
  headerName?: string;
} {
  // Candidate signature headers in common provider order
  const candidateHeaderNames = [
    "x-webhook-signature",
    "x-hub-signature-256",
    "x-signature",
    "stripe-signature",
    "x-twilio-signature",
    "webhook-signature",
  ];

  let rawHeaderValue: string | null = null;
  let headerName: string | undefined;

  for (const name of candidateHeaderNames) {
    const val = headers.get(name);
    if (val) {
      rawHeaderValue = val.trim();
      headerName = name;
      break;
    }
  }

  // Candidate timestamp headers
  const candidateTimestampHeaderNames = [
    "x-webhook-timestamp",
    "x-signature-timestamp",
    "x-request-timestamp",
    "webhook-timestamp",
  ];

  let extractedTimestamp: number | undefined;

  for (const tsName of candidateTimestampHeaderNames) {
    const tsVal = headers.get(tsName);
    if (tsVal) {
      const parsed = parseInt(tsVal.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        // If in seconds (10 digits), convert to ms
        extractedTimestamp = parsed < 10000000000 ? parsed * 1000 : parsed;
        break;
      }
    }
  }

  if (!rawHeaderValue) {
    return { timestamp: extractedTimestamp };
  }

  // Parse structured formats like "t=1724900000,v1=hex..."
  if (rawHeaderValue.includes("t=") && rawHeaderValue.includes("v1=")) {
    const parts = rawHeaderValue.split(",");
    let v1Sig: string | undefined;
    let tVal: number | undefined;

    for (const part of parts) {
      const [key, val] = part.trim().split("=");
      if (key === "v1" && val) {
        v1Sig = val;
      } else if (key === "t" && val) {
        const parsedT = parseInt(val, 10);
        if (!isNaN(parsedT) && parsedT > 0) {
          tVal = parsedT < 10000000000 ? parsedT * 1000 : parsedT;
        }
      }
    }

    return {
      signature: v1Sig || rawHeaderValue,
      timestamp: tVal || extractedTimestamp,
      headerName,
    };
  }

  // Strip prefix like "sha256="
  let cleanSignature = rawHeaderValue;
  if (cleanSignature.startsWith("sha256=")) {
    cleanSignature = cleanSignature.slice(7);
  }

  return {
    signature: cleanSignature,
    timestamp: extractedTimestamp,
    headerName,
  };
}

/**
 * Resolves the plaintext signing secret from an IntegrationCredential record.
 */
export async function resolveCredentialSecret(
  credential: IntegrationCredential,
  customResolver?: (credential: IntegrationCredential) => string | Promise<string>
): Promise<string> {
  if (customResolver) {
    return await customResolver(credential);
  }

  // If stored in encryptedData as plaintext test format "plain:secret"
  if (credential.encryptedData.startsWith("plain:")) {
    return credential.encryptedData.slice(6);
  }

  // Fall back to encryptedData or fingerprint for reference/mock verifiers
  return credential.encryptedData || credential.fingerprint;
}

/**
 * Verifies an incoming webhook's cryptographic signature against the connection's credentials.
 * Checks ACTIVE credential first, falling back to SUPERSEDED credentials if within the grace window.
 */
export async function verifyWebhookSignature(
  rawBody: Buffer,
  headers: Headers,
  credentials: readonly IntegrationCredential[],
  options: VerifySignatureOptions = {}
): Promise<SignatureVerificationResult> {
  const {
    gracePeriodMs = CREDENTIAL_SUPERSEDED_GRACE_PERIOD_MS,
    now = new Date(),
    customSecretResolver,
  } = options;

  const { signature, timestamp } = extractSignatureAndTimestamp(headers);

  if (!signature) {
    return {
      valid: false,
      reason: "Missing webhook signature header",
      extractedTimestamp: timestamp,
    };
  }

  const activeCredentials = credentials.filter(
    (c) => c.status === IntegrationCredentialStatus.ACTIVE
  );

  const supersededCredentials = credentials.filter(
    (c) => c.status === IntegrationCredentialStatus.SUPERSEDED
  );

  // 1. Try ACTIVE credentials first
  for (const cred of activeCredentials) {
    const secret = await resolveCredentialSecret(cred, customSecretResolver);
    if (isValidHmac(rawBody, signature, secret, timestamp)) {
      return {
        valid: true,
        matchedCredential: cred,
        extractedTimestamp: timestamp,
      };
    }
  }

  // 2. Fallback to SUPERSEDED credentials if within grace period
  const nowMs = now.getTime();
  for (const cred of supersededCredentials) {
    const ageMs = nowMs - cred.updatedAt.getTime();
    if (ageMs <= gracePeriodMs) {
      const secret = await resolveCredentialSecret(cred, customSecretResolver);
      if (isValidHmac(rawBody, signature, secret, timestamp)) {
        return {
          valid: true,
          matchedCredential: cred,
          extractedTimestamp: timestamp,
        };
      }
    }
  }

  return {
    valid: false,
    reason: "Cryptographic signature mismatch against active and eligible superseded credentials",
    extractedTimestamp: timestamp,
  };
}

/**
 * Validates HMAC signature using timing-safe comparison.
 */
function isValidHmac(
  rawBody: Buffer,
  providedSignature: string,
  secret: string,
  timestamp?: number
): boolean {
  try {
    // If timestamp is included in header (e.g. Stripe format t.body), check both rawBody and t.rawBody
    const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBase64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

    const matchRawHex = safeCompare(providedSignature, expectedHex);
    const matchRawBase64 = safeCompare(providedSignature, expectedBase64);

    if (matchRawHex || matchRawBase64) {
      return true;
    }

    if (timestamp) {
      const tSeconds = Math.floor(timestamp / 1000);
      const signedPayload = Buffer.concat([
        Buffer.from(`${tSeconds}.`),
        rawBody,
      ]);

      const expectedWithTHex = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");

      const expectedWithTBase64 = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("base64");

      if (
        safeCompare(providedSignature, expectedWithTHex) ||
        safeCompare(providedSignature, expectedWithTBase64)
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Compares two strings with constant-time equality check to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
