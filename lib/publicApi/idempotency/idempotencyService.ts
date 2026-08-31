import { prisma } from "@/lib/prisma";
import {
    DEFAULT_IDEMPOTENCY_TTL_MS,
    IdempotencyAcquisitionResult,
    IdempotencyScope,
} from "./idempotency.types";
import { computePayloadHash, computeScopedKeyHash } from "./canonicalHash";

export interface AcquireIdempotencyParams extends IdempotencyScope {
    requestPayload: unknown;
    ttlMs?: number;
}

export interface ResolveIdempotencyParams {
    recordId: string;
    responseStatus: number;
    responseBody: unknown;
    responseHeaders?: Record<string, string>;
}

/**
 * Atomically attempts to acquire an idempotency lock for a scoped key.
 *
 * Implements strict database-level mutual exclusion:
 * 1. Checks for existing active record matching the unique scoped key hash.
 * 2. If resolved and payload matches -> returns cached response (REPLAY).
 * 3. If resolved and payload differs -> returns payload mismatch conflict (CONFLICT).
 * 4. If currently pending -> returns concurrent execution conflict (IN_PROGRESS).
 * 5. If expired or non-existent -> inserts a new PENDING record with uniqueness constraint.
 *    Any concurrent insert race fails on database unique constraint (P2002) and falls back safely.
 */
export async function acquireIdempotencyLock(
    params: AcquireIdempotencyParams,
): Promise<IdempotencyAcquisitionResult> {
    const {
        workspaceId,
        apiKeyId,
        endpoint,
        idempotencyKey,
        requestPayload,
        ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS,
    } = params;

    const scopedKeyHash = computeScopedKeyHash(
        workspaceId,
        apiKeyId,
        endpoint,
        idempotencyKey,
    );
    const requestHash = computePayloadHash(requestPayload);
    const now = new Date();

    // 1. Check existing record
    const existing = await prisma.apiIdempotencyRecord.findUnique({
        where: { scopedKeyHash },
    });

    if (existing) {
        // If expired, clean it up and treat as new request
        if (existing.expiresAt <= now) {
            await prisma.apiIdempotencyRecord
                .delete({
                    where: { id: existing.id },
                })
                .catch(() => {});
        } else {
            // Active unexpired record exists
            if (existing.status === "RESOLVED") {
                if (existing.requestHash !== requestHash) {
                    return {
                        kind: "CONFLICT",
                        message:
                            "Idempotency key was previously used with a different request payload.",
                    };
                }

                return {
                    kind: "REPLAY",
                    responseStatus: existing.responseStatus ?? 200,
                    responseBody: existing.responseBody,
                    responseHeaders: existing.responseHeaders as
                        | Record<string, string>
                        | undefined,
                };
            }

            if (existing.status === "PENDING") {
                return {
                    kind: "IN_PROGRESS",
                    message:
                        "A request with this idempotency key is currently being processed. Please retry shortly.",
                };
            }

            // If status is FAILED, remove and re-attempt
            if (existing.status === "FAILED") {
                await prisma.apiIdempotencyRecord
                    .delete({
                        where: { id: existing.id },
                    })
                    .catch(() => {});
            }
        }
    }

    // 2. Insert new PENDING record with database-level uniqueness guarantee
    const expiresAt = new Date(Date.now() + ttlMs);

    try {
        const record = await prisma.apiIdempotencyRecord.create({
            data: {
                workspaceId,
                apiKeyId,
                endpoint,
                idempotencyKey,
                scopedKeyHash,
                requestHash,
                status: "PENDING",
                expiresAt,
            },
        });

        return {
            kind: "ACQUIRED",
            recordId: record.id,
            scopedKeyHash,
        };
    } catch (error: any) {
        // Handle unique constraint violation on simultaneous concurrent race
        if (error?.code === "P2002") {
            const raced = await prisma.apiIdempotencyRecord.findUnique({
                where: { scopedKeyHash },
            });

            if (raced && raced.expiresAt > new Date()) {
                if (raced.status === "RESOLVED") {
                    if (raced.requestHash !== requestHash) {
                        return {
                            kind: "CONFLICT",
                            message:
                                "Idempotency key was previously used with a different request payload.",
                        };
                    }
                    return {
                        kind: "REPLAY",
                        responseStatus: raced.responseStatus ?? 200,
                        responseBody: raced.responseBody,
                        responseHeaders: raced.responseHeaders as
                            | Record<string, string>
                            | undefined,
                    };
                }

                return {
                    kind: "IN_PROGRESS",
                    message:
                        "A request with this idempotency key is currently being processed. Please retry shortly.",
                };
            }
        }

        throw error;
    }
}

/**
 * Resolves an active idempotency lock by persisting the final HTTP status and serialized response envelope.
 */
export async function resolveIdempotencyRecord(
    params: ResolveIdempotencyParams,
): Promise<void> {
    try {
        await prisma.apiIdempotencyRecord.update({
            where: { id: params.recordId },
            data: {
                status: "RESOLVED",
                responseStatus: params.responseStatus,
                responseBody: params.responseBody as any,
                responseHeaders: params.responseHeaders ?? undefined,
                updatedAt: new Date(),
            },
        });
    } catch (err) {
        console.error(
            `[PublicAPI:Idempotency] Failed to resolve record '${params.recordId}':`,
            err,
        );
    }
}

/**
 * Releases a pending idempotency lock on unhandled server failure, allowing future retries to execute.
 */
export async function releaseIdempotencyLock(recordId: string): Promise<void> {
    try {
        await prisma.apiIdempotencyRecord.deleteMany({
            where: {
                id: recordId,
                status: "PENDING",
            },
        });
    } catch (err) {
        console.error(
            `[PublicAPI:Idempotency] Failed to release lock for record '${recordId}':`,
            err,
        );
    }
}

/**
 * Purges expired idempotency records past their TTL.
 */
export async function purgeExpiredIdempotencyRecords(
    workspaceId?: string,
): Promise<number> {
    const result = await prisma.apiIdempotencyRecord.deleteMany({
        where: {
            expiresAt: { lte: new Date() },
            ...(workspaceId ? { workspaceId } : {}),
        },
    });
    return result.count;
}
