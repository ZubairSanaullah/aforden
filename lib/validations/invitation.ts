import { z } from "zod";

/**
 * Valid invitable roles.
 *
 * OWNER cannot be granted via invitation — ownership is transferred
 * directly. The inviter must also pass assertCanManageRole() to
 * prevent escalation beyond their own role.
 */
export const INVITABLE_ROLES = [
    "ADMIN",
    "MANAGER",
    "DISPATCHER",
    "TECHNICIAN",
    "ACCOUNTANT",
] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const createInvitationSchema = z.object({
    email: z
        .string()
        .trim()
        .email("Please enter a valid email address.")
        .transform((value) => value.toLowerCase()),

    role: z.enum(INVITABLE_ROLES, {
        error: "Role must be one of: ADMIN, MANAGER, DISPATCHER, TECHNICIAN, ACCOUNTANT.",
    }),
});

export type CreateInvitationInput = z.infer<
    typeof createInvitationSchema
>;

export const acceptInvitationSchema = z.object({
    /**
     * The raw invitation token from the URL query parameter.
     *
     * This is a 64-character hex string produced by
     * crypto.randomBytes(32).toString("hex").
     *
     * The server hashes this before looking up the database record.
     */
    token: z
        .string()
        .trim()
        .min(1, "Invitation token is required.")
        .regex(
            /^[a-f0-9]{64}$/,
            "Invalid invitation token format.",
        ),
});

export type AcceptInvitationInput = z.infer<
    typeof acceptInvitationSchema
>;
