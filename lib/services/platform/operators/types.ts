import { PlatformRole, PlatformAdminStatus } from "@/generated/prisma/client";

/**
 * Sanitized Platform Operator DTO.
 * Exposes identity and administrative status while strictly excluding secrets (e.g. passwordHash).
 */
export interface PlatformOperatorDto {
    userId: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    userStatus: string;
    platformRole: PlatformRole;
    profileId: string;
    status: PlatformAdminStatus;
    lastActiveAt: Date | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    metadata: Record<string, unknown> | null;
}

export interface CreatePlatformUserInput {
    userId?: string;
    email?: string;
    name?: string | null;
    platformRole: PlatformRole;
    metadata?: Record<string, unknown> | null;
}

export interface CreatePlatformUserResult {
    operator: PlatformOperatorDto;
    setupToken?: string | null;
    setupUrl?: string | null;
}

export interface UpdatePlatformUserInput {

    name?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface PlatformOperatorsFilter {
    role?: PlatformRole;
    status?: PlatformAdminStatus;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: "email" | "name" | "createdAt" | "lastActiveAt";
    sortOrder?: "asc" | "desc";
}

export interface OperatorLifecycleOptions {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
}
