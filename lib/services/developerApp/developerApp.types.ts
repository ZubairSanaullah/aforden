import {
    DeveloperApplicationStatus,
    ApiKeyEnvironment,
    ApiKeyStatus,
} from "@/generated/prisma/client";
import { PublicApiScope } from "@/lib/publicApi/scopes";

export {
    DeveloperApplicationStatus,
    ApiKeyEnvironment,
    ApiKeyStatus,
};
export type { PublicApiScope };

export interface CreateDeveloperApplicationInput {
    name: string;
    description?: string;
    createdByUserId: string;
}

export interface CreateApiKeyInput {
    environment?: ApiKeyEnvironment;
    scopes: string[] | PublicApiScope[];
    expiresAt?: Date | null;
    metadata?: Record<string, any>;
}

export interface CreateApiKeyResult {
    id: string;
    developerApplicationId: string;
    keyPrefix: string;
    environment: ApiKeyEnvironment;
    status: ApiKeyStatus;
    scopes: string[];
    expiresAt: Date | null;
    createdAt: Date;
    rawSecretKey: string;
}

export interface ResolvedApiCredential {
    apiKeyId: string;
    developerApplicationId: string;
    developerApplicationName: string;
    workspaceId: string;
    environment: ApiKeyEnvironment;
    scopes: string[];
}
