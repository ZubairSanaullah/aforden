import crypto from "crypto";

/**
 * Phase 1.20.9 — Secrets Management, Credential Encryption & Key Rotation
 *
 * Core Cryptographic Service for:
 * 1. AES-256-GCM Authenticated Encryption & Decryption at Rest.
 * 2. KMS Envelope Encryption with Data Encryption Keys (DEK).
 * 3. Secret Fingerprinting (SHA-256 non-reversible identifier).
 * 4. Master Key & Credential Rotation Lifecycle Management.
 */

export class CredentialDecryptionError extends Error {
    public readonly code = "CREDENTIAL_DECRYPTION_FAILED";
    constructor(message: string = "Failed to decrypt secret payload: authentication tag mismatch or corrupted ciphertext.") {
        super(message);
        this.name = "CredentialDecryptionError";
    }
}

export class KeyRotationError extends Error {
    public readonly code = "KEY_ROTATION_FAILED";
    constructor(message: string) {
        super(message);
        this.name = "KeyRotationError";
    }
}

export class KeyVaultConfigurationError extends Error {
    public readonly code = "KEY_VAULT_CONFIGURATION_ERROR";
    constructor(message: string = "Key vault configuration error.") {
        super(message);
        this.name = "KeyVaultConfigurationError";
    }
}

export interface EncryptedSecretRecord {
    encryptedData: string;
    iv: string;
    tag: string;
    algorithm: string;
    fingerprint: string;
    version: number;
    keyVaultProvider: string;
    encryptedDek?: string | null;
}

export interface EncryptionOptions {
    masterKey?: Buffer | string;
    keyVaultProvider?: "LOCAL_ENCRYPTED_DB" | "AWS_KMS" | string;
    version?: number;
    useEnvelopeEncryption?: boolean;
}

export interface DecryptionOptions {
    masterKey?: Buffer | string;
    encryptedDek?: string | null;
}

/**
 * Derives a 32-byte (256-bit) AES-GCM master encryption key from environment secrets.
 *
 * Security Guardrails:
 * - In production (NODE_ENV === "production"):
 *   - Strictly rejects the default static fallback ("aforden_default_integration_master_key_32_bytes").
 *   - Requires INTEGRATION_KEY_ENCRYPTION_SECRET or ENCRYPTION_MASTER_KEY.
 *   - Enforces safe minimum length (>= 32 characters/bytes).
 *   - Throws KeyVaultConfigurationError if missing or weak.
 * - In dev/test (NODE_ENV !== "production"):
 *   - Preserves static fallback for local developer convenience and backward-compatible test fixtures.
 * - Error messages never leak the secret value or partial key material.
 */
export function deriveMasterKey(secretInput?: Buffer | string): Buffer {
    const isProd = process.env.NODE_ENV === "production";

    if (Buffer.isBuffer(secretInput)) {
        if (isProd && secretInput.length < 32) {
            throw new KeyVaultConfigurationError(
                "Weak master encryption key in production: Buffer key must be at least 32 bytes.",
            );
        }
        if (secretInput.length === 32) return secretInput;
        return crypto.createHash("sha256").update(secretInput).digest();
    }

    if (typeof secretInput === "string" && secretInput.length > 0) {
        if (isProd && secretInput.length < 32) {
            throw new KeyVaultConfigurationError(
                "Weak master encryption key in production: secret must be at least 32 characters long.",
            );
        }
        return crypto.createHash("sha256").update(secretInput).digest();
    }

    if (isProd) {
        const prodSecret =
            process.env.INTEGRATION_KEY_ENCRYPTION_SECRET ||
            process.env.ENCRYPTION_MASTER_KEY;

        if (!prodSecret) {
            throw new KeyVaultConfigurationError(
                "Missing master encryption key in production: INTEGRATION_KEY_ENCRYPTION_SECRET or ENCRYPTION_MASTER_KEY environment variable is required.",
            );
        }

        if (prodSecret.length < 32) {
            throw new KeyVaultConfigurationError(
                "Weak master encryption key in production: secret must be at least 32 characters long.",
            );
        }

        return crypto.createHash("sha256").update(prodSecret).digest();
    }

    const secret =
        process.env.INTEGRATION_KEY_ENCRYPTION_SECRET ||
        process.env.ENCRYPTION_MASTER_KEY ||
        process.env.NEXTAUTH_SECRET ||
        "aforden_default_integration_master_key_32_bytes";

    return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Computes a non-reversible SHA-256 fingerprint for secret identity verification.
 */
export function computeSecretFingerprint(secret: string): string {
    const digest = crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16);
    return `sha256:${digest}`;
}

/**
 * Encrypts a plaintext secret string using AES-256-GCM (with optional envelope encryption).
 *
 * Guarantees:
 * - Fresh cryptographically secure 12-byte IV per encryption operation.
 * - 16-byte GCM authentication tag for tamper detection.
 * - Output hex-encoded ciphertext, IV, and tag.
 */
