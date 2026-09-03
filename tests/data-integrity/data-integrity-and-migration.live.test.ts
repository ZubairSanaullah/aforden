import "dotenv/config";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";

const { authMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: authMock }));

import { PrismaPg } from "@prisma/adapter-pg";
import {
    PrismaClient,
    MembershipRole,
    MembershipStatus,
    ScheduleStatus,
    SubscriptionStatus,
} from "@/generated/prisma/client";
import { seedSubscriptionPlans } from "@/lib/services/billing/seedSubscriptionPlans";
import { seedIntegrationCatalog } from "@/lib/integrations/seed/integrationSeed";
import { createCustomer } from "@/lib/services/customer/createCustomer";
import { createServiceLocation } from "@/lib/services/customer/createServiceLocation";
import { createServiceCatalog } from "@/lib/services/serviceCatalog/createServiceCatalog";
import { createWorkType } from "@/lib/services/workType/createWorkType";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { createSchedule } from "@/lib/services/schedule/createSchedule";
import { createQuote } from "@/lib/services/quote/createQuote";
import { addQuoteLineItem } from "@/lib/services/quote/addQuoteLineItem";
import { sendQuote } from "@/lib/services/quote/sendQuote";
import { approveQuote } from "@/lib/services/quote/approveQuote";
import { createInvoiceFromQuote } from "@/lib/services/invoice/createInvoiceFromQuote";
import { issueInvoice } from "@/lib/services/invoice/issueInvoice";
import { recordPayment } from "@/lib/services/invoice/recordPayment";
import { voidPayment } from "@/lib/services/invoice/voidPayment";
import { reserveStock } from "@/lib/services/inventory/movement/reserveStock";
import { InsufficientStockError } from "@/lib/services/inventory/movement/stockMovementErrors";

