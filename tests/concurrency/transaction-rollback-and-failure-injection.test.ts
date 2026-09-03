import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { SubscriptionStatus } from "@/generated/prisma/enums";

const { authMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

// Real production services under test
import { createCustomer } from "@/lib/services/customer/createCustomer";
import { createQuote } from "@/lib/services/quote/createQuote";
import { addQuoteLineItem } from "@/lib/services/quote/addQuoteLineItem";
import { sendQuote } from "@/lib/services/quote/sendQuote";
import { approveQuote } from "@/lib/services/quote/approveQuote";
import { createInvoiceFromQuote } from "@/lib/services/invoice/createInvoiceFromQuote";
import { issueInvoice } from "@/lib/services/invoice/issueInvoice";
import { recordPayment } from "@/lib/services/invoice/recordPayment";
import * as calcEngine from "@/lib/services/invoice/invoiceCalculationEngine";
import * as notificationService from "@/lib/services/notification";
import {
    createSubscription,
    transitionSubscriptionStatus,
} from "@/lib/services/billing/subscriptionService";

describe("Phase 1.21.6 — Transaction Failure, Partial Failure Injection & Clean Rollback", () => {
    let prisma: PrismaClient;
    const runId = Math.floor(Math.random() * 900000 + 100000);
    const workspaceId = `ws_rollback_${runId}`;
    const userId = `usr_rollback_${runId}`;
    const userEmail = `admin-rollback-${runId}@example.com`;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Seed live user
        await prisma.user.create({
            data: {
                id: userId,
                email: userEmail,
                name: "Rollback Test Admin",
                status: "ACTIVE",
            },
        });

        // 2. Seed live workspace
        await prisma.workspace.create({
            data: {
                id: workspaceId,
                name: `Rollback Testing Workspace ${runId}`,
                slug: `rollback-ws-${runId}`,
                timezone: "America/New_York",
                defaultCurrencyCode: "USD",
            },
        });

        // 3. Seed live admin membership
        await prisma.workspaceMember.create({
            data: {
                workspaceId,
                userId,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        authMock.mockResolvedValue({
            user: { id: userId, email: userEmail },
        });
    });

    afterAll(async () => {
        if (!prisma) return;
        try {
            await prisma.notificationOutbox.deleteMany({ where: { workspaceId } });
            await prisma.payment.deleteMany({ where: { workspaceId } });
            await prisma.invoiceLineItem.deleteMany({ where: { invoice: { workspaceId } } });
            await prisma.invoiceHistory.deleteMany({ where: { workspaceId } });
            await prisma.invoice.deleteMany({ where: { workspaceId } });
            await prisma.quoteLineItem.deleteMany({ where: { quote: { workspaceId } } });
            await prisma.quoteHistory.deleteMany({ where: { workspaceId } });
            await prisma.quote.deleteMany({ where: { workspaceId } });
            await prisma.subscriptionHistory.deleteMany({ where: { subscription: { workspaceId } } });
            await prisma.subscription.deleteMany({ where: { workspaceId } });
            await prisma.subscriptionPlan.deleteMany({ where: { code: { startsWith: `plan_roll_${runId}` } } });
            await prisma.platformBillingAccount.deleteMany({ where: { workspaceId } });
            await prisma.customer.deleteMany({ where: { workspaceId } });
            await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
            await prisma.workspace.deleteMany({ where: { id: workspaceId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        } catch (e) {
            console.error("Cleanup error in rollback test:", e);
        } finally {
            await prisma.$disconnect();
        }
    });

    // =========================================================================
    // 1. Multi-Step Transaction Rollback: createInvoiceFromQuote Real Service
    // =========================================================================
    describe("1. Quote-to-Invoice Multi-Step Transaction Rollback (Real Service)", () => {
        it("leaves zero orphaned rows (no invoice, no line items, no audit history, no outbox events) when an error occurs inside createInvoiceFromQuote", async () => {
            const customer = await createCustomer(workspaceId, {
                name: `Rollback Customer ${runId}`,
                customerNumber: `CUST-ROLL-${runId}`,
            });

            const quote = await createQuote(workspaceId, {
                customerId: customer.id,
                title: "Teardown with Injected Failure",
                validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
            });

            await addQuoteLineItem(workspaceId, quote.id, {
                description: "Industrial Compressor Core",
                quantity: 1,
                unitPrice: 1500,
            });

            await sendQuote(workspaceId, quote.id, {});
            await approveQuote(workspaceId, quote.id, {});

            // Snapshot existing DB counts before attempted conversion
            const countInvoicesBefore = await prisma.invoice.count({ where: { workspaceId } });
            const countLineItemsBefore = await prisma.invoiceLineItem.count({ where: { invoice: { workspaceId } } });
            const countHistoriesBefore = await prisma.invoiceHistory.count({ where: { workspaceId } });
            const countOutboxBefore = await prisma.notificationOutbox.count({ where: { workspaceId } });

            // Spy on calculation engine to inject failure mid-transaction (after invoice & line items are inserted)
            const calcSpy = vi.spyOn(calcEngine, "calculateInvoiceTotals").mockImplementationOnce(() => {
                throw new Error("INJECTED_CALCULATION_ENGINE_FAILURE: Calculation engine aborted mid-pipeline");
            });

            // Execute the REAL createInvoiceFromQuote production service
            await expect(
                createInvoiceFromQuote(workspaceId, quote.id, {
                    dueDate: new Date(Date.now() + 86400000 * 30).toISOString(),
                })
            ).rejects.toThrow("INJECTED_CALCULATION_ENGINE_FAILURE");

            calcSpy.mockRestore();

            // Invariant: Verify zero writes escaped the aborted transaction in PostgreSQL
            const countInvoicesAfter = await prisma.invoice.count({ where: { workspaceId } });
            const countLineItemsAfter = await prisma.invoiceLineItem.count({ where: { invoice: { workspaceId } } });
            const countHistoriesAfter = await prisma.invoiceHistory.count({ where: { workspaceId } });
            const countOutboxAfter = await prisma.notificationOutbox.count({ where: { workspaceId } });

            expect(countInvoicesAfter).toBe(countInvoicesBefore);
            expect(countLineItemsAfter).toBe(countLineItemsBefore);
            expect(countHistoriesAfter).toBe(countHistoriesBefore);
            expect(countOutboxAfter).toBe(countOutboxBefore);
        });
    });

    // =========================================================================
    // 2. Multi-Step Transaction Rollback: recordPayment Real Service
    // =========================================================================
    describe("2. Payment Recording Multi-Step Transaction Rollback (Real Service)", () => {
        it("leaves invoice amountPaid/status unchanged and creates no partial payment rows when recordPayment transaction aborts", async () => {
            const customer = await createCustomer(workspaceId, {
                name: `Payment Rollback Customer ${runId}`,
                customerNumber: `CUST-PAY-ROLL-${runId}`,
            });

            const quote = await createQuote(workspaceId, {
                customerId: customer.id,
                title: "Payment Invoice Setup Quote",
                validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
            });

            await addQuoteLineItem(workspaceId, quote.id, {
                description: "HVAC Sensor Array",
                quantity: 2,
                unitPrice: 1000,
            });

            await sendQuote(workspaceId, quote.id, {});
            await approveQuote(workspaceId, quote.id, {});

            // Create and Issue real invoice via production service ($2,000 total)
            const draftInvoice = await createInvoiceFromQuote(workspaceId, quote.id, {
                dueDate: new Date(Date.now() + 86400000 * 30).toISOString(),
            });

            const issuedInvoice = await issueInvoice(workspaceId, draftInvoice.id);
            expect(issuedInvoice.status).toBe("ISSUED");
            expect(Number(issuedInvoice.amountDue)).toBe(2000);
            expect(Number(issuedInvoice.amountPaid)).toBe(0);

            const countPaymentsBefore = await prisma.payment.count({ where: { workspaceId } });
            const countHistoriesBefore = await prisma.invoiceHistory.count({ where: { workspaceId } });
            const countOutboxBefore = await prisma.notificationOutbox.count({ where: { workspaceId } });

            // Spy on notification emission inside recordPayment transaction to inject failure after payment & invoice update
            const notifySpy = vi.spyOn(notificationService, "emitNotificationEvent").mockImplementationOnce(() => {
                throw new Error("INJECTED_NOTIFICATION_FAILURE: Outbox write failed mid-transaction");
            });

            // Execute the REAL recordPayment production service
            await expect(
                recordPayment(workspaceId, issuedInvoice.id, {
                    amount: 1000,
                    paymentMethod: "CREDIT_CARD",
                })
            ).rejects.toThrow("INJECTED_NOTIFICATION_FAILURE");

            notifySpy.mockRestore();

            // Verify clean rollback: Payment count, History count, Outbox count unchanged in DB
            const countPaymentsAfter = await prisma.payment.count({ where: { workspaceId } });
            const countHistoriesAfter = await prisma.invoiceHistory.count({ where: { workspaceId } });
            const countOutboxAfter = await prisma.notificationOutbox.count({ where: { workspaceId } });

            expect(countPaymentsAfter).toBe(countPaymentsBefore);
            expect(countHistoriesAfter).toBe(countHistoriesBefore);
            expect(countOutboxAfter).toBe(countOutboxBefore);

            // Verify invoice balances and status were completely preserved in live DB
            const dbInvoice = await prisma.invoice.findUnique({ where: { id: issuedInvoice.id } });
            expect(Number(dbInvoice!.amountPaid)).toBe(0);
            expect(Number(dbInvoice!.amountDue)).toBe(2000);
            expect(dbInvoice!.status).toBe("ISSUED");
        });
    });

    // =========================================================================
    // 3. Subscription State Machine Transition Rollback (Real Service)
    // =========================================================================
    describe("3. Subscription State Machine Transition Rollback (Real Service)", () => {
        it("preserves previous subscription status and rolls back history records when transition transaction aborts", async () => {
            const billingAccount = await prisma.platformBillingAccount.create({
                data: {
                    workspaceId,
                    billingEmail: `billing-roll-${runId}@example.com`,
                    provider: "STRIPE",
                    providerCustomerId: `cus_roll_${runId}`,
                },
            });

            const plan = await prisma.subscriptionPlan.create({
                data: {
                    code: `plan_roll_${runId}`,
                    name: "Rollback Plan",
                    tier: "STARTER",
                    baseSeats: 1,
                },
            });

            // Create initial ACTIVE subscription via real createSubscription
            const sub = await prisma.$transaction(async (tx) => {
                return createSubscription(tx, {
                    workspaceId,
                    accountId: billingAccount.id,
                    planId: plan.id,
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
                    triggerSource: "TEST:setup",
                });
            });

            const historyCountBefore = await prisma.subscriptionHistory.count({
                where: { subscriptionId: sub.id },
            });

            // Attempt transition with real transitionSubscriptionStatus inside an aborted transaction
            await expect(
                prisma.$transaction(async (tx) => {
                    await transitionSubscriptionStatus(tx, {
                        subscriptionId: sub.id,
                        toStatus: SubscriptionStatus.PAST_DUE,
                        triggerSource: "WEBHOOK:invoice.payment_failed",
                        actorUserId: userId,
                    });

                    // Inject downstream failure before transaction commit
                    throw new Error("INJECTED_WEBHOOK_FAILURE: Webhook acknowledgement dropped");
                })
            ).rejects.toThrow("INJECTED_WEBHOOK_FAILURE");

            // Invariant: Status remains ACTIVE and no partial history row persisted in live DB
            const dbSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
            expect(dbSub!.status).toBe(SubscriptionStatus.ACTIVE);

            const historyCountAfter = await prisma.subscriptionHistory.count({
                where: { subscriptionId: sub.id },
            });
            expect(historyCountAfter).toBe(historyCountBefore);
        });
    });
});
