import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createTechnicianSkillSchema } from "@/lib/validations/technicianSkill";
import {
    TechnicianSkillAlreadyExistsError,
    InvalidTechnicianProfileError,
    InvalidSkillAssignmentError,
} from "./technicianSkillErrors";
import { InactiveSkillAssignmentError } from "@/lib/services/skill/skillErrors";
import type { TechnicianSkill, Skill } from "@/generated/prisma/client";

export type TechnicianSkillWithSkill = TechnicianSkill & {
    skill: Skill;
};

/**
 * Assigns a Skill to a TechnicianProfile within a workspace.
 *
 * Security & Integrity guarantees:
 *   - Caller must be an authenticated, active member of the workspace.
 *   - Caller must hold the MEMBERS_UPDATE permission (OWNER or ADMIN).
 *   - Inputs are validated via Zod (`createTechnicianSkillSchema`).
 *   - TechnicianProfile must exist and belong to the workspace (`employee.workspaceId === workspaceId`).
 *   - Skill must exist and belong to the same workspace (`skill.workspaceId === workspaceId`).
 *   - Skill must be ACTIVE; assignments to INACTIVE skills are rejected (`InactiveSkillAssignmentError`).
 *   - Enforces unique assignment per (technicianProfileId, skillId).
 */
export async function assignSkillToTechnician(
    workspaceId: string,
    technicianProfileId: string,
    skillId: string,
    input?: unknown,
): Promise<TechnicianSkillWithSkill> {
    // --- Validate Input ---
    const data = createTechnicianSkillSchema.parse(input ?? {});

    // --- Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- RBAC: Enforce MEMBERS_UPDATE permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_UPDATE,
    );

    // --- Verify TechnicianProfile Exists in Workspace ---
    const profile = await prisma.technicianProfile.findFirst({
        where: {
            id: technicianProfileId,
            employee: {
                workspaceId,
            },
        },
    });

    if (!profile) {
        throw new InvalidTechnicianProfileError();
    }

    // --- Verify Skill Exists in Workspace and is Active ---
    const skill = await prisma.skill.findFirst({
        where: {
            id: skillId,
            workspaceId,
        },
    });

    if (!skill) {
        throw new InvalidSkillAssignmentError();
    }

    if (skill.status === "INACTIVE") {
        throw new InactiveSkillAssignmentError(
            "Cannot assign an inactive skill to a technician.",
        );
    }

    // --- Verify No Duplicate Assignment ---
    const existing = await prisma.technicianSkill.findUnique({
        where: {
            technicianProfileId_skillId: {
                technicianProfileId,
                skillId,
            },
        },
    });

    if (existing) {
        throw new TechnicianSkillAlreadyExistsError();
    }

    // --- Create TechnicianSkill Assignment ---
    const technicianSkill = await prisma.technicianSkill.create({
        data: {
            technicianProfileId,
            skillId,
            proficiency: data.proficiency,
            yearsExperience: data.yearsExperience ?? null,
            notes: data.notes ?? null,
        },
        include: {
            skill: true,
        },
    });

    return technicianSkill;
}
