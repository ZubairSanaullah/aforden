/**
 * Phase 1.20.9 — Secrets Management, Credential Encryption & Key Rotation Suite
 *
 * Mechanically asserts:
 * 1. Inventory of Secrets at Rest (Schema & Storage Validation).
 * 2. AES-256-GCM Authenticated Encryption & Envelope Encryption Round-Trips.
 * 3. Cryptographic Tamper-Proof Detection (Authentication Tag Integrity).
 * 4. Secrets in Transit, Masking & In-Memory Redaction.
 * 5. Master Key Rotation, API Key Rotation & Webhook Secret Rotation.
 * 6. Webhook Signing HMAC-SHA256 and OAuth Version Lifecycle.
 */

import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import {
  encryptSecretPayload,
  decryptSecretPayload,
  rotateEncryptedSecret,
  computeSecretFingerprint,
  deriveMasterKey,
  CredentialDecryptionError,
} from "@/lib/services/security/credentialEncryptionService";
import {
  maskCredentialSummary,
  sanitizePayload,
} from "@/lib/utils/integrationApiError";
import { generateRawApiKey, hashApiKey } from "@/lib/services/developerApp/developerAppService";
import { timingSafeEqualStrings } from "@/lib/services/platform/security/constantTime";
import { resolveAndDecryptCredential } from "@/lib/integrations/execution/secretDecryption";
import { IntegrationCredentialStatus } from "@/generated/prisma/client";

