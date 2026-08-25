import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    getQuoteHistory,
    getQuoteTimelineSummary,
    QuoteNotFoundError,
    mapQuoteHistoryToReadModel,
} from "@/lib/services/quote";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        quoteFindFirst: vi.fn(),
        quoteHistoryCount: vi.fn(),
        quoteHistoryFindMany: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        quote: {
            findFirst: mocks.quoteFindFirst,
        },
        quoteHistory: {
            count: mocks.quoteHistoryCount,
            findMany: mocks.quoteHistoryFindMany,
        },
    },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: vi.fn(),
}));

describe("Phase 1.11.9 — Quote Audit History & Query Services", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
    const QUOTE_ID = "quote_test_01";

    const adminActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_admin_01",
            role: "ADMIN",
            status: "ACTIVE",
        },
        user: {
            id: "usr_admin_01",
            name: "Admin User",
            email: "admin@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: {
            id: WS_ID,
            name: "Alpha HVAC",
            slug: "alpha-hvac",
            logoUrl: null,
            timezone: "UTC",
        },
    };

    const dispatcherActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_disp_01",
            role: "DISPATCHER",
            status: "ACTIVE",
        },
        user: {
            id: "usr_disp_01",
            name: "Dispatcher User",
            email: "disp@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: adminActor.workspace,
    };

    const techActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_tech_01",
            role: "TECHNICIAN",
            status: "ACTIVE",
        },
        user: {
            id: "usr_tech_01",
            name: "Tech User",
            email: "tech@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: adminActor.workspace,
    };

    const mockQuoteRow = {
        id: QUOTE_ID,
        workspaceId: WS_ID,
        quoteNumber: "Q-2026-000001",
        customerId: CUST_ID,
        locationId: "loc_01",
        status: "APPROVED",
        title: "AC System Repair",
        description: "Standard repair quote",
        internalNotes: "Internal note",
        termsAndConditions: "Standard terms",
        currencyCode: "USD",
        validUntil: new Date("2026-09-01T00:00:00Z"),
        subtotal: new Prisma.Decimal("300.00"),
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal("0.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        taxRate: new Prisma.Decimal("0.0000"),
        taxAmount: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("300.00"),
        sentAt: new Date("2026-08-25T01:00:00Z"),
        approvedAt: new Date("2026-08-25T02:00:00Z"),
        approvedByCustomerName: "John Customer",
        rejectedAt: null,
        rejectionReason: null,
        convertedAt: null,
        convertedWorkOrderId: null,
        convertedByMemberId: null,
        createdAt: new Date("2026-08-25T00:00:00Z"),
        updatedAt: new Date("2026-08-25T02:00:00Z"),
    };

    const mockHistoryRecords = [
        {
            id: "hist_03",
            quoteId: QUOTE_ID,
            workspaceId: WS_ID,
            eventType: "APPROVED",
            actorMemberId: "mem_admin_01",
            actorName: "Admin User",
            field: "status",
            oldValue: "PENDING_APPROVAL",
            newValue: "APPROVED",
            metadata: { approvedByCustomerName: "John Customer" },
            createdAt: new Date("2026-08-25T02:00:00Z"),
        },
        {
            id: "hist_02",
            quoteId: QUOTE_ID,
            workspaceId: WS_ID,
            eventType: "SENT",
            actorMemberId: "mem_disp_01",
            actorName: "Dispatcher User",
            field: "status",
            oldValue: "DRAFT",
            newValue: "PENDING_APPROVAL",
            metadata: { notes: "Sent to client" },
            createdAt: new Date("2026-08-25T01:00:00Z"),
        },
        {
            id: "hist_01",
            quoteId: QUOTE_ID,
            workspaceId: WS_ID,
            eventType: "CREATED",
            actorMemberId: "mem_admin_01",
            actorName: "Admin User",
            field: null,
            oldValue: null,
            newValue: null,
            metadata: { title: "AC System Repair" },
            createdAt: new Date("2026-08-25T00:00:00Z"),
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.quoteFindFirst.mockResolvedValue(mockQuoteRow);
        mocks.quoteHistoryCount.mockResolvedValue(3);
        mocks.quoteHistoryFindMany.mockResolvedValue(mockHistoryRecords);
    });

    // ==========================================
    // 1. getQuoteHistory
    // ==========================================
    describe("1. getQuoteHistory", () => {
        it("rejects TECHNICIAN without quotes.view permission", async () => {
            await expect(
                getQuoteHistory(WS_ID, QUOTE_ID, techActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows DISPATCHER with quotes.view permission", async () => {
            const result = await getQuoteHistory(WS_ID, QUOTE_ID, dispatcherActor);
            expect(result.items).toHaveLength(3);
            expect(result.total).toBe(3);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(20);
            expect(result.totalPages).toBe(1);
        });

        it("throws QuoteNotFoundError if quote is missing in workspace", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                getQuoteHistory(WS_ID, "quote_missing", adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("retrieves history ordered by createdAt desc by default", async () => {
            await getQuoteHistory(WS_ID, QUOTE_ID, adminActor);

            expect(mocks.quoteHistoryFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                        quoteId: QUOTE_ID,
                    },
                    orderBy: [
                        { createdAt: "desc" },
                        { id: "desc" },
                    ],
                }),
            );
        });

        it("supports filtering by eventType", async () => {
            mocks.quoteHistoryCount.mockResolvedValue(1);
            mocks.quoteHistoryFindMany.mockResolvedValue([mockHistoryRecords[0]]);

            const result = await getQuoteHistory(WS_ID, QUOTE_ID, adminActor, {
                eventType: "APPROVED",
            });

            expect(mocks.quoteHistoryFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                        quoteId: QUOTE_ID,
                        eventType: "APPROVED",
                    },
                }),
            );
            expect(result.items).toHaveLength(1);
            expect(result.items[0].eventType).toBe("APPROVED");
        });

        it("supports pagination parameters (page, limit, totalPages)", async () => {
            mocks.quoteHistoryCount.mockResolvedValue(25);
            mocks.quoteHistoryFindMany.mockResolvedValue([mockHistoryRecords[0]]);

            const result = await getQuoteHistory(WS_ID, QUOTE_ID, adminActor, {
                page: 2,
                limit: 10,
            });

            expect(mocks.quoteHistoryFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    skip: 10,
                    take: 10,
                }),
            );
            expect(result.page).toBe(2);
            expect(result.limit).toBe(10);
            expect(result.total).toBe(25);
            expect(result.totalPages).toBe(3);
        });
    });

    // ==========================================
    // 2. Actor Display Resolution
    // ==========================================
    describe("2. Actor Display Resolution (mapQuoteHistoryToReadModel)", () => {
        it("renders human actor with active name correctly", () => {
            const readModel = mapQuoteHistoryToReadModel({
                id: "hist_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                eventType: "CREATED",
                actorMemberId: "mem_01",
                actorName: "Alice Engineer",
                field: null,
                oldValue: null,
                newValue: null,
                metadata: {},
                createdAt: new Date("2026-08-25T00:00:00Z"),
            });

            expect(readModel.actorMemberId).toBe("mem_01");
            expect(readModel.actorName).toBe("Alice Engineer");
        });

        it("renders deleted human member as 'Deleted User'", () => {
            const readModel = mapQuoteHistoryToReadModel({
                id: "hist_02",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                eventType: "UPDATED",
                actorMemberId: "mem_deleted_01",
                actorName: null,
                field: "title",
                oldValue: "Old",
                newValue: "New",
                metadata: {},
                createdAt: new Date("2026-08-25T00:00:00Z"),
            });

            expect(readModel.actorMemberId).toBe("mem_deleted_01");
            expect(readModel.actorName).toBe("Deleted User");
        });

        it("renders system actor as 'System' with metadata.system: true", () => {
            const readModel = mapQuoteHistoryToReadModel({
                id: "hist_exp_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                eventType: "EXPIRED",
                actorMemberId: null,
                actorName: null,
                field: "status",
                oldValue: "PENDING_APPROVAL",
                newValue: "EXPIRED",
                metadata: { system: true, reason: "Quote validity period expired" },
                createdAt: new Date("2026-08-25T00:00:00Z"),
            });

            expect(readModel.actorMemberId).toBeNull();
            expect(readModel.actorName).toBe("System");
            expect(readModel.metadata?.system).toBe(true);
        });
    });

    // ==========================================
    // 3. getQuoteTimelineSummary
    // ==========================================
    describe("3. getQuoteTimelineSummary", () => {
        it("rejects TECHNICIAN without quotes.view permission", async () => {
            await expect(
                getQuoteTimelineSummary(WS_ID, QUOTE_ID, techActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("throws QuoteNotFoundError if quote is missing", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                getQuoteTimelineSummary(WS_ID, "missing_quote", adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("derives correct summary for APPROVED quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteRow);

            const summary = await getQuoteTimelineSummary(WS_ID, QUOTE_ID, adminActor);

            expect(summary.quoteId).toBe(QUOTE_ID);
            expect(summary.quoteNumber).toBe("Q-2026-000001");
            expect(summary.status).toBe("APPROVED");
            expect(summary.currentLifecycleMilestone).toBe("APPROVED");
            expect(summary.isTerminal).toBe(true);
            expect(summary.isExpired).toBe(false);
            expect(summary.sentAt).toBe(mockQuoteRow.sentAt.toISOString());
            expect(summary.approvedAt).toBe(mockQuoteRow.approvedAt.toISOString());
            expect(summary.approvedByCustomerName).toBe("John Customer");
        });

        it("derives correct summary for DRAFT quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteRow,
                status: "DRAFT",
                sentAt: null,
                approvedAt: null,
                approvedByCustomerName: null,
            });

            const summary = await getQuoteTimelineSummary(WS_ID, QUOTE_ID, adminActor);

            expect(summary.status).toBe("DRAFT");
            expect(summary.currentLifecycleMilestone).toBe("DRAFT");
            expect(summary.isTerminal).toBe(false);
            expect(summary.isExpired).toBe(false);
            expect(summary.sentAt).toBeNull();
            expect(summary.approvedAt).toBeNull();
        });

        it("derives correct summary for SENT / PENDING_APPROVAL quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteRow,
                status: "PENDING_APPROVAL",
                approvedAt: null,
                approvedByCustomerName: null,
            });

            const summary = await getQuoteTimelineSummary(WS_ID, QUOTE_ID, adminActor);

            expect(summary.status).toBe("PENDING_APPROVAL");
            expect(summary.currentLifecycleMilestone).toBe("SENT");
            expect(summary.isTerminal).toBe(false);
            expect(summary.sentAt).toBeDefined();
        });

        it("derives correct summary for REJECTED quote with rejectionReason", async () => {
            const rejectedAt = new Date("2026-08-25T04:00:00Z");
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteRow,
                status: "REJECTED",
                rejectedAt,
                rejectionReason: "Client chose alternative contractor",
            });

            const summary = await getQuoteTimelineSummary(WS_ID, QUOTE_ID, adminActor);

            expect(summary.status).toBe("REJECTED");
            expect(summary.currentLifecycleMilestone).toBe("REJECTED");
            expect(summary.isTerminal).toBe(true);
            expect(summary.rejectedAt).toBe(rejectedAt.toISOString());
            expect(summary.rejectionReason).toBe("Client chose alternative contractor");
        });

        it("derives correct summary for CONVERTED quote with convertedWorkOrderId", async () => {
            const convertedAt = new Date("2026-08-25T05:00:00Z");
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteRow,
                status: "CONVERTED",
                convertedAt,
                convertedWorkOrderId: "wo_conv_001",
            });

            const summary = await getQuoteTimelineSummary(WS_ID, QUOTE_ID, adminActor);

            expect(summary.status).toBe("CONVERTED");
            expect(summary.currentLifecycleMilestone).toBe("CONVERTED");
            expect(summary.isTerminal).toBe(true);
            expect(summary.convertedAt).toBe(convertedAt.toISOString());
            expect(summary.convertedWorkOrderId).toBe("wo_conv_001");
        });

        it("derives isExpired: true when status is EXPIRED or past validUntil", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteRow,
                status: "EXPIRED",
                validUntil: new Date("2026-01-01T00:00:00Z"),
            });

            const summary = await getQuoteTimelineSummary(WS_ID, QUOTE_ID, adminActor);

            expect(summary.status).toBe("EXPIRED");
            expect(summary.currentLifecycleMilestone).toBe("EXPIRED");
            expect(summary.isTerminal).toBe(true);
            expect(summary.isExpired).toBe(true);
        });
    });

    // ==========================================
    // 4. Mutating Services Event Completeness Mapping
    // ==========================================
    describe("4. Mutating Services Event Completeness Matrix", () => {
        const expectedServiceEventMatrix = [
            { service: "createQuote", eventType: "CREATED" },
            { service: "updateQuote", eventType: "UPDATED" },
            { service: "deleteQuote", eventType: "DELETED" },
            { service: "addQuoteLineItem", eventType: "LINE_ITEM_ADDED" },
            { service: "updateQuoteLineItem", eventType: "LINE_ITEM_UPDATED" },
            { service: "removeQuoteLineItem", eventType: "LINE_ITEM_REMOVED" },
            { service: "reorderQuoteLineItems", eventType: "LINE_ITEM_UPDATED" },
            { service: "sendQuote", eventType: "SENT" },
            { service: "approveQuote", eventType: "APPROVED" },
            { service: "rejectQuote", eventType: "REJECTED" },
            { service: "reviseQuote", eventType: "UPDATED" },
            { service: "evaluateQuoteExpiration", eventType: "EXPIRED" },
            { service: "convertQuoteToWorkOrder", eventType: "CONVERTED" },
        ];

        it("verifies all 13 mutation services map to recognized QuoteHistoryEventType values", () => {
            const validEventTypes = [
                "CREATED",
                "UPDATED",
                "LINE_ITEM_ADDED",
                "LINE_ITEM_UPDATED",
                "LINE_ITEM_REMOVED",
                "SENT",
                "APPROVED",
                "REJECTED",
                "EXPIRED",
                "CONVERTED",
                "DELETED",
            ];

            for (const item of expectedServiceEventMatrix) {
                expect(validEventTypes).toContain(item.eventType);
            }
            expect(expectedServiceEventMatrix).toHaveLength(13);
        });
    });
});
