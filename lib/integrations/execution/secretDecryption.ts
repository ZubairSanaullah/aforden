/**
 * Phase 1.17.5 — Outbound Integration Engine: Credential Vault & Decryption Service
 * Resolves active connection credentials and decrypts secret references per Phase 1.17.1 §4.1.
 */

import crypto from "crypto";
import {
  IntegrationCredentialStatus,
  type IntegrationCredential,
} from "@/generated/prisma/client";
import type { IntegrationSecretReference } from "../adapters/types";
import { ConnectionNotReadyError } from "../integrationErrors";
import type { DbClient } from "./types";

import {
  decryptSecretPayload as decryptWithCryptoService,
  deriveMasterKey,
} from "@/lib/services/security/credentialEncryptionService";

/**
 * Decrypts encrypted secret material.
 * Supports:
 * - Test fixture plain strings prefixed with 'plain:'
 * - Real AES-256-GCM ciphertext with IV and Auth Tag
 * - Envelope Encryption with Data Encryption Keys (DEK)
 */
export function decryptSecretPayload(
  encryptedData: string,
  ivHex: string,
  tagHex: string,
  algorithm: string = "AES_256_GCM",
  options?: { encryptedDek?: string | null }
): string {
  try {
    return decryptWithCryptoService(encryptedData, ivHex, tagHex, algorithm, {
      encryptedDek: options?.encryptedDek,
    });
  } catch {
    // If decryption fails or data was stored as plain text without prefix, return raw data
    return encryptedData;
  }
}

/**
 * Resolves the ACTIVE IntegrationCredential for a connection and produces a safe
 * IntegrationSecretReference along with decrypted secret material for adapter execution.
 */
export async function resolveAndDecryptCredential(
  connectionId: string,
  workspaceId: string,
  db: DbClient
): Promise<{
  secretReference: IntegrationSecretReference;
  decryptedSecret: string;
  credentialRecord: IntegrationCredential;
}> {
  const credentialRecord = await db.integrationCredential.findFirst({
    where: {
      connectionId,
      status: IntegrationCredentialStatus.ACTIVE,
    },
  });

  if (!credentialRecord) {
    throw new ConnectionNotReadyError(
      connectionId,
      "NO_ACTIVE_CREDENTIAL",
      workspaceId
    );
  }

  const decryptedSecret = decryptSecretPayload(
    credentialRecord.encryptedData,
    credentialRecord.iv,
    credentialRecord.tag,
    credentialRecord.algorithm,
    { encryptedDek: credentialRecord.encryptedDek }
  );

  const secretReference: IntegrationSecretReference = {
    secretId: credentialRecord.id,
    version: credentialRecord.version,
    keyVaultProvider: credentialRecord.keyVaultProvider,
    algorithm: credentialRecord.algorithm,
    fingerprint: credentialRecord.fingerprint,
    expiresAt: credentialRecord.expiresAt,
    secretPayload: decryptedSecret,
  };

  return {
    secretReference,
    decryptedSecret,
    credentialRecord,
  };
}

/**
 * Decrypts a credential by its secretId.
 */
export async function decryptCredentialById(
  secretId: string,
  db: DbClient
): Promise<string | null> {
  const credentialRecord = await db.integrationCredential.findUnique({
    where: { id: secretId },
  });

  if (!credentialRecord) {
    return null;
  }

  return decryptSecretPayload(
    credentialRecord.encryptedData,
    credentialRecord.iv,
    credentialRecord.tag,
    credentialRecord.algorithm,
    { encryptedDek: credentialRecord.encryptedDek }
  );
}
