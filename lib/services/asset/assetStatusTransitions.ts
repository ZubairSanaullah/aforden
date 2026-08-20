import { type AssetStatus, type MembershipRole } from "@/generated/prisma/client";

export interface StatusTransitionRule {
    from: AssetStatus;
    to: AssetStatus;
    allowedRoles: MembershipRole[];
    requiresReason: boolean;
    description: string;
}

/**
 * Complete state transition matrix defined in Phase 1.7.1 Section 2.2.
 */
export const ASSET_STATUS_TRANSITION_RULES: StatusTransitionRule[] = [
    // From IN_STORAGE
    {
        from: "IN_STORAGE",
        to: "OPERATIONAL",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"],
        requiresReason: false,
        description: "Deployed to active site and assigned to customer/location",
    },
    {
        from: "IN_STORAGE",
        to: "DECOMMISSIONED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Placed on administrative inactive hold from storage",
    },
    {
        from: "IN_STORAGE",
        to: "RETIRED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Scrapped or disposed directly from depot storage",
    },

    // From OPERATIONAL
    {
        from: "OPERATIONAL",
        to: "DEGRADED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER", "TECHNICIAN"],
        requiresReason: true,
        description: "Operating with reduced performance or warning alerts",
    },
    {
        from: "OPERATIONAL",
        to: "OUT_OF_SERVICE",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER", "TECHNICIAN"],
        requiresReason: true,
        description: "Total breakdown or emergency safety shutdown",
    },
    {
        from: "OPERATIONAL",
        to: "IN_STORAGE",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"],
        requiresReason: true,
        description: "Uninstalled from site and returned to depot inventory",
    },
    {
        from: "OPERATIONAL",
        to: "DECOMMISSIONED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Mothballed or taken offline indefinitely at site",
    },
    {
        from: "OPERATIONAL",
        to: "RETIRED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Permanent end of life / scrapped directly from operation",
    },

    // From DEGRADED
    {
        from: "DEGRADED",
        to: "OPERATIONAL",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER", "TECHNICIAN"],
        requiresReason: false,
        description: "Corrective maintenance verified; restored to full operational state",
    },
    {
        from: "DEGRADED",
        to: "OUT_OF_SERVICE",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER", "TECHNICIAN"],
        requiresReason: true,
        description: "Performance collapsed; shut down for repair",
    },
    {
        from: "DEGRADED",
        to: "IN_STORAGE",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"],
        requiresReason: true,
        description: "Removed for bench overhaul or depot storage",
    },
    {
        from: "DEGRADED",
        to: "DECOMMISSIONED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Decommissioned in degraded state",
    },
    {
        from: "DEGRADED",
        to: "RETIRED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Repair uneconomical; retired directly from degraded state",
    },

    // From OUT_OF_SERVICE
    {
        from: "OUT_OF_SERVICE",
        to: "OPERATIONAL",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER", "TECHNICIAN"],
        requiresReason: false,
        description: "Major repair completed and verified; recommissioned",
    },
    {
        from: "OUT_OF_SERVICE",
        to: "DEGRADED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER", "TECHNICIAN"],
        requiresReason: false,
        description: "Partial temporary fix achieved; placed under monitoring",
    },
    {
        from: "OUT_OF_SERVICE",
        to: "IN_STORAGE",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER", "DISPATCHER"],
        requiresReason: true,
        description: "Removed from customer site to depot for rebuild",
    },
    {
        from: "OUT_OF_SERVICE",
        to: "DECOMMISSIONED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Mothballed in non-functioning state",
    },
    {
        from: "OUT_OF_SERVICE",
        to: "RETIRED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Catastrophic failure; condemned and scrapped",
    },

    // From DECOMMISSIONED
    {
        from: "DECOMMISSIONED",
        to: "IN_STORAGE",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "Reactivated to depot inventory",
    },
    {
        from: "DECOMMISSIONED",
        to: "OPERATIONAL",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: false,
        description: "Recommissioned directly into service at site",
    },
    {
        from: "DECOMMISSIONED",
        to: "RETIRED",
        allowedRoles: ["OWNER", "ADMIN", "MANAGER"],
        requiresReason: true,
        description: "End of storage life; permanently retired",
    },
];

/**
 * Quick lookup index for state transitions: `${from}->${to}` -> Rule.
 */
export const STATUS_TRANSITION_MAP: Map<string, StatusTransitionRule> = new Map(
    ASSET_STATUS_TRANSITION_RULES.map((rule) => [`${rule.from}->${rule.to}`, rule])
);

/**
 * Checks whether a state transition from `fromStatus` to `toStatus` is valid per the 1.7.1 matrix.
 */
export function isStatusTransitionAllowed(fromStatus: AssetStatus, toStatus: AssetStatus): boolean {
    if (fromStatus === toStatus) return true;
    if (fromStatus === "RETIRED") return false; // Irreversible terminal state
    return STATUS_TRANSITION_MAP.has(`${fromStatus}->${toStatus}`);
}

/**
 * Gets the transition rule for a `(from, to)` pair, or undefined if invalid.
 */
export function getStatusTransitionRule(fromStatus: AssetStatus, toStatus: AssetStatus): StatusTransitionRule | undefined {
    return STATUS_TRANSITION_MAP.get(`${fromStatus}->${toStatus}`);
}

/**
 * Checks whether a `statusReason` is required for a specific `(from, to)` transition pair.
 */
export function isReasonRequiredForTransition(fromStatus: AssetStatus, toStatus: AssetStatus): boolean {
    const rule = getStatusTransitionRule(fromStatus, toStatus);
    return rule ? rule.requiresReason : false;
}

/**
 * Set of target statuses that universally require a statusReason if fromStatus is unknown at validation time.
 * (DECOMMISSIONED, RETIRED, OUT_OF_SERVICE always require a reason; IN_STORAGE requires a reason from all source states).
 */
export const REASON_REQUIRED_TARGET_STATUSES: Set<AssetStatus> = new Set([
    "DEGRADED",
    "OUT_OF_SERVICE",
    "IN_STORAGE",
    "DECOMMISSIONED",
    "RETIRED",
]);
