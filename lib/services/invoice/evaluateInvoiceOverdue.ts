/**
 * Phase 1.12.9 — Invoice Lifecycle: Evaluate Overdue Invoices
 *
 * System-triggered service — NOT a user action.
 * No AUTH/PERMISSION guard against a human actor.
 * Designed to be called by a scheduler (scheduling itself is out of scope for 1.12.9).
 *
 * ELIGIBLE STATUSES (per §6.1 State Transition Matrix, locked architecture):
 * - `ISSUED` → `OVERDUE`: §6.1 line 625 — now() > dueDate and amountDue > 0.00
 * - `PARTIALLY_PAID` → `OVERDUE`: §6.1 line 628 — now() > dueDate and amountDue > 0.00
 */

import { prisma } from "@/lib/prisma";
import type { InvoiceStatus } from "./invoice.types";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

export interface EvaluateInvoiceOverdueResult {
    processedCount: number;
    transitionedCount: number;
    workspacesProcessed: number;
    errors: Array<{ invoiceId: string; error: string }>;
}

/**
 * The locked set of statuses that can transition to OVERDUE (§6.1).
 */
const OVERDUE_ELIGIBLE_STATUSES: InvoiceStatus[] = ["ISSUED", "PARTIALLY_PAID"];

/**
 * Evaluates all ISSUED and PARTIALLY_PAID invoices whose due date is strictly before `now`
 * and transitions them to OVERDUE. Can be called per-workspace or across all workspaces.
 *
 * @param workspaceId - Specific workspace ID, or "ALL" for system-wide evaluation.
 * @param now - Optional override for "current time" (UTC). Defaults to new Date(). Useful for tests.
 */
export async function evaluateInvoiceOverdue(
    workspaceId: string | "ALL",
    now: Date = new Date(),
): Promise<EvaluateInvoiceOverdueResult> {
    const result: EvaluateInvoiceOverdueResult = {
        processedCount: 0,
        transitionedCount: 0,
        workspacesProcessed: 0,
        errors: [],
    };

    // Determine the workspace IDs to process
    let workspaceIds: string[];

    if (workspaceId === "ALL") {
        // Enumerate distinct workspaces that have eligible invoices — never an unscoped cross-tenant query
        const eligibleWorkspaces = await prisma.invoice.findMany({
            where: {
                status: { in: OVERDUE_ELIGIBLE_STATUSES },
                dueDate: { lt: now },
                amountDue: { gt: 0 },
            },
            select: { workspaceId: true },
            distinct: ["workspaceId"],
        });
        workspaceIds = eligibleWorkspaces.map((w) => w.workspaceId);
    } else {
        workspaceIds = [workspaceId];
    }

    result.workspacesProcessed = workspaceIds.length;

    // Per-workspace iteration: preserves tenant isolation for batch runs
    for (const wsId of workspaceIds) {
        // Fetch ISSUED and PARTIALLY_PAID invoices past due in this workspace with outstanding balance
        const overdueInvoices = await prisma.invoice.findMany({
            where: {
                workspaceId: wsId,
                status: { in: OVERDUE_ELIGIBLE_STATUSES },
                dueDate: { lt: now },
                amountDue: { gt: 0 },
            },
            select: {
                id: true,
                invoiceNumber: true,
                title: true,
                customerId: true,
                customer: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
                total: true,
                amountDue: true,
                dueDate: true,
                status: true,
            },
        });

        result.processedCount += overdueInvoices.length;

        // Per-invoice atomic transaction: bounds lock scope, ensures recovery on partial failure
        for (const inv of overdueInvoices) {
            try {
                const transitioned = await prisma.$transaction(async (tx) => {
                    // Re-fetch inside transaction to detect concurrent status changes (idempotency guard)
                    const current = await tx.invoice.findFirst({
                        where: {
                            id: inv.id,
                            workspaceId: wsId,
                            status: { in: OVERDUE_ELIGIBLE_STATUSES }, // Must still be ISSUED or PARTIALLY_PAID
                            amountDue: { gt: 0 },
                        },
                        select: { id: true, status: true },
                    });

                    if (!current) {
                        // Already transitioned by another process or concurrent call — skip silently
                        return false;
                    }

                    await tx.invoice.update({
                        where: { id: inv.id },
                        data: { status: "OVERDUE" },
                    });

                    await tx.invoiceHistory.create({
                        data: {
                            invoiceId: inv.id,
                            workspaceId: wsId,
                            eventType: "OVERDUE_MARKED",
                            actorMemberId: null, // System action — no human actor
                            actorName: "System",
                            field: "status",
                            oldValue: inv.status,
                            newValue: "OVERDUE",
                            metadata: {
                                system: true,
                                evaluatedAt: now.toISOString(),
                                dueDate: inv.dueDate.toISOString(),
                                invoiceNumber: inv.invoiceNumber,
                            },
                        },
                    });

                    const daysOverdue = Math.max(
                        0,
                        Math.floor(
                            (now.getTime() - inv.dueDate.getTime()) /
                                (1000 * 60 * 60 * 24),
                        ),
                    );

                    // Phase 1.13.9: Emit INVOICE_OVERDUE in same transaction
                    await emitNotificationEvent(tx, {
                        workspaceId: wsId,
                        eventType: NotificationEventType.INVOICE_OVERDUE,
                        sourceEntity: "Invoice",
                        sourceId: inv.id,
                        actorMemberId: null, // System event
                        payload: {
                            invoiceId: inv.id,
                            invoiceNumber: inv.invoiceNumber,
                            title: inv.title || `Invoice ${inv.invoiceNumber}`,
                            customerId: inv.customerId || "customer_unknown",
                            customerName: inv.customer?.name,
                            customerEmail: inv.customer?.email ?? undefined,
                            totalAmount:
                                typeof inv.total === "object" && (inv.total as any)?.toFixed
                                    ? (inv.total as any).toFixed(2)
                                    : String(inv.total ?? "0.00"),
                            dueDate: inv.dueDate.toISOString(),
                            daysOverdue,
                            amountDue:
                                typeof inv.amountDue === "object" && (inv.amountDue as any)?.toFixed
                                    ? (inv.amountDue as any).toFixed(2)
                                    : String(inv.amountDue ?? "0.00"),
                        },
                    });

                    return true;
                });

                if (transitioned) {
                    result.transitionedCount += 1;
                }
            } catch (err) {
                // Per-invoice error: record and continue processing other invoices
                result.errors.push({
                    invoiceId: inv.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }

    return result;
}
