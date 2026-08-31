/**
 * Phase 1.13.4 — Recipient Resolution Service
 * Resolves communication targets (Workspace Members, Customer Contacts, Direct Recipients)
 * to concrete delivery destinations with strict tenant-isolation scoping in queries.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { RecipientType } from "@/generated/prisma/enums";
import { ResolvedRecipientDestination } from "./notification.types";
import {
    NotificationRecipientUnresolvableError,
    NotificationCrossTenantLeakageError,
} from "./notificationErrors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[1-9]\d{4,14}$/;

/**
 * Resolves a recipient ID to a concrete delivery destination (email, phone, name, userId).
 *
 * CRITICAL TENANT ISOLATION RULE:
 * Every database query MUST scope by `workspaceId` at the query level (`where` clause),
 * not filtered in application code. Cross-tenant IDs return `NotificationRecipientUnresolvableError`
 * identically to non-existent IDs to prevent tenant enumeration and information leakage.
 */
export async function resolveRecipientDestination(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    recipientType: RecipientType,
    recipientId: string,
): Promise<ResolvedRecipientDestination> {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required for recipient resolution.",
        );
    }
    if (!recipientId) {
        throw new NotificationRecipientUnresolvableError(
            "recipientId must not be empty.",
        );
    }

    switch (recipientType) {
        case RecipientType.WORKSPACE_MEMBER: {
            // Strictly scoped by workspaceId in where clause
            const member = await prisma.workspaceMember.findFirst({
                where: {
                    id: recipientId,
                    workspaceId,
                    status: "ACTIVE",
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            status: true,
                        },
                    },
                    employee: true,
                },
            });

            if (!member || !member.user) {
                throw new NotificationRecipientUnresolvableError(
                    `Active workspace member ${recipientId} not found in workspace.`,
                );
            }

            const name =
                member.employee?.displayName ||
                member.user.name ||
                "Workspace Member";
            const email = member.user.email || undefined;
            const phone = member.employee?.phone || undefined;

            return {
                recipientId: member.id,
                recipientType: RecipientType.WORKSPACE_MEMBER,
                name,
                email,
                phone,
                userId: member.userId,
                role: member.role,
            };
        }

        case RecipientType.CUSTOMER_CONTACT: {
            // Strictly scoped by customer: { workspaceId } in where clause
            const contact = await prisma.customerContact.findFirst({
                where: {
                    id: recipientId,
                    customer: {
                        workspaceId,
                    },
                },
                include: {
                    customer: true,
                },
            });

            if (!contact || !contact.customer) {
                throw new NotificationRecipientUnresolvableError(
                    `Customer contact ${recipientId} not found in workspace.`,
                );
            }

            const name =
                `${contact.firstName} ${contact.lastName}`.trim() ||
                contact.customer.name;
            const email = contact.email || undefined;
            const phone = contact.mobilePhone || contact.phone || undefined;

            return {
                recipientId: contact.id,
                recipientType: RecipientType.CUSTOMER_CONTACT,
                name,
                email,
                phone,
                customerId: contact.customerId,
            };
        }

        case RecipientType.DIRECT_RECIPIENT: {
            const trimmed = recipientId.trim();
            const isEmail = EMAIL_REGEX.test(trimmed);
            const isPhone = PHONE_REGEX.test(trimmed.replace(/[\s()-]/g, ""));

            if (!isEmail && !isPhone) {
                throw new NotificationRecipientUnresolvableError(
                    `Invalid direct recipient destination: "${trimmed}". Must be a valid email or phone number.`,
                );
            }

            return {
                recipientId: trimmed,
                recipientType: RecipientType.DIRECT_RECIPIENT,
                name: trimmed,
                email: isEmail ? trimmed : undefined,
                phone: isPhone ? trimmed : undefined,
            };
        }

        default: {
            throw new NotificationRecipientUnresolvableError(
                `Unsupported recipient type: ${recipientType}`,
            );
        }
    }
}
