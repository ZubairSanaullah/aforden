import type {
    MembershipRole,
    MembershipStatus,
} from "@/generated/prisma/client";

export interface AuthorizationUser {
    id: string;
    name: string | null;
    email: string;
    status: string;
    emailVerified: Date | null;
}

export interface AuthorizationWorkspace {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    timezone: string;
}

export interface AuthorizationMembership {
    id: string;
    role: MembershipRole;
    status: MembershipStatus;
}

export interface WorkspaceAuthorizationContext {
    user: AuthorizationUser;

    workspace: AuthorizationWorkspace;

    membership: AuthorizationMembership;
}