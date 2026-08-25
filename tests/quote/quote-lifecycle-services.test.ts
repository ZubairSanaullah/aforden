import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    sendQuote,
    approveQuote,
    rejectQuote,
    reviseQuote,
    evaluateQuoteExpiration,
    QuoteNotFoundError,
    QuoteStatusConflictError,
    QuoteEmptyLineItemsError,
    QuoteExpiredError,
    MissingRejectionReasonError,
} from "@/lib/services/quote";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        quoteFindFirst: vi.fn(),
        quoteFindMany: vi.fn(),
        quoteUpdate: vi.fn(),
        quoteHistoryCreate: vi.fn(),
        $transaction: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        quote: {
            findFirst: mocks.quoteFindFirst,
            findMany: mocks.quoteFindMany,
            update: mocks.quoteUpdate,
        },
        quoteHistory: {
            create: mocks.quoteHistoryCreate,
        },
        $transaction: mocks.$transaction,
    },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: vi.fn(),
}));

describe("Phase 1.11.7 — Quote Lifecycle Transition Services", () => {
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

    const managerActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_mgr_01",
            role: "MANAGER",
            status: "ACTIVE",
        },
        user: {
            id: "usr_mgr_01",
            name: "Manager User",
            email: "mgr@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: adminActor.workspace,
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

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days in future
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days in past

    const mockQuoteDraft = {
        id: QUOTE_ID,
        workspaceId: WS_ID,
        quoteNumber: "Q-2026-000001",
        customerId: CUST_ID,
        locationId: null,
        status: "DRAFT",
        title: "Initial AC Repair",
        description: "Draft estimate",
        internalNotes: null,
        termsAndConditions: null,
        currencyCode: "USD",
        validUntil: futureDate,
        subtotal: new Prisma.Decimal("100.00"),
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal("0.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        taxRate: new Prisma.Decimal("0.0000"),
        taxAmount: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("100.00"),
        sentAt: null,
        approvedAt: null,
        approvedByCustomerName: null,
        rejectedAt: null,
        rejectionReason: null,
        convertedAt: null,
        convertedWorkOrderId: null,
        convertedByMemberId: null,
        createdAt: new Date("2026-08-25T00:00:00Z"),
        updatedAt: new Date("2026-08-25T00:00:00Z"),
        lineItems: [
            {
                id: "line_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "CUSTOM",
                workTypeId: null,
                partId: null,
                name: "Initial Diagnostic",
                description: null,
                workTypeName: null,
                workTypeCode: null,
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("100.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("100.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("100.00"),
                sortOrder: 0,
                createdAt: new Date("2026-08-25T00:00:00Z"),
                updatedAt: new Date("2026-08-25T00:00:00Z"),
            },
        ],
    };

    const mockQuotePending = {
        ...mockQuoteDraft,
        status: "PENDING_APPROVAL",
        sentAt: new Date("2026-08-25T01:00:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.quoteHistoryCreate.mockResolvedValue({});
        mocks.quoteUpdate.mockResolvedValue(mockQuoteDraft);

        mocks.$transaction.mockImplementation(async (cb: any) => {
            const tx = {
                quote: {
                    update: mocks.quoteUpdate,
                },
                quoteHistory: {
                    create: mocks.quoteHistoryCreate,
                },
            };
            return cb(tx);
        });
    });

    // ==========================================
    // 1. sendQuote
    // ==========================================
    describe("1. sendQuote", () => {
        it("rejects unauthorized actor without quotes.send permission (e.g. TECHNICIAN)", async () => {
            await expect(
                sendQuote(WS_ID, QUOTE_ID, {}, techActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows DISPATCHER with quotes.send permission to send quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                status: "PENDING_APPROVAL",
                sentAt: new Date(),
            });

            const result = await sendQuote(WS_ID, QUOTE_ID, { notes: "Sending to client" }, dispatcherActor);
            expect(result.status).toBe("PENDING_APPROVAL");
            expect(result.sentAt).toBeDefined();
        });

        it("throws QuoteNotFoundError if quote does not exist", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                sendQuote(WS_ID, "quote_missing", {}, adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("throws QuoteStatusConflictError if quote is not in DRAFT status", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                status: "PENDING_APPROVAL",
            });

            await expect(
                sendQuote(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteEmptyLineItemsError when quote has 0 line items", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                lineItems: [],
            });

            await expect(
                sendQuote(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteEmptyLineItemsError);
        });

        it("rejects quote when validUntil is unset", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                validUntil: null,
            });

            await expect(
                sendQuote(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(/validUntil/i);
        });

        it("throws QuoteExpiredError when validUntil is in the past", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                validUntil: pastDate,
            });

            await expect(
                sendQuote(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteExpiredError);
        });

        it("transitions DRAFT -> PENDING_APPROVAL, sets sentAt, and records SENT history", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                status: "PENDING_APPROVAL",
                sentAt: new Date("2026-08-25T10:00:00Z"),
            });

            const result = await sendQuote(
                WS_ID,
                QUOTE_ID,
                { notes: "Customer requested expedited review" },
                adminActor,
            );

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
                data: {
                    status: "PENDING_APPROVAL",
                    sentAt: expect.any(Date),
                },
                include: expect.any(Object),
            });

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: QUOTE_ID,
                    workspaceId: WS_ID,
                    eventType: "SENT",
                    actorMemberId: adminActor.membership.id,
                    field: "status",
                    oldValue: "DRAFT",
                    newValue: "PENDING_APPROVAL",
                    metadata: expect.objectContaining({
                        notes: "Customer requested expedited review",
                        lineItemCount: 1,
                    }),
                }),
            });

            expect(result.status).toBe("PENDING_APPROVAL");
        });
    });

    // ==========================================
    // 2. approveQuote
    // ==========================================
    describe("2. approveQuote", () => {
        it("rejects DISPATCHER without quotes.approve permission", async () => {
            await expect(
                approveQuote(WS_ID, QUOTE_ID, {}, dispatcherActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows MANAGER with quotes.approve permission to approve", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "APPROVED",
                approvedAt: new Date(),
                approvedByCustomerName: "John Doe",
            });

            const result = await approveQuote(
                WS_ID,
                QUOTE_ID,
                { approvedByCustomerName: "John Doe" },
                managerActor,
            );
            expect(result.status).toBe("APPROVED");
        });

        it("throws QuoteNotFoundError if quote is missing", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                approveQuote(WS_ID, "quote_missing", {}, adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("throws QuoteStatusConflictError if quote is not PENDING_APPROVAL (e.g. DRAFT or APPROVED)", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft); // Status is DRAFT

            await expect(
                approveQuote(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteExpiredError when approving a quote whose validUntil has elapsed", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuotePending,
                validUntil: pastDate,
            });

            await expect(
                approveQuote(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteExpiredError);
        });

        it("transitions PENDING_APPROVAL -> APPROVED and writes APPROVED history", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "APPROVED",
                approvedAt: new Date("2026-08-25T11:00:00Z"),
                approvedByCustomerName: "Jane Smith",
            });

            const result = await approveQuote(
                WS_ID,
                QUOTE_ID,
                {
                    approvedByCustomerName: "Jane Smith",
                    notes: "Signed proposal via phone authorization",
                },
                adminActor,
            );

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
                data: {
                    status: "APPROVED",
                    approvedAt: expect.any(Date),
                    approvedByCustomerName: "Jane Smith",
                },
                include: expect.any(Object),
            });

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: QUOTE_ID,
                    eventType: "APPROVED",
                    field: "status",
                    oldValue: "PENDING_APPROVAL",
                    newValue: "APPROVED",
                    metadata: expect.objectContaining({
                        approvedByCustomerName: "Jane Smith",
                        notes: "Signed proposal via phone authorization",
                    }),
                }),
            });

            expect(result.status).toBe("APPROVED");
            expect(result.approvedByCustomerName).toBe("Jane Smith");
        });
    });

    // ==========================================
    // 3. rejectQuote
    // ==========================================
    describe("3. rejectQuote", () => {
        it("rejects DISPATCHER without quotes.reject permission", async () => {
            await expect(
                rejectQuote(
                    WS_ID,
                    QUOTE_ID,
                    { rejectionReason: "Too expensive" },
                    dispatcherActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows MANAGER with quotes.reject permission to reject", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "REJECTED",
                rejectedAt: new Date(),
                rejectionReason: "Client chose another vendor",
            });

            const result = await rejectQuote(
                WS_ID,
                QUOTE_ID,
                { rejectionReason: "Client chose another vendor" },
                managerActor,
            );
            expect(result.status).toBe("REJECTED");
        });

        it("throws QuoteStatusConflictError if quote is not PENDING_APPROVAL", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);

            await expect(
                rejectQuote(
                    WS_ID,
                    QUOTE_ID,
                    { rejectionReason: "No budget" },
                    adminActor,
                ),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws MissingRejectionReasonError when rejectionReason is missing or empty", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);

            await expect(
                rejectQuote(WS_ID, QUOTE_ID, { rejectionReason: "" }, adminActor),
            ).rejects.toThrow(MissingRejectionReasonError);

            await expect(
                rejectQuote(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(MissingRejectionReasonError);
        });

        it("transitions PENDING_APPROVAL -> REJECTED and records REJECTED history", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "REJECTED",
                rejectedAt: new Date("2026-08-25T12:00:00Z"),
                rejectionReason: "Scope too broad for immediate budget",
            });

            const result = await rejectQuote(
                WS_ID,
                QUOTE_ID,
                { rejectionReason: "Scope too broad for immediate budget" },
                adminActor,
            );

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
                data: {
                    status: "REJECTED",
                    rejectedAt: expect.any(Date),
                    rejectionReason: "Scope too broad for immediate budget",
                },
                include: expect.any(Object),
            });

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: QUOTE_ID,
                    eventType: "REJECTED",
                    field: "status",
                    oldValue: "PENDING_APPROVAL",
                    newValue: "REJECTED",
                    metadata: expect.objectContaining({
                        rejectionReason: "Scope too broad for immediate budget",
                    }),
                }),
            });

            expect(result.status).toBe("REJECTED");
            expect(result.rejectionReason).toBe("Scope too broad for immediate budget");
        });
    });

    // ==========================================
    // 4. reviseQuote
    // ==========================================
    describe("4. reviseQuote", () => {
        it("rejects TECHNICIAN without quotes.update permission", async () => {
            await expect(
                reviseQuote(WS_ID, QUOTE_ID, techActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows DISPATCHER with quotes.update permission to revise quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "DRAFT",
                sentAt: null,
            });

            const result = await reviseQuote(WS_ID, QUOTE_ID, dispatcherActor);
            expect(result.status).toBe("DRAFT");
            expect(result.sentAt).toBeNull();
        });

        it("throws QuoteNotFoundError if quote is missing", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                reviseQuote(WS_ID, "quote_missing", adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("throws QuoteStatusConflictError if quote is not PENDING_APPROVAL (e.g. DRAFT or REJECTED)", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft); // Already DRAFT

            await expect(
                reviseQuote(WS_ID, QUOTE_ID, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);

            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                status: "REJECTED",
            });

            await expect(
                reviseQuote(WS_ID, QUOTE_ID, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("transitions PENDING_APPROVAL -> DRAFT, clears sentAt, and writes UPDATED history", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "DRAFT",
                sentAt: null,
            });

            const result = await reviseQuote(WS_ID, QUOTE_ID, adminActor);

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
                data: {
                    status: "DRAFT",
                    sentAt: null,
                },
                include: expect.any(Object),
            });

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: QUOTE_ID,
                    eventType: "UPDATED",
                    field: "status",
                    oldValue: "PENDING_APPROVAL",
                    newValue: "DRAFT",
                    metadata: expect.objectContaining({
                        action: "REVISED",
                    }),
                }),
            });

            expect(result.status).toBe("DRAFT");
            expect(result.sentAt).toBeNull();
        });
    });

    // ==========================================
    // 5. evaluateQuoteExpiration (System Batch)
    // ==========================================
    describe("5. evaluateQuoteExpiration", () => {
        it("transitions qualifying past-due PENDING_APPROVAL quotes to EXPIRED with system audit", async () => {
            const expiredQuote1 = {
                id: "quote_exp_01",
                workspaceId: WS_ID,
                quoteNumber: "Q-2026-000010",
                validUntil: pastDate,
            };
            const expiredQuote2 = {
                id: "quote_exp_02",
                workspaceId: WS_ID,
                quoteNumber: "Q-2026-000011",
                validUntil: pastDate,
            };

            mocks.quoteFindMany.mockResolvedValue([expiredQuote1, expiredQuote2]);

            const result = await evaluateQuoteExpiration(WS_ID);

            expect(mocks.quoteFindMany).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    status: "PENDING_APPROVAL",
                    validUntil: expect.objectContaining({
                        lt: expect.any(Date),
                    }),
                    workspaceId: WS_ID,
                }),
                select: expect.any(Object),
            });

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: "quote_exp_01" },
                data: { status: "EXPIRED" },
            });

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: "quote_exp_02" },
                data: { status: "EXPIRED" },
            });

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: "quote_exp_01",
                    eventType: "EXPIRED",
                    actorMemberId: null,
                    actorName: null,
                    field: "status",
                    oldValue: "PENDING_APPROVAL",
                    newValue: "EXPIRED",
                    metadata: expect.objectContaining({
                        system: true,
                        reason: "Quote validity period expired",
                    }),
                }),
            });

            expect(result.evaluatedCount).toBe(2);
            expect(result.expiredCount).toBe(2);
            expect(result.expiredQuoteIds).toEqual(["quote_exp_01", "quote_exp_02"]);
        });

        it("returns 0 expired count when no quotes are past due", async () => {
            mocks.quoteFindMany.mockResolvedValue([]);

            const result = await evaluateQuoteExpiration();

            expect(result.evaluatedCount).toBe(0);
            expect(result.expiredCount).toBe(0);
            expect(result.expiredQuoteIds).toHaveLength(0);
            expect(mocks.quoteUpdate).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // 6. Full Lifecycle Walk
    // ==========================================
    describe("6. Full Lifecycle Walk", () => {
        it("completes full happy path: DRAFT -> PENDING_APPROVAL -> APPROVED", async () => {
            // 1. Send
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.quoteUpdate.mockResolvedValue(mockQuotePending);
            const sent = await sendQuote(WS_ID, QUOTE_ID, {}, adminActor);
            expect(sent.status).toBe("PENDING_APPROVAL");

            // 2. Approve
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "APPROVED",
                approvedAt: new Date(),
                approvedByCustomerName: "Client A",
            });
            const approved = await approveQuote(WS_ID, QUOTE_ID, { approvedByCustomerName: "Client A" }, adminActor);
            expect(approved.status).toBe("APPROVED");
        });

        it("completes revision loop: DRAFT -> PENDING_APPROVAL -> DRAFT -> PENDING_APPROVAL -> REJECTED", async () => {
            // 1. Send
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.quoteUpdate.mockResolvedValue(mockQuotePending);
            const sent = await sendQuote(WS_ID, QUOTE_ID, {}, adminActor);
            expect(sent.status).toBe("PENDING_APPROVAL");

            // 2. Revise back to DRAFT
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue(mockQuoteDraft);
            const revised = await reviseQuote(WS_ID, QUOTE_ID, adminActor);
            expect(revised.status).toBe("DRAFT");

            // 3. Send again
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.quoteUpdate.mockResolvedValue(mockQuotePending);
            const resent = await sendQuote(WS_ID, QUOTE_ID, {}, adminActor);
            expect(resent.status).toBe("PENDING_APPROVAL");

            // 4. Reject
            mocks.quoteFindFirst.mockResolvedValue(mockQuotePending);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuotePending,
                status: "REJECTED",
                rejectedAt: new Date(),
                rejectionReason: "Too costly",
            });
            const rejected = await rejectQuote(WS_ID, QUOTE_ID, { rejectionReason: "Too costly" }, adminActor);
            expect(rejected.status).toBe("REJECTED");
        });
    });
});
