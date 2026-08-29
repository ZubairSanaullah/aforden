import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createServiceLocationSchema } from "@/lib/validations/serviceLocation";
import {
    CustomerNotFoundError,
    InactiveCustomerError,
    ServiceLocationCreationError,
    ServiceLocationPrimaryExistsError,
} from "./customerErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma, type ServiceLocation } from "@/generated/prisma/client";
import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";

/**
 * Creates a ServiceLocation for a Customer in a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   - Customer lookup is strictly tenant-scoped (`where: { id: customerId, workspaceId }`).
 *   - Target customer must have status ACTIVE (inactive customers reject location creation).
 *   - Enforces primary-location invariant (at most one primary location per customer).
 *   - Concurrency safe against simultaneous primary location creations.
 *   - Disallows injection of system-managed fields (id, customerId, workspaceId, timestamps).
 *   - Returns the created ServiceLocation record.
 */
export async function createServiceLocation(
    workspaceId: string,
    customerId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<ServiceLocation> {
    // --- 1. Validate Input Payload ---
    const validated = createServiceLocationSchema.parse(input);

    // --- 2. Authenticate & Authorize Workspace Context ---
    const authorization = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // --- 3. RBAC: Enforce CUSTOMERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.CUSTOMERS_UPDATE,
    );

    // --- 4. Tenant-Scoped Customer Lookup ---
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    // --- 5. Customer Lifecycle Check (Must be ACTIVE) ---
    if (customer.status !== "ACTIVE") {
        throw new InactiveCustomerError(
            "Cannot create service locations for an inactive customer.",
        );
    }

    // --- 6. Primary Location Pre-Check ---
    if (validated.isPrimary) {
        const existingPrimary = await prisma.serviceLocation.findFirst({
            where: {
                customerId,
                isPrimary: true,
            },
        });

        if (existingPrimary) {
            throw new ServiceLocationPrimaryExistsError();
        }
    }

    // --- 7. Execute Creation with Concurrency Collision Handling ---
    const runTx =
        typeof prisma.$transaction === "function"
            ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
            : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    try {
        const location = await runTx(async (tx) => {
            // Phase 1.15.5: Assert MAX_SERVICE_LOCATIONS quota inside the transaction so
            // the count query and insertion are atomic, preventing TOCTOU races.
            await assertEntitlement(tx, workspaceId, "MAX_SERVICE_LOCATIONS");

            return tx.serviceLocation.create({
                data: {
                    customerId,
                    name: validated.name,
                    addressLine1: validated.addressLine1,
                    addressLine2: validated.addressLine2 ?? null,
                    city: validated.city,
                    state: validated.state ?? null,
                    postalCode: validated.postalCode ?? null,
                    country: validated.country,
                    latitude:
                        validated.latitude !== undefined &&
                        validated.latitude !== null
                            ? new Prisma.Decimal(validated.latitude)
                            : null,
                    longitude:
                        validated.longitude !== undefined &&
                        validated.longitude !== null
                            ? new Prisma.Decimal(validated.longitude)
                            : null,
                    notes: validated.notes ?? null,
                    isPrimary: validated.isPrimary ?? false,
                },
            });
        });

        return location;
    } catch (error: any) {
        // Prisma code P2002: Unique constraint violation (e.g. concurrent primary location creation)
        if (error?.code === "P2002") {
            throw new ServiceLocationPrimaryExistsError();
        }

        // Re-throw domain errors from assertEntitlement (QuotaExceededError, etc.) as-is
        if (error?.code === "QUOTA_EXCEEDED" || error?.statusCode) {
            throw error;
        }

        throw new ServiceLocationCreationError(
            error instanceof Error
                ? error.message
                : "Failed to create service location record.",
        );
    }
}