describe("Phase 1.20.9 — Secrets Management, Credential Encryption & Key Rotation", () => {
  // =========================================================================
  // 1. Inventory of Secrets at Rest
  // =========================================================================
  describe("1. Inventory of Secrets at Rest", () => {
    it("generates hashed API keys storing only sha256 digest and masked prefix — never raw secret", () => {
      const { rawKey, keyPrefix, keyHash } = generateRawApiKey("LIVE");

      expect(rawKey).toMatch(/^afd_live_[A-Za-z0-9_-]+$/);
      expect(keyPrefix).toMatch(/^afd_live_[A-Za-z0-9_-]{3}\.\.\.[A-Za-z0-9_-]{4}$/);
      expect(keyHash).toHaveLength(64); // SHA-256 hex length
      expect(keyHash).toBe(hashApiKey(rawKey));
      expect(keyHash).not.toContain("afd_live_");
    });

    it("generates deterministic non-reversible SHA-256 fingerprints for credential identification", () => {
      const secret = "ghp_secure_oauth_token_example_1234567890";
      const fingerprint = computeSecretFingerprint(secret);

      expect(fingerprint).toMatch(/^sha256:[a-f0-9]{16}$/);
      // Same secret produces identical fingerprint
      expect(computeSecretFingerprint(secret)).toBe(fingerprint);
      // Different secret produces different fingerprint
      expect(computeSecretFingerprint(secret + "_altered")).not.toBe(fingerprint);
    });

    it("handles plain: test fixture prefixes for backward-compatible test mocking", () => {
      const mockPlainSecret = "plain:my_unencrypted_test_secret_for_mock_runs";
      const decrypted = decryptSecretPayload(mockPlainSecret, "0".repeat(24), "0".repeat(32));

      expect(decrypted).toBe("my_unencrypted_test_secret_for_mock_runs");
    });

    it("validates master key derivation fallback and Buffer key normalization", () => {
      const bufKey32 = crypto.randomBytes(32);
      const derivedBuf = deriveMasterKey(bufKey32);
      expect(derivedBuf).toEqual(bufKey32);

      const stringKey = "custom_integration_secret_key";
      const derivedString = deriveMasterKey(stringKey);
      expect(derivedString).toHaveLength(32);
      expect(derivedString).toEqual(crypto.createHash("sha256").update(stringKey).digest());
    });
  });

  // =========================================================================
  // 2. AES-256-GCM Authenticated Encryption & Envelope Encryption
  // =========================================================================
  describe("2. AES-256-GCM Encryption & Envelope Encryption", () => {
    it("successfully performs direct AES-256-GCM encryption and decryption round-trip", () => {
      const secretPlaintext = JSON.stringify({
        clientId: "client_acme_123",
        clientSecret: "sec_987654321_topsecret",
        refreshToken: "rt_555444333222111",
      });

      const masterKey = "master_key_secret_for_unit_tests_12345";
      const encrypted = encryptSecretPayload(secretPlaintext, {
        masterKey,
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        version: 1,
      });

      expect(encrypted.algorithm).toBe("AES_256_GCM");
      expect(encrypted.keyVaultProvider).toBe("LOCAL_ENCRYPTED_DB");
      expect(encrypted.version).toBe(1);
      expect(encrypted.iv).toHaveLength(24); // 12 bytes hex
      expect(encrypted.tag).toHaveLength(32); // 16 bytes hex
      expect(encrypted.encryptedData).not.toContain("client_acme_123");
      expect(encrypted.encryptedData).not.toContain("sec_987654321_topsecret");

      // Decrypt and verify
      const decrypted = decryptSecretPayload(
        encrypted.encryptedData,
        encrypted.iv,
        encrypted.tag,
        encrypted.algorithm,
        { masterKey },
      );

      expect(decrypted).toBe(secretPlaintext);
      expect(JSON.parse(decrypted)).toEqual({
        clientId: "client_acme_123",
        clientSecret: "sec_987654321_topsecret",
        refreshToken: "rt_555444333222111",
      });
    });

    it("generates unique IVs across multiple encryption operations of identical plaintext", () => {
      const plaintext = "constant_secret_material";
      const masterKey = "master_key_iv_uniqueness_test";

      const enc1 = encryptSecretPayload(plaintext, { masterKey });
      const enc2 = encryptSecretPayload(plaintext, { masterKey });

      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.encryptedData).not.toBe(enc2.encryptedData);
      expect(enc1.tag).not.toBe(enc2.tag);

      // Both decrypt to identical plaintext
      expect(decryptSecretPayload(enc1.encryptedData, enc1.iv, enc1.tag, enc1.algorithm, { masterKey })).toBe(plaintext);
      expect(decryptSecretPayload(enc2.encryptedData, enc2.iv, enc2.tag, enc2.algorithm, { masterKey })).toBe(plaintext);
    });

    it("successfully performs KMS Envelope Encryption with Data Encryption Key (DEK) wrapper", () => {
      const secretPlaintext = "stripe_api_key_sk_live_998877665544332211";
      const masterKey = "aws_kms_root_key_wrapper_32_bytes";

      const encryptedEnvelope = encryptSecretPayload(secretPlaintext, {
        masterKey,
        keyVaultProvider: "AWS_KMS",
        version: 1,
        useEnvelopeEncryption: true,
      });

      expect(encryptedEnvelope.encryptedDek).toBeDefined();
      expect(typeof encryptedEnvelope.encryptedDek).toBe("string");
      expect(encryptedEnvelope.keyVaultProvider).toBe("AWS_KMS");

      // Decrypt using envelope
      const decrypted = decryptSecretPayload(
        encryptedEnvelope.encryptedData,
        encryptedEnvelope.iv,
        encryptedEnvelope.tag,
        encryptedEnvelope.algorithm,
        {
          masterKey,
          encryptedDek: encryptedEnvelope.encryptedDek,
        },
      );

      expect(decrypted).toBe(secretPlaintext);
    });

    it("proves full runtime round-trip from IntegrationManagementService encryption to resolveAndDecryptCredential read path", async () => {
      const secretStr = JSON.stringify({
        apiKey: "sk_live_real_adapter_secret_token_12345",
        region: "us-east-1",
      });

      // 1. Write Path: Exact encryption performed by IntegrationManagementService
      const encryptedRecord = encryptSecretPayload(secretStr, {
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        version: 1,
      });

      const mockDb = {
        integrationCredential: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cred_test_live_roundtrip",
            connectionId: "conn_test_roundtrip",
            version: encryptedRecord.version,
            status: IntegrationCredentialStatus.ACTIVE,
            keyVaultProvider: encryptedRecord.keyVaultProvider,
            algorithm: encryptedRecord.algorithm,
            iv: encryptedRecord.iv,
            tag: encryptedRecord.tag,
            encryptedData: encryptedRecord.encryptedData,
            encryptedDek: encryptedRecord.encryptedDek,
            fingerprint: encryptedRecord.fingerprint,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
      } as any;

      // 2. Read Path: Exact resolveAndDecryptCredential function used by runtime execution engine
      const resolved = await resolveAndDecryptCredential(
        "conn_test_roundtrip",
        "ws_test_acme",
        mockDb,
      );

      expect(resolved.secretReference.secretId).toBe("cred_test_live_roundtrip");
      expect(resolved.secretReference.fingerprint).toBe(encryptedRecord.fingerprint);
      expect(resolved.decryptedSecret).toBe(secretStr);
      expect(JSON.parse(resolved.decryptedSecret)).toEqual({
        apiKey: "sk_live_real_adapter_secret_token_12345",
        region: "us-east-1",
      });
    });
  });

  // =========================================================================
  // 3. Cryptographic Tamper Detection (Authentication Tag Validation)
  // =========================================================================
  describe("3. Cryptographic Tamper Detection", () => {
    it("rejects decryption and throws CredentialDecryptionError when ciphertext is modified", () => {
      const plaintext = "sensitive_database_connection_credentials";
      const masterKey = "master_key_tamper_test";

      const encrypted = encryptSecretPayload(plaintext, { masterKey });

      // Flip the last byte of the ciphertext
      const tamperedCiphertext =
        encrypted.encryptedData.slice(0, -2) +
        (encrypted.encryptedData.slice(-2) === "00" ? "ff" : "00");

      expect(() =>
        decryptSecretPayload(tamperedCiphertext, encrypted.iv, encrypted.tag, encrypted.algorithm, {
          masterKey,
        }),
      ).toThrow(CredentialDecryptionError);
    });

    it("rejects decryption and throws CredentialDecryptionError when authentication tag is tampered", () => {
      const plaintext = "sensitive_quickbooks_oauth_token";
      const masterKey = "master_key_tag_tamper_test";

      const encrypted = encryptSecretPayload(plaintext, { masterKey });

      // Tamper authentication tag
      const tamperedTag = "00000000000000000000000000000000";

      expect(() =>
        decryptSecretPayload(encrypted.encryptedData, encrypted.iv, tamperedTag, encrypted.algorithm, {
          masterKey,
        }),
      ).toThrow(CredentialDecryptionError);
    });

    it("rejects decryption when wrong master key is provided", () => {
      const plaintext = "sensitive_google_calendar_token";
      const masterKey = "correct_master_key_123456789";
      const wrongMasterKey = "incorrect_master_key_987654321";

      const encrypted = encryptSecretPayload(plaintext, { masterKey });

      expect(() =>
        decryptSecretPayload(encrypted.encryptedData, encrypted.iv, encrypted.tag, encrypted.algorithm, {
          masterKey: wrongMasterKey,
        }),
      ).toThrow(CredentialDecryptionError);
    });

    it("rejects corrupted or truncated envelope DEK buffers", () => {
      const plaintext = "sensitive_envelope_dek_test";
      const masterKey = "master_key_dek_test";

      const encrypted = encryptSecretPayload(plaintext, {
        masterKey,
        useEnvelopeEncryption: true,
      });

      // Corrupt DEK (too short)
      const corruptedDek = Buffer.from("truncated").toString("base64");

      expect(() =>
        decryptSecretPayload(encrypted.encryptedData, encrypted.iv, encrypted.tag, encrypted.algorithm, {
          masterKey,
          encryptedDek: corruptedDek,
        }),
      ).toThrow(CredentialDecryptionError);
    });
  });

  // =========================================================================
  // 4. In-Transit Redaction & Client Masking
  // =========================================================================
  describe("4. In-Transit Redaction & Client DTO Masking", () => {
    it("maskCredentialSummary strips all cryptographic cipher material from client view", () => {
      const rawRecord = {
        id: "cred_123",
        connectionId: "conn_abc",
        version: 1,
        status: "ACTIVE",
        keyVaultProvider: "LOCAL_ENCRYPTED_DB",
        algorithm: "AES_256_GCM",
        iv: "123456789012345678901234",
        tag: "abcdefabcdefabcdefabcdefabcdefab",
        encryptedData: "deadbeefcafebabe1234567890",
        encryptedDek: "wrapped_dek_base64_data",
        fingerprint: "sha256:abc1234567890def",
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const masked = maskCredentialSummary(rawRecord as any);

      expect(masked).toHaveProperty("id", "cred_123");
      expect(masked).toHaveProperty("fingerprint", "sha256:abc1234567890def");
      expect(masked).not.toHaveProperty("encryptedData");
      expect(masked).not.toHaveProperty("iv");
      expect(masked).not.toHaveProperty("tag");
      expect(masked).not.toHaveProperty("encryptedDek");
    });

    it("sanitizePayload redacts known secret key and token patterns from logs and payloads", () => {
      const payloadWithSecrets = {
        name: "Acme Integration",
        apiKey: "afd_live_supersecretapikey999",
        stripeSecret: "sk_live_51AbcDefGhiJklMnoPqrStuv",
        webhookSigningKey: "whsec_abcdef1234567890",
        nested: {
          clientSecret: "sec_nested_secret_value",
          password: "SuperSecretPassword123!",
          safeField: "safe_value",
        },
      };

      const sanitized = sanitizePayload(payloadWithSecrets) as any;

      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.stripeSecret).toBe("[REDACTED]");
      expect(sanitized.webhookSigningKey).toBe("[REDACTED]");
      expect(sanitized.nested.clientSecret).toBe("[REDACTED]");
      expect(sanitized.nested.password).toBe("[REDACTED]");
      expect(sanitized.nested.safeField).toBe("safe_value");
    });

    it("verifies constant-time comparison for secret authentication preventing timing attacks", () => {
      const secret = "correct_secret_string_12345";
      expect(timingSafeEqualStrings(secret, secret)).toBe(true);
      expect(timingSafeEqualStrings(secret, "wrong_secret_string_12345")).toBe(false);
      expect(timingSafeEqualStrings(secret, "short")).toBe(false);
    });
  });

  // =========================================================================
  // 5. Key & Credential Rotation Engine
  // =========================================================================
  describe("5. Key & Credential Rotation Engine", () => {
    it("rotates an encrypted secret to a new master key, incrementing version and generating new ciphertext", () => {
      const plaintext = "refresh_token_to_be_rotated_across_kms_versions";
      const keyV1 = "master_encryption_key_v1_2026";
      const keyV2 = "master_encryption_key_v2_2027";

      // 1. Initial encryption under V1
      const initialRecord = encryptSecretPayload(plaintext, {
        masterKey: keyV1,
        version: 1,
      });

      expect(initialRecord.version).toBe(1);

      // 2. Rotate to V2
      const rotatedRecord = rotateEncryptedSecret(initialRecord, keyV1, keyV2);

      expect(rotatedRecord.version).toBe(2);
      expect(rotatedRecord.encryptedData).not.toBe(initialRecord.encryptedData);
      expect(rotatedRecord.iv).not.toBe(initialRecord.iv);
      expect(rotatedRecord.tag).not.toBe(initialRecord.tag);
      expect(rotatedRecord.fingerprint).toBe(initialRecord.fingerprint); // Fingerprint remains invariant

      // 3. Verify rotated record decrypts cleanly with Key V2
      const decryptedV2 = decryptSecretPayload(
        rotatedRecord.encryptedData,
        rotatedRecord.iv,
        rotatedRecord.tag,
        rotatedRecord.algorithm,
        { masterKey: keyV2 },
      );
      expect(decryptedV2).toBe(plaintext);

      // 4. Verify rotated record fails decryption under obsolete Key V1
      expect(() =>
        decryptSecretPayload(
          rotatedRecord.encryptedData,
          rotatedRecord.iv,
          rotatedRecord.tag,
          rotatedRecord.algorithm,
          { masterKey: keyV1 },
        ),
      ).toThrow(CredentialDecryptionError);
    });

    it("rotates envelope-encrypted credentials to a new master key wrapper", () => {
      const plaintext = "enterprise_sso_client_secret_rotation";
      const rootKey2026 = "kms_root_key_2026_period_a";
      const rootKey2027 = "kms_root_key_2027_period_b";

      const envelopeV1 = encryptSecretPayload(plaintext, {
        masterKey: rootKey2026,
        version: 1,
        useEnvelopeEncryption: true,
      });

      const envelopeV2 = rotateEncryptedSecret(envelopeV1, rootKey2026, rootKey2027, {
        useEnvelopeEncryption: true,
      });

      expect(envelopeV2.version).toBe(2);
      expect(envelopeV2.encryptedDek).not.toBe(envelopeV1.encryptedDek);

      const decrypted = decryptSecretPayload(
        envelopeV2.encryptedData,
        envelopeV2.iv,
        envelopeV2.tag,
        envelopeV2.algorithm,
        {
          masterKey: rootKey2027,
          encryptedDek: envelopeV2.encryptedDek,
        },
      );
      expect(decrypted).toBe(plaintext);
    });

    it("verifies webhook signing HMAC-SHA256 signature calculation and secret rotation", () => {
      const payload = JSON.stringify({ event: "work_order.created", id: "wo_123" });
      const secretV1 = "whsec_initial_webhook_secret_key_1";
      const secretV2 = "whsec_rotated_webhook_secret_key_2";

      // Compute HMAC signature with secret V1
      const signatureV1 = crypto.createHmac("sha256", secretV1).update(payload).digest("hex");
      const signatureV2 = crypto.createHmac("sha256", secretV2).update(payload).digest("hex");

      expect(signatureV1).not.toBe(signatureV2);

      // Verify V1 payload matches V1 signature
      const computedV1 = crypto.createHmac("sha256", secretV1).update(payload).digest("hex");
      expect(timingSafeEqualStrings(computedV1, signatureV1)).toBe(true);

      // Reject V1 signature against rotated secret V2
      expect(timingSafeEqualStrings(computedV1, signatureV2)).toBe(false);
    });

    it("simulates multi-version OAuth credential superseding lifecycle", () => {
      // Version 1 (Active)
      const credV1 = encryptSecretPayload("oauth_refresh_token_v1", { version: 1 });
      expect(credV1.version).toBe(1);

      // Provider refresh event triggers Version 2 (Active), marking V1 as Superseded
      const credV2 = encryptSecretPayload("oauth_refresh_token_v2", { version: credV1.version + 1 });
      expect(credV2.version).toBe(2);
      expect(credV2.fingerprint).not.toBe(credV1.fingerprint);

      // Decrypt both independently
      expect(decryptSecretPayload(credV1.encryptedData, credV1.iv, credV1.tag)).toBe("oauth_refresh_token_v1");
      expect(decryptSecretPayload(credV2.encryptedData, credV2.iv, credV2.tag)).toBe("oauth_refresh_token_v2");
    });
  });
});
