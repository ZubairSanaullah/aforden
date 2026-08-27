import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { roleHasPermission } from "@/lib/services/authorization/permissionService";
import { ReportScopeViolationError } from "./reportingErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Unexported unique symbol brand.
 * Makes EffectiveTechnicianScope nominal and completely unforgeable outside this module.
 */
const effectiveScopeBrand: unique symbol = Symbol("EffectiveTechnicianScope");

/**
 * Branded nominal type for an effective technician scope.
 * Guarantees that query builders cannot bypass scope resolution or fabricate unscoped queries.
 */
export type EffectiveTechnicianScope = {
  readonly [effectiveScopeBrand]: true;
  readonly workspaceId: string;
  readonly isAll: boolean;
  readonly technicianIds: readonly string[];
  
  /** Query helper: generates WorkOrder where clause */
  toWorkOrderWhere(): Prisma.WorkOrderWhereInput;
  /** Query helper: generates ScheduleAppointment where clause */
  toScheduleWhere(): Prisma.ScheduleAppointmentWhereInput;
  /** Query helper: generates TechnicianTimeEntry where clause */
  toTimeEntryWhere(): Prisma.TechnicianTimeEntryWhereInput;
  /** Query helper: generates TechnicianProfile where clause */
  toTechnicianProfileWhere(): Prisma.TechnicianProfileWhereInput;
  /** Query helper: generates WorkOrderHistory where clause scoped to reassigned-away (oldValue) */
  toWorkOrderHistoryOldValueWhere(): Prisma.WorkOrderHistoryWhereInput;
};

/**
 * Internal factory to create a branded EffectiveTechnicianScope.
 * Not exported outside this file.
 */
function createEffectiveScope(
  workspaceId: string,
  isAll: boolean,
  technicianIds: readonly string[],
): EffectiveTechnicianScope {
  return {
    [effectiveScopeBrand]: true,
    workspaceId,
    isAll,
    technicianIds: Object.freeze([...technicianIds]),
    toWorkOrderWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { assignedTechnicianId: { in: [...technicianIds] } }),
      };
    },
    toScheduleWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { technicianId: { in: [...technicianIds] } }),
      };
    },
    toTimeEntryWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { technicianProfileId: { in: [...technicianIds] } }),
      };
    },
    toTechnicianProfileWhere() {
      return {
        employee: { workspaceId },
        ...(isAll ? {} : { id: { in: [...technicianIds] } }),
      };
    },
    toWorkOrderHistoryOldValueWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { oldValue: { in: [...technicianIds] } }),
      };
    },
  };
}

/**
 * For roles in ReportDefinition.selfScopedRoles, resolves the viewer's own TechnicianProfile
 * and returns the technicianProfile.id that MUST be injected into the query.
 * Chain: WorkspaceMember -> Employee -> TechnicianProfile.
 */
export async function resolveSelfTechnicianScope(
  workspaceId: string,
  auth: WorkspaceAuthorizationContext,
  dbClient = prisma,
): Promise<string> {
  const employee = await dbClient.employee.findFirst({
    where: { workspaceId, workspaceMemberId: auth.membership.id },
    select: { technicianProfile: { select: { id: true } } },
  });

  if (!employee?.technicianProfile) {
    throw new ReportScopeViolationError(
      "Viewer has no technician profile in this workspace and cannot view technician reports.",
    );
  }

  return employee.technicianProfile.id;
}

import type { QueryArgs, ScopedReportDb } from "./reporting.types";

export interface TechnicianScopeDbHandle {
  readonly technicianProfile: {
    findMany(args?: QueryArgs): Promise<Array<{ id: string }>>;
  };
  readonly employee: {
    findFirst(args?: QueryArgs): Promise<{ id?: string; technicianProfile?: { id: string } | null } | null>;
  };
}

/**
 * Resolves the effective technician scope for a requesting principal and requested filter.
 *
 * Rules:
 * 1. Deny by default: principal must possess REPORTS_VIEW_TECHNICIAN.
 * 2. Read-all, no filter: scope is all technicians in the caller's workspace (isAll: true).
 * 3. Read-all, filter requested: scope is validated IDs strictly belonging to caller's workspace.
 * 4. Read-self, no filter: silently narrows to caller's own technician profile ID.
 * 5. Read-self, filter requesting own ID: allowed, narrows to caller's own technician profile ID.
 * 6. Read-self, filter requesting other IDs (or own + others): throws ReportScopeViolationError (403).
 * 7. Read-self, caller has no technician profile: throws ReportScopeViolationError (403).
 */
export async function resolveEffectiveTechnicianScope(
  workspaceId: string,
  auth: WorkspaceAuthorizationContext,
  requestedFilter?: string | readonly string[] | null,
  db: TechnicianScopeDbHandle | ScopedReportDb = prisma as unknown as TechnicianScopeDbHandle,
): Promise<EffectiveTechnicianScope> {
  const role = auth.membership.role;
  const hasTechnicianPermission = roleHasPermission(role, PERMISSIONS.REPORTS_VIEW_TECHNICIAN);

  // Deny by default
  if (!hasTechnicianPermission) {
    throw new ReportScopeViolationError(
      `Role "${role}" does not have permission to view technician reports.`,
    );
  }

  const isSelfScoped = role === "TECHNICIAN";
  const canReadAll = !isSelfScoped;

  // Parse requested filter into unique array of IDs
  const requestedIds: string[] = requestedFilter
    ? Array.isArray(requestedFilter)
      ? Array.from(new Set(requestedFilter.map(String)))
      : [String(requestedFilter)]
    : [];

  // --- READ-ALL PRINCIPAL (Admin, Manager, Dispatcher, Owner) ---
  if (canReadAll) {
    if (requestedIds.length === 0) {
      return createEffectiveScope(workspaceId, true, []);
    }

    // Verify all requested technician IDs belong to the caller's workspace
    const foundProfiles = await db.technicianProfile.findMany<{ id: string }>({
      where: {
        id: { in: requestedIds },
        employee: { workspaceId },
      },
      select: { id: true },
    });

    const foundIdSet = new Set(foundProfiles.map((p: { id: string }) => p.id));
    for (const reqId of requestedIds) {
      if (!foundIdSet.has(reqId)) {
        throw new ReportScopeViolationError(
          `Technician profile ID "${reqId}" does not exist in workspace "${workspaceId}".`,
        );
      }
    }

    return createEffectiveScope(workspaceId, false, requestedIds);
  }

  // --- READ-SELF-ONLY PRINCIPAL (Technician) ---
  const employee = await db.employee.findFirst<{
    id?: string;
    technicianProfile?: { id: string } | null;
  }>({
    where: {
      workspaceId,
      workspaceMemberId: auth.membership.id,
    },
    select: {
      technicianProfile: {
        select: { id: true },
      },
    },
  });

  const selfTechnicianId = employee?.technicianProfile?.id;
  if (!selfTechnicianId) {
    throw new ReportScopeViolationError(
      "Viewer has no technician profile in this workspace and cannot view self-scorecard.",
    );
  }

  // If no filter requested, silently narrow to self
  if (requestedIds.length === 0) {
    return createEffectiveScope(workspaceId, false, [selfTechnicianId]);
  }

  // If filter requested: strictly ensure ALL requested IDs match self
  const hasUnauthorizedId = requestedIds.some((id) => id !== selfTechnicianId);
  if (hasUnauthorizedId) {
    throw new ReportScopeViolationError(
      "Technicians are only authorized to access their own productivity metrics.",
    );
  }

  return createEffectiveScope(workspaceId, false, [selfTechnicianId]);
}
