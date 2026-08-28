import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createTechnicianProfileSchema } from "@/lib/validations/technicianProfile";
import {
    TechnicianProfileAlreadyExistsError,
    InvalidEmployeeError,
} from "./technicianProfileErrors";
import type { TechnicianProfile } from "@/generated/prisma/client";
import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";

/**
 * Creates a TechnicianProfile for an Employee in a specific workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createTechnicianProfileSchema`).
 *   - Target Employee must exist and belong to `workspaceId`.
 *   - Enforces 1:0..1 employee ↔ technician profile cardinality (rejects duplicate profile).
 *   - Profile is strictly attached to `employeeId`.
 */
export async function createTechnicianProfile(
    workspaceId: string,
    employeeId: string,
    input: unknown,
): Promise<TechnicianProfile> {
    // --- Validate Input ---
    const data = createTechnicianProfileSchema.parse(input);

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify Target Employee Exists in Workspace ---
    const employee = await prisma.employee.findFirst({
        where: {
            id: employeeId,
            workspaceId,
        },
        include: {
            technicianProfile: true,
        },
    });

    if (!employee) {
        throw new InvalidEmployeeError();
    }

    if (employee.technicianProfile) {
        throw new TechnicianProfileAlreadyExistsError();
    }

    // --- Create TechnicianProfile (within transaction for atomic quota enforcement) ---
    const runTx =
        typeof prisma.$transaction === "function"
            ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
            : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const profile = await runTx(async (tx) => {
        // Phase 1.15.5: Assert MAX_TECHNICIANS quota inside the transaction so the
        // count and profile creation are atomic, preventing TOCTOU races.
        await assertEntitlement(tx, workspaceId, "MAX_TECHNICIANS");

        return tx.technicianProfile.create({
            data: {
                employeeId,
                licenseNumber: data.licenseNumber ?? null,
                yearsExperience: data.yearsExperience ?? null,
                emergencyContact: data.emergencyContact ?? null,
                notes: data.notes ?? null,
            },
        });
    });

    return profile;
}
