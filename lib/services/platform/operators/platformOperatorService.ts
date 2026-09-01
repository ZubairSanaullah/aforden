import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { Prisma, PlatformRole, PlatformAdminStatus } from "@/generated/prisma/client";
import { createPasswordResetUrl } from "@/lib/services/auth/passwordResetUrl";
import {
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    assertPlatformPermission,
} from "../authorization";
import {
    recordPlatformAuditEvent,
    PLATFORM_AUDIT_EVENTS,
} from "../audit";
import {
    validateDangerousActionReason,
    assertTier2StepUpAuthenticated,
} from "../workspaces";
import {
    PlatformOperatorDto,
    CreatePlatformUserInput,
    CreatePlatformUserResult,
    UpdatePlatformUserInput,
    PlatformOperatorsFilter,
    OperatorLifecycleOptions,
} from "./types";

import {
    PlatformOperatorNotFoundError,
    PlatformOperatorConflictError,
    PlatformLastOwnerProtectionError,
    PlatformSelfModificationError,
    PlatformOperatorValidationError,
} from "./errors";

/**
 * Maps raw database User and PlatformAdminProfile into a sanitized PlatformOperatorDto.
 * Guarantees zero leakage of credentials (passwordHash is omitted).
 */
function mapToPlatformOperatorDto(user: any): PlatformOperatorDto {
    const profile = user.platformAdminProfile;
    return {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        userStatus: user.status,
        platformRole: user.platformRole,
        profileId: profile?.id ?? "",
        status: profile?.status ?? PlatformAdminStatus.INACTIVE,
        lastActiveAt: profile?.lastActiveAt ?? null,
        lastLoginAt: profile?.lastLoginAt ?? null,
        createdAt: profile?.createdAt ?? user.createdAt,
        updatedAt: profile?.updatedAt ?? user.updatedAt,
        metadata: (profile?.metadata as Record<string, unknown> | null) ?? null,
    };
}

/**
 * Retrieves a list of platform operators with filtering and pagination.
 * Gated by platform.operators.view.
 * Whitelists attributes to enforce zero credential leakage.
 */
export async function getPlatformUsers(
    context: PlatformAuthorizationContext,
    filters?: PlatformOperatorsFilter
): Promise<{
    operators: PlatformOperatorDto[];
    total: number;
}> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATORS_VIEW);

    const where: Prisma.UserWhereInput = {
        platformRole: { not: null },
    };

    if (filters?.role) {
        where.platformRole = filters.role;
    }

    if (filters?.status) {
        where.platformAdminProfile = {
            status: filters.status,
        };
    }

    if (filters?.search) {
        where.OR = [
            { name: { contains: filters.search, mode: "insensitive" } },
            { email: { contains: filters.search, mode: "insensitive" } },
        ];
    }

    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            orderBy: { createdAt: filters?.sortOrder ?? "desc" },
            take: limit,
            skip: offset,
            select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
                status: true,
                platformRole: true,
                createdAt: true,
                updatedAt: true,
                platformAdminProfile: {
                    select: {
                        id: true,
                        status: true,
                        lastActiveAt: true,
                        lastLoginAt: true,
                        metadata: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        }),
        prisma.user.count({ where }),
    ]);

    return {
        operators: users.map(mapToPlatformOperatorDto),
        total,
    };
}

/**
 * Retrieves detailed diagnostics for a single platform operator.
 * Gated by platform.operators.view.
 */
export async function getPlatformUser(
    context: PlatformAuthorizationContext,
    userId: string,
    tx?: Prisma.TransactionClient
): Promise<PlatformOperatorDto | null> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATORS_VIEW);
    const db = tx || prisma;

    const user = await db.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            status: true,
            platformRole: true,
            createdAt: true,
            updatedAt: true,
            platformAdminProfile: {
                select: {
                    id: true,
                    status: true,
                    lastActiveAt: true,
                    lastLoginAt: true,
                    metadata: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
        },
    });

    if (!user || !user.platformRole) {
        return null;
    }

    return mapToPlatformOperatorDto(user);
}

