/**
 * Phase 1.17.5 — Outbound Integration Engine: Capability Resolver
 * Implements the locked capability provider resolution algorithm from Phase 1.17.1 §2.3.
 *
 * Resolution Order:
 * 1. Entitlement Guard: verifies FEATURE_API_ACCESS entitlement.
 * 2. Explicit Provider Hint: evaluates caller-provided providerHint option.
 * 3. Workspace Default Preference: checks WorkspaceIntegrationSetting.defaultProvidersJson.
 * 4. Active Connection Query & Disambiguation:
 *    - Exclusive Singleton (allowsMultipleActiveProviders: false): exactly 1 CONNECTED provider.
 *    - Multi-Provider (allowsMultipleActiveProviders: true): single match returns connection;
 *      multiple matches without default/hint throws AmbiguousCapabilityProviderError.
 * 5. Fail-Closed Error Handling:
 *    - Connection not in CONNECTED status throws ConnectionNotReadyError.
 *    - Zero configured connections throws CapabilityProviderNotConfiguredError (no platform fallback in 1.17.5).
 */

import { prisma } from "@/lib/prisma";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  type IntegrationConnection,
} from "@/generated/prisma/client";
import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";
import { CAPABILITY_REGISTRY } from "../registry";
import {
  ConnectionNotReadyError,
  AmbiguousCapabilityProviderError,
  CapabilityProviderNotConfiguredError,
} from "../integrationErrors";
import type { ResolveCapabilityOptions, DbClient } from "./types";
import { AdapterRegistry } from "../adapters/adapterRegistry";

/**
 * Resolves the appropriate active IntegrationConnection for a given workspace and capability.
 *
 * @param workspaceId - Target tenant workspace ID.
 * @param capability - Desired IntegrationCapability.
 * @param options - Optional provider hint and database client.
 * @returns The resolved, ready IntegrationConnection.
 * @throws PlanFeatureNotEnabledError if workspace is not entitled.
 * @throws ConnectionNotReadyError if a candidate connection is not in CONNECTED status.
 * @throws AmbiguousCapabilityProviderError if multiple multi-provider connections match with no default.
 * @throws CapabilityProviderNotConfiguredError if no connection is configured.
 */
export async function resolveCapabilityConnection(
  workspaceId: string,
  capability: IntegrationCapability,
  options?: ResolveCapabilityOptions
): Promise<IntegrationConnection> {
  const db: DbClient = options?.dbClient ?? prisma;

  // =========================================================================
  // 1. Entitlement Guard (Phase 1.15 / 1.17.4 Disclosed Substitution)
  // =========================================================================
  await assertEntitlement(db, workspaceId, "FEATURE_API_ACCESS");

  const capabilityDef = CAPABILITY_REGISTRY[capability];
  if (!capabilityDef) {
    throw new CapabilityProviderNotConfiguredError(capability, workspaceId);
  }

  // =========================================================================
  // 2. Explicit Provider Hint (Highest Priority)
  // =========================================================================
  if (options?.providerHint) {
    const hintConnection = await db.integrationConnection.findFirst({
      where: {
        workspaceId,
        integrationId: options.providerHint,
      },
      include: {
        integration: true,
      },
    });

    if (!hintConnection) {
      throw new CapabilityProviderNotConfiguredError(
        `${capability} (hint: ${options.providerHint})`,
        workspaceId
      );
    }

    if (hintConnection.status !== IntegrationConnectionStatus.CONNECTED) {
      throw new ConnectionNotReadyError(
        hintConnection.id,
        hintConnection.status,
        workspaceId
      );
    }

    // Verify hint provider supports capability
    const hintAdapter = AdapterRegistry.getAdapter(hintConnection.integrationId);
    const supportsCap =
      hintConnection.integration?.capabilities?.includes(capability) ||
      (hintAdapter && hintAdapter.getCapabilities().includes(capability));

    if (!supportsCap) {
      throw new CapabilityProviderNotConfiguredError(
        `${capability} (provider '${options.providerHint}' does not support this capability)`,
        workspaceId
      );
    }

    return hintConnection;
  }

  // =========================================================================
  // 3. Workspace Default Provider Preference
  // =========================================================================
  const setting = await db.workspaceIntegrationSetting.findUnique({
    where: { workspaceId },
  });

  if (setting?.defaultProvidersJson && typeof setting.defaultProvidersJson === "object") {
    const defaultProviders = setting.defaultProvidersJson as Record<string, string>;
    const defaultIntegrationId = defaultProviders[capability];

    if (defaultIntegrationId) {
      const defaultConnection = await db.integrationConnection.findFirst({
        where: {
          workspaceId,
          integrationId: defaultIntegrationId,
        },
        include: {
          integration: true,
        },
      });

      if (defaultConnection) {
        if (defaultConnection.status !== IntegrationConnectionStatus.CONNECTED) {
          throw new ConnectionNotReadyError(
            defaultConnection.id,
            defaultConnection.status,
            workspaceId
          );
        }
        return defaultConnection;
      }
    }
  }

  // =========================================================================
  // 4. Query All Workspace Connections Supporting Capability
  // =========================================================================
  const allWorkspaceConnections = await db.integrationConnection.findMany({
    where: {
      workspaceId,
    },
    include: {
      integration: true,
    },
  });

  // Filter connections that advertise/support this capability
  const matchingConnections = allWorkspaceConnections.filter((conn) => {
    if (conn.integration?.capabilities?.includes(capability)) {
      return true;
    }
    const adapter = AdapterRegistry.getAdapter(conn.integrationId);
    if (adapter) {
      return adapter.getCapabilities().includes(capability);
    }
    return false;
  });

  const connectedMatches = matchingConnections.filter(
    (conn) => conn.status === IntegrationConnectionStatus.CONNECTED
  );

  // =========================================================================
  // 5. Exclusive Singleton vs. Multi-Provider Branch
  // =========================================================================
  if (!capabilityDef.allowsMultipleActiveProviders) {
    // Exclusive Singleton
    if (connectedMatches.length === 1) {
      return connectedMatches[0];
    }
    if (connectedMatches.length === 0) {
      if (matchingConnections.length > 0) {
        throw new ConnectionNotReadyError(
          matchingConnections[0].id,
          matchingConnections[0].status,
          workspaceId
        );
      }
      throw new CapabilityProviderNotConfiguredError(capability, workspaceId);
    }
    // More than 1 connected on exclusive capability is a data invariant violation
    throw new AmbiguousCapabilityProviderError(
      capability,
      workspaceId,
      connectedMatches.map((c) => c.id)
    );
  } else {
    // Multi-Provider Transport
    if (connectedMatches.length === 1) {
      return connectedMatches[0];
    }
    if (connectedMatches.length > 1) {
      throw new AmbiguousCapabilityProviderError(
        capability,
        workspaceId,
        connectedMatches.map((c) => c.id)
      );
    }
    if (matchingConnections.length > 0) {
      throw new ConnectionNotReadyError(
        matchingConnections[0].id,
        matchingConnections[0].status,
        workspaceId
      );
    }
    throw new CapabilityProviderNotConfiguredError(capability, workspaceId);
  }
}
