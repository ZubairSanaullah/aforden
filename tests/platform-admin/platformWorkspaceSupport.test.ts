import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Hoisted mock functions
const {
    workspaceFindUniqueMock,
    workspaceMemberFindManyMock,
    customerCountMock,
    workOrderCountMock,
    assetCountMock,
    invoiceCountMock,
    partCountMock,
    quoteCountMock,
    scheduleAppointmentCountMock,
    workOrderGroupByMock,
    notificationOutboxGroupByMock,
    notificationOutboxCountMock,
    automationExecutionGroupByMock,
    automationExecutionCountMock,
    integrationConnectionFindManyMock,
    integrationConnectionGroupByMock,
    integrationConnectionCountMock,
    auditLogCreateMock,
} = vi.hoisted(() => ({
    workspaceFindUniqueMock: vi.fn(),
    workspaceMemberFindManyMock: vi.fn(),
    customerCountMock: vi.fn(),
    workOrderCountMock: vi.fn(),
    assetCountMock: vi.fn(),
    invoiceCountMock: vi.fn(),
    partCountMock: vi.fn(),
    quoteCountMock: vi.fn(),
    scheduleAppointmentCountMock: vi.fn(),
    workOrderGroupByMock: vi.fn(),
    notificationOutboxGroupByMock: vi.fn(),
    notificationOutboxCountMock: vi.fn(),
    automationExecutionGroupByMock: vi.fn(),
    automationExecutionCountMock: vi.fn(),
    integrationConnectionFindManyMock: vi.fn(),
    integrationConnectionGroupByMock: vi.fn(),
    integrationConnectionCountMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        workspace: {
            findUnique: workspaceFindUniqueMock,
        },
        workspaceMember: {
            findMany: workspaceMemberFindManyMock,
        },
        customer: {
            count: customerCountMock,
        },
        workOrder: {
            count: workOrderCountMock,
            groupBy: workOrderGroupByMock,
        },
        asset: {
            count: assetCountMock,
        },
        invoice: {
            count: invoiceCountMock,
        },
        part: {
            count: partCountMock,
        },
        quote: {
            count: quoteCountMock,
        },
        scheduleAppointment: {
            count: scheduleAppointmentCountMock,
        },
        notificationOutbox: {
            groupBy: notificationOutboxGroupByMock,
            count: notificationOutboxCountMock,
        },
        automationExecution: {
            groupBy: automationExecutionGroupByMock,
            count: automationExecutionCountMock,
        },
        integrationConnection: {
            findMany: integrationConnectionFindManyMock,
            groupBy: integrationConnectionGroupByMock,
            count: integrationConnectionCountMock,
        },
        platformAuditLog: {
            create: auditLogCreateMock,
        },
    },
}));

import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
    PlatformAccessDeniedError,
} from "@/lib/services/platform/authorization";
import {
    getWorkspaceSupportDiagnostics,
    PlatformWorkspaceSupportNotFoundError,
} from "@/lib/services/platform/support";
import { PLATFORM_AUDIT_EVENTS } from "@/lib/services/platform/audit";
import { Prisma } from "@/generated/prisma/client";


