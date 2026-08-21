import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createAssetCategorySchema } from "./assetCategory.schemas";
import { AssetCategoryAlreadyExistsError } from "./assetCategoryErrors";
import { toAssetCategoryViewModel } from "./getAssetCategories";
import type {
    AssetCategoryViewModel,
    CreateAssetCategoryInput,
} from "./assetCategory.types";

/**
 * Creates a new AssetCategory in an authorized workspace.
 *
 * Security & Validation Invariants (Phase 1.7.1 §6.3, §13.2):
 *   1. Authenticate & Authorize Workspace Context (`requireWorkspaceAuthorization`).
 *   2. RBAC check: Caller must hold `PERMISSIONS.ASSET_CATEGORIES_MANAGE` (OWNER, ADMIN, MANAGER).
 *   3. Parse and validate input payload using `createAssetCategorySchema`.
 *   4. Uniqueness assertion:
 *      - `name` must be unique within the workspace (case-insensitive check).
 *      - `code` (if provided) must be unique within the workspace (case-insensitive check).
 *   5. Persistence: Insert into `AssetCategory` table with `workspaceId`.
 *   6. Returns canonical `AssetCategoryViewModel`.
 */
export async function createAssetCategory(
    workspaceId: string,
    rawInput: unknown,
): Promise<AssetCategoryViewModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce ASSET_CATEGORIES_MANAGE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.ASSET_CATEGORIES_MANAGE,
    );

    // --- 3. Input Validation ---
    const data = createAssetCategorySchema.parse(rawInput);

    // --- 4. Uniqueness Assertions ---
    // Assert unique name in workspace
    const existingName = await prisma.assetCategory.findFirst({
        where: {
            workspaceId,
            name: {
                equals: data.name,
                mode: "insensitive",
            },
        },
    });

    if (existingName) {
        throw new AssetCategoryAlreadyExistsError(
            `An asset category with the name '${data.name}' already exists in this workspace.`,
        );
    }

    // Assert unique code in workspace (if code is provided)
    if (data.code) {
        const existingCode = await prisma.assetCategory.findFirst({
            where: {
                workspaceId,
                code: {
                    equals: data.code,
                    mode: "insensitive",
                },
            },
        });

        if (existingCode) {
            throw new AssetCategoryAlreadyExistsError(
                `An asset category with the code '${data.code}' already exists in this workspace.`,
            );
        }
    }

    // --- 5. Persistence ---
    try {
        const created = await prisma.assetCategory.create({
            data: {
                workspaceId,
                name: data.name,
                code: data.code ?? null,
                description: data.description ?? null,
                status: data.status,
                sortOrder: data.sortOrder,
            },
            include: {
                _count: {
                    select: {
                        assets: true,
                    },
                },
            },
        });

        return toAssetCategoryViewModel(created);
    } catch (error: any) {
        if (error?.code === "P2002") {
            throw new AssetCategoryAlreadyExistsError();
        }
        throw error;
    }
}
