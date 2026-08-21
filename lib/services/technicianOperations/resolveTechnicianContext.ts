import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { TechnicianProfileNotFoundError } from "./technicianOperationsErrors";
import type { TechnicianExecutionContext } from "./technicianOperations.types";

/**
 * Resolves the authenticated caller to their canonical TechnicianExecutionContext.
 *
 * Deterministic Resolution Pipeline (Phase 1.9.1 Section 3.1 & Invariant 2 Section 2.2):
 * 1. Authenticate Session via auth() & Validate Workspace Authorization
 *    (User must be ACTIVE, Workspace must exist, WorkspaceMember must be ACTIVE).
 * 2. Lookup Employee by workspaceMemberId (and workspaceId) where status === ACTIVE.
 * 3. Lookup TechnicianProfile linked to Employee.
 * 4. Construct and return strictly server-derived TechnicianExecutionContext.
 *
 * Throws:
 * - UnauthorizedError (401) if session is invalid/missing.
 * - WorkspaceNotFoundError (404) if workspace does not exist.
 * - WorkspaceAccessDeniedError (403) if user is inactive, membership missing, or membership inactive.
 * - TechnicianProfileNotFoundError (404) if employee missing, inactive, or lacking a TechnicianProfile.
 */
export async function resolveTechnicianContext(
    workspaceId: string
): Promise<TechnicianExecutionContext> {
    // Step 1: Validate session, active user, active workspace, and active membership
    const { user, membership } = await requireWorkspaceAuthorization(workspaceId);

    // Step 2 & 3: Look up active Employee and associated TechnicianProfile within tenant
    const employee = await prisma.employee.findFirst({
        where: {
            workspaceMemberId: membership.id,
            workspaceId,
        },
        include: {
            technicianProfile: true,
        },
    });

    if (!employee || employee.status !== "ACTIVE" || !employee.technicianProfile) {
        throw new TechnicianProfileNotFoundError();
    }

    // Step 4: Derive canonical technician display name
    const technicianName =
        employee.displayName?.trim() ||
        user.name?.trim() ||
        "Technician";

    return {
        userId: user.id,
        workspaceId,
        membershipId: membership.id,
        role: membership.role,
        employeeId: employee.id,
        technicianProfileId: employee.technicianProfile.id,
        technicianName,
    };
}
