import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createWorkTypeSchema } from "@/lib/validations/workType";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    DuplicateWorkTypeNameError,
    DuplicateWorkTypeCodeError,
    WorkTypeCreationError,
} from "./workTypeErrors";
import type { WorkTypeOperationalReadModel } from "./workType.types";

/**
 * Creates a WorkType service definition within an authorized workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_CREATE permission (OWNER, ADMIN, or MANAGER).
 *   - Inputs are validated via Zod (`createWorkTypeSchema`).
 *   - Workspace ownership is strictly derived from the trusted `workspaceId` argument.
 *   - Tenant Alignment Invariant: Verifies that the parent `ServiceCatalog` belongs to the SAME `workspaceId`.
 *   - Status defaults to `ACTIVE` through schema definition.
 *   - Handles Prisma P2002 unique constraint violations on `[catalogId, name]` and `[workspaceId, code]`.
 *   - Returns operational read model with computed `isAvailableForWorkOrder`.
 */
export async function createWorkType(
    workspaceId: string,
    input: unknown,
): Promise<WorkTypeOperationalReadModel> {
    // --- 1. Validate Input ---
    const data = createWorkTypeSchema.parse(input);

    // --- 2. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 3. RBAC: Enforce SERVICE_CATALOG_CREATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_CREATE,
    );

    // --- 4. Tenant Alignment Invariant: Verify Parent Catalog Exists in Same Workspace ---
    const catalog = await prisma.serviceCatalog.findFirst({
        where: {
            id: data.catalogId,
            workspaceId,
        },
    });

    if (!catalog) {
        throw new ServiceCatalogNotFoundError();
    }

    // --- 5. Persist Record with Concurrency Handling ---
    try {
        const workType = await prisma.workType.create({
            data: {
                workspaceId,
                catalogId: data.catalogId,
                name: data.name,
                code: data.code ?? null,
                description: data.description ?? null,
                estimatedDuration: data.estimatedDuration ?? null,
                sortOrder: data.sortOrder ?? 0,
                status: "ACTIVE",
            },
            include: {
                catalog: true,
            },
        });

        return {
            id: workType.id,
            workspaceId: workType.workspaceId,
            catalogId: workType.catalogId,
            catalogName: workType.catalog.name,
            catalogStatus: workType.catalog.status,
            name: workType.name,
            code: workType.code,
            description: workType.description,
            estimatedDuration: workType.estimatedDuration,
            status: workType.status,
            sortOrder: workType.sortOrder,
            isAvailableForWorkOrder:
                workType.status === "ACTIVE" &&
                workType.catalog.status === "ACTIVE",
            createdAt: workType.createdAt,
            updatedAt: workType.updatedAt,
        };
    } catch (error: any) {
        const isUnique =
            error?.code === "P2002" ||
            (typeof error?.message === "string" &&
                error.message.includes("Unique constraint failed"));

        if (isUnique) {
            const target =
                error?.meta?.target ||
                (typeof error?.message === "string" ? error.message : "");

            if (Array.isArray(target)) {
                if (target.includes("code")) {
                    throw new DuplicateWorkTypeCodeError();
                }
                if (target.includes("name") || target.includes("catalogId")) {
                    throw new DuplicateWorkTypeNameError();
                }
            } else if (typeof target === "string") {
                if (target.includes("code")) {
                    throw new DuplicateWorkTypeCodeError();
                }
                if (target.includes("name")) {
                    throw new DuplicateWorkTypeNameError();
                }
            }

            if (data.code) {
                const existingCode = await prisma.workType.findFirst({
                    where: { workspaceId, code: data.code },
                });
                if (existingCode) {
                    throw new DuplicateWorkTypeCodeError();
                }
            }

            throw new DuplicateWorkTypeNameError();
        }

        throw new WorkTypeCreationError(
            error instanceof Error
                ? error.message
                : "Failed to create work type record.",
        );
    }
}