export function encryptSecretPayload(
    plaintext: string,
    options: EncryptionOptions = {},
): EncryptedSecretRecord {
    const {
        masterKey: masterKeyInput,
        keyVaultProvider = "LOCAL_ENCRYPTED_DB",
        version = 1,
        useEnvelopeEncryption = false,
    } = options;

    const masterKey = deriveMasterKey(masterKeyInput);
    const fingerprint = computeSecretFingerprint(plaintext);

    if (useEnvelopeEncryption) {
        // Envelope Encryption:
        // 1. Generate ephemeral 32-byte Data Encryption Key (DEK).
        const dek = crypto.randomBytes(32);
        const iv = crypto.randomBytes(12);

        // 2. Encrypt plaintext with DEK
        const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
        const encryptedData = Buffer.concat([
            cipher.update(plaintext, "utf-8"),
            cipher.final(),
        ]).toString("hex");
        const tag = cipher.getAuthTag().toString("hex");

        // 3. Encrypt DEK with Master Key (using standard AES-256-GCM wrapper)
        const dekIv = crypto.randomBytes(12);
        const dekCipher = crypto.createCipheriv("aes-256-gcm", masterKey, dekIv);
        const encryptedDekData = Buffer.concat([
            dekCipher.update(dek),
            dekCipher.final(),
        ]);
        const dekTag = dekCipher.getAuthTag();
        // Pack dekIv (12b) + dekTag (16b) + encryptedDekData (32b) into base64
        const encryptedDek = Buffer.concat([dekIv, dekTag, encryptedDekData]).toString("base64");

        return {
            encryptedData,
            iv: iv.toString("hex"),
            tag,
            algorithm: "AES_256_GCM",
            fingerprint,
            version,
            keyVaultProvider,
            encryptedDek,
        };
    }

    // Direct AES-256-GCM Encryption with Master Key
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);

    const encryptedData = Buffer.concat([
        cipher.update(plaintext, "utf-8"),
        cipher.final(),
    ]).toString("hex");
    const tag = cipher.getAuthTag().toString("hex");

    return {
        encryptedData,
        iv: iv.toString("hex"),
        tag,
        algorithm: "AES_256_GCM",
        fingerprint,
        version,
        keyVaultProvider,
        encryptedDek: null,
    };
}

function decodeBuffer(val: string): Buffer {
    if (/^[0-9a-fA-F]+$/.test(val) && val.length % 2 === 0) {
        return Buffer.from(val, "hex");
    }
    return Buffer.from(val, "base64");
}

/**
 * Decrypts an encrypted secret payload with authentication tag validation.
 *
 * Throws CredentialDecryptionError if ciphertext or auth tag is tampered with.
 */
export function decryptSecretPayload(
    encryptedData: string,
    ivHex: string,
    tagHex: string,
    algorithm: string = "AES_256_GCM",
    options: DecryptionOptions = {},
): string {
    // 1. Plaintext test fixture support
    if (encryptedData.startsWith("plain:")) {
        return encryptedData.slice(6);
    }

    try {
        const masterKey = deriveMasterKey(options.masterKey);

        // Handle Envelope Encryption if encryptedDek is provided
        if (options.encryptedDek) {
            const dekBuffer = Buffer.from(options.encryptedDek, "base64");
            if (dekBuffer.length < 28) {
                throw new CredentialDecryptionError("Invalid encrypted DEK length.");
            }
            const dekIv = dekBuffer.subarray(0, 12);
            const dekTag = dekBuffer.subarray(12, 28);
            const encryptedDekData = dekBuffer.subarray(28);

            const dekDecipher = crypto.createDecipheriv("aes-256-gcm", masterKey, dekIv);
            dekDecipher.setAuthTag(dekTag);
            const dek = Buffer.concat([
                dekDecipher.update(encryptedDekData),
                dekDecipher.final(),
            ]);

            const iv = decodeBuffer(ivHex);
            const tag = decodeBuffer(tagHex);
            const ciphertext = decodeBuffer(encryptedData);

            const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
            decipher.setAuthTag(tag);

            const decrypted = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]);

            return decrypted.toString("utf-8");
        }

        // Direct Master Key Decryption
        const iv = decodeBuffer(ivHex);
        const tag = decodeBuffer(tagHex);
        const ciphertext = decodeBuffer(encryptedData);

        const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
        decipher.setAuthTag(tag);

        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);

        return decrypted.toString("utf-8");
    } catch (err: any) {
        if (err instanceof CredentialDecryptionError) throw err;
        if (err instanceof KeyVaultConfigurationError) throw err;
        throw new CredentialDecryptionError(
            `Failed to decrypt secret payload: ${err.message || "authentication tag mismatch"}`,
        );
    }
}

/**
 * Re-encrypts an existing secret record under a new Master Key (Key Rotation).
 * Increments credential version.
 */
export function rotateEncryptedSecret(
    existing: EncryptedSecretRecord,
    oldMasterKey: Buffer | string,
    newMasterKey: Buffer | string,
    options: { useEnvelopeEncryption?: boolean } = {},
): EncryptedSecretRecord {
    // 1. Decrypt with old key
    const plaintext = decryptSecretPayload(
        existing.encryptedData,
        existing.iv,
        existing.tag,
        existing.algorithm,
        {
            masterKey: oldMasterKey,
            encryptedDek: existing.encryptedDek,
        },
    );

    // 2. Re-encrypt with new key and incremented version
    return encryptSecretPayload(plaintext, {
        masterKey: newMasterKey,
        keyVaultProvider: existing.keyVaultProvider,
        version: existing.version + 1,
        useEnvelopeEncryption: options.useEnvelopeEncryption ?? Boolean(existing.encryptedDek),
    });
}
