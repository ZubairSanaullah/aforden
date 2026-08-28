/**
 * Phase 1.15.7 — Customer Billing Portal Service
 *
 * Coordinates creation of provider-hosted customer billing portal sessions.
 * Allows workspace administrators to manage payment methods, download invoices,
 * review receipts, and resolve past-due balances per §2.2, §5, and §10.
 */

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { getBillingAdapter } from "./providers/getBillingAdapter";
import type { PortalSessionResult } from "./providers/providerTypes";
import {
  BillingAccountNotFoundError,
  MissingProviderCustomerError,
} from "./billingErrors";
import type { CreatePortalInput } from "@/lib/validations/billing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbClient = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// createCustomerPortalSession
// ---------------------------------------------------------------------------

/**
 * Generates a provider billing portal session URL for a tenant workspace.
 *
 * Preconditions:
 *   1. Target workspace must exist.
 *   2. Target workspace must have an existing PlatformBillingAccount.
 *   3. The PlatformBillingAccount must have a registered providerCustomerId.
 *      Workspaces that have never initiated a checkout/subscription throw MissingProviderCustomerError.
 *
 * @param prisma      - PrismaClient or Prisma.TransactionClient
 * @param workspaceId - Target tenant workspace
 * @param input       - Validated return URL payload
 */
export async function createCustomerPortalSession(
  prisma: DbClient,
  workspaceId: string,
  input: CreatePortalInput
): Promise<PortalSessionResult> {
  const db = prisma as PrismaClient;

  // 1. Verify workspace exists
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });

  if (!workspace) {
    throw new Error(`Workspace '${workspaceId}' not found`);
  }

  // 2. Locate PlatformBillingAccount
  const billingAccount = await db.platformBillingAccount.findUnique({
    where: { workspaceId },
  });

  if (!billingAccount) {
    throw new BillingAccountNotFoundError(workspaceId);
  }

  // 3. Verify provider customer ID exists
  if (!billingAccount.providerCustomerId) {
    throw new MissingProviderCustomerError(workspaceId);
  }

  // 4. Resolve provider adapter & generate portal session
  const adapter = getBillingAdapter(billingAccount.provider);

  const session = await adapter.createPortalSession({
    providerCustomerId: billingAccount.providerCustomerId,
    returnUrl: input.returnUrl,
  });

  return session;
}
