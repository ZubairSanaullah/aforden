/**
 * Phase 1.17.3 — Provider Adapter Registry
 * Manages deploy-time registration and lookup of concrete IntegrationAdapter instances.
 * Enforces fail-fast capability subset validation against catalog definitions.
 */

import { SEED_INTEGRATIONS } from "../seed/integrationSeed";
import {
  AdapterNotRegisteredError,
  AdapterAlreadyRegisteredError,
  AdapterCapabilityMismatchError,
} from "../integrationErrors";
import type { IntegrationAdapter, IntegrationCapability } from "./types";
import { ResendAdapter } from "./resendAdapter";
import { BrevoAdapter } from "./brevoAdapter";

export interface RegisterAdapterOptions {
  /**
   * If true, permits replacing an already-registered adapter for the same integrationId.
   * Defaults to false.
   */
  allowOverride?: boolean;

  /**
   * If true, bypasses static catalog capability subset verification (e.g. for dynamic mock adapters in tests).
   * Defaults to false.
   */
  skipCatalogValidation?: boolean;
}

export class AdapterRegistry {
  private static readonly adapters = new Map<string, IntegrationAdapter>();

  /**
   * Registers a concrete IntegrationAdapter instance in the platform registry.
   * Validates that the adapter's declared capabilities form a valid subset of the catalog's advertised capabilities.
   *
   * @throws {AdapterAlreadyRegisteredError} If an adapter for integrationId is already registered and allowOverride is false.
   * @throws {AdapterCapabilityMismatchError} If the adapter advertises capabilities not supported by the catalog row.
   */
  public static registerAdapter(
    adapter: IntegrationAdapter,
    options: RegisterAdapterOptions = {}
  ): void {
    if (!adapter || !adapter.integrationId || adapter.integrationId.trim().length === 0) {
      throw new Error("[AdapterRegistry] Cannot register adapter without a valid integrationId.");
    }

    const { allowOverride = false, skipCatalogValidation = false } = options;

    if (this.adapters.has(adapter.integrationId) && !allowOverride) {
      throw new AdapterAlreadyRegisteredError(adapter.integrationId);
    }

    // Fail-fast capability subset validation against static platform catalog
    if (!skipCatalogValidation) {
      const catalogEntry = SEED_INTEGRATIONS.find((entry) => entry.id === adapter.integrationId);
      if (catalogEntry) {
        const declaredCapabilities = adapter.getCapabilities() || [];
        const unsupportedCapabilities = declaredCapabilities.filter(
          (cap) => !catalogEntry.capabilities.includes(cap)
        );

        if (unsupportedCapabilities.length > 0) {
          throw new AdapterCapabilityMismatchError(
            adapter.integrationId,
            unsupportedCapabilities,
            catalogEntry.capabilities
          );
        }
      }
    }

    this.adapters.set(adapter.integrationId, adapter);
  }

  /**
   * Looks up an adapter by integrationId. Returns undefined if not found.
   */
  public static getAdapter(integrationId: string): IntegrationAdapter | undefined {
    return this.adapters.get(integrationId);
  }

  /**
   * Looks up an adapter by integrationId or throws AdapterNotRegisteredError.
   *
   * @throws {AdapterNotRegisteredError} If no adapter is registered for the integrationId.
   */
  public static getAdapterOrThrow(integrationId: string): IntegrationAdapter {
    const adapter = this.adapters.get(integrationId);
    if (!adapter) {
      throw new AdapterNotRegisteredError(integrationId);
    }
    return adapter;
  }

  /**
   * Returns true if an adapter is currently registered for integrationId.
   */
  public static hasAdapter(integrationId: string): boolean {
    return this.adapters.has(integrationId);
  }

  /**
   * Returns a readonly array of all currently registered adapters.
   */
  public static getAllAdapters(): readonly IntegrationAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Unregisters an adapter by integrationId. Returns true if removed, false if not found.
   */
  public static unregisterAdapter(integrationId: string): boolean {
    return this.adapters.delete(integrationId);
  }

  /**
   * Clears all registered adapters. Intended for test cleanup and isolation.
   */
  public static clearAdapters(): void {
    this.adapters.clear();
  }

  /**
   * Cross-checks all registered adapters against a list of catalog integration definitions.
   * Asserts that every registered adapter's getCapabilities() is a valid subset of its catalog definition.
   *
   * @throws {AdapterCapabilityMismatchError} If any registered adapter advertises unsupported capabilities.
   */
  public static validateAdapterCatalogConsistency(
    catalogIntegrations: readonly { id: string; capabilities: readonly IntegrationCapability[] }[]
  ): void {
    for (const adapter of this.adapters.values()) {
      const catalogItem = catalogIntegrations.find((item) => item.id === adapter.integrationId);
      if (!catalogItem) continue;

      const declaredCapabilities = adapter.getCapabilities() || [];
      const unsupported = declaredCapabilities.filter(
        (cap) => !catalogItem.capabilities.includes(cap)
      );

      if (unsupported.length > 0) {
        throw new AdapterCapabilityMismatchError(
          adapter.integrationId,
          unsupported,
          catalogItem.capabilities
        );
      }
    }
  }

  /**
   * Registers standard default platform adapters (Resend, Brevo).
   */
  public static registerDefaultAdapters(): void {
    this.registerAdapter(new ResendAdapter(), { allowOverride: true });
    this.registerAdapter(new BrevoAdapter(), { allowOverride: true });
  }
}

// Module-level convenience function exports
export const registerAdapter = AdapterRegistry.registerAdapter.bind(AdapterRegistry);
export const getAdapter = AdapterRegistry.getAdapter.bind(AdapterRegistry);
export const getAdapterOrThrow = AdapterRegistry.getAdapterOrThrow.bind(AdapterRegistry);
export const hasAdapter = AdapterRegistry.hasAdapter.bind(AdapterRegistry);
export const getAllAdapters = AdapterRegistry.getAllAdapters.bind(AdapterRegistry);
export const unregisterAdapter = AdapterRegistry.unregisterAdapter.bind(AdapterRegistry);
export const clearAdapters = AdapterRegistry.clearAdapters.bind(AdapterRegistry);
export const validateAdapterCatalogConsistency = AdapterRegistry.validateAdapterCatalogConsistency.bind(AdapterRegistry);
export const registerDefaultAdapters = AdapterRegistry.registerDefaultAdapters.bind(AdapterRegistry);

// Initialize default built-in platform adapters on startup
registerDefaultAdapters();
