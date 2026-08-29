/**
 * Phase 1.17.2 — Third-Party Integrations Domain Error Classes
 * Follows Aforden pure domain error conventions with immutable code, statusCode, and context.
 */

export interface IntegrationErrorContext {
  [key: string]: unknown;
}

export abstract class IntegrationDomainError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  get httpStatus(): number {
    return this.statusCode;
  }
  readonly context: IntegrationErrorContext;

  constructor(message: string, context: IntegrationErrorContext = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
  }
}

export class ConnectionNotReadyError extends IntegrationDomainError {
  readonly code = "CONNECTION_NOT_READY";
  readonly statusCode = 409;

  constructor(connectionId: string, status: string, workspaceId: string) {
    super(
      `Integration connection '${connectionId}' in workspace '${workspaceId}' is not ready (status: ${status}).`,
      { connectionId, status, workspaceId }
    );
  }
}

export class AmbiguousCapabilityProviderError extends IntegrationDomainError {
  readonly code = "AMBIGUOUS_CAPABILITY_PROVIDER";
  readonly statusCode = 409;

  constructor(capability: string, workspaceId: string, matchingConnectionIds: readonly string[]) {
    super(
      `Ambiguous active providers found for capability '${capability}' in workspace '${workspaceId}'. Please configure a default provider preference.`,
      { capability, workspaceId, matchingConnectionIds }
    );
  }
}

export class CapabilityProviderNotConfiguredError extends IntegrationDomainError {
  readonly code = "CAPABILITY_PROVIDER_NOT_CONFIGURED";
  readonly statusCode = 404;

  constructor(capability: string, workspaceId: string) {
    super(
      `No active provider connection configured for capability '${capability}' in workspace '${workspaceId}'.`,
      { capability, workspaceId }
    );
  }
}

export class ExclusiveCapabilityConflictError extends IntegrationDomainError {
  readonly code = "EXCLUSIVE_CAPABILITY_CONFLICT";
  readonly statusCode = 409;

  constructor(
    capability: string,
    workspaceId: string,
    existingConnectionId: string,
    attemptedConnectionId: string
  ) {
    super(
      `Workspace '${workspaceId}' already has an active connection '${existingConnectionId}' for exclusive capability '${capability}'. Disconnect the existing provider before connecting '${attemptedConnectionId}'.`,
      { capability, workspaceId, existingConnectionId, attemptedConnectionId }
    );
  }
}

export class EntitlementBlockedError extends IntegrationDomainError {
  readonly code = "ENTITLEMENT_BLOCKED";
  readonly statusCode = 402;

  constructor(workspaceId: string, featureKey: string = "FEATURE_INTEGRATIONS") {
    super(
      `Workspace '${workspaceId}' does not have an active subscription entitlement for '${featureKey}'.`,
      { workspaceId, featureKey }
    );
  }
}

export class InvalidConnectionTransitionError extends IntegrationDomainError {
  readonly code = "INVALID_CONNECTION_TRANSITION";
  readonly statusCode = 400;

  constructor(from: string, to: string, trigger: string) {
    super(
      `Invalid connection lifecycle transition from '${from}' to '${to}' with trigger '${trigger}'.`,
      { from, to, trigger }
    );
  }
}

export class InvalidCredentialTransitionError extends IntegrationDomainError {
  readonly code = "INVALID_CREDENTIAL_TRANSITION";
  readonly statusCode = 400;

  constructor(from: string, to: string, trigger: string) {
    super(
      `Invalid credential lifecycle transition from '${from}' to '${to}' with trigger '${trigger}'.`,
      { from, to, trigger }
    );
  }
}

export class AdapterNotRegisteredError extends IntegrationDomainError {
  readonly code = "ADAPTER_NOT_REGISTERED";
  readonly statusCode = 500;

  constructor(integrationId: string) {
    super(
      `No provider adapter registered for integration '${integrationId}'.`,
      { integrationId }
    );
  }
}

export class AdapterAlreadyRegisteredError extends IntegrationDomainError {
  readonly code = "ADAPTER_ALREADY_REGISTERED";
  readonly statusCode = 409;

  constructor(integrationId: string) {
    super(
      `An adapter is already registered for integration '${integrationId}'. Use allowOverride to replace it.`,
      { integrationId }
    );
  }
}

export class AdapterCapabilityMismatchError extends IntegrationDomainError {
  readonly code = "ADAPTER_CAPABILITY_MISMATCH";
  readonly statusCode = 500;

  constructor(
    integrationId: string,
    unsupportedCapabilities: readonly string[],
    catalogCapabilities: readonly string[]
  ) {
    super(
      `Adapter for integration '${integrationId}' advertises capabilities [${unsupportedCapabilities.join(", ")}] not supported by catalog [${catalogCapabilities.join(", ")}].`,
      { integrationId, unsupportedCapabilities, catalogCapabilities }
    );
  }
}

export class ConnectionNotFoundError extends IntegrationDomainError {
  readonly code = "CONNECTION_NOT_FOUND";
  readonly statusCode = 404;

  constructor(connectionId: string) {
    super(
      `Integration connection '${connectionId}' not found.`,
      { connectionId }
    );
  }
}

