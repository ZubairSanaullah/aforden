import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createServiceCatalogSchema } from "@/lib/validations/serviceCatalog";
import {
    DuplicateServiceCatalogNameError,
    ServiceCatalogCreationError,
} from "./serviceCatalogErrors";
import type { ServiceCatalog } from "@/generated/prisma/client";

/**
 * Creates a ServiceCatalog within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_CREATE permission (OWNER, ADMIN, or MANAGER).
 *   - Inputs are validated via Zod (`createServiceCatalogSchema`).
 *   - Workspace ownership is strictly derived from the trusted `workspaceId` argument.
 *   - Status defaults to `ACTIVE` through schema definition.
 *   - Concurrency & Collision Safety: handles Prisma P2002 unique constraint violations on `[workspaceId, name]`.
 *   - Clean domain error translation without leaking raw database internals.
 */
export async function createServiceCatalog(
    workspaceId: string,
    input: unknown,
): Promise<ServiceCatalog> {
    // --- 1. Validate Input ---
    const data = createServiceCatalogSchema.parse(input);

    // --- 2. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 3. RBAC: Enforce SERVICE_CATALOG_CREATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_CREATE,
    );

    // --- 4. Persist Record ---
    try {
        const catalog = await prisma.serviceCatalog.create({
            data: {
                workspaceId,
                name: data.name,
                description: data.description ?? null,
                sortOrder: data.sortOrder ?? 0,
                status: "ACTIVE",
            },
        });

        return catalog;
    } catch (error: any) {
        // Handle Prisma unique constraint violation (P2002)
        const isUniqueConstraintViolation =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUniqueConstraintViolation) {
            throw new DuplicateServiceCatalogNameError();
        }

        // Clean domain error translation
        throw new ServiceCatalogCreationError(
            error instanceof Error
                ? error.message
                : "Failed to create service catalog record.",
        );
    }
}
