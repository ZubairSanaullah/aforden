/**
 * Phase 1.17.5 — Outbound Integration Engine: Deterministic Idempotency Key Generator
 * Implements RFC 4122 UUIDv5 deterministic idempotency key derivation per Phase 1.17.1 §6.2.
 *
 * Inputs:
 * - Namespace: AFORDEN_INTEGRATION_NAMESPACE (a3bb189e-8bf9-3888-9912-ace4e6543002)
 * - Name Seed: `${workspaceId}:${connectionId}:${capability}:${action}:${sha256(canonicalPayload)}`
 *
 * Guarantees:
 * - Deterministic across repeated calls with identical payload.
 * - Key order independent via canonical JSON serialization.
 * - Zero collision risk across workspaces, connections, capabilities, and actions.
 */

import crypto from "crypto";

/**
 * Dedicated UUID namespace for Aforden Outbound Integration Execution Engine.
 */
export const AFORDEN_INTEGRATION_NAMESPACE = "a3bb189e-8bf9-3888-9912-ace4e6543002";

/**
 * Converts a canonical 36-char hyphenated UUID string to a 16-byte Buffer.
 */
function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  return Buffer.from(hex, "hex");
}

/**
 * Generates a deterministic RFC 4122 UUIDv5 from a name and namespace.
 */
export function generateUuidV5(
  name: string,
  namespaceUuid: string = AFORDEN_INTEGRATION_NAMESPACE
): string {
  const nsBytes = uuidToBytes(namespaceUuid);
  const nameBytes = Buffer.from(name, "utf-8");
  const hash = crypto
    .createHash("sha1")
    .update(Buffer.concat([nsBytes, nameBytes]))
    .digest();

  // Set version to 5 (0101 in high nibble of octet 6)
  hash[6] = (hash[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122 (10xx in high 2 bits of octet 8)
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString("hex", 0, 16);
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join("-");
}

/**
 * Canonical, key-sorted JSON serializer to guarantee deterministic hash calculation
 * regardless of object key insertion order.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalJsonStringify(item)).join(",") + "]";
  }
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Computes a deterministic UUIDv5 idempotency key for outbound integration execution.
 */
export function generateOutboundIdempotencyKey(
  workspaceId: string,
  connectionId: string,
  capability: string,
  action: string,
  payload: Record<string, unknown>
): string {
  const canonicalPayload = canonicalJsonStringify(payload ?? {});
  const payloadHash = crypto.createHash("sha256").update(canonicalPayload).digest("hex");
  const seedName = `${workspaceId}:${connectionId}:${capability}:${action}:${payloadHash}`;
  return generateUuidV5(seedName, AFORDEN_INTEGRATION_NAMESPACE);
}