/**
 * Provisions a platform operator identity (Phase 1.19.8).
 * 
 * Supports two workflows:
 * 1. Promoting an existing User: Assigns platformRole and creates PlatformAdminProfile.
 * 2. Onboarding a new Operator by email: Provisions base User and PlatformAdminProfile.
 * 
 * Invariants & Guarantees:
 * - Strictly gated by platform.operators.invite (PLATFORM_OWNER-exclusive).
 * - Tier-2 dangerous action validation: mandatory justification reason (min 10 chars).
 * - Step-up authentication guard hook (Phase 1.19.17).
 * - Rejects if user is already an active platform operator (conflict).
 * - Atomic & durable: User/Profile write and OPERATOR_INVITED audit record committed together in $transaction.
 */
export async function createPlatformUser(
    context: PlatformAuthorizationContext,
    input: CreatePlatformUserInput,
    reason: string,
    options?: OperatorLifecycleOptions
): Promise<CreatePlatformUserResult> {
    // 1. Permission Gate (OWNER-exclusive)
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATORS_INVITE);

    // 2. Tier-2 Dangerous Action Reason Validation
    const validatedReason = validateDangerousActionReason(reason);

    // 3. Step-up Authentication Guard Hook (Phase 1.19.17)
    assertTier2StepUpAuthenticated(context);

    // 4. Input validation
    if (!input.userId && !input.email) {
        throw new PlatformOperatorValidationError(
            "Either userId or email must be provided to create a platform operator."
        );
    }
    if (!input.platformRole) {
        throw new PlatformOperatorValidationError("platformRole is mandatory.");
    }

    // 5. Atomic Transaction: Identity Provisioning + Access Setup Token + Compliance Audit Log
    return prisma.$transaction(async (tx) => {
        let targetUser: any = null;

        if (input.userId) {
            targetUser = await tx.user.findUnique({
                where: { id: input.userId },
                include: { platformAdminProfile: true },
            });
            if (!targetUser) {
                throw new PlatformOperatorNotFoundError(input.userId);
            }
        } else if (input.email) {
            const normalizedEmail = input.email.toLowerCase().trim();
            targetUser = await tx.user.findUnique({
                where: { email: normalizedEmail },
                include: { platformAdminProfile: true },
            });
        }

        let targetUserId: string;
        let previousState: Record<string, unknown> | null = null;
        let setupToken: string | null = null;
        let setupUrl: string | null = null;

        if (targetUser) {
            // Existing User: Verify not already an active operator
            if (
                targetUser.platformRole &&
                targetUser.platformAdminProfile?.status === PlatformAdminStatus.ACTIVE
            ) {
                throw new PlatformOperatorConflictError(
                    `User '${targetUser.email}' is already an active platform operator with role '${targetUser.platformRole}'. Use changePlatformRole to update.`
                );
            }

            previousState = {
                platformRole: targetUser.platformRole ?? null,
                status: targetUser.platformAdminProfile?.status ?? null,
            };

            await tx.user.update({
                where: { id: targetUser.id },
                data: {
                    platformRole: input.platformRole,
                    name: input.name !== undefined ? input.name : targetUser.name,
                },
            });

            await tx.platformAdminProfile.upsert({
                where: { userId: targetUser.id },
                update: {
                    status: PlatformAdminStatus.ACTIVE,
                    metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                },
                create: {
                    userId: targetUser.id,
                    status: PlatformAdminStatus.ACTIVE,
                    metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                },
            });

            targetUserId = targetUser.id;
        } else {
            // New Operator: Create User and PlatformAdminProfile from scratch
            const normalizedEmail = input.email!.toLowerCase().trim();
            const created = await tx.user.create({
                data: {
                    email: normalizedEmail,
                    name: input.name ?? null,
                    status: "ACTIVE",
                    emailVerified: new Date(),
                    platformRole: input.platformRole,
                    platformAdminProfile: {
                        create: {
                            status: PlatformAdminStatus.ACTIVE,
                            metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                        },
                    },
                },
                select: { id: true },
            });

            targetUserId = created.id;
            previousState = null;

            // Generate initial password setup token so new operator can set password and gain access
            const rawToken = crypto.randomBytes(32).toString("hex");
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

            await tx.passwordResetToken.create({
                data: {
                    userId: targetUserId,
                    tokenHash,
                    expiresAt,
                },
            });

            setupToken = rawToken;
            setupUrl = createPasswordResetUrl(rawToken);
        }

        // Compliance Audit Record (atomic within transaction)
        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.OPERATOR_INVITED,
            targetType: "OPERATOR",
            targetId: targetUserId,
            workspaceId: null,
            requestId: options?.requestId ?? `req_operator_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState,
            newState: {
                platformRole: input.platformRole,
                status: PlatformAdminStatus.ACTIVE,
            },
            metadata: options?.metadata ?? null,
            tx,
        });

        const detail = await getPlatformUser(context, targetUserId, tx);
        if (!detail) {
            throw new PlatformOperatorNotFoundError(targetUserId);
        }

        return {
            operator: detail,
            setupToken,
            setupUrl,
        };
    });
}


/**
 * Changes a platform operator's administrative role (Phase 1.19.8).
 * 
 * Invariants & Guarantees:
 * - Strictly gated by platform.operators.update_role (PLATFORM_OWNER-exclusive).
 * - Tier-2 dangerous action validation: mandatory justification reason (min 10 chars).
 * - Step-up authentication guard hook (Phase 1.19.17).
 * - Self-modification guard: Operator cannot change their own role.
 * - Last Owner protection: Cannot demote the last remaining active PLATFORM_OWNER.
 * - Idempotency guard: Rejects if operator already holds target role.
 * - Atomic & durable: Role mutation and OPERATOR_ROLE_UPDATED audit record committed together in $transaction.
 */
export async function changePlatformRole(
    context: PlatformAuthorizationContext,
    targetUserId: string,
    newRole: PlatformRole,
    reason: string,
    options?: OperatorLifecycleOptions
): Promise<PlatformOperatorDto> {
    // 1. Permission Gate (OWNER-exclusive)
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATORS_UPDATE_ROLE);

    // 2. Tier-2 Dangerous Action Reason Validation
    const validatedReason = validateDangerousActionReason(reason);

    // 3. Step-up Authentication Guard Hook (Phase 1.19.17)
    assertTier2StepUpAuthenticated(context);

    // 4. Self-Modification Guard
    if (context.userId === targetUserId) {
        throw new PlatformSelfModificationError(
            "Operators cannot alter their own platform role. Another platform owner must perform this action."
        );
    }

    // 5. Atomic Transaction: Role Mutation + Last-Owner Check + Audit Log
    return prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
            where: { id: targetUserId },
            include: { platformAdminProfile: true },
        });

        if (!target || !target.platformRole) {
            throw new PlatformOperatorNotFoundError(targetUserId);
        }

        const oldRole = target.platformRole;
        if (oldRole === newRole) {
            throw new PlatformOperatorConflictError(
                `Operator '${targetUserId}' already holds role '${newRole}'.`
            );
        }

        // Last-Owner Protection: Abort if demoting the sole remaining active PLATFORM_OWNER
        if (oldRole === PlatformRole.PLATFORM_OWNER && newRole !== PlatformRole.PLATFORM_OWNER) {
            const activeOwnerCount = await tx.platformAdminProfile.count({
                where: {
                    status: PlatformAdminStatus.ACTIVE,
                    user: {
                        platformRole: PlatformRole.PLATFORM_OWNER,
                        status: "ACTIVE",
                    },
                },
            });

            if (activeOwnerCount <= 1) {
                throw new PlatformLastOwnerProtectionError(
                    "Cannot demote the last remaining active PLATFORM_OWNER. The platform must maintain at least one active owner."
                );
            }
        }

        await tx.user.update({
            where: { id: targetUserId },
            data: { platformRole: newRole },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.OPERATOR_ROLE_UPDATED,
            targetType: "OPERATOR",
            targetId: targetUserId,
            workspaceId: null,
            requestId: options?.requestId ?? `req_role_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: { platformRole: oldRole },
            newState: { platformRole: newRole },
            metadata: options?.metadata ?? null,
            tx,
        });

        const detail = await getPlatformUser(context, targetUserId, tx);
        if (!detail) {
            throw new PlatformOperatorNotFoundError(targetUserId);
        }
        return detail;
    });
}