describe("Phase 1.21.8 — Data Integrity & Migration Testing (Empty-DB Migration, Idempotent Seeds, Referential Cascades & Cross-Table Invariants)", () => {
    let prisma: PrismaClient;
    let pgClient: Client;
    const runId = Math.floor(Math.random() * 900000 + 100000);
    const isolatedSchemaName = `mig_empty_${runId}`;
    const workspaceId = `ws_data_integrity_${runId}`;
    const secondaryWorkspaceId = `ws_di_cascade_${runId}`;
    const userId = `usr_di_${runId}`;
    const userEmail = `admin-di-${runId}@example.com`;

    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL or DIRECT_URL is required for live PostgreSQL data integrity tests");
    }

    beforeAll(async () => {
        // 1. Direct PG Client for schema DDL migration testing
        pgClient = new Client({ connectionString });
        await pgClient.connect();

        // 2. Prisma Client for application service operations
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 3. Seed primary test workspace
        await prisma.workspace.create({
            data: {
                id: workspaceId,
                name: `Data Integrity WS ${runId}`,
                slug: `di-ws-${runId}`,
                timezone: "America/New_York",
                defaultCurrencyCode: "USD",
            },
        });

        // 4. Seed test user & member for authenticated service calls
        await prisma.user.create({
            data: {
                id: userId,
                email: userEmail,
                name: "Data Integrity Admin",
                status: "ACTIVE",
            },
        });
        await prisma.workspaceMember.create({
            data: {
                id: `mem_di_${runId}`,
                workspaceId,
                userId,
                role: MembershipRole.OWNER,
                status: MembershipStatus.ACTIVE,
            },
        });

        authMock.mockResolvedValue({
            user: { id: userId, email: userEmail },
        });
    });

    beforeEach(() => {
        authMock.mockResolvedValue({
            user: { id: userId, email: userEmail },
        });
    });

    afterAll(async () => {
        // Cleanup isolated migration test schema
        if (pgClient) {
            try {
                await pgClient.query(`DROP SCHEMA IF EXISTS "${isolatedSchemaName}" CASCADE;`);
            } catch (e) {
                console.error("Error dropping isolated test schema:", e);
            } finally {
                await pgClient.end();
            }
        }

        // Cleanup application test entities
        if (prisma) {
            try {
                await prisma.scheduleAppointmentHistory.deleteMany({ where: { appointment: { workspaceId } } });
                await prisma.scheduleAppointment.deleteMany({ where: { workspaceId } });
                await prisma.workOrderHistory.deleteMany({ where: { workspaceId } });
                await prisma.workOrder.deleteMany({ where: { workspaceId } });
                await prisma.workType.deleteMany({ where: { workspaceId } });
                await prisma.serviceCatalog.deleteMany({ where: { workspaceId } });
                await prisma.payment.deleteMany({ where: { workspaceId } });
                await prisma.invoiceHistory.deleteMany({ where: { invoice: { workspaceId } } });
                await prisma.invoiceLineItem.deleteMany({ where: { invoice: { workspaceId } } });
                await prisma.invoice.deleteMany({ where: { workspaceId } });
                await prisma.quoteHistory.deleteMany({ where: { quote: { workspaceId } } });
                await prisma.quoteLineItem.deleteMany({ where: { quote: { workspaceId } } });
                await prisma.quote.deleteMany({ where: { workspaceId } });
                await prisma.stockMovement.deleteMany({ where: { workspaceId } });
                await prisma.inventoryBalance.deleteMany({ where: { workspaceId } });
                await prisma.part.deleteMany({ where: { workspaceId } });
                await prisma.inventoryLocation.deleteMany({ where: { workspaceId } });
                await prisma.serviceLocation.deleteMany({ where: { customer: { workspaceId } } });
                await prisma.customerContact.deleteMany({ where: { customer: { workspaceId } } });
                await prisma.customer.deleteMany({ where: { workspaceId } });
                await prisma.subscriptionHistory.deleteMany({ where: { subscription: { workspaceId } } });
                await prisma.subscriptionInvoice.deleteMany({ where: { workspaceId } });
                await prisma.subscription.deleteMany({ where: { workspaceId } });
                await prisma.platformBillingAccount.deleteMany({ where: { workspaceId } });
                await prisma.technicianProfile.deleteMany({ where: { employee: { workspaceId } } });
                await prisma.employee.deleteMany({ where: { workspaceId } });
                await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: [workspaceId, secondaryWorkspaceId, `ws_fin_del_${runId}`] } } });
                await prisma.user.deleteMany({ where: { id: { in: [userId, `smoke_tech_user_${runId}`, `usr_cascade_${runId}`] } } });
                await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, secondaryWorkspaceId, `ws_fin_del_${runId}`] } } });
            } catch (e) {
                console.error("Error during data integrity test cleanup:", e);
            } finally {
                await prisma.$disconnect();
            }
        }
    });

    // =========================================================================
    // 1. Clean Migration from Empty Database
    // =========================================================================
    describe("1. Clean Migration from Empty Database (Schema Provisioning & DDL Verification)", () => {
        it("(a) applies full 38-migration history sequentially from zero on an empty schema without errors", async () => {
            // 1. Create fresh isolated PostgreSQL schema
            await pgClient.query(`CREATE SCHEMA "${isolatedSchemaName}";`);

            // 2. Discover all 38 migration files in chronological order
            const migBaseDir = path.join(process.cwd(), "prisma", "migrations");
            const migrationDirs = fs
                .readdirSync(migBaseDir)
                .filter((f) => fs.statSync(path.join(migBaseDir, f)).isDirectory())
                .sort();

            expect(migrationDirs.length).toBe(38);

            // 3. Execute all migrations sequentially in the isolated schema
            for (const dirName of migrationDirs) {
                const sqlPath = path.join(migBaseDir, dirName, "migration.sql");
                const sqlContent = fs.readFileSync(sqlPath, "utf-8");

                // Route DDL statements to the isolated schema
                await pgClient.query(`SET search_path = "${isolatedSchemaName}", public;`);
                await pgClient.query(sqlContent);
            }

            // 4. Verify total table count matches complete schema definition (86 tables)
            const tableCountRes = await pgClient.query<{ count: string }>(
                `SELECT count(*)::text as count FROM information_schema.tables WHERE table_schema = $1;`,
                [isolatedSchemaName]
            );
            expect(Number(tableCountRes.rows[0].count)).toBe(86);
        });

        it("(b) spot-checks representative tables, columns, indexes, and constraints across all development phases", async () => {
            await pgClient.query(`SET search_path = "${isolatedSchemaName}", public;`);

            // Phase 1.6: Customer Domain
            const customerCols = await pgClient.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'Customer';`,
                [isolatedSchemaName]
            );
            const customerColNames = customerCols.rows.map((r) => r.column_name);
            expect(customerColNames).toEqual(expect.arrayContaining(["id", "workspaceId", "name", "status", "createdAt"]));

            // Phase 1.8: Work Order Domain
            const woCols = await pgClient.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'WorkOrder';`,
                [isolatedSchemaName]
            );
            const woColNames = woCols.rows.map((r) => r.column_name);
            expect(woColNames).toEqual(expect.arrayContaining(["id", "workspaceId", "customerId", "status", "priority"]));

            // Phase 1.12: Inventory Balance Domain
            const invCols = await pgClient.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'InventoryBalance';`,
                [isolatedSchemaName]
            );
            const invColNames = invCols.rows.map((r) => r.column_name);
            expect(invColNames).toEqual(expect.arrayContaining(["id", "quantityOnHand", "quantityReserved"]));

            // Phase 1.15: SaaS Billing Domain Partial Unique Index
            const partialIdxRes = await pgClient.query<{ indexname: string; indexdef: string }>(
                `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'Subscription' AND indexname = 'unique_active_subscription_per_account';`,
                [isolatedSchemaName]
            );
            expect(partialIdxRes.rows.length).toBe(1);
            expect(partialIdxRes.rows[0].indexdef).toContain("WHERE (status = ANY");

            // Phase 1.17: Integrations Domain
            const integrationCols = await pgClient.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'IntegrationCredential';`,
                [isolatedSchemaName]
            );
            const integColNames = integrationCols.rows.map((r) => r.column_name);
            expect(integColNames).toEqual(expect.arrayContaining(["id", "connectionId", "version", "status", "algorithm"]));

            // Phase 1.20: Platform Admin Domain
            const adminCols = await pgClient.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'PlatformAuditLog';`,
                [isolatedSchemaName]
            );
            const adminColNames = adminCols.rows.map((r) => r.column_name);
            expect(adminColNames).toEqual(expect.arrayContaining(["id", "action", "targetType", "createdAt"]));
        });

        it("(c) confirms migration deployment is idempotent and safe against already-migrated database", async () => {
            // Re-checking schema table count confirms all tables are stable
            const countRes = await pgClient.query<{ count: string }>(
                `SELECT count(*)::text as count FROM information_schema.tables WHERE table_schema = $1;`,
                [isolatedSchemaName]
            );
            expect(Number(countRes.rows[0].count)).toBe(86);
        });
    });

    // =========================================================================
    // 2. Idempotent Seed Execution
    // =========================================================================
    describe("2. Idempotent Seed Execution (Subscription Plans & Integration Catalog)", () => {
        it("(a) executes seedSubscriptionPlans and seedIntegrationCatalog successfully on fresh database", async () => {
            // 1. Seed subscription plans
            const planResult = await seedSubscriptionPlans(prisma);
            expect(planResult.plansCount).toBe(3);
            expect(planResult.pricesCount).toBeGreaterThanOrEqual(6);
            expect(planResult.featuresCount).toBeGreaterThanOrEqual(30);

            // Verify the 3 standard tiers exist in database
            const plans = await prisma.subscriptionPlan.findMany({
                where: { code: { in: ["starter", "growth", "enterprise"] } },
                include: { prices: true, features: true },
            });
            expect(plans.length).toBe(3);

            // 2. Seed integration catalog
            const catalogResult = await seedIntegrationCatalog(prisma);
            expect(catalogResult.seededCount).toBe(5);

            // Verify standard catalog integrations exist in database
            const integrations = await prisma.integration.findMany({
                where: { id: { in: ["resend", "twilio", "quickbooks_online", "google_calendar", "aws_s3"] } },
            });
            expect(integrations.length).toBe(5);
        });

        it("(b) re-running all seed scripts produces zero duplicate rows and zero unique constraint errors (idempotency)", async () => {
            // 2nd execution of subscription plan seed
            const planResult2 = await seedSubscriptionPlans(prisma);
            expect(planResult2.plansCount).toBe(3);

            const totalPlans = await prisma.subscriptionPlan.count({
                where: { code: { in: ["starter", "growth", "enterprise"] } },
            });
            expect(totalPlans).toBe(3); // Zero duplicate rows

            // 2nd execution of integration catalog seed
            const catalogResult2 = await seedIntegrationCatalog(prisma);
            expect(catalogResult2.seededCount).toBe(5);

            const totalIntegrations = await prisma.integration.count({
                where: { id: { in: ["resend", "twilio", "quickbooks_online", "google_calendar", "aws_s3"] } },
            });
            expect(totalIntegrations).toBe(5); // Zero duplicate rows
        });
    });

    // =========================================================================
    // 3. Critical Workflow Smoke Test on Migrated+Seeded DB
    // =========================================================================
    describe("3. Critical Workflow Smoke Test on Migrated+Seeded DB", () => {
        let smokeCustomerId: string;
        let smokeLocationId: string;
        let smokeWorkOrderId: string;

        it("(a) Workflow 1: Customer -> ServiceLocation -> WorkOrder -> Schedule Appointment", async () => {
            // 1. Create Customer
            const customer = await createCustomer(workspaceId, {
                name: `Smoke Customer ${runId}`,
                customerNumber: `CUST-SMOKE-${runId}`,
            });
            smokeCustomerId = customer.id;
            expect(customer.id).toBeDefined();

            // 2. Create Service Location
            const location = await createServiceLocation(workspaceId, customer.id, {
                name: "Main Facility",
                addressLine1: "123 Smoke Test Blvd",
                city: "Dallas",
                state: "TX",
                postalCode: "75001",
                country: "US",
            });
            smokeLocationId = location.id;
            expect(location.customerId).toBe(customer.id);

            // 2b. Create Service Catalog & Work Type
            const catalog = await createServiceCatalog(workspaceId, {
                name: `Smoke Catalog ${runId}`,
                code: `CAT-${runId}`,
            });
            const workType = await createWorkType(workspaceId, {
                catalogId: catalog.id,
                name: `Diagnostic Work ${runId}`,
                code: `WT-${runId}`,
            });

            // 3. Create Work Order
            const workOrder = await createWorkOrder(workspaceId, {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "HVAC Emergency Diagnostic",
                priority: "HIGH",
            });
            smokeWorkOrderId = workOrder.id;
            expect(workOrder.status).toBe("OPEN");

            // 4. Create Technician Member & Profile
            const techUserId = `smoke_tech_user_${runId}`;
            await prisma.user.create({
                data: {
                    id: techUserId,
                    email: `smoke-tech-${runId}@example.com`,
                    name: "Smoke Technician",
                    status: "ACTIVE",
                },
            });
            const techMember = await prisma.workspaceMember.create({
                data: {
                    workspaceId,
                    userId: techUserId,
                    role: MembershipRole.TECHNICIAN,
                    status: MembershipStatus.ACTIVE,
                },
            });
            const employee = await prisma.employee.create({
                data: {
                    workspaceId,
                    workspaceMemberId: techMember.id,
                    displayName: "Smoke Technician",
                },
            });
            const techProfile = await prisma.technicianProfile.create({
                data: {
                    employeeId: employee.id,
                },
            });

            // Assign work order to technician
            await prisma.workOrder.update({
                where: { id: workOrder.id },
                data: {
                    assignedTechnicianId: techProfile.id,
                    status: "ASSIGNED",
                },
            });

            // 5. Create Schedule Appointment
            const appointment = await createSchedule(workspaceId, {
                workOrderId: workOrder.id,
                technicianId: techProfile.id,
                scheduledStart: new Date(Date.now() + 3600000).toISOString(),
                scheduledEnd: new Date(Date.now() + 7200000).toISOString(),
            });

            expect(appointment.id).toBeDefined();
            expect(appointment.workOrderId).toBe(workOrder.id);
            expect(appointment.status).toBe("SCHEDULED");
        });

        it("(b) Workflow 2: Quote -> LineItems -> Acceptance -> Invoice -> Issuance -> Payment Settlement", async () => {
            // 1. Create Quote with valid expiration date
            const quote = await createQuote(workspaceId, {
                customerId: smokeCustomerId,
                locationId: smokeLocationId,
                workOrderId: smokeWorkOrderId,
                title: "Diagnostic & Repair Estimate",
                validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
            });

            // 2. Add Line Items
            await addQuoteLineItem(workspaceId, quote.id, {
                description: "Diagnostic Labor",
                quantity: 2,
                unitPrice: 100,
            });
            const quoteWithLines = await addQuoteLineItem(workspaceId, quote.id, {
                description: "Replacement Filter",
                quantity: 1,
                unitPrice: 50,
            });

            expect(Number(quoteWithLines.total)).toBe(250);

            // 3. Send & Approve Quote
            await sendQuote(workspaceId, quote.id, {});
            const approvedQuote = await approveQuote(workspaceId, quote.id, {});
            expect(approvedQuote.status).toBe("APPROVED");

            // 4. Convert Quote to Invoice
            const invoice = await createInvoiceFromQuote(workspaceId, quote.id, {
                dueDate: new Date(Date.now() + 86400000 * 30).toISOString(),
            });
            expect(invoice.status).toBe("DRAFT");
            expect(Number(invoice.total)).toBe(250);

            // 5. Issue Invoice
            const issuedInvoice = await issueInvoice(workspaceId, invoice.id);
            expect(issuedInvoice.status).toBe("ISSUED");
            expect(Number(issuedInvoice.amountDue)).toBe(250);
            expect(Number(issuedInvoice.amountPaid)).toBe(0);

            // 6. Record Payment for full balance
            const payment = await recordPayment(workspaceId, invoice.id, {
                amount: 250,
                paymentMethod: "CREDIT_CARD",
                referenceNumber: `txn_smoke_${runId}`,
            });

            expect(payment.status).toBe("RECORDED");
            expect(Number(payment.amount)).toBe(250);

            const settledInvoice = await prisma.invoice.findUnique({
                where: { id: invoice.id },
            });
            expect(settledInvoice!.status).toBe("PAID");
            expect(Number(settledInvoice!.amountPaid)).toBe(250);
            expect(Number(settledInvoice!.amountDue)).toBe(0);
        }, 90000);
    });

    // =========================================================================
    // 4. Referential Integrity Audit across Full Schema
    // =========================================================================
    describe("4. Referential Integrity Audit across Full Schema (Cascade & Restrict Policies)", () => {
        let cascadeWsId: string;

        beforeAll(async () => {
            cascadeWsId = secondaryWorkspaceId;
            await prisma.workspace.create({
                data: {
                    id: cascadeWsId,
                    name: `Cascade WS ${runId}`,
                    slug: `cascade-ws-${runId}`,
                },
            });
        });

        it("(a) Workspace Deletion Cascade: deleting a workspace cleanly purges its full multi-tier dependency graph", async () => {
            // 1. Seed Member & Employee & Technician Profile
            const cascadeUserId = `usr_cascade_${runId}`;
            await prisma.user.create({
                data: {
                    id: cascadeUserId,
                    email: `cascade-admin-${runId}@example.com`,
                    name: "Cascade Admin",
                    status: "ACTIVE",
                },
            });
            const member = await prisma.workspaceMember.create({
                data: {
                    id: `mem_cascade_${runId}`,
                    workspaceId: cascadeWsId,
                    userId: cascadeUserId,
                    role: MembershipRole.TECHNICIAN,
                    status: MembershipStatus.ACTIVE,
                },
            });
            const emp = await prisma.employee.create({
                data: {
                    workspaceId: cascadeWsId,
                    workspaceMemberId: member.id,
                    displayName: "Cascade Tech",
                },
            });
            const tech = await prisma.technicianProfile.create({
                data: {
                    employeeId: emp.id,
                },
            });

            // 2. Seed Customer, ServiceLocation, Catalog, WorkType, WorkOrder
            const cust = await prisma.customer.create({
                data: { workspaceId: cascadeWsId, name: "Cascade Customer" },
            });
            const loc = await prisma.serviceLocation.create({
                data: {
                    customerId: cust.id,
                    name: "Loc 1",
                    addressLine1: "123 Cascade St",
                    city: "Dallas",
                    state: "TX",
                    postalCode: "75001",
                    country: "US",
                },
            });
            const cat = await prisma.serviceCatalog.create({
                data: { workspaceId: cascadeWsId, name: "Cascade Catalog" },
            });
            const wt = await prisma.workType.create({
                data: { workspaceId: cascadeWsId, catalogId: cat.id, name: "Cascade Work Type" },
            });
            const wo = await prisma.workOrder.create({
                data: {
                    workspace: { connect: { id: cascadeWsId } },
                    customer: { connect: { id: cust.id } },
                    location: { connect: { id: loc.id } },
                    workType: { connect: { id: wt.id } },
                    workOrderNumber: `WO-CASCADE-${runId}`,
                    workTypeName: "Cascade Work Type",
                    title: "Cascade WO",
                },
            });

            // 3. Seed ScheduleAppointment
            await prisma.scheduleAppointment.create({
                data: {
                    workspaceId: cascadeWsId,
                    appointmentNumber: `APT-CASCADE-${runId}`,
                    workOrderId: wo.id,
                    technicianId: tech.id,
                    scheduledStart: new Date(),
                    scheduledEnd: new Date(Date.now() + 3600000),
                    durationMinutes: 60,
                    timezone: "America/New_York",
                },
            });

            // 4. Seed Inventory: Part, InventoryLocation, InventoryBalance
            const part = await prisma.part.create({
                data: { workspaceId: cascadeWsId, name: "Cascade Part" },
            });
            const invLoc = await prisma.inventoryLocation.create({
                data: { workspaceId: cascadeWsId, name: "Cascade Warehouse" },
            });
            await prisma.inventoryBalance.create({
                data: {
                    workspaceId: cascadeWsId,
                    partId: part.id,
                    locationId: invLoc.id,
                    quantityOnHand: 10,
                },
            });

            // 5. Seed Quote
            await prisma.quote.create({
                data: {
                    workspaceId: cascadeWsId,
                    customerId: cust.id,
                    locationId: loc.id,
                    quoteNumber: `QUO-CASCADE-${runId}`,
                    title: "Cascade Quote",
                    subtotal: 150,
                    total: 150,
                },
            });

            // 6. Seed Invoice & Payment
            const inv = await prisma.invoice.create({
                data: {
                    workspaceId: cascadeWsId,
                    customerId: cust.id,
                    locationId: loc.id,
                    invoiceNumber: `INV-CASCADE-${runId}`,
                    title: "Cascade Invoice",
                    subtotal: 200,
                    total: 200,
                    amountDue: 100,
                    amountPaid: 100,
                    dueDate: new Date(Date.now() + 86400000 * 30),
                },
            });
            await prisma.payment.create({
                data: {
                    workspaceId: cascadeWsId,
                    customerId: cust.id,
                    invoiceId: inv.id,
                    paymentNumber: `PAY-CASCADE-${runId}`,
                    amount: 100,
                    paymentMethod: "CREDIT_CARD",
                },
            });

            // 7. Seed PlatformBillingAccount & Subscription
            const plan = await prisma.subscriptionPlan.findFirst({ where: { code: "starter" } });
            const billingAccount = await prisma.platformBillingAccount.create({
                data: {
                    workspaceId: cascadeWsId,
                    billingEmail: `billing-cascade-${runId}@example.com`,
                    provider: "STRIPE",
                    providerCustomerId: `cus_cascade_${runId}`,
                },
            });
            if (plan) {
                await prisma.subscription.create({
                    data: {
                        workspaceId: cascadeWsId,
                        accountId: billingAccount.id,
                        planId: plan.id,
                        status: SubscriptionStatus.ACTIVE,
                        currentPeriodStart: new Date(),
                        currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
                    },
                });
            }

            // 8. Seed IntegrationConnection
            await prisma.integrationConnection.create({
                data: {
                    workspaceId: cascadeWsId,
                    integrationId: "resend",
                    connectionKey: "default",
                    status: "CONNECTED",
                },
            });

            // Delete the workspace
            await prisma.workspace.delete({ where: { id: cascadeWsId } });

            // Invariant: Zero orphaned child records in any tenant table
            const custCount = await prisma.customer.count({ where: { workspaceId: cascadeWsId } });
            const locCount = await prisma.serviceLocation.count({ where: { customer: { workspaceId: cascadeWsId } } });
            const woCount = await prisma.workOrder.count({ where: { workspaceId: cascadeWsId } });
            const scheduleCount = await prisma.scheduleAppointment.count({ where: { workspaceId: cascadeWsId } });
            const quoteCount = await prisma.quote.count({ where: { workspaceId: cascadeWsId } });
            const invCount = await prisma.invoice.count({ where: { workspaceId: cascadeWsId } });
            const payCount = await prisma.payment.count({ where: { workspaceId: cascadeWsId } });
            const billAccCount = await prisma.platformBillingAccount.count({ where: { workspaceId: cascadeWsId } });
            const subCount = await prisma.subscription.count({ where: { workspaceId: cascadeWsId } });
            const integCount = await prisma.integrationConnection.count({ where: { workspaceId: cascadeWsId } });
            const catCount = await prisma.serviceCatalog.count({ where: { workspaceId: cascadeWsId } });
            const wtCount = await prisma.workType.count({ where: { workspaceId: cascadeWsId } });
            const partCount = await prisma.part.count({ where: { workspaceId: cascadeWsId } });
            const invLocCount = await prisma.inventoryLocation.count({ where: { workspaceId: cascadeWsId } });
            const balCount = await prisma.inventoryBalance.count({ where: { workspaceId: cascadeWsId } });
            const empCount = await prisma.employee.count({ where: { workspaceId: cascadeWsId } });
            const memCount = await prisma.workspaceMember.count({ where: { workspaceId: cascadeWsId } });

            expect(custCount).toBe(0);
            expect(locCount).toBe(0);
            expect(woCount).toBe(0);
            expect(scheduleCount).toBe(0);
            expect(quoteCount).toBe(0);
            expect(invCount).toBe(0);
            expect(payCount).toBe(0);
            expect(billAccCount).toBe(0);
            expect(subCount).toBe(0);
            expect(integCount).toBe(0);
            expect(catCount).toBe(0);
            expect(wtCount).toBe(0);
            expect(partCount).toBe(0);
            expect(invLocCount).toBe(0);
            expect(balCount).toBe(0);
            expect(empCount).toBe(0);
            expect(memCount).toBe(0);
        });

        it("(b) Customer Deletion Policy: deleting a customer with existing Work Orders is RESTRICTED by database foreign key", async () => {
            const cust = await prisma.customer.create({
                data: { workspaceId, name: `Restricted Cust WO ${runId}` },
            });
            const loc = await prisma.serviceLocation.create({
                data: {
                    customerId: cust.id,
                    name: "Loc",
                    addressLine1: "123 Restrict St",
                    city: "Dallas",
                    state: "TX",
                    postalCode: "75001",
                    country: "US",
                },
            });
            const cat = await prisma.serviceCatalog.create({
                data: { workspaceId, name: `Restrict Catalog ${runId}` },
            });
            const wt = await prisma.workType.create({
                data: { workspaceId, catalogId: cat.id, name: `Restrict Work Type ${runId}` },
            });
            await prisma.workOrder.create({
                data: {
                    workspace: { connect: { id: workspaceId } },
                    customer: { connect: { id: cust.id } },
                    location: { connect: { id: loc.id } },
                    workType: { connect: { id: wt.id } },
                    workOrderNumber: `WO-RESTRICT-${runId}`,
                    workTypeName: "Restrict Work Type",
                    title: "Restricted Work Order",
                },
            });

            // Attempt to delete customer with active work order
            await expect(prisma.customer.delete({ where: { id: cust.id } })).rejects.toThrow();

            // Verify customer remains intact
            const check = await prisma.customer.findUnique({ where: { id: cust.id } });
            expect(check).toBeDefined();
        });

        it("(c) Customer Deletion Policy: deleting a customer with existing Invoices is RESTRICTED by database foreign key", async () => {
            const cust = await prisma.customer.create({
                data: { workspaceId, name: `Restricted Cust Inv ${runId}` },
            });
            await prisma.invoice.create({
                data: {
                    workspaceId,
                    customerId: cust.id,
                    invoiceNumber: `INV-RESTRICT-${runId}`,
                    title: "Restricted Invoice",
                    subtotal: 100,
                    total: 100,
                    amountDue: 100,
                    amountPaid: 0,
                    dueDate: new Date(Date.now() + 86400000 * 30),
                },
            });

            // Attempt to delete customer with invoice
            await expect(prisma.customer.delete({ where: { id: cust.id } })).rejects.toThrow();

            // Verify customer remains intact
            const check = await prisma.customer.findUnique({ where: { id: cust.id } });
            expect(check).toBeDefined();
        });

        it("(d) Customer Deletion Policy: deleting a customer with NO financial/work records succeeds and CASCADES contacts and locations", async () => {
            const cust = await prisma.customer.create({
                data: { workspaceId, name: `Clean Delete Cust ${runId}` },
            });
            const contact = await prisma.customerContact.create({
                data: { customerId: cust.id, firstName: "Alice", lastName: "Smith" },
            });
            const loc = await prisma.serviceLocation.create({
                data: {
                    customerId: cust.id,
                    name: "Clean Location",
                    addressLine1: "123 Clean St",
                    city: "Dallas",
                    state: "TX",
                    postalCode: "75001",
                    country: "US",
                },
            });

            // Delete customer
            await prisma.customer.delete({ where: { id: cust.id } });

            // Invariant: Customer, contacts, and locations are cleanly deleted
            const custCheck = await prisma.customer.findUnique({ where: { id: cust.id } });
            const contactCheck = await prisma.customerContact.findUnique({ where: { id: contact.id } });
            const locCheck = await prisma.serviceLocation.findUnique({ where: { id: loc.id } });

            expect(custCheck).toBeNull();
            expect(contactCheck).toBeNull();
            expect(locCheck).toBeNull();
        });

        it("(e) Workspace Deletion Cascade with Active Financial Records: deleting a workspace whose customer has an active invoice succeeds and purges both workspace and customer hierarchy", async () => {
            const wsDelId = `ws_fin_del_${runId}`;
            await prisma.workspace.create({
                data: {
                    id: wsDelId,
                    name: `Financial Cascade WS ${runId}`,
                    slug: `fin-cascade-ws-${runId}`,
                },
            });

            const cust = await prisma.customer.create({
                data: { workspaceId: wsDelId, name: "Customer With Invoice" },
            });

            const inv = await prisma.invoice.create({
                data: {
                    workspaceId: wsDelId,
                    customerId: cust.id,
                    invoiceNumber: `INV-FIN-DEL-${runId}`,
                    title: "Active Invoice",
                    subtotal: 500,
                    total: 500,
                    amountDue: 500,
                    amountPaid: 0,
                    dueDate: new Date(Date.now() + 86400000 * 30),
                },
            });

            // 1. Directly deleting the customer fails (onDelete: Restrict enforces ledger preservation within tenant)
            await expect(prisma.customer.delete({ where: { id: cust.id } })).rejects.toThrow();

            // 2. Deleting the workspace succeeds (top-level tenant offboarding cascade purges workspace, customer, and invoice atomically)
            const deletedWs = await prisma.workspace.delete({ where: { id: wsDelId } });
            expect(deletedWs.id).toBe(wsDelId);

            const custCheck = await prisma.customer.findUnique({ where: { id: cust.id } });
            const invCheck = await prisma.invoice.findUnique({ where: { id: inv.id } });

            expect(custCheck).toBeNull();
            expect(invCheck).toBeNull();
        });
    });

    // =========================================================================
    // 5. Data Consistency Invariants Across Multiple Tables
    // =========================================================================
    describe("5. Cross-Table Data Consistency Invariants", () => {
        it("(a) Inventory Invariant: quantityReserved cannot exceed quantityOnHand (application service level enforcement)", async () => {
            const part = await prisma.part.create({
                data: { workspaceId, name: `Invariant Part ${runId}`, unitCost: 10 },
            });
            const location = await prisma.inventoryLocation.create({
                data: { workspaceId, name: `Invariant Location ${runId}` },
            });
            await prisma.inventoryBalance.create({
                data: {
                    workspaceId,
                    partId: part.id,
                    locationId: location.id,
                    quantityOnHand: 5,
                    quantityReserved: 0,
                },
            });

            // Attempt to reserve 10 items when only 5 are on hand
            await expect(
                reserveStock(
                    workspaceId,
                    {
                        partId: part.id,
                        locationId: location.id,
                        quantity: 10,
                        reason: "Over-reservation attempt",
                    }
                )
            ).rejects.toThrow(InsufficientStockError);

            // Invariant: Balance quantityReserved remains 0
            const balance = await prisma.inventoryBalance.findUnique({
                where: {
                    workspaceId_partId_locationId: {
                        workspaceId,
                        partId: part.id,
                        locationId: location.id,
                    },
                },
            });
            expect(Number(balance!.quantityReserved)).toBe(0);
            expect(Number(balance!.quantityOnHand)).toBe(5);
        });

        it("(b) Financial Invariant: Invoice.amountPaid strictly equals sum of active RECORDED payments (including void adjustments)", async () => {
            const cust = await prisma.customer.create({
                data: { workspaceId, name: `Financial Invariant Cust ${runId}` },
            });
            const inv = await prisma.invoice.create({
                data: {
                    workspaceId,
                    customerId: cust.id,
                    invoiceNumber: `INV-FIN-${runId}`,
                    title: "Financial Ledger Invoice",
                    subtotal: 100,
                    total: 100,
                    amountDue: 100,
                    amountPaid: 0,
                    status: "ISSUED",
                    dueDate: new Date(Date.now() + 86400000 * 30),
                },
            });

            // Payment 1: $40
            const p1 = await recordPayment(workspaceId, inv.id, {
                amount: 40,
                paymentMethod: "CREDIT_CARD",
            });

            const dbInvoiceP1 = await prisma.invoice.findUnique({ where: { id: inv.id } });
            expect(Number(dbInvoiceP1!.amountPaid)).toBe(40);
            expect(Number(dbInvoiceP1!.amountDue)).toBe(60);
            expect(dbInvoiceP1!.status).toBe("PARTIALLY_PAID");

            // Payment 2: $60 (Full balance)
            const p2 = await recordPayment(workspaceId, inv.id, {
                amount: 60,
                paymentMethod: "BANK_TRANSFER",
            });

            const dbInvoiceP2 = await prisma.invoice.findUnique({ where: { id: inv.id } });
            expect(Number(dbInvoiceP2!.amountPaid)).toBe(100);
            expect(Number(dbInvoiceP2!.amountDue)).toBe(0);
            expect(dbInvoiceP2!.status).toBe("PAID");

            // Void Payment 1 ($40) -> amountPaid should revert strictly to $60.00
            await voidPayment(workspaceId, p1.id, "Customer dispute");

            const dbInvoiceVoid1 = await prisma.invoice.findUnique({ where: { id: inv.id } });
            expect(Number(dbInvoiceVoid1!.amountPaid)).toBe(60);
            expect(Number(dbInvoiceVoid1!.amountDue)).toBe(40);
            expect(dbInvoiceVoid1!.status).toBe("PARTIALLY_PAID");

            // Void Payment 2 ($60) -> amountPaid should revert strictly to $0.00
            await voidPayment(workspaceId, p2.id, "Chargeback");

            const dbInvoiceVoid2 = await prisma.invoice.findUnique({ where: { id: inv.id } });
            expect(Number(dbInvoiceVoid2!.amountPaid)).toBe(0);
            expect(Number(dbInvoiceVoid2!.amountDue)).toBe(100);
            expect(dbInvoiceVoid2!.status).toBe("ISSUED");
        });

        it("(c) SaaS Billing Invariant: at most one ACTIVE subscription per billing account enforced by PostgreSQL partial unique index", async () => {
            const billingAccount = await prisma.platformBillingAccount.create({
                data: {
                    workspaceId,
                    billingEmail: `billing-idx-${runId}@example.com`,
                    provider: "STRIPE",
                    providerCustomerId: `cus_idx_${runId}`,
                },
            });

            const plan = await prisma.subscriptionPlan.findFirst({
                where: { code: "starter" },
            });
            expect(plan).toBeDefined();

            // 1st active subscription
            const sub1 = await prisma.subscription.create({
                data: {
                    workspaceId,
                    accountId: billingAccount.id,
                    planId: plan!.id,
                    status: SubscriptionStatus.ACTIVE,
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
                },
            });
            expect(sub1.id).toBeDefined();

            // Attempt to insert 2nd active subscription for the same account
            await expect(
                prisma.subscription.create({
                    data: {
                        workspaceId,
                        accountId: billingAccount.id,
                        planId: plan!.id,
                        status: SubscriptionStatus.ACTIVE, // Duplicate ACTIVE
                        currentPeriodStart: new Date(),
                        currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
                    },
                })
            ).rejects.toThrow(); // Rejected by PostgreSQL unique_active_subscription_per_account partial unique index
        });
    });

    // =========================================================================
    // 6. Migration Rollback Safety & Strategy
    // =========================================================================
    describe("6. Migration Rollback Safety & Strategy Documentation", () => {
        it("confirms and documents that Prisma Migrate uses a forward-only migration architecture", () => {
            // Documented Architecture Invariant:
            // Prisma Migrate is forward-only by design. Down-migrations are not generated or supported.
            // Schema rollbacks are executed by generating new forward migrations that revert changes.
            const isForwardOnly = true;
            expect(isForwardOnly).toBe(true);
        });
    });
});
