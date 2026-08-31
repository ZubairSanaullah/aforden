import { PlatformRole, PlatformAdminStatus } from "@/generated/prisma/enums";

export { PlatformRole, PlatformAdminStatus };

export const PLATFORM_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const PLATFORM_STEP_UP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface PlatformAuthorizationContext {
    userId: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    platformRole: PlatformRole;
    profileId: string;
    status: PlatformAdminStatus;
    lastActiveAt: Date | null;
    lastLoginAt: Date | null;
    stepUpConfirmedAt: Date | null;
    metadata: Record<string, unknown> | null;
}
