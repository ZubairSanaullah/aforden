/**
 * Phase 1.17.3 — Capability-to-Adapter Resolution Bridge Tests
 * Tests getAdapterForConnection against real PostgreSQL database records,
 * verifying connection lookup, adapter retrieval, transaction support, and domain error handling.
 */

import "dotenv/config";
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  registerAdapter,
  clearAdapters,
} from "@/lib/integrations/adapters/adapterRegistry";
import { getAdapterForConnection } from "@/lib/integrations/adapters/adapterResolution";
import { MockEmailAdapter } from "@/lib/integrations/adapters/mockEmailAdapter";
import { seedIntegrationCatalog } from "@/lib/integrations/seed/integrationSeed";
import {
  ConnectionNotFoundError,
  AdapterNotRegisteredError,
} from "@/lib/integrations/integrationErrors";
import {
  IntegrationConnectionStatus,
} from "@/lib/integrations/adapters/types";

describe("Phase 1.17.3 — Capability-to-Adapter Resolution Bridge", () => {
  let prisma: PrismaClient;
  let testWorkspaceId: string;
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // Ensure platform catalog is seeded
    await seedIntegrationCatalog(prisma);
  });

  afterAll(async () => {
    clearAdapters();
    for (const wsId of createdWorkspaceIds) {
      await prisma.workspace.delete({ where: { id: wsId } }).catch(() => {});
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    clearAdapters();

    // Create a fresh test workspace
    const ws = await prisma.workspace.create({
      data: {
        name: `Adapter Resolution Test WS ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        slug: `ws-adapter-res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
    });
    testWorkspaceId = ws.id;
    createdWorkspaceIds.push(ws.id);
  });

  it("should resolve the registered adapter and return the database connection record", async () => {
    // 1. Register MockEmailAdapter for 'resend'
    const resendAdapter = new MockEmailAdapter("resend", "Resend Mock Adapter");
    registerAdapter(resendAdapter);

    // 2. Create IntegrationConnection in database for 'resend'
    const connection = await prisma.integrationConnection.create({
      data: {
        workspaceId: testWorkspaceId,
        integrationId: "resend",
        connectionKey: "default",
        status: IntegrationConnectionStatus.CONNECTED,
        configJson: { fromEmail: "billing@aforden.com" },
      },
    });

    // 3. Resolve adapter for connection
    const resolved = await getAdapterForConnection(connection.id, prisma);

    expect(resolved).toBeDefined();
    expect(resolved.adapter).toBe(resendAdapter);
    expect(resolved.adapter.integrationId).toBe("resend");
    expect(resolved.connection.id).toBe(connection.id);
    expect(resolved.connection.workspaceId).toBe(testWorkspaceId);
    expect(resolved.connection.status).toBe(IntegrationConnectionStatus.CONNECTED);
    expect(resolved.connection.connectionKey).toBe("default");
  });

  it("should throw ConnectionNotFoundError when connectionId does not exist in the database", async () => {
    const nonExistentId = "00000000-0000-0000-0000-000000000000";

    await expect(getAdapterForConnection(nonExistentId, prisma)).rejects.toThrow(ConnectionNotFoundError);
    await expect(getAdapterForConnection(nonExistentId, prisma)).rejects.toThrow(
      `Integration connection '${nonExistentId}' not found.`
    );
  });

  it("should throw ConnectionNotFoundError when connectionId is empty or whitespace", async () => {
    await expect(getAdapterForConnection("", prisma)).rejects.toThrow(ConnectionNotFoundError);
    await expect(getAdapterForConnection("   ", prisma)).rejects.toThrow(ConnectionNotFoundError);
  });

  it("should throw AdapterNotRegisteredError when the connection's integrationId has no registered adapter", async () => {
    // Create connection for 'twilio' but do NOT register an adapter for twilio
    const connection = await prisma.integrationConnection.create({
      data: {
        workspaceId: testWorkspaceId,
        integrationId: "twilio",
        connectionKey: "default",
        status: IntegrationConnectionStatus.CONNECTED,
      },
    });

    await expect(getAdapterForConnection(connection.id, prisma)).rejects.toThrow(AdapterNotRegisteredError);
    await expect(getAdapterForConnection(connection.id, prisma)).rejects.toThrow(
      "No provider adapter registered for integration 'twilio'."
    );
  });

  it("should execute resolution within a Prisma transaction client", async () => {
    const resendAdapter = new MockEmailAdapter("resend", "Resend Mock Adapter");
    registerAdapter(resendAdapter);

    await prisma.$transaction(async (tx) => {
      const connection = await tx.integrationConnection.create({
        data: {
          workspaceId: testWorkspaceId,
          integrationId: "resend",
          connectionKey: "tx_test",
          status: IntegrationConnectionStatus.CONNECTED,
        },
      });

      const resolved = await getAdapterForConnection(connection.id, tx);
      expect(resolved.adapter).toBe(resendAdapter);
      expect(resolved.connection.connectionKey).toBe("tx_test");
    });
  });
});