describe("Phase 1.19.9 — Workspace Support & Controlled Access Suite", () => {
    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_SUPPORT,
        userId = `usr_${role.toLowerCase()}`,
        stepUpConfirmedAt: Date | null = new Date()
    ): PlatformAuthorizationContext {
        return {
            userId,
            email: `${role.toLowerCase()}@aforden.com`,
            name: `${role} Operator`,
            avatarUrl: null,
            platformRole: role,
            profileId: `prof_${role.toLowerCase()}`,
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt,
            metadata: null,
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();

        // Seed default database query mocks
        workspaceFindUniqueMock.mockResolvedValue({
            id: "ws_alpha",
            name: "Alpha Corp Workspace",
            slug: "alpha-corp",
            timezone: "America/New_York",
            defaultCurrencyCode: "USD",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-08-01T00:00:00Z"),
            organization: {
                id: "org_alpha",
                businessName: "Alpha Corporation LLC",
                legalName: "Alpha Corporation LLC",
                logoUrl: "https://cdn.aforden.com/alpha_logo.png",
                email: "support@alphacorp.com",
                phone: "+1-800-555-0199",
                status: "ACTIVE",
            },
        });

        workspaceMemberFindManyMock.mockResolvedValue([
            {
                id: "mem_1",
                userId: "usr_owner_1",
                role: "OWNER",
                status: "ACTIVE",
                createdAt: new Date("2026-01-01T00:00:00Z"),
                user: { name: "Alice Owner", email: "alice@alphacorp.com", avatarUrl: null, status: "ACTIVE" },
            },
            {
                id: "mem_2",
                userId: "usr_tech_1",
                role: "TECHNICIAN",
                status: "ACTIVE",
                createdAt: new Date("2026-02-01T00:00:00Z"),
                user: { name: "Bob Tech", email: "bob@alphacorp.com", avatarUrl: null, status: "ACTIVE" },
            },
        ]);

        customerCountMock.mockResolvedValue(42);
        workOrderCountMock.mockResolvedValue(150);
        assetCountMock.mockResolvedValue(88);
        invoiceCountMock.mockResolvedValue(120);
        partCountMock.mockResolvedValue(310);
        quoteCountMock.mockResolvedValue(25);
        scheduleAppointmentCountMock.mockResolvedValue(95);

        workOrderGroupByMock.mockResolvedValue([
            { status: "COMPLETED", _count: 100 },
            { status: "IN_PROGRESS", _count: 30 },
            { status: "ASSIGNED", _count: 20 },
        ]);

        notificationOutboxGroupByMock.mockResolvedValue([
            { status: "SENT", _count: 450 },
            { status: "FAILED", _count: 2 },
        ]);
        notificationOutboxCountMock.mockResolvedValue(452);

        automationExecutionGroupByMock.mockResolvedValue([
            { status: "COMPLETED", _count: 80 },
            { status: "FAILED", _count: 1 },
        ]);
        automationExecutionCountMock.mockResolvedValue(81);

        integrationConnectionFindManyMock.mockResolvedValue([
            {
                id: "conn_stripe_1",
                integrationId: "stripe",
                connectionKey: "default",
                status: "CONNECTED",
                lastTestedAt: new Date("2026-08-20T10:00:00Z"),
                externalAccountName: "Alpha Corp Stripe Acct",
            },
        ]);
        integrationConnectionGroupByMock.mockResolvedValue([
            { status: "CONNECTED", _count: 1 },
        ]);
        integrationConnectionCountMock.mockResolvedValue(1);

        auditLogCreateMock.mockResolvedValue({ id: "audit_supp_1" });
    });

    describe("1. Permission Gating & Matrix Alignment", () => {
        it("allows PLATFORM_OWNER, PLATFORM_ADMIN, PLATFORM_SUPPORT, and PLATFORM_SECURITY to access support diagnostics", async () => {
            const authorizedRoles = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_SECURITY,
            ];

            for (const role of authorizedRoles) {
                const context = createMockPlatformContext(role);
                const res = await getWorkspaceSupportDiagnostics(context, "ws_alpha");

                expect(res.workspaceId).toBe("ws_alpha");
                expect(res.configuration.name).toBe("Alpha Corp Workspace");
                expect(res.memberships.totalMembers).toBe(2);
            }
        });

        it("denies PLATFORM_OPERATIONS and PLATFORM_BILLING from accessing support diagnostics", async () => {
            const unauthorizedRoles = [
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of unauthorizedRoles) {
                const context = createMockPlatformContext(role);
                await expect(
                    getWorkspaceSupportDiagnostics(context, "ws_alpha")
                ).rejects.toThrow(PlatformAccessDeniedError);
            }

            expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
            expect(auditLogCreateMock).not.toHaveBeenCalled();
        });
    });

    describe("2. Compliance Audit Event Recording (WORKSPACE_SUPPORT_ACCESSED)", () => {
        it("synchronously records WORKSPACE_SUPPORT_ACCESSED audit record with optional support ticket reference", async () => {
            const supportContext = createMockPlatformContext(PlatformRole.PLATFORM_SUPPORT, "usr_support_1");
            const ticketRef = "SUP-88421";

            const res = await getWorkspaceSupportDiagnostics(supportContext, "ws_alpha", {
                ticketReference: ticketRef,
                requestId: "req_supp_ticket_99",
                ipAddress: "192.168.1.100",
            });

            expect(res.ticketReference).toBe(ticketRef);
            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);

            const auditCall = auditLogCreateMock.mock.calls[0][0].data;
            expect(auditCall.action).toBe(PLATFORM_AUDIT_EVENTS.WORKSPACE_SUPPORT_ACCESSED);
            expect(auditCall.targetType).toBe("WORKSPACE");
            expect(auditCall.targetId).toBe("ws_alpha");
            expect(auditCall.workspaceId).toBe("ws_alpha");
            expect(auditCall.actorUserId).toBe("usr_support_1");
            expect(auditCall.actorRole).toBe(PlatformRole.PLATFORM_SUPPORT);
            expect(auditCall.requestId).toBe("req_supp_ticket_99");
            expect(auditCall.ipAddress).toBe("192.168.1.100");
            expect(auditCall.metadata).toEqual({ ticketReference: ticketRef });
        });

        it("records Prisma.JsonNull ticketReference in audit metadata when omitted", async () => {
            const supportContext = createMockPlatformContext(PlatformRole.PLATFORM_SUPPORT, "usr_support_1");

            const res = await getWorkspaceSupportDiagnostics(supportContext, "ws_alpha");
            expect(res.ticketReference).toBeNull();

            const auditCall = auditLogCreateMock.mock.calls[0][0].data;
            expect(auditCall.metadata).toBe(Prisma.JsonNull);
        });

    });

    describe("3. Structural Read-Only Guarantee (Static Analysis Test)", () => {
        it("proves platformSupportService.ts invokes ZERO write operations against Prisma", () => {
            const serviceFilePath = path.join(
                process.cwd(),
                "lib/services/platform/support/platformSupportService.ts"
            );
            const sourceCode = fs.readFileSync(serviceFilePath, "utf8");

            // Mutating operations forbidden in read-only support service
            const forbiddenMutations = [
                /\.create\s*\(/g,
                /\.update\s*\(/g,
                /\.updateMany\s*\(/g,
                /\.delete\s*\(/g,
                /\.deleteMany\s*\(/g,
                /\.upsert\s*\(/g,
                /\.executeRaw\s*\(/g,
            ];

            for (const pattern of forbiddenMutations) {
                const matches = sourceCode.match(pattern);
                expect(matches).toBeNull();
            }
        });
    });

    describe("4. Non-Tier-2 Categorization (Exemption Negative Test)", () => {
        it("succeeds without requiring min 10-char reason string or step-up authentication", async () => {
            const supportContext = createMockPlatformContext(PlatformRole.PLATFORM_SUPPORT, "usr_support_1");
            // stepUpConfirmedAt is intentionally null
            supportContext.stepUpConfirmedAt = null;

            // Invoking without reason parameter or step-up headers must succeed cleanly
            const res = await getWorkspaceSupportDiagnostics(supportContext, "ws_alpha");
            expect(res.workspaceId).toBe("ws_alpha");
        });
    });

    describe("5. Diagnostics Content & Error Handling", () => {
        it("correctly surfaces configuration, member directory, entity counts, queue statuses, and integration health", async () => {
            const supportContext = createMockPlatformContext(PlatformRole.PLATFORM_SUPPORT, "usr_support_1");

            const res = await getWorkspaceSupportDiagnostics(supportContext, "ws_alpha");

            // 1. Workspace & Org Configuration
            expect(res.configuration).toEqual({
                id: "ws_alpha",
                name: "Alpha Corp Workspace",
                slug: "alpha-corp",
                timezone: "America/New_York",
                defaultCurrencyCode: "USD",
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
                organization: {
                    id: "org_alpha",
                    businessName: "Alpha Corporation LLC",
                    legalName: "Alpha Corporation LLC",
                    logoUrl: "https://cdn.aforden.com/alpha_logo.png",
                    email: "support@alphacorp.com",
                    phone: "+1-800-555-0199",
                    status: "ACTIVE",
                },
            });

            // 2. Memberships
            expect(res.memberships.totalMembers).toBe(2);
            expect(res.memberships.roleBreakdown).toEqual({ OWNER: 1, TECHNICIAN: 1 });
            expect(res.memberships.statusBreakdown).toEqual({ ACTIVE: 2 });
            expect(res.memberships.members).toHaveLength(2);

            // 3. Operational Counts & Status Breakdown
            expect(res.operationalMetadata.counts).toEqual({
                customers: 42,
                workOrders: 150,
                assets: 88,
                invoices: 120,
                parts: 310,
                quotes: 25,
                scheduleAppointments: 95,
            });
            expect(res.operationalMetadata.workOrderStatusBreakdown).toEqual({
                COMPLETED: 100,
                IN_PROGRESS: 30,
                ASSIGNED: 20,
            });

            // 4. Queue Statuses (Outbox & Automation Executions)
            expect(res.queueStatuses.notificationOutbox.total).toBe(452);
            expect(res.queueStatuses.notificationOutbox.statusBreakdown).toEqual({ SENT: 450, FAILED: 2 });
            expect(res.queueStatuses.automationExecutions.total).toBe(81);
            expect(res.queueStatuses.automationExecutions.statusBreakdown).toEqual({ COMPLETED: 80, FAILED: 1 });

            // 5. Integration Connection Statuses
            expect(res.integrationStatuses.totalConnections).toBe(1);
            expect(res.integrationStatuses.statusBreakdown).toEqual({ CONNECTED: 1 });
            expect(res.integrationStatuses.activeConnections).toHaveLength(1);
            expect(res.integrationStatuses.activeConnections[0].externalAccountName).toBe("Alpha Corp Stripe Acct");
        });

        it("throws PlatformWorkspaceSupportNotFoundError when target workspace does not exist", async () => {
            workspaceFindUniqueMock.mockResolvedValueOnce(null);
            const supportContext = createMockPlatformContext(PlatformRole.PLATFORM_SUPPORT, "usr_support_1");

            await expect(
                getWorkspaceSupportDiagnostics(supportContext, "ws_nonexistent")
            ).rejects.toThrow(PlatformWorkspaceSupportNotFoundError);
        });
    });
});
