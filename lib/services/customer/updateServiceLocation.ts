import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateServiceLocationSchema } from "@/lib/validations/serviceLocation";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    InactiveCustomerError,
    ServiceLocationPrimaryExistsError,
    ServiceLocationUpdateError,
} from "./customerErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma, type ServiceLocation } from "@/generated/prisma/client";

/**
 * Updates an existing ServiceLocation for a Customer in a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the CUSTOMERS_UPDATE permission (OWNER, ADMIN, MANAGER, DISPATCHER).
 *   - Target customer must belong to the authorized workspace and have status ACTIVE.
 *   - Location lookup is strictly scoped to `customerId`.
 *   - Supports partial updates and explicit clearing of nullable fields (`null`).
 *   - Enforces the primary-location single-holder rule without silent demotions.
 *   - Concurrency safe against simultaneous primary promotions (intercepts P2002).
 *   - Disallows modification of system-managed fields (`id`, `customerId`, `workspaceId`, `createdAt`).
 *   - Returns the updated ServiceLocation record.
 */
export async function updateServiceLocation(
    workspaceId: string,
    customerId: string,
    locationId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<ServiceLocation> {
    // --- 1. Validate Input Payload ---
    const validated = updateServiceLocationSchema.parse(input);

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
            "Cannot update service locations for an inactive customer.",
        );
    }

    // --- 6. Customer-Scoped ServiceLocation Lookup ---
    const existingLocation = await prisma.serviceLocation.findFirst({
        where: {
            id: locationId,
            customerId,
        },
    });

    if (!existingLocation) {
        throw new ServiceLocationNotFoundError();
    }

    // --- 7. Primary Location Promotion Pre-Check ---
    if (validated.isPrimary === true && !existingLocation.isPrimary) {
        const existingPrimary = await prisma.serviceLocation.findFirst({
            where: {
                customerId,
                isPrimary: true,
                NOT: {
                    id: locationId,
                },
            },
        });

        if (existingPrimary) {
            throw new ServiceLocationPrimaryExistsError();
        }
    }

    // --- 8. Build Explicit Update Payload ---
    const data: Prisma.ServiceLocationUpdateInput = {};

    if (validated.name !== undefined) data.name = validated.name;
    if (validated.addressLine1 !== undefined) data.addressLine1 = validated.addressLine1;
    if (validated.addressLine2 !== undefined) data.addressLine2 = validated.addressLine2;
    if (validated.city !== undefined) data.city = validated.city;
    if (validated.state !== undefined) data.state = validated.state;
    if (validated.postalCode !== undefined) data.postalCode = validated.postalCode;
    if (validated.country !== undefined) data.country = validated.country;
    if (validated.latitude !== undefined) {
        data.latitude =
            validated.latitude !== null
                ? new Prisma.Decimal(validated.latitude)
                : null;
    }
    if (validated.longitude !== undefined) {
        data.longitude =
            validated.longitude !== null
                ? new Prisma.Decimal(validated.longitude)
                : null;
    }
    if (validated.notes !== undefined) data.notes = validated.notes;
    if (validated.isPrimary !== undefined) data.isPrimary = validated.isPrimary;

    // --- 9. Execute Update with Concurrency Collision Protection ---
    try {
        const updated = await prisma.serviceLocation.update({
            where: {
                id: locationId,
            },
            data,
        });

        return updated;
    } catch (error: any) {
        // Prisma code P2002: Unique constraint violation on concurrent primary promotion
        if (error?.code === "P2002") {
            throw new ServiceLocationPrimaryExistsError();
        }

        throw new ServiceLocationUpdateError(
            error instanceof Error
                ? error.message
                : "Failed to update service location record.",
        );
    }
}
