/**
 * Phase 1.12.5 — Invoice Creation Service (Header CRUD)
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createInvoiceSchema } from "./invoice.schemas";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Creates a new Invoice in DRAFT status within an authorized workspace.
 * Standalone path only; quoteId and workOrderId remain null.
 */
export async function createInvoice(
    workspaceId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.create
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_CREATE);

    // 3. VALIDATION (includes dueDate >= issueDate refinement)
    const data = createInvoiceSchema.parse(input);

    // 4. RESOLUTION & TENANT INTEGRITY
    const customer = await prisma.customer.findFirst({
        where: {
            id: data.customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    if (data.locationId) {
        const location = await prisma.serviceLocation.findFirst({
            where: {
                id: data.locationId,
                customerId: data.customerId,
            },
        });

        if (!location) {
            throw new ServiceLocationNotFoundError();
        }
    }

    // Snapshot currencyCode from Workspace.defaultCurrencyCode
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { defaultCurrencyCode: true },
    });

    const currencyCode =
        data.currencyCode || workspace?.defaultCurrencyCode || "USD";

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction with Concurrency Retry)
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const MAX_NUMBER_RETRIES = 5;

    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
        try {
            const createdInvoice = await runTx(async (tx) => {
                // Deterministic sequential numbering (INV-YYYY-XXXXXX)
                const latest = await tx.invoice.findFirst({
                    where: {
                        workspaceId,
                        invoiceNumber: { startsWith: prefix },
                    },
                    orderBy: { invoiceNumber: "desc" },
                    select: { invoiceNumber: true },
                });

                let nextSeq = 1;
                if (latest?.invoiceNumber) {
                    const match = latest.invoiceNumber.match(/^INV-(?:\d{4}-)?(\d+)$/);
                    if (match && match[1]) {
                        const currentSeq = parseInt(match[1], 10);
                        if (!isNaN(currentSeq)) {
                            nextSeq = currentSeq + 1;
                        }
                    }
                }

                const invoiceNumber = `${prefix}${String(nextSeq).padStart(6, "0")}`;

                const issueDate = data.issueDate ? new Date(data.issueDate) : new Date();
                const dueDate = new Date(data.dueDate);

                const discountValue = data.discountValue !== undefined && data.discountValue !== null
                    ? new Prisma.Decimal(String(data.discountValue))
                    : new Prisma.Decimal("0.00");

                const taxRate = data.taxRate !== undefined && data.taxRate !== null
                    ? new Prisma.Decimal(String(data.taxRate))
                    : new Prisma.Decimal("0.0000");

                const invoice = await tx.invoice.create({
                    data: {
                        workspaceId,
                        invoiceNumber,
                        customerId: data.customerId,
                        locationId: data.locationId ?? null,
                        quoteId: null,
                        workOrderId: null,
                        status: "DRAFT",
                        title: data.title,
                        notes: data.notes ?? null,
                        internalNotes: data.internalNotes ?? null,
                        termsAndConditions: data.termsAndConditions ?? null,
                        currencyCode,
                        issueDate,
                        dueDate,
                        subtotal: new Prisma.Decimal("0.00"),
                        discountType: data.discountType ?? "PERCENTAGE",
                        discountValue,
                        discountAmount: new Prisma.Decimal("0.00"),
                        taxRate,
                        taxAmount: new Prisma.Decimal("0.00"),
                        total: new Prisma.Decimal("0.00"),
                        amountPaid: new Prisma.Decimal("0.00"),
                        amountDue: new Prisma.Decimal("0.00"),
                    },
                    include: {
                        customer: true,
                        location: true,
                        lineItems: true,
                        payments: true,
                    },
                });

                // Write immutable audit history record
                await tx.invoiceHistory.create({
                    data: {
                        invoiceId: invoice.id,
                        workspaceId,
                        eventType: "CREATED",
                        actorMemberId: authContext.membership.id,
                        actorName: authContext.user?.name ?? null,
                        field: "status",
                        oldValue: null,
                        newValue: "DRAFT",
                        metadata: {
                            invoiceNumber,
                            title: invoice.title,
                            customerId: invoice.customerId,
                            currencyCode,
                        },
                    },
                });

                // Phase 1.13.9: Emit INVOICE_CREATED in same transaction
                await emitNotificationEvent(tx, {
                    workspaceId,
                    eventType: NotificationEventType.INVOICE_CREATED,
                    sourceEntity: "Invoice",
                    sourceId: invoice.id,
                    actorMemberId: authContext.membership.id,
                    payload: {
                        invoiceId: invoice.id,
                        invoiceNumber: invoice.invoiceNumber,
                        title: invoice.title,
                        customerId: invoice.customerId,
                        customerName: invoice.customer?.name,
                        totalAmount:
                            typeof invoice.total === "object" && (invoice.total as any)?.toFixed
                                ? (invoice.total as any).toFixed(2)
                                : String(invoice.total ?? "0.00"),
                        dueDate:
                            invoice.dueDate instanceof Date
                                ? invoice.dueDate.toISOString()
                                : invoice.dueDate
                                  ? new Date(invoice.dueDate).toISOString()
                                  : new Date().toISOString(),
                    },
                });

                return invoice;
            });

            return mapInvoiceToReadModel(createdInvoice);
        } catch (err: any) {
            lastError = err;
            const isUniqueConstraint =
                err?.code === "P2002" ||
                err?.message?.includes("Unique constraint") ||
                (err?.meta?.target && Array.isArray(err.meta.target) && err.meta.target.includes("invoiceNumber"));

            if (isUniqueConstraint && attempt < MAX_NUMBER_RETRIES - 1) {
                continue; // Retry with fresh latest sequence lookup
            }
            throw err;
        }
    }

    throw lastError;
}
