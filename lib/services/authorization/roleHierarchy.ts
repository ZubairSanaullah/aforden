import type {
    MembershipRole,
} from "@/generated/prisma/client";

export const ROLE_HIERARCHY: Record<
    MembershipRole,
    number
> = {
    OWNER: 600,
    ADMIN: 500,
    MANAGER: 400,
    DISPATCHER: 300,
    TECHNICIAN: 200,
    ACCOUNTANT: 100,
};

export function roleHasMinimumLevel(
    role: MembershipRole,
    minimumRole: MembershipRole
): boolean {
    return (
        ROLE_HIERARCHY[role] >=
        ROLE_HIERARCHY[minimumRole]
    );
}

export function roleIsHigherThan(
    role: MembershipRole,
    otherRole: MembershipRole
): boolean {
    return (
        ROLE_HIERARCHY[role] >
        ROLE_HIERARCHY[otherRole]
    );
}