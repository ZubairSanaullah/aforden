import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
    CreateDeveloperApplicationInput,
    CreateApiKeyInput,
    CreateApiKeyResult,
    ResolvedApiCredential,
    ApiKeyEnvironment,
    DeveloperApplicationStatus,
} from "./developerApp.types";
import {
    validatePublicApiScopes,
    ALL_PUBLIC_API_SCOPES,
} from "@/lib/publicApi/scopes";

/**
 * Computes the SHA-256 hash of a raw API key secret.
 */
export function hashApiKey(rawKey: string): string {
    return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Generates a structured raw API key, masked display prefix, and SHA-256 hash.
 */
export function generateRawApiKey(environment: ApiKeyEnvironment = "LIVE"): {
    rawKey: string;
    keyPrefix: string;
    keyHash: string;
} {
    const prefix = environment === "TEST" ? "afd_test_" : "afd_live_";
    const randomSecret = crypto.randomBytes(24).toString("base64url");
    const rawKey = `${prefix}${randomSecret}`;
    const keyPrefix = `${rawKey.slice(0, 12)}...${rawKey.slice(-4)}`;
    const keyHash = hashApiKey(rawKey);
    return { rawKey, keyPrefix, keyHash };
}

/**
 * Creates a new DeveloperApplication record bound to a workspace.
 */
export async function createDeveloperApplication(
    workspaceId: string,
    input: CreateDeveloperApplicationInput,
) {
    return prisma.developerApplication.create({
        data: {
            workspaceId,
            name: input.name,
            description: input.description,
            createdByUserId: input.createdByUserId,
            status: "ACTIVE",
        },
    });
}

/**
 * Gets a DeveloperApplication by ID within a workspace.
 */
export async function getDeveloperApplication(
    workspaceId: string,
    id: string,
) {
    return prisma.developerApplication.findFirst({
        where: {
            id,
            workspaceId,
        },
        include: {
            apiKeys: {
                orderBy: { createdAt: "desc" },
            },
        },
    });
}

/**
 * Updates the status of a DeveloperApplication.
 */
export async function updateDeveloperApplicationStatus(
    workspaceId: string,
    id: string,
    status: DeveloperApplicationStatus,
) {
    const app = await prisma.developerApplication.findFirst({
        where: { id, workspaceId },
    });
    if (!app) {
        throw new Error(`DeveloperApplication '${id}' not found in workspace '${workspaceId}'`);
    }

    return prisma.developerApplication.update({
        where: { id },
        data: { status },
    });
}

/**
 * Issues a new ApiKey for a DeveloperApplication.
 * Returns the raw secret key ONCE to the caller; only keyHash is persisted.
 */
export async function createApiKey(
    workspaceId: string,
    developerApplicationId: string,
    input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
    const app = await prisma.developerApplication.findFirst({
        where: { id: developerApplicationId, workspaceId },
    });
    if (!app) {
        throw new Error(
            `DeveloperApplication '${developerApplicationId}' not found in workspace '${workspaceId}'`,
        );
    }

    const env = input.environment ?? "LIVE";
    const scopes = input.scopes ?? [];

    // Validate requested scopes against canonical registry
    const { valid, invalidScopes } = validatePublicApiScopes(scopes);
    if (!valid) {
        throw new Error(
            `Invalid scope(s) requested: [${invalidScopes.join(", ")}]. Canonical scopes are: [${ALL_PUBLIC_API_SCOPES.join(", ")}]`,
        );
    }

    const { rawKey, keyPrefix, keyHash } = generateRawApiKey(env);

    const apiKey = await prisma.apiKey.create({
        data: {
            developerApplicationId,
            keyHash,
            keyPrefix,
            environment: env,
            status: "ACTIVE",
            scopes,
            expiresAt: input.expiresAt ?? null,
            metadata: input.metadata ?? undefined,
        },
    });

    return {
        id: apiKey.id,
        developerApplicationId: apiKey.developerApplicationId,
        keyPrefix: apiKey.keyPrefix,
        environment: apiKey.environment,
        status: apiKey.status,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        rawSecretKey: rawKey,
    };
}

/**
 * Resolves an active API credential by its SHA-256 keyHash.
 * Enforces:
 * 1. ApiKey status is ACTIVE
 * 2. ApiKey is not expired (expiresAt > now or null)
 * 3. Parent DeveloperApplication status is ACTIVE
 * 4. Resolves workspaceId from DeveloperApplication tenant boundary
 */
export async function resolveActiveApiKeyByKeyHash(
    keyHash: string,
): Promise<ResolvedApiCredential | null> {
    const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash },
        include: {
            developerApplication: true,
        },
    });

    if (!apiKey) {
        return null;
    }

    // Check key status
    if (apiKey.status !== "ACTIVE") {
        return null;
    }

    // Check key expiration
    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
        return null;
    }

    // Check parent DeveloperApplication status
    if (apiKey.developerApplication.status !== "ACTIVE") {
        return null;
    }

    return {
        apiKeyId: apiKey.id,
        developerApplicationId: apiKey.developerApplication.id,
        developerApplicationName: apiKey.developerApplication.name,
        workspaceId: apiKey.developerApplication.workspaceId,
        environment: apiKey.environment,
        scopes: apiKey.scopes,
    };
}

/**
 * Revokes an existing ApiKey.
 */
export async function revokeApiKey(
    workspaceId: string,
    developerApplicationId: string,
    apiKeyId: string,
) {
    const app = await prisma.developerApplication.findFirst({
        where: { id: developerApplicationId, workspaceId },
    });
    if (!app) {
        throw new Error(
            `DeveloperApplication '${developerApplicationId}' not found in workspace '${workspaceId}'`,
        );
    }

    const key = await prisma.apiKey.findFirst({
        where: { id: apiKeyId, developerApplicationId },
    });
    if (!key) {
        throw new Error(`ApiKey '${apiKeyId}' not found for application '${developerApplicationId}'`);
    }

    return prisma.apiKey.update({
        where: { id: apiKeyId },
        data: {
            status: "REVOKED",
            revokedAt: new Date(),
        },
    });
}

/**
 * Lists all API keys for an application.
 */
export async function listDeveloperApplicationKeys(
    workspaceId: string,
    developerApplicationId: string,
) {
    const app = await prisma.developerApplication.findFirst({
        where: { id: developerApplicationId, workspaceId },
    });
    if (!app) {
        throw new Error(
            `DeveloperApplication '${developerApplicationId}' not found in workspace '${workspaceId}'`,
        );
    }

    return prisma.apiKey.findMany({
        where: { developerApplicationId },
        orderBy: { createdAt: "desc" },
    });
}

/**
 * Updates lastUsedAt on an ApiKey upon successful authentication.
 */
export async function touchApiKeyLastUsed(apiKeyId: string): Promise<void> {
    try {
        await prisma.apiKey.update({
            where: { id: apiKeyId },
            data: { lastUsedAt: new Date() },
        });
    } catch (err) {
        // Suppress non-critical tracking error to prevent disrupting request execution
        console.error(`[PublicAPI] Failed to update lastUsedAt for key '${apiKeyId}':`, err);
    }
}

