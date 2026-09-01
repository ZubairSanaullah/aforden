import { prisma } from "@/lib/prisma";
import { PlatformAuthorizationContext } from "../authorization/types";
import {
    PLATFORM_AUDIT_EVENTS,
    recordPlatformAuditEvent,
} from "../audit";
import { PlatformActionValidationError } from "../workspaces";
import { constantTimeBcryptCompare } from "./constantTime";

export const PLATFORM_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Thrown when operator provides an invalid password or failed credential for step-up re-authentication.
 */
export class PlatformStepUpChallengeFailedError extends Error {
    readonly statusCode = 403;
    readonly code = "STEP_UP_CHALLENGE_FAILED";

    constructor(message = "Invalid credentials for step-up challenge.") {
        super(message);
        this.name = "PlatformStepUpChallengeFailedError";
    }
}

export interface PlatformStepUpChallengeInput {
    password?: string;
    reason?: string;
}

export interface PlatformStepUpChallengeResult {
    stepUpConfirmedAt: Date;
    expiresAt: Date;
    expiresInSeconds: number;
}

export interface PlatformStepUpStatusResult {
    isStepUpActive: boolean;
    stepUpConfirmedAt: Date | null;
    expiresAt: Date | null;
    remainingSeconds: number;
}

export interface PlatformStepUpOptions {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
}

/**
 * Verifies operator credentials for step-up authentication (Phase 1.19.17).
 * 
 * Flow:
 * 1. Validates presence of password input.
 * 2. Fetches user passwordHash from database.
 * 3. Verifies bcrypt password hash match.
 * 4. On failure: emits platform.security.step_up_challenge_failed and throws 403.
 * 5. On success: updates PlatformAdminProfile.stepUpConfirmedAt = now, emits platform.security.step_up_challenge_success.
 */
export async function verifyPlatformStepUpChallenge(
    context: PlatformAuthorizationContext,
    input: PlatformStepUpChallengeInput,
    options?: PlatformStepUpOptions
): Promise<PlatformStepUpChallengeResult> {
    if (!input || typeof input.password !== "string" || !input.password.trim()) {
        throw new PlatformActionValidationError("Password required for step-up authentication.");
    }

    const user = await prisma.user.findUnique({
        where: { id: context.userId },
        select: {
            id: true,
            email: true,
            passwordHash: true,
            status: true,
            platformRole: true,
            platformAdminProfile: {
                select: {
                    id: true,
                    status: true,
                },
            },
        },
    });

    const isEligible = Boolean(
        user &&
        user.status === "ACTIVE" &&
        user.platformRole &&
        user.platformAdminProfile &&
        user.platformAdminProfile.status === "ACTIVE" &&
        user.passwordHash
    );

    // Constant-time password comparison (Phase 1.19.18):
    // Always executes full bcrypt work factor, even when operator is ineligible or lacking a password hash,
    // preventing enumeration of operator status via response latency side-channels.
    const passwordMatches = await constantTimeBcryptCompare(
        input.password,
        isEligible ? user!.passwordHash : null
    );

    if (!isEligible || !passwordMatches) {
        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.STEP_UP_CHALLENGE_FAILED,
            targetType: "OPERATOR",
            targetId: context.userId,
            workspaceId: null,
            requestId: options?.requestId ?? `req_stepup_fail_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: input.reason ?? "Step-up challenge failed: invalid credentials.",
            metadata: {
                reason: !isEligible ? "ineligible_operator" : "password_mismatch",
                ...(options?.metadata || {}),
            },
        });
        throw new PlatformStepUpChallengeFailedError();
    }

    const now = new Date();
    await prisma.platformAdminProfile.update({
        where: { id: user!.platformAdminProfile!.id },
        data: { stepUpConfirmedAt: now },
    });

    await recordPlatformAuditEvent({
        actor: context,
        action: PLATFORM_AUDIT_EVENTS.STEP_UP_CHALLENGE_SUCCESS,
        targetType: "OPERATOR",
        targetId: context.userId,
        workspaceId: null,
        requestId: options?.requestId ?? `req_stepup_ok_${Date.now()}`,
        ipAddress: options?.ipAddress ?? "127.0.0.1",
        userAgent: options?.userAgent ?? null,
        reason: input.reason ?? "Step-up authentication confirmed.",
        previousState: {
            stepUpConfirmedAt: context.stepUpConfirmedAt ? context.stepUpConfirmedAt.toISOString() : null,
        },
        newState: {
            stepUpConfirmedAt: now.toISOString(),
        },
        metadata: options?.metadata ?? null,
    });

    return {
        stepUpConfirmedAt: now,
        expiresAt: new Date(now.getTime() + PLATFORM_STEP_UP_MAX_AGE_MS),
        expiresInSeconds: Math.floor(PLATFORM_STEP_UP_MAX_AGE_MS / 1000),
    };
}

/**
 * Retrieves the current step-up authentication status for the operator context.
 */
export function getPlatformStepUpStatus(
    context: PlatformAuthorizationContext
): PlatformStepUpStatusResult {
    if (!context.stepUpConfirmedAt) {
        return {
            isStepUpActive: false,
            stepUpConfirmedAt: null,
            expiresAt: null,
            remainingSeconds: 0,
        };
    }

    const confirmedTime = new Date(context.stepUpConfirmedAt).getTime();
    const elapsedMs = Date.now() - confirmedTime;

    if (elapsedMs > PLATFORM_STEP_UP_MAX_AGE_MS || elapsedMs < 0) {
        return {
            isStepUpActive: false,
            stepUpConfirmedAt: context.stepUpConfirmedAt,
            expiresAt: new Date(confirmedTime + PLATFORM_STEP_UP_MAX_AGE_MS),
            remainingSeconds: 0,
        };
    }

    const remainingMs = PLATFORM_STEP_UP_MAX_AGE_MS - elapsedMs;
    return {
        isStepUpActive: true,
        stepUpConfirmedAt: context.stepUpConfirmedAt,
        expiresAt: new Date(confirmedTime + PLATFORM_STEP_UP_MAX_AGE_MS),
        remainingSeconds: Math.floor(remainingMs / 1000),
    };
}
