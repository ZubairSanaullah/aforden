import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    getTechniciansQuerySchema,
    type GetTechniciansQueryInput,
} from "@/lib/validations/technicianDirectory";
import type {
    TechnicianDirectoryItem,
    TechnicianDirectoryResult,
} from "./technicianDirectory.types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a paginated directory list of technicians for an authenticated workspace.
 *
 * Security & Tenant Isolation guarantees:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the MEMBERS_VIEW permission (OWNER, ADMIN, or MANAGER).
 *   - Queries are strictly scoped to `employee.workspaceId === workspaceId`.
 *   - Only returns employees with an attached `TechnicianProfile`.
 *   - Zero mutation side effects.
 *   - Excludes sensitive authentication data (passwords, tokens, sessions, accounts).
 *   - Deterministically orders items by `employee.displayName ASC`, then `employee.id ASC`.
 */
export async function getTechnicians(
    workspaceId: string,
    options?: GetTechniciansQueryInput,
): Promise<TechnicianDirectoryResult> {
    // --- Validate Query Options ---
    const query = getTechniciansQuerySchema.parse(options ?? {});

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    // --- Construct Tenant-Scoped Query Filter ---
    const employeeWhere: Prisma.EmployeeWhereInput = {
        workspaceId,
        ...(query.employeeStatus ? { status: query.employeeStatus } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.jobTitleId ? { jobTitleId: query.jobTitleId } : {}),
    };

    if (query.search && query.search.length > 0) {
        employeeWhere.OR = [
            {
                displayName: {
                    contains: query.search,
                    mode: "insensitive",
                },
            },
            {
                employeeNumber: {
                    contains: query.search,
                    mode: "insensitive",
                },
            },
            {
                phone: {
                    contains: query.search,
                    mode: "insensitive",
                },
            },
        ];
    }

    const where: Prisma.TechnicianProfileWhereInput = {
        employee: employeeWhere,
        ...(query.serviceAreaId
            ? {
                  technicianServiceAreas: {
                      some: {
                          serviceAreaId: query.serviceAreaId,
                      },
                  },
              }
            : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    // --- Execute Parallel Count and Paginated Query ---
    const [total, profiles] = await Promise.all([
        prisma.technicianProfile.count({ where }),
        prisma.technicianProfile.findMany({
            where,
            skip,
            take,
            orderBy: [
                {
                    employee: {
                        displayName: "asc",
                    },
                },
                {
                    employee: {
                        id: "asc",
                    },
                },
            ],
            select: {
                id: true,
                licenseNumber: true,
                yearsExperience: true,
                employee: {
                    select: {
                        id: true,
                        employeeNumber: true,
                        displayName: true,
                        phone: true,
                        hireDate: true,
                        status: true,
                        department: {
                            select: {
                                id: true,
                                name: true,
                                status: true,
                            },
                        },
                        jobTitle: {
                            select: {
                                id: true,
                                name: true,
                                status: true,
                            },
                        },
                    },
                },
                technicianSkills: {
                    select: {
                        id: true,
                        proficiency: true,
                        skill: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                    orderBy: {
                        skill: {
                            name: "asc",
                        },
                    },
                },
                technicianServiceAreas: {
                    select: {
                        id: true,
                        serviceArea: {
                            select: {
                                id: true,
                                name: true,
                                status: true,
                            },
                        },
                    },
                    orderBy: {
                        serviceArea: {
                            name: "asc",
                        },
                    },
                },
                technicianAvailabilities: {
                    select: {
                        dayOfWeek: true,
                        status: true,
                    },
                },
            },
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);

    // --- Map Database Records into Directory Items ---
    const items: TechnicianDirectoryItem[] = profiles.map((p) => {
        const activeDaysSet = new Set(
            p.technicianAvailabilities
                .filter((a) => a.status === "ACTIVE")
                .map((a) => a.dayOfWeek),
        );

        return {
            id: p.id,
            employeeId: p.employee.id,
            employee: {
                id: p.employee.id,
                employeeNumber: p.employee.employeeNumber,
                displayName: p.employee.displayName,
                phone: p.employee.phone,
                hireDate: p.employee.hireDate,
                status: p.employee.status,
            },
            department: p.employee.department ?? null,
            jobTitle: p.employee.jobTitle ?? null,
            technicianProfile: {
                id: p.id,
                licenseNumber: p.licenseNumber,
                yearsExperience: p.yearsExperience,
            },
            skills: p.technicianSkills.map((ts) => ({
                id: ts.skill.id,
                name: ts.skill.name,
                proficiency: ts.proficiency,
            })),
            serviceAreas: p.technicianServiceAreas.map((sa) => ({
                id: sa.serviceArea.id,
                name: sa.serviceArea.name,
                status: sa.serviceArea.status,
            })),
            availabilitySummary: {
                activeDays: activeDaysSet.size,
            },
        };
    });

    return {
        items,
        pagination: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages,
            hasNextPage: query.page < totalPages,
            hasPreviousPage: query.page > 1 && totalPages > 0,
        },
    };
}
