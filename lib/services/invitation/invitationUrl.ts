import { getAppUrl } from "@/lib/services/auth/verificationUrl";

/**
 * Constructs the invitation acceptance URL that is sent to the invitee.
 *
 * The URL contains the RAW invitation token as a query parameter.
 * The raw token is NEVER stored in the database — only its SHA-256 hash is.
 */
export function createInvitationAcceptUrl(rawToken: string): string {
    const url = new URL("/invitations/accept", getAppUrl());

    url.searchParams.set("token", rawToken);

    return url.toString();
}
