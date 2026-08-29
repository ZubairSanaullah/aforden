/**
 * Phase 1.17.3 — Capability-to-Adapter Resolution Bridge
 * Resolves an IntegrationConnection record by connectionId, retrieves its parent integrationId,
 * and looks up the registered IntegrationAdapter instance from AdapterRegistry.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ConnectionNotFoundError } from "../integrationErrors";
import { getAdapterOrThrow } from "./adapterRegistry";
import type { IntegrationAdapter, IntegrationConnection } from "./types";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ResolvedConnectionAdapter {
  readonly adapter: IntegrationAdapter;
  readonly connection: IntegrationConnection;
}

/**
 * Resolves the concrete IntegrationAdapter registered for an IntegrationConnection.
 * Pure data-access lookup and registry bridge — contains zero execution or retry logic.
 *
 * @param connectionId - The UUID of the IntegrationConnection record
 * @param dbClient - Optional PrismaClient or transaction client
 * @returns An object containing the loaded IntegrationConnection and its registered IntegrationAdapter
 * @throws {ConnectionNotFoundError} If connectionId does not exist in the database
 * @throws {AdapterNotRegisteredError} If no adapter is registered for the connection's integrationId
 */
export async function getAdapterForConnection(
  connectionId: string,
  dbClient?: DbClient
): Promise<ResolvedConnectionAdapter> {
  if (!connectionId || connectionId.trim().length === 0) {
    throw new ConnectionNotFoundError(connectionId);
  }

  const db = dbClient || prisma;

  const connection = await db.integrationConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection) {
    throw new ConnectionNotFoundError(connectionId);
  }

  const adapter = getAdapterOrThrow(connection.integrationId);

  return {
    adapter,
    connection,
  };
}
