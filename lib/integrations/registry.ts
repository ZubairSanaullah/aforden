/**
 * Phase 1.17.2 — Third-Party Integrations Capability Registry
 * Ports the locked capability catalog from Phase 1.17.1 §2.2 verbatim.
 */

import { IntegrationCapability } from "@/generated/prisma/client";

export { IntegrationCapability };

export interface CapabilityDefinition {
  readonly capability: IntegrationCapability;
  readonly displayName: string;
  readonly description: string;
  readonly defaultTimeoutMs: number;
  /**
   * Defines whether a workspace is permitted to maintain multiple simultaneous
   * CONNECTED providers for this capability:
   * - `false` (Exclusive Singleton): A workspace may have at most ONE active CONNECTED
   *   provider for this capability (e.g. Accounting Ledgers, Calendar Sync, Primary File Storage).
   * - `true` (Multi-Provider Transport): A workspace may connect multiple distinct providers
   *   concurrently (e.g. Email channels, SMS gateways, multiple Webhook endpoints).
   */
  readonly allowsMultipleActiveProviders: boolean;
}

export const CAPABILITY_REGISTRY: Record<IntegrationCapability, CapabilityDefinition> = {
  [IntegrationCapability.EMAIL_SEND]: {
    capability: IntegrationCapability.EMAIL_SEND,
    displayName: "Outbound Email Dispatch",
    description: "Send transactional and operational emails via provider",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: true,
  },
  [IntegrationCapability.SMS_SEND]: {
    capability: IntegrationCapability.SMS_SEND,
    displayName: "Outbound SMS Dispatch",
    description: "Send transactional and alert SMS messages via provider",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: true,
  },
  [IntegrationCapability.CALENDAR_WRITE]: {
    capability: IntegrationCapability.CALENDAR_WRITE,
    displayName: "External Calendar Sync (Write)",
    description: "Write bookings and schedule appointments to external calendar",
    defaultTimeoutMs: 8000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.CALENDAR_READ]: {
    capability: IntegrationCapability.CALENDAR_READ,
    displayName: "External Calendar Sync (Read)",
    description: "Read external calendar busy slots for technician scheduling",
    defaultTimeoutMs: 8000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.ACCOUNTING_INVOICE_SYNC]: {
    capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
    displayName: "Accounting Invoice Synchronization",
    description: "Sync Aforden field invoices into external accounting ledgers",
    defaultTimeoutMs: 15000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.ACCOUNTING_PAYMENT_SYNC]: {
    capability: IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
    displayName: "Accounting Payment Synchronization",
    description: "Sync settled payments and refunds to accounting ledgers",
    defaultTimeoutMs: 15000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC]: {
    capability: IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
    displayName: "Accounting Customer Synchronization",
    description: "Sync customer profiles and tax exemptions to accounting ledgers",
    defaultTimeoutMs: 15000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.FILE_UPLOAD]: {
    capability: IntegrationCapability.FILE_UPLOAD,
    displayName: "Cloud File Storage (Upload)",
    description: "Offload photo evidence and attachments to cloud bucket",
    defaultTimeoutMs: 30000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.FILE_DOWNLOAD]: {
    capability: IntegrationCapability.FILE_DOWNLOAD,
    displayName: "Cloud File Storage (Download)",
    description: "Generate secure download signatures for stored assets",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.WEBHOOK_RECEIVE]: {
    capability: IntegrationCapability.WEBHOOK_RECEIVE,
    displayName: "Inbound Webhook Processing",
    description: "Ingest and verify external provider webhooks",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: true,
  },
  [IntegrationCapability.CRM_CONTACT_SYNC]: {
    capability: IntegrationCapability.CRM_CONTACT_SYNC,
    displayName: "CRM Contact Synchronization",
    description: "Sync customer service locations and contacts to external CRM",
    defaultTimeoutMs: 12000,
    allowsMultipleActiveProviders: false,
  },
} as const;

/**
 * Returns the capability definition for a given capability enum.
 */
export function getCapabilityDefinition(capability: IntegrationCapability): CapabilityDefinition {
  const definition = CAPABILITY_REGISTRY[capability];
  if (!definition) {
    throw new Error(`Unrecognized integration capability: ${String(capability)}`);
  }
  return definition;
}

/**
 * Returns true if the capability requires an exclusive single-active provider.
 */
export function isExclusiveCapability(capability: IntegrationCapability): boolean {
  return !getCapabilityDefinition(capability).allowsMultipleActiveProviders;
}

/**
 * Returns all registered integration capabilities.
 */
export function getAllCapabilities(): readonly IntegrationCapability[] {
  return Object.values(IntegrationCapability);
}

/**
 * Returns all exclusive singleton capabilities.
 */
export function getExclusiveCapabilities(): readonly IntegrationCapability[] {
  return getAllCapabilities().filter((cap) => isExclusiveCapability(cap));
}

/**
 * Returns all multi-provider transport capabilities.
 */
export function getMultiProviderCapabilities(): readonly IntegrationCapability[] {
  return getAllCapabilities().filter((cap) => !isExclusiveCapability(cap));
}