/**
 * Deactivates a platform operator account (Phase 1.19.8).
 * 
 * Invariants & Guarantees:
 * - Strictly gated by platform.operators.revoke (PLATFORM_OWNER-exclusive).
 * - Tier-2 dangerous action validation: mandatory justification reason (min 10 chars).
 * - Step-up authentication guard hook (Phase 1.19.17).
 * - Self-modification guard: Operator cannot deactivate their own account.
 * - Last Owner protection: Cannot deactivate the last remaining active PLATFORM_OWNER.
 * - Idempotency guard: Rejects if operator is already INACTIVE.
 * - Atomic & durable: Profile update and OPERATOR_REVOKED audit record committed together in $transaction.
 */
export async function deactivatePlatformUser(
    context: PlatformAuthorizationContext,
    targetUserId: string,
    reason: string,
    options?: OperatorLifecycleOptions
): Promise<PlatformOperatorDto> {
    // 1. Permission Gate (OWNER-exclusive)
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATORS_REVOKE);

    // 2. Tier-2 Dangerous Action Reason Validation
    const validatedReason = validateDangerousActionReason(reason);

    // 3. Step-up Authentication Guard Hook (Phase 1.19.17)
    assertTier2StepUpAuthenticated(context);

    // 4. Self-Modification Guard
    if (context.userId === targetUserId) {
        throw new PlatformSelfModificationError(
            "Operators cannot deactivate their own platform account. Another platform owner must perform this action."
        );
    }

    // 5. Atomic Transaction: Deactivation + Last-Owner Check + Audit Log
    return prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
            where: { id: targetUserId },
            include: { platformAdminProfile: true },
        });

        if (!target || !target.platformRole || !target.platformAdminProfile) {
            throw new PlatformOperatorNotFoundError(targetUserId);
        }

        const profile = target.platformAdminProfile;
        if (profile.status === PlatformAdminStatus.INACTIVE) {
            throw new PlatformOperatorConflictError(
                `Operator '${targetUserId}' is already inactive.`
            );
        }

        // Last-Owner Protection: Abort if deactivating the sole remaining active PLATFORM_OWNER
        if (
            target.platformRole === PlatformRole.PLATFORM_OWNER &&
            profile.status === PlatformAdminStatus.ACTIVE
        ) {
            const activeOwnerCount = await tx.platformAdminProfile.count({
                where: {
                    status: PlatformAdminStatus.ACTIVE,
                    user: {
                        platformRole: PlatformRole.PLATFORM_OWNER,
                        status: "ACTIVE",
                    },
                },
            });

            if (activeOwnerCount <= 1) {
                throw new PlatformLastOwnerProtectionError(
                    "Cannot deactivate the last remaining active PLATFORM_OWNER. The platform must maintain at least one active owner."
                );
            }
        }

        await tx.platformAdminProfile.update({
            where: { id: profile.id },
            data: { status: PlatformAdminStatus.INACTIVE },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.OPERATOR_REVOKED,
            targetType: "OPERATOR",
            targetId: targetUserId,
            workspaceId: null,
            requestId: options?.requestId ?? `req_revoke_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: { status: PlatformAdminStatus.ACTIVE },
            newState: { status: PlatformAdminStatus.INACTIVE },
            metadata: options?.metadata ?? null,
            tx,
        });

        const detail = await getPlatformUser(context, targetUserId, tx);
        if (!detail) {
            throw new PlatformOperatorNotFoundError(targetUserId);
        }
        return detail;
    });
}

/**
 * Updates profile fields (name, metadata) of a platform operator.
 * Role changes must go through changePlatformRole.
 * Gated by platform.operators.update_role (PLATFORM_OWNER-exclusive).
 */
export async function updatePlatformUser(
    context: PlatformAuthorizationContext,
    targetUserId: string,
    data: UpdatePlatformUserInput,
    options?: OperatorLifecycleOptions
): Promise<PlatformOperatorDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.OPERATORS_UPDATE_ROLE);

    return prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
            where: { id: targetUserId },
            include: { platformAdminProfile: true },
        });

        if (!target || !target.platformRole || !target.platformAdminProfile) {
            throw new PlatformOperatorNotFoundError(targetUserId);
        }

        if (data.name !== undefined) {
            await tx.user.update({
                where: { id: targetUserId },
                data: { name: data.name },
            });
        }

        if (data.metadata !== undefined) {
            await tx.platformAdminProfile.update({
                where: { id: target.platformAdminProfile.id },
                data: {
                    metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                },
            });
        }

        const detail = await getPlatformUser(context, targetUserId, tx);
        if (!detail) {
            throw new PlatformOperatorNotFoundError(targetUserId);
        }
        return detail;
    });
}
