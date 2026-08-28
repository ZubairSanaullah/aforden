/**
 * Phase 1.16.3 — Trigger Matcher & Entitlement Verification Service
 *
 * Scopes all rule queries strictly by workspaceId (Invariant 1) and verifies
 * workspace entitlement status directly via the Phase 1.15 entitlement resolution protocol.
 */

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { AutomationTriggerType } from "@/generated/prisma/enums";
import { resolveEntitlement } from "@/lib/services/billing/entitlementResolver";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface MatchedRulesResult {
  allMatchingRules: any[];
  enabledRules: any[];
  disabledRules: any[];
}

/**
 * Checks workspace entitlement for automated workflows (`FEATURE_AUTOMATIONS`)
 * by delegating directly to the Phase 1.15 entitlement resolver.
 */
export async function checkAutomationEntitlement(
  prisma: DbClient,
  workspaceId: string
): Promise<boolean> {
  const resolved = await resolveEntitlement(prisma, workspaceId, "FEATURE_AUTOMATIONS");
  return resolved.value === true || resolved.isUnlimited;
}

/**
 * Queries active and matching automation rules for a given event in a specific workspace.
 * Guaranteed strict tenant isolation by scoping exclusively on workspaceId.
 */
export async function findMatchingRules(
  prisma: DbClient,
  workspaceId: string,
  eventType: string,
  canonicalTriggerType: AutomationTriggerType | null
): Promise<MatchedRulesResult> {
  const triggerFilters: Prisma.AutomationTriggerWhereInput[] = [
    { eventType: eventType },
    { eventType: eventType.toLowerCase() },
    { eventType: eventType.toUpperCase() },
  ];

  if (canonicalTriggerType) {
    triggerFilters.push({ triggerType: canonicalTriggerType });
  }

  const allMatchingRules = await (prisma as PrismaClient).automationRule.findMany({
    where: {
      workspaceId, // INVARIANT 1: Strict Workspace Tenant Isolation
      trigger: {
        is: {
          OR: triggerFilters,
        },
      },
    },
    include: {
      trigger: true,
      conditionGroup: {
        include: {
          conditions: true,
          childGroups: true,
        },
      },
      actions: {
        orderBy: { stepOrder: "asc" },
      },
    },
  });

  const enabledRules = allMatchingRules.filter((rule) => rule.isEnabled === true);
  const disabledRules = allMatchingRules.filter((rule) => rule.isEnabled === false);

  return {
    allMatchingRules,
    enabledRules,
    disabledRules,
  };
}
