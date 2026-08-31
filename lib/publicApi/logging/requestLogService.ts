import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
    CreateApiRequestLogParams,
    ApiRequestLogQueryOptions,
    ApiRequestLogDto,
    PaginatedApiRequestLogsResult,
} from "./requestLog.types";

/**
 * Maps a Prisma ApiRequestLog record to a sanitized public DTO.
 */
function toApiRequestLogDto(record: any): ApiRequestLogDto {
    return {
        id: record.id,
        workspaceId: record.workspaceId,
        apiKeyId: record.apiKeyId ?? null,
        developerApplicationId: record.developerApplicationId ?? null,
        requestId: record.requestId,
        endpoint: record.endpoint,
        method: record.method,
        statusCode: record.statusCode,
        durationMs: record.durationMs,
        ipHash: record.ipHash ?? null,
        userAgent: record.userAgent ?? null,
        apiVersion: record.apiVersion,
        rateLimitTier: record.rateLimitTier ?? null,
        errorCode: record.errorCode ?? null,
        createdAt: record.createdAt.toISOString(),
    };
}

/**
 * Records an API request execution log asynchronously.
 *
 * Guaranteed Non-Throwing / Fail-Safe:
 * Observability write failures will NEVER throw, alter, or fail client API requests.
 */
export async function recordApiRequestLog(
    params: CreateApiRequestLogParams,
): Promise<ApiRequestLogDto | null> {
    try {
        const record = await prisma.apiRequestLog.create({
            data: {
                workspaceId: params.workspaceId,
                apiKeyId: params.apiKeyId ?? null,
                developerApplicationId: params.developerApplicationId ?? null,
                requestId: params.requestId,
                endpoint: params.endpoint,
                method: params.method,
                statusCode: params.statusCode,
                durationMs: Math.max(0, Math.round(params.durationMs)),
                ipHash: params.ipHash ?? null,
                userAgent: params.userAgent
                    ? params.userAgent.substring(0, 512)
                    : null,
                apiVersion: params.apiVersion ?? "v1",
                rateLimitTier: params.rateLimitTier ?? null,
                errorCode: params.errorCode ?? null,
            },
        });

        return toApiRequestLogDto(record);
    } catch (error) {
        // Observability logging must never throw or disrupt client traffic
        console.error(
            `[PublicAPI] Failed to record API request log [${params.requestId}]:`,
            error,
        );
        return null;
    }
}

/**
 * Queries request logs for a workspace with strict tenant isolation and cursor pagination.
 */
export async function queryApiRequestLogs(
    workspaceId: string,
    options?: ApiRequestLogQueryOptions,
): Promise<PaginatedApiRequestLogsResult> {
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 100);
    const where: Prisma.ApiRequestLogWhereInput = {
        workspaceId,
    };

    if (options?.apiKeyId) {
        where.apiKeyId = options.apiKeyId;
    }

    if (options?.developerApplicationId) {
        where.developerApplicationId = options.developerApplicationId;
    }

    if (options?.statusCode !== undefined) {
        where.statusCode = options.statusCode;
    }

    if (options?.endpoint) {
        where.endpoint = options.endpoint;
    }

    if (options?.method) {
        where.method = options.method.toUpperCase();
    }

    if (options?.startDate || options?.endDate) {
        where.createdAt = {};
        if (options.startDate) {
            where.createdAt.gte = options.startDate;
        }
        if (options.endDate) {
            where.createdAt.lte = options.endDate;
        }
    }

    const queryArgs: Prisma.ApiRequestLogFindManyArgs = {
        where,
        take: limit + 1,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    };

    if (options?.cursor) {
        queryArgs.cursor = { id: options.cursor };
        queryArgs.skip = 1;
    }

    const records = await prisma.apiRequestLog.findMany(queryArgs);

    let hasMore = false;
    let nextCursor: string | null = null;

    if (records.length > limit) {
        hasMore = true;
        const extraItem = records.pop();
        const lastItem = records[records.length - 1];
        nextCursor = lastItem?.id ?? null;
    }

    return {
        items: records.map(toApiRequestLogDto),
        nextCursor,
        hasMore,
    };
}

/**
 * Helper to clean up request logs for testing.
 */
export async function deleteApiRequestLogsForTesting(
    workspaceId: string,
): Promise<number> {
    const result = await prisma.apiRequestLog.deleteMany({
        where: { workspaceId },
    });
    return result.count;
}
