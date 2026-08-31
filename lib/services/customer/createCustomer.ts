import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createCustomerSchema } from "@/lib/validations/customer";
import {
    DuplicateCustomerNumberError,
    CustomerCreationError,
} from "./customerErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Customer } from "@/generated/prisma/client";
import {
    enqueueWebhookDelivery,
    triggerWebhookDeliveries,
    PUBLIC_WEBHOOK_EVENTS,
} from "@/lib/publicApi/webhooks";

const CUSTOMER_NUMBER_PREFIX = "CUST-";
const MAX_AUTO_GENERATE_ATTEMPTS = 5;

/**
 * Resolves the next sequential customer number within a specific workspace.
 * Queries the highest existing customer number starting with "CUST-" in that workspace.
 */
async function getNextCustomerNumber(db: any, workspaceId: string): Promise<string> {
    const latest = await db.customer.findFirst({
        where: {
            workspaceId,
            customerNumber: {
                startsWith: CUSTOMER_NUMBER_PREFIX,
            },
        },
        orderBy: {
            customerNumber: "desc",
        },
        select: {
            customerNumber: true,
        },
    });

    let nextSeq = 1;
    if (latest?.customerNumber) {
        const match = latest.customerNumber.match(/^CUST-(\d+)$/);
        if (match && match[1]) {
            const currentSeq = parseInt(match[1], 10);
            if (!isNaN(currentSeq)) {
                nextSeq = currentSeq + 1;
            }
        }
    }

    return `${CUSTOMER_NUMBER_PREFIX}${String(nextSeq).padStart(5, "0")}`;
}

/**
 * Creates a Customer within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_CREATE permission (OWNER, ADMIN, MANAGER, or DISPATCHER).
 *   - Inputs are validated via Zod (`createCustomerSchema`).
 *   - Workspace ownership is strictly derived from the authorized context (`workspaceId`).
 *   - Customer number is always assigned to every persisted customer:
 *       - If provided explicitly: validated and verified unique within workspace.
 *       - If omitted: auto-generated sequentially (`CUST-00001`, `CUST-00002`, ...).
 *   - Concurrency & Collision Safety: handles concurrent unique constraint collisions gracefully with automatic retry.
 *   - Clean domain error translation without leaking raw database internals.
 */
export async function createCustomer(
    workspaceId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
    txClient?: any,
): Promise<Customer> {
    // --- Validate Input ---
    const data = createCustomerSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- RBAC: Enforce CUSTOMERS_CREATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_CREATE,
    );

    const isExplicitCustomerNumber = Boolean(data.customerNumber);
    const initialDb = txClient ?? prisma;

    // --- Explicit Customer Number Pre-check ---
    if (isExplicitCustomerNumber && data.customerNumber) {
        const existing = await initialDb.customer.findUnique({
            where: {
                workspaceId_customerNumber: {
                    workspaceId,
                    customerNumber: data.customerNumber,
                },
            },
        });

        if (existing) {
            throw new DuplicateCustomerNumberError();
        }
    }

    // --- Persistence with Concurrency-Safe Generation ---
    for (let attempt = 0; attempt < MAX_AUTO_GENERATE_ATTEMPTS; attempt++) {
        try {
            const runTx = txClient
                ? async (cb: (tx: any) => Promise<any>) => cb(txClient)
                : (typeof prisma.$transaction === "function"
                    ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
                    : async (cb: (tx: any) => Promise<any>) => cb(prisma));

            const { customer, webhookDeliveryIds } = await runTx(async (tx) => {
                const resolvedCustomerNumber = isExplicitCustomerNumber
                    ? (data.customerNumber as string)
                    : await getNextCustomerNumber(tx, workspaceId);

                const created = await tx.customer.create({
                    data: {
                        workspaceId,
                        customerNumber: resolvedCustomerNumber,
                        name: data.name,
                        email: data.email ?? null,
                        phone: data.phone ?? null,
                        website: data.website ?? null,
                        addressLine1: data.addressLine1 ?? null,
                        addressLine2: data.addressLine2 ?? null,
                        city: data.city ?? null,
                        state: data.state ?? null,
                        postalCode: data.postalCode ?? null,
                        country: data.country ?? null,
                        status: data.status,
                        notes: data.notes ?? null,
                    },
                });

                // Enqueue Webhook Delivery in the same transaction
                const deliveryIds = await enqueueWebhookDelivery(
                    tx,
                    workspaceId,
                    PUBLIC_WEBHOOK_EVENTS.CUSTOMER_CREATED,
                    created,
                );

                return {
                    customer: created,
                    webhookDeliveryIds: deliveryIds,
                };
            });

            // Trigger background delivery strictly POST-COMMIT
            triggerWebhookDeliveries(webhookDeliveryIds);

            return customer;
        } catch (error: any) {
            // Check for Prisma unique constraint violation (P2002)
            const isUniqueConstraintViolation =
                error?.code === "P2002" ||
                (typeof error?.message === "string" &&
                    error.message.includes("Unique constraint failed"));

            if (isUniqueConstraintViolation) {
                if (isExplicitCustomerNumber) {
                    throw new DuplicateCustomerNumberError();
                }
                // If auto-generated number collided with concurrent insert, retry to calculate next number
                continue;
            }

            // Other unexpected database errors
            throw new CustomerCreationError(
                error instanceof Error ? error.message : "Failed to create customer record.",
            );
        }
    }

    throw new CustomerCreationError(
        "Could not generate a unique customer number after multiple attempts.",
    );
}
