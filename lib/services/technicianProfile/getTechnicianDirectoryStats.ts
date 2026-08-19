import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import type {
    TechnicianDirectoryStats,
    TechnicianEmployeeStatusSummary,
    TechnicianDepartmentStat,
    TechnicianJobTitleStat,
    TechnicianServiceAreaStat,
} from "./technicianDirectoryStats.types";

/**
 * Retrieves aggregate workforce statistics and summaries for all technicians in an authenticated workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Aggregations are strictly scoped to `employee.workspaceId === workspaceId`.
 *   - Counts only employees with an attached `TechnicianProfile`.
 *   - Zero mutation side effects.
 *   - Excludes sensitive authentication data (passwords, tokens, sessions, accounts).
 *   - Deterministically orders breakdown arrays by `name ASC`, then `id ASC`.
 */
export async function getTechnicianDirectoryStats(
    workspaceId: string,
): Promise<TechnicianDirectoryStats> {
    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Retrieve Tenant-Scoped Technician Aggregates ---
    const profiles = await prisma.technicianProfile.findMany({
        where: {
            employee: {
                workspaceId,
            },
        },
        select: {
            id: true,
            employee: {
                select: {
                    status: true,
                    department: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    jobTitle: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            },
            technicianServiceAreas: {
                select: {
                    serviceArea: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            },
        },
    });

    const total = profiles.length;

    // --- Compute Employee Status Summary ---
    const byEmployeeStatus: TechnicianEmployeeStatusSummary = {
        ACTIVE: 0,
        INACTIVE: 0,
        ON_LEAVE: 0,
        TERMINATED: 0,
    };

    const deptMap = new Map<string, TechnicianDepartmentStat>();
    let departmentUnassigned = 0;

    const titleMap = new Map<string, TechnicianJobTitleStat>();
    let jobTitleUnassigned = 0;

    const areaMap = new Map<string, TechnicianServiceAreaStat>();
    let serviceAreaUnassigned = 0;

    for (const profile of profiles) {
        // Status breakdown
        const status = profile.employee.status;
        if (status in byEmployeeStatus) {
            byEmployeeStatus[status]++;
        }

        // Department breakdown
        if (profile.employee.department) {
            const dept = profile.employee.department;
            const existing = deptMap.get(dept.id) ?? {
                id: dept.id,
                name: dept.name,
                count: 0,
            };
            existing.count++;
            deptMap.set(dept.id, existing);
        } else {
            departmentUnassigned++;
        }

        // Job Title breakdown
        if (profile.employee.jobTitle) {
            const title = profile.employee.jobTitle;
            const existing = titleMap.get(title.id) ?? {
                id: title.id,
                name: title.name,
                count: 0,
            };
            existing.count++;
            titleMap.set(title.id, existing);
        } else {
            jobTitleUnassigned++;
        }

        // Service Area breakdown (unique per technician)
        if (profile.technicianServiceAreas.length === 0) {
            serviceAreaUnassigned++;
        } else {
            const seenAreasForProfile = new Set<string>();
            for (const tsa of profile.technicianServiceAreas) {
                const sa = tsa.serviceArea;
                if (!seenAreasForProfile.has(sa.id)) {
                    seenAreasForProfile.add(sa.id);
                    const existing = areaMap.get(sa.id) ?? {
                        id: sa.id,
                        name: sa.name,
                        count: 0,
                    };
                    existing.count++;
                    areaMap.set(sa.id, existing);
                }
            }
        }
    }

    // --- Deterministic Sorting (name ASC, id ASC) ---
    const sortByNameAndId = <T extends { name: string; id: string }>(
        items: T[],
    ): T[] => {
        return items.sort((a, b) => {
            const nameCmp = a.name.localeCompare(b.name);
            if (nameCmp !== 0) return nameCmp;
            return a.id.localeCompare(b.id);
        });
    };

    const byDepartment = sortByNameAndId(Array.from(deptMap.values()));
    const byJobTitle = sortByNameAndId(Array.from(titleMap.values()));
    const byServiceArea = sortByNameAndId(Array.from(areaMap.values()));

    return {
        total,
        byEmployeeStatus,
        byDepartment,
        byJobTitle,
        byServiceArea,
        departmentUnassigned,
        jobTitleUnassigned,
        serviceAreaUnassigned,
    };
}
