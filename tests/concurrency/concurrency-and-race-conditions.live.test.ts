import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { SubscriptionStatus } from "@/generated/prisma/enums";

const { authMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

// Services under test against live PostgreSQL
import { createCustomer } from "@/lib/services/customer/createCustomer";
import { createServiceLocation } from "@/lib/services/customer/createServiceLocation";
import { createServiceCatalog } from "@/lib/services/serviceCatalog/createServiceCatalog";
import { createWorkType } from "@/lib/services/workType/createWorkType";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { assignWorkOrder } from "@/lib/services/workOrder/assignWorkOrder";
import { createPart } from "@/lib/services/inventory/part/createPart";
import { createInventoryLocation } from "@/lib/services/inventory/inventoryLocation/createInventoryLocation";
import { receiveStock } from "@/lib/services/inventory/movement/receiveStock";
import { reserveStock } from "@/lib/services/inventory/movement/reserveStock";
import { consumeStock } from "@/lib/services/inventory/movement/consumeStock";
import { InsufficientStockError } from "@/lib/services/inventory/movement/stockMovementErrors";
import { createSubscription } from "@/lib/services/billing/subscriptionService";
import { DuplicateActiveSubscriptionError } from "@/lib/services/billing/billingErrors";
import { createSchedule } from "@/lib/services/schedule/createSchedule";
import { ScheduleTechnicianConflictError } from "@/lib/services/schedule/scheduleErrors";
import { acceptInvitation } from "@/lib/services/invitation/acceptInvitation";
import {
    InvitationAlreadyAcceptedError,
    InvitationNotFoundError,
} from "@/lib/services/invitation/invitationErrors";
import { generateInvitationToken, hashInvitationToken } from "@/lib/services/invitation/invitationToken";

describe("Phase 1.21.6 — Live PostgreSQL Concurrency & Shared-State Race Conditions", () => {
    let prisma: PrismaClient;
    const runId = Math.floor(Math.random() * 900000 + 100000);
    const workspaceId = `ws_race_${runId}`;
    const userId = `usr_race_${runId}`;
    const userEmail = `admin-race-${runId}@example.com`;

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
                name: "Race Test Admin",
                status: "ACTIVE",
            },
        });

        // 2. Seed live workspace
        await prisma.workspace.create({
            data: {
                id: workspaceId,
                name: `Race Testing Workspace ${runId}`,
                slug: `race-ws-${runId}`,
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
            await prisma.scheduleAppointmentHistory.deleteMany({ where: { workspaceId } });
            await prisma.scheduleAppointment.deleteMany({ where: { workspaceId } });
            await prisma.technicianAvailability.deleteMany({ where: { technicianProfile: { employee: { workspaceId } } } });
            await prisma.technicianProfile.deleteMany({ where: { employee: { workspaceId } } });
            await prisma.employee.deleteMany({ where: { workspaceId } });
            await prisma.workspaceInvitation.deleteMany({ where: { workspaceId } });
            await prisma.subscriptionHistory.deleteMany({ where: { subscription: { workspaceId } } });
            await prisma.subscription.deleteMany({ where: { workspaceId } });
            await prisma.subscriptionPlan.deleteMany({ where: { code: { startsWith: `plan_race_${runId}` } } });
            await prisma.platformBillingAccount.deleteMany({ where: { workspaceId } });
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
            await prisma.user.deleteMany({ where: { email: { contains: `race-${runId}` } } });
        } catch (e) {
            console.error("Cleanup error in live concurrency test:", e);
        } finally {
            await prisma.$disconnect();
        }
    });

    // =========================================================================
    // 1. Inventory Stock Reservation & Consumption Race Condition
    // =========================================================================
    describe("1. Inventory Stock Reservation & Consumption Concurrency", () => {
        it("strictly prevents overselling when 4 concurrent workers request 3 units each from a 10-unit stock (12 total requested)", async () => {
            // Relational foundation
            const customer = await createCustomer(workspaceId, {
                name: `Race Customer ${runId}`,
                customerNumber: `CUST-RACE-${runId}`,
            });
            const location = await createServiceLocation(workspaceId, customer.id, {
                name: "Plant Floor",
                addressLine1: "500 Concurrency Way",
                city: "New York",
                state: "NY",
                postalCode: "10001",
                country: "US",
            });
            const catalog = await createServiceCatalog(workspaceId, {
                name: `Race Catalog ${runId}`,
            });
            const workType = await createWorkType(workspaceId, {
                catalogId: catalog.id,
                name: "High Voltage Relay",
                code: `RELAY-${runId}`,
                estimatedDuration: 60,
            });

            // Create 4 Work Orders sequentially
            const wo1 = await createWorkOrder(workspaceId, { customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "WO 1" });
            const wo2 = await createWorkOrder(workspaceId, { customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "WO 2" });
            const wo3 = await createWorkOrder(workspaceId, { customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "WO 3" });
            const wo4 = await createWorkOrder(workspaceId, { customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "WO 4" });

            // Part & Location
            const part = await createPart(workspaceId, {
                name: `Precision Relay ${runId}`,
                partNumber: `PR-RELAY-${runId}`,
                unitCost: 25.00,
            });
            const invLoc = await createInventoryLocation(workspaceId, {
                name: `Warehouse Bay ${runId}`,
                code: `BAY-RACE-${runId}`,
                type: "WAREHOUSE",
            });

            // Receive 10 units of stock
            await receiveStock(workspaceId, {
                partId: part.id,
                locationId: invLoc.id,
                quantity: 10,
                unitCost: 25.00,
            });

            // Step: Fire 4 genuinely concurrent reservation requests for 3 units each
            // Total requested = 12 units > 10 units available
            const reservationPromises = [
                reserveStock(workspaceId, { partId: part.id, locationId: invLoc.id, workOrderId: wo1.id, quantity: 3 }),
                reserveStock(workspaceId, { partId: part.id, locationId: invLoc.id, workOrderId: wo2.id, quantity: 3 }),
                reserveStock(workspaceId, { partId: part.id, locationId: invLoc.id, workOrderId: wo3.id, quantity: 3 }),
                reserveStock(workspaceId, { partId: part.id, locationId: invLoc.id, workOrderId: wo4.id, quantity: 3 }),
            ];

            const results = await Promise.allSettled(reservationPromises);

            const fulfilled = results.filter(r => r.status === "fulfilled");
            const rejected = results.filter(r => r.status === "rejected");

            // Invariant: Exactly 3 requests must succeed (3 * 3 = 9 units), exactly 1 must fail
            expect(fulfilled.length).toBe(3);
            expect(rejected.length).toBe(1);

            const failedError = (rejected[0] as PromiseRejectedResult).reason;
            expect(failedError).toBeInstanceOf(InsufficientStockError);

            // Verify live DB balance invariant
            const dbBalance = await prisma.inventoryBalance.findUnique({
                where: {
                    workspaceId_partId_locationId: {
                        workspaceId,
                        partId: part.id,
                        locationId: invLoc.id,
                    },
                },
            });

            expect(Number(dbBalance!.quantityOnHand)).toBe(10);
            expect(Number(dbBalance!.quantityReserved)).toBe(9);
            // Available = 10 - 9 = 1

            // Step 2: Now fire 3 concurrent consumption requests for the 3 successful work orders (3 units each = 9 units)
            const successfulWoIds = [wo1.id, wo2.id, wo3.id, wo4.id].filter((_, idx) => results[idx].status === "fulfilled");

            const consumptionPromises = successfulWoIds.map(woId =>
                consumeStock(workspaceId, {
                    partId: part.id,
                    locationId: invLoc.id,
                    workOrderId: woId,
                    quantity: 3,
                })
            );

            const consumeResults = await Promise.allSettled(consumptionPromises);
            expect(consumeResults.every(r => r.status === "fulfilled")).toBe(true);

            // Final DB balance verification
            const finalBalance = await prisma.inventoryBalance.findUnique({
                where: {
                    workspaceId_partId_locationId: {
                        workspaceId,
                        partId: part.id,
                        locationId: invLoc.id,
                    },
                },
            });

            expect(Number(finalBalance!.quantityOnHand)).toBe(1); // 10 - 9 = 1
            expect(Number(finalBalance!.quantityReserved)).toBe(0); // 9 - 9 = 0
        }, 60000);
    });

    // =========================================================================
    // 2. Single-Active-Subscription Partial Unique Index Race Condition
    // =========================================================================
    describe("2. Single-Active-Subscription Creation Race Condition", () => {
        it("guarantees strictly one active subscription is created when 4 concurrent workers race to activate", async () => {
            // Setup billing account and plan
            const billingAccount = await prisma.platformBillingAccount.create({
                data: {
                    workspaceId,
                    billingEmail: `billing-race-${runId}@example.com`,
                    provider: "STRIPE",
                    providerCustomerId: `cus_race_${runId}`,
                },
            });

            const plan = await prisma.subscriptionPlan.create({
                data: {
                    code: `plan_race_${runId}`,
                    name: "Concurrency Enterprise Plan",
                    tier: "ENTERPRISE",
                    baseSeats: 5,
                },
            });

            const now = new Date();
            const periodEnd = new Date(Date.now() + 86400000 * 30);

            // Fire 4 concurrent createSubscription calls
            const createPromises = [1, 2, 3, 4].map(idx =>
                prisma.$transaction(async (tx) => {
                    return createSubscription(tx, {
                        workspaceId,
                        accountId: billingAccount.id,
                        planId: plan.id,
                        status: SubscriptionStatus.ACTIVE,
                        providerSubscriptionId: `sub_stripe_race_${runId}_${idx}`,
                        currentPeriodStart: now,
                        currentPeriodEnd: periodEnd,
                        actorUserId: userId,
                        triggerSource: `concurrent_test_worker_${idx}`,
                    });
                })
            );

            const results = await Promise.allSettled(createPromises);

            const fulfilled = results.filter(r => r.status === "fulfilled");
            const rejected = results.filter(r => r.status === "rejected");

            // Exactly 1 must succeed; other 3 must fail with DuplicateActiveSubscriptionError (or P2002 partial index)
            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(3);

            for (const rej of rejected) {
                const err = (rej as PromiseRejectedResult).reason;
                expect(
                    err instanceof DuplicateActiveSubscriptionError ||
                    err?.message?.includes("active subscription already exists") ||
                    err?.code === "P2002"
                ).toBe(true);
            }

            // Assert DB invariant: Exactly 1 ACTIVE subscription exists for this workspace
            const activeSubs = await prisma.subscription.findMany({
                where: {
                    workspaceId,
                    status: SubscriptionStatus.ACTIVE,
                },
            });
            expect(activeSubs.length).toBe(1);
        }, 60000);
    });

    // =========================================================================
    // 3. Schedule Appointment Conflict Half-Open Interval Race Condition
    // =========================================================================
    describe("3. Schedule Appointment Overlap Conflict Race Condition", () => {
        it("strictly prevents double-booking when 2 concurrent requests schedule overlapping appointment intervals for the same technician", async () => {
            // Seed Employee and TechnicianProfile with ACTIVE status
            const techUser = await prisma.user.create({
                data: {
                    id: `usr_tech_race_${runId}`,
                    email: `tech-race-${runId}@example.com`,
                    name: "Race Technician",
                    status: "ACTIVE",
                },
            });

            const techMember = await prisma.workspaceMember.create({
                data: {
                    workspaceId,
                    userId: techUser.id,
                    role: "TECHNICIAN",
                    status: "ACTIVE",
                },
            });

            const employee = await prisma.employee.create({
                data: {
                    workspaceId,
                    workspaceMemberId: techMember.id,
                    displayName: "Race Technician",
                    status: "ACTIVE",
                },
            });

            const technicianProfile = await prisma.technicianProfile.create({
                data: {
                    employeeId: employee.id,
                },
            });

            // Set up customer, location, catalog, workType, and 2 work orders
            const customer = await createCustomer(workspaceId, {
                name: `Schedule Customer ${runId}`,
                customerNumber: `CUST-SCH-${runId}`,
            });
            const location = await createServiceLocation(workspaceId, customer.id, {
                name: "HVAC Plant",
                addressLine1: "100 Schedule Way",
                city: "New York",
                state: "NY",
                postalCode: "10001",
                country: "US",
            });
            const catalog = await createServiceCatalog(workspaceId, { name: `Schedule Catalog ${runId}` });
            const workType = await createWorkType(workspaceId, {
                catalogId: catalog.id,
                name: "HVAC Calibration",
                code: `SCH-CAL-${runId}`,
                estimatedDuration: 60,
            });

            const wo1 = await createWorkOrder(workspaceId, { customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "WO Schedule 1" });
            const wo2 = await createWorkOrder(workspaceId, { customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "WO Schedule 2" });

            // Assign technician to both work orders prior to booking
            await assignWorkOrder(workspaceId, wo1.id, { technicianId: technicianProfile.id });
            await assignWorkOrder(workspaceId, wo2.id, { technicianId: technicianProfile.id });

            // Time windows: Slot A: 09:00 - 11:00, Slot B: 10:00 - 12:00 (Overlapping from 10:00 - 11:00)
            const baseTime = Date.now() + 86400000 * 5; // 5 days in future
            const start1 = new Date(baseTime);
            const end1 = new Date(baseTime + 7200000); // +2 hrs

            const start2 = new Date(baseTime + 3600000); // +1 hr (overlaps Slot 1)
            const end2 = new Date(baseTime + 10800000); // +3 hrs

            // Fire 2 genuinely concurrent schedule creation requests for the same technician with overlapping windows
            const schedulePromises = [
                createSchedule(workspaceId, {
                    workOrderId: wo1.id,
                    technicianId: technicianProfile.id,
                    scheduledStart: start1.toISOString(),
                    scheduledEnd: end1.toISOString(),
                }),
                createSchedule(workspaceId, {
                    workOrderId: wo2.id,
                    technicianId: technicianProfile.id,
                    scheduledStart: start2.toISOString(),
                    scheduledEnd: end2.toISOString(),
                }),
            ];

            const results = await Promise.allSettled(schedulePromises);

            const fulfilled = results.filter(r => r.status === "fulfilled");
            const rejected = results.filter(r => r.status === "rejected");

            // Invariant: Exactly 1 appointment must succeed; the overlapping attempt is rejected
            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(1);

            const err = (rejected[0] as PromiseRejectedResult).reason;
            expect(err).toBeInstanceOf(ScheduleTechnicianConflictError);

            // Verify live DB state: strictly 1 appointment persisted
            const appointments = await prisma.scheduleAppointment.findMany({
                where: {
                    workspaceId,
                    technicianId: technicianProfile.id,
                },
            });
            expect(appointments.length).toBe(1);
        }, 60000);
    });

    // =========================================================================
    // 4. Invitation Token Concurrent Acceptance Race Condition
    // =========================================================================
    describe("4. Invitation Token Concurrent Acceptance Race Condition", () => {
        it("strictly creates exactly one workspace membership and rejects duplicate concurrent token acceptance", async () => {
            const rawToken = generateInvitationToken();
            const tokenHash = hashInvitationToken(rawToken);
            const inviteEmail = `invitee-race-${runId}@example.com`;

            // Create pending invitation
            const invitation = await prisma.workspaceInvitation.create({
                data: {
                    workspaceId,
                    email: inviteEmail,
                    invitedById: userId,
                    tokenHash,
                    role: "TECHNICIAN",
                    expiresAt: new Date(Date.now() + 86400000 * 7),
                },
            });

            // Create target authenticated user
            const invitedUser = await prisma.user.create({
                data: {
                    email: inviteEmail,
                    name: "Invited Technician",
                    status: "ACTIVE",
                },
            });

            // Fire 2 concurrent acceptInvitation calls using the same token
            const acceptPromises = [
                acceptInvitation({
                    rawToken,
                    authenticatedUserId: invitedUser.id,
                    authenticatedUserEmail: inviteEmail,
                    ipAddress: "127.0.0.1",
                }),
                acceptInvitation({
                    rawToken,
                    authenticatedUserId: invitedUser.id,
                    authenticatedUserEmail: inviteEmail,
                    ipAddress: "127.0.0.1",
                }),
            ];

            const results = await Promise.allSettled(acceptPromises);

            const fulfilled = results.filter(r => r.status === "fulfilled");
            const rejected = results.filter(r => r.status === "rejected");

            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(1);

            const err = (rejected[0] as PromiseRejectedResult).reason;
            expect(
                err instanceof InvitationAlreadyAcceptedError ||
                err instanceof InvitationNotFoundError ||
                err?.code === "P2002"
            ).toBe(true);

            // Invariant: DB has strictly 1 member created and invitation acceptedAt is set
            const members = await prisma.workspaceMember.findMany({
                where: {
                    workspaceId,
                    userId: invitedUser.id,
                },
            });
            expect(members.length).toBe(1);

            const dbInvite = await prisma.workspaceInvitation.findUnique({
                where: { id: invitation.id },
            });
            expect(dbInvite!.acceptedAt).not.toBeNull();
        }, 60000);
    });
});
