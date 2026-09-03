import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const { authMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

// Services under test
import { createCustomer } from "@/lib/services/customer/createCustomer";
import { createServiceLocation } from "@/lib/services/customer/createServiceLocation";
import { createServiceCatalog } from "@/lib/services/serviceCatalog/createServiceCatalog";
import { createWorkType } from "@/lib/services/workType/createWorkType";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { createQuote } from "@/lib/services/quote/createQuote";
import { addQuoteLineItem } from "@/lib/services/quote/addQuoteLineItem";
import { sendQuote } from "@/lib/services/quote/sendQuote";
import { approveQuote } from "@/lib/services/quote/approveQuote";
import { createInvoiceFromQuote } from "@/lib/services/invoice/createInvoiceFromQuote";
import { issueInvoice } from "@/lib/services/invoice/issueInvoice";
import { recordPayment } from "@/lib/services/invoice/recordPayment";
import { createPart } from "@/lib/services/inventory/part/createPart";
import { createInventoryLocation } from "@/lib/services/inventory/inventoryLocation/createInventoryLocation";
import { receiveStock } from "@/lib/services/inventory/movement/receiveStock";
import { reserveStock } from "@/lib/services/inventory/movement/reserveStock";
import { consumeStock } from "@/lib/services/inventory/movement/consumeStock";

describe("Phase 1.21.5 — Live PostgreSQL Critical Workflows (Financial & Inventory)", () => {
    let prisma: PrismaClient;
    const runId = Math.floor(Math.random() * 900000 + 100000);
    const workspaceId = `ws_live_wf_${runId}`;
    const userId = `usr_live_wf_${runId}`;
    const userEmail = `admin-workflow-${runId}@example.com`;

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
                name: "Workflow Live Admin",
                status: "ACTIVE",
            },
        });

        // 2. Seed live workspace
        await prisma.workspace.create({
            data: {
                id: workspaceId,
                name: "Apex Mechanical Live",
                slug: `apex-live-${runId}`,
                timezone: "America/New_York",
                defaultCurrencyCode: "USD",
            },
        });

        // 3. Seed live admin member
        await prisma.workspaceMember.create({
            data: {
                workspaceId,
                userId,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // Setup session auth
        authMock.mockResolvedValue({
            user: { id: userId, email: userEmail },
        });
    });

    afterAll(async () => {
        if (!prisma) return;
        try {
            await prisma.payment.deleteMany({ where: { workspaceId } });
            await prisma.invoiceLineItem.deleteMany({ where: { invoice: { workspaceId } } });
            await prisma.invoiceHistory.deleteMany({ where: { workspaceId } });
            await prisma.invoice.deleteMany({ where: { workspaceId } });
            await prisma.quoteLineItem.deleteMany({ where: { quote: { workspaceId } } });
            await prisma.quoteHistory.deleteMany({ where: { workspaceId } });
            await prisma.quote.deleteMany({ where: { workspaceId } });
            await prisma.stockMovement.deleteMany({ where: { workspaceId } });
            await prisma.inventoryBalance.deleteMany({ where: { workspaceId } });
            await prisma.workOrderPart.deleteMany({ where: { workOrder: { workspaceId } } });
            await prisma.workOrderHistory.deleteMany({ where: { workspaceId } });
            await prisma.workOrder.deleteMany({ where: { workspaceId } });
            await prisma.workType.deleteMany({ where: { workspaceId } });
            await prisma.serviceCatalog.deleteMany({ where: { workspaceId } });
            await prisma.inventoryLocation.deleteMany({ where: { workspaceId } });
            await prisma.part.deleteMany({ where: { workspaceId } });
            await prisma.serviceLocation.deleteMany({ where: { customer: { workspaceId } } });
            await prisma.customerContact.deleteMany({ where: { customer: { workspaceId } } });
            await prisma.customer.deleteMany({ where: { workspaceId } });
            await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
            await prisma.workspace.deleteMany({ where: { id: workspaceId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        } catch (e) {
            console.error("Cleanup error in live workflows test:", e);
        } finally {
            await prisma.$disconnect();
        }
    });

    // =========================================================================
    // Workflow 6 (Live PostgreSQL): Financial Lifecycle (Quote → Invoice → Payment)
    // =========================================================================
    describe("6. Financial Workflow (Live PostgreSQL Engine)", () => {
        it("chains Quote creation ($3,100) → Send → Approval → Invoice conversion → Issuance → Partial payment ($1,500) → Final payment ($1,600 → PAID)", async () => {
            const customer = await createCustomer(workspaceId, {
                name: `Metropolitan Health Hub ${runId}`,
                customerNumber: `CUST-FIN-${runId}`,
            });

            const quote = await createQuote(workspaceId, {
                customerId: customer.id,
                title: "Commercial Boiler Teardown & Overhaul",
                validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
            });

            await addQuoteLineItem(workspaceId, quote.id, {
                description: "High-Efficiency Commercial Boiler 500k BTU",
                quantity: 1,
                unitPrice: 2500,
            });

            const quoteWithLines = await addQuoteLineItem(workspaceId, quote.id, {
                description: "Certified Master Plumber Labor (Hours)",
                quantity: 4,
                unitPrice: 150,
            });

            expect(Number(quoteWithLines.subtotal)).toBe(3100);
            expect(Number(quoteWithLines.total)).toBe(3100);

            const sentQuote = await sendQuote(workspaceId, quote.id, {});
            expect(sentQuote.status).toBe("PENDING_APPROVAL");

            const approvedQuote = await approveQuote(workspaceId, quote.id, {});
            expect(approvedQuote.status).toBe("APPROVED");

            const invoice = await createInvoiceFromQuote(workspaceId, quote.id, {
                dueDate: new Date(Date.now() + 86400000 * 30).toISOString(),
            });

            expect(invoice.id).toBeDefined();
            expect(invoice.status).toBe("DRAFT");
            expect(Number(invoice.total)).toBe(3100);
            expect(Number(invoice.amountDue)).toBe(3100);
            expect(Number(invoice.amountPaid)).toBe(0);
            expect(invoice.lineItems?.length).toBe(2);

            const issuedInvoice = await issueInvoice(workspaceId, invoice.id);
            expect(issuedInvoice.status).toBe("ISSUED");

            const payment1 = await recordPayment(workspaceId, invoice.id, {
                amount: 1500,
                paymentMethod: "CREDIT_CARD",
                referenceNumber: `CC-LIVE-${runId}`,
            });
            expect(payment1.id).toBeDefined();
            expect(payment1.status).toBe("RECORDED");
            expect(Number(payment1.amount)).toBe(1500);

            const dbInvoiceAfterP1 = await prisma.invoice.findUnique({
                where: { id: invoice.id },
            });
            expect(Number(dbInvoiceAfterP1!.amountPaid)).toBe(1500);
            expect(Number(dbInvoiceAfterP1!.amountDue)).toBe(1600);
            expect(dbInvoiceAfterP1!.status).toBe("PARTIALLY_PAID");

            const payment2 = await recordPayment(workspaceId, invoice.id, {
                amount: 1600,
                paymentMethod: "BANK_TRANSFER",
                referenceNumber: `ACH-LIVE-${runId}`,
            });
            expect(payment2.id).toBeDefined();
            expect(payment2.status).toBe("RECORDED");
            expect(Number(payment2.amount)).toBe(1600);

            const dbInvoiceSettled = await prisma.invoice.findUnique({
                where: { id: invoice.id },
                include: { payments: true },
            });
            expect(Number(dbInvoiceSettled!.amountPaid)).toBe(3100);
            expect(Number(dbInvoiceSettled!.amountDue)).toBe(0);
            expect(dbInvoiceSettled!.status).toBe("PAID");
            expect(dbInvoiceSettled!.paidAt).toBeDefined();
            expect(dbInvoiceSettled!.payments.length).toBe(2);
        }, 60000);
    });

    // =========================================================================
    // Workflow 7 (Live PostgreSQL): Inventory Lifecycle & Real Stock Arithmetic
    // =========================================================================
    describe("7. Inventory Lifecycle & Real Stock Arithmetic (Live PostgreSQL Engine)", () => {
        it("tracks Part creation → Stock Receipt (10 units) → Reservation (4 units) → Consumption (4 units) with zero arithmetic drift", async () => {
            // Setup relational foundation in live Postgres
            const customer = await createCustomer(workspaceId, {
                name: `Industrial Plant ${runId}`,
                customerNumber: `CUST-INV-${runId}`,
            });
            const location = await createServiceLocation(workspaceId, customer.id, {
                name: "Plant A Basement",
                addressLine1: "100 Industrial Parkway",
                city: "New York",
                state: "NY",
                postalCode: "10001",
                country: "US",
            });
            const catalog = await createServiceCatalog(workspaceId, {
                name: `Facility Catalog ${runId}`,
            });
            const workType = await createWorkType(workspaceId, {
                catalogId: catalog.id,
                name: "Heavy Contactor Replacement",
                code: `HVAC-CON-${runId}`,
                estimatedDuration: 60,
            });
            const workOrder = await createWorkOrder(workspaceId, {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Replace 40A Contactor",
            });

            // Step 1: Create Part in live catalog
            const part = await createPart(workspaceId, {
                name: `Heavy-Duty Contactor 40A ${runId}`,
                partNumber: `CON-40A-${runId}`,
                unitCost: 45.00,
            });
            expect(part.id).toBeDefined();

            // Step 2: Create Inventory Location (Warehouse)
            const invLoc = await createInventoryLocation(workspaceId, {
                name: `Central Warehouse Bay ${runId}`,
                code: `WH-BAY-${runId}`,
                type: "WAREHOUSE",
            });
            expect(invLoc.id).toBeDefined();

            // Step 3: Receive 10 units into live stock
            const received = await receiveStock(workspaceId, {
                partId: part.id,
                locationId: invLoc.id,
                quantity: 10,
                unitCost: 45.00,
            });
            expect(Number(received.balance.quantityOnHand)).toBe(10);
            expect(Number(received.balance.quantityReserved)).toBe(0);
            expect(Number(received.balance.quantityAvailable)).toBe(10);

            // Step 4: Reserve 4 units for the Work Order
            const reserved = await reserveStock(workspaceId, {
                partId: part.id,
                locationId: invLoc.id,
                workOrderId: workOrder.id,
                quantity: 4,
            });
            expect(Number(reserved.balance.quantityOnHand)).toBe(10);
            expect(Number(reserved.balance.quantityReserved)).toBe(4);
            expect(Number(reserved.balance.quantityAvailable)).toBe(6);

            // Step 5: Consume 4 units to fulfill the work order
            const consumed = await consumeStock(workspaceId, {
                partId: part.id,
                locationId: invLoc.id,
                workOrderId: workOrder.id,
                quantity: 4,
            });
            expect(Number(consumed.balance.quantityOnHand)).toBe(6);
            expect(Number(consumed.balance.quantityReserved)).toBe(0);
            expect(Number(consumed.balance.quantityAvailable)).toBe(6);

            // Step 6: Verify live StockMovement audit ledger in PostgreSQL
            const movements = await prisma.stockMovement.findMany({
                where: { workspaceId, partId: part.id },
                orderBy: { createdAt: "asc" },
            });
            expect(movements.length).toBe(3); // RECEIPT, RESERVATION, CONSUMPTION
            expect(movements[0].movementType).toBe("RECEIPT");
            expect(Number(movements[0].quantity)).toBe(10);
            expect(movements[1].movementType).toBe("RESERVATION");
            expect(Number(movements[1].quantity)).toBe(4);
            expect(movements[2].movementType).toBe("CONSUMPTION");
            expect(Number(movements[2].quantity)).toBe(4);
        }, 60000);
    });
});
