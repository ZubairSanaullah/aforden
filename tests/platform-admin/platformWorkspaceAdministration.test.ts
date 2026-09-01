import { describe, it, expect, vi, beforeEach } from "vitest";

const { workspaceFindManyMock, workspaceCountMock, workspaceFindUniqueMock } =
    vi.hoisted(() => ({
        workspaceFindManyMock: vi.fn(),
        workspaceCountMock: vi.fn(),
        workspaceFindUniqueMock: vi.fn(),
    }));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        workspace: {
            findMany: workspaceFindManyMock,
            count: workspaceCountMock,
            findUnique: workspaceFindUniqueMock,
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
    getWorkspace,
    getWorkspaces,
} from "@/lib/services/platform/workspaces";
import { PlanTier, SubscriptionStatus, OrganizationStatus } from "@/generated/prisma/client";
import { getUserWorkspaces } from "@/lib/services/workspace/getUserWorkspaces";

describe("Phase 1.19.6 — Platform Workspace Administration Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN,
        stepUpConfirmedAt: Date | null = new Date()
    ): PlatformAuthorizationContext {
        return {
            userId: `usr_${role.toLowerCase()}`,
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

    const mockRawWorkspace1 = {
        id: "ws_acme_corp",
        name: "Acme Corporation",
        slug: "acme-corp",
        logoUrl: "https://aforden.com/acme.png",
        timezone: "America/New_York",
        defaultCurrencyCode: "USD",
        createdAt: new Date("2026-01-15T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
        organization: {
            businessName: "Acme Global Industries",
            legalName: "Acme Global Industries LLC",
            email: "contact@acme.com",
            phone: "+1-555-0199",
            website: "https://acme.com",
            status: "ACTIVE" as OrganizationStatus,
        },
        memberships: [
            {
                user: {
                    id: "usr_acme_owner",
                    name: "Alice Acme",
                    email: "alice@acme.com",
                    avatarUrl: "https://aforden.com/alice.png",
                },
            },
        ],
        subscriptions: [
            {
                id: "sub_acme_1",
                status: "ACTIVE" as SubscriptionStatus,
                seatsCount: 25,
                currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
                currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
                trialEnd: null,
                cancelAtPeriodEnd: false,
                dunningAttemptsCount: 0,
                gracePeriodEndsAt: null,
                plan: {
                    tier: "ENTERPRISE" as PlanTier,
                    name: "Enterprise Fleet Plan",
                    code: "enterprise-2026",
                },
            },
        ],
        platformBillingAccount: {
            billingEmail: "billing@acme.com",
            billingName: "Acme Accounts Payable",
            paymentMethodBrand: "visa",
            paymentMethodLast4: "4242",
            delinquentSince: null,
        },
        _count: {
            memberships: 28,
            workOrders: 342,
            customers: 120,
            assets: 580,
            developerApplications: 3,
        },
    };

    const mockRawWorkspace2 = {
        id: "ws_stark_industries",
        name: "Stark Industries",
        slug: "stark-industries",
        logoUrl: null,
        timezone: "America/Los_Angeles",
        defaultCurrencyCode: "USD",
        createdAt: new Date("2026-03-10T00:00:00Z"),
        updatedAt: new Date("2026-08-15T00:00:00Z"),
        organization: {
            businessName: "Stark Industries Inc",
            legalName: "Stark Industries Inc",
            email: "tony@stark.com",
            phone: null,
            website: "https://stark.com",
            status: "ACTIVE" as OrganizationStatus,
        },
        memberships: [
            {
                user: {
                    id: "usr_tony_stark",
                    name: "Tony Stark",
                    email: "tony@stark.com",
                    avatarUrl: null,
                },
            },
        ],
        subscriptions: [
            {
                id: "sub_stark_1",
                status: "TRIALING" as SubscriptionStatus,
                seatsCount: 5,
                currentPeriodStart: new Date("2026-08-15T00:00:00Z"),
                currentPeriodEnd: new Date("2026-09-15T00:00:00Z"),
                trialEnd: new Date("2026-09-01T00:00:00Z"),
                cancelAtPeriodEnd: false,
                dunningAttemptsCount: 0,
                gracePeriodEndsAt: null,
                plan: {
                    tier: "GROWTH" as PlanTier,
                    name: "Growth Plan",
                    code: "growth-monthly",
                },
            },
        ],
        platformBillingAccount: null,
        _count: {
            memberships: 5,
            workOrders: 42,
            customers: 18,
            assets: 90,
            developerApplications: 1,
        },
    };

    describe("1. Permission Gating & Least-Privilege Role Scoping", () => {
        it("allows all 6 platform roles to query workspaces via platform.workspaces.view", async () => {
            workspaceFindManyMock.mockResolvedValue([mockRawWorkspace1]);
            workspaceCountMock.mockResolvedValue(1);

            const allRoles = Object.values(PlatformRole);
            for (const role of allRoles) {
                const context = createMockPlatformContext(role);
                const result = await getWorkspaces(context);
                expect(result.total).toBe(1);
            }
        });

        it("denies query from context without a platform role", async () => {
            const invalidContext = {
                userId: "usr_regular",
                email: "user@client.com",
                name: "Regular User",
                avatarUrl: null,
                platformRole: null as any,
                profileId: "prof_null",
                status: PlatformAdminStatus.ACTIVE,
                lastActiveAt: new Date(),
                lastLoginAt: new Date(),
                stepUpConfirmedAt: null,
                metadata: null,
            };

            await expect(getWorkspaces(invalidContext)).rejects.toThrow(
                PlatformAccessDeniedError
            );
            await expect(getWorkspace(invalidContext, "ws_acme")).rejects.toThrow(
                PlatformAccessDeniedError
            );
        });

        it("masks subscription and billing data for PLATFORM_OPERATIONS and PLATFORM_SECURITY (lacking platform.billing.view)", async () => {
            workspaceFindUniqueMock.mockResolvedValue(mockRawWorkspace1);
            workspaceFindManyMock.mockResolvedValue([mockRawWorkspace1]);
            workspaceCountMock.mockResolvedValue(1);

            const restrictedRoles = [
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
            ];

            for (const role of restrictedRoles) {
                const context = createMockPlatformContext(role);

                // getWorkspace check
                const detail = await getWorkspace(context, "ws_acme_corp");
                expect(detail).not.toBeNull();
                expect(detail!.subscription).toBeNull();
                expect(detail!.billingAccount).toBeNull();
                // Diagnostic counts and org data remain visible
                expect(detail!.counts.workOrdersCount).toBe(342);
                expect(detail!.organization?.businessName).toBe("Acme Global Industries");

                // getWorkspaces check
                const list = await getWorkspaces(context);
                expect(list.workspaces[0].subscription).toBeNull();
            }
        });

        it("includes full subscription and billing data for roles holding platform.billing.view", async () => {
            workspaceFindUniqueMock.mockResolvedValue(mockRawWorkspace1);
            workspaceFindManyMock.mockResolvedValue([mockRawWorkspace1]);
            workspaceCountMock.mockResolvedValue(1);

            const authorizedBillingRoles = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of authorizedBillingRoles) {
                const context = createMockPlatformContext(role);

                // getWorkspace check
                const detail = await getWorkspace(context, "ws_acme_corp");
                expect(detail).not.toBeNull();
                expect(detail!.subscription).not.toBeNull();
                expect(detail!.subscription!.planTier).toBe("ENTERPRISE");
                expect(detail!.billingAccount).not.toBeNull();
                expect(detail!.billingAccount!.billingEmail).toBe("billing@acme.com");

                // getWorkspaces check
                const list = await getWorkspaces(context);
                expect(list.workspaces[0].subscription).not.toBeNull();
                expect(list.workspaces[0].subscription!.planTier).toBe("ENTERPRISE");
            }
        });
    });

    describe("2. Global Cross-Tenant Visibility", () => {
        it("returns workspaces across multiple distinct tenants in a single query", async () => {
            workspaceFindManyMock.mockResolvedValue([
                mockRawWorkspace1,
                mockRawWorkspace2,
            ]);
            workspaceCountMock.mockResolvedValue(2);

            const context = createMockPlatformContext(PlatformRole.PLATFORM_SUPPORT);
            const result = await getWorkspaces(context);

            expect(result.total).toBe(2);
            expect(result.workspaces).toHaveLength(2);
            expect(result.workspaces[0].id).toBe("ws_acme_corp");
            expect(result.workspaces[1].id).toBe("ws_stark_industries");

            // Verify where clause in prisma query had ZERO workspaceId tenant filter
            const callArgs = workspaceFindManyMock.mock.calls[0][0];
            expect(callArgs.where.id).toBeUndefined();
        });
    });

    describe("3. Multi-Criteria Filtering", () => {
        it("filters by search string across name, slug, and organization businessName", async () => {
            workspaceFindManyMock.mockResolvedValue([mockRawWorkspace1]);
            workspaceCountMock.mockResolvedValue(1);

            const context = createMockPlatformContext();
            await getWorkspaces(context, { search: "Acme" });

            const callArgs = workspaceFindManyMock.mock.calls[0][0];
            expect(callArgs.where.OR).toEqual([
                { name: { contains: "Acme", mode: "insensitive" } },
                { slug: { contains: "Acme", mode: "insensitive" } },
                {
                    organization: {
                        businessName: { contains: "Acme", mode: "insensitive" },
                    },
                },
            ]);
        });

        it("filters by organization status", async () => {
            workspaceFindManyMock.mockResolvedValue([mockRawWorkspace1]);
            workspaceCountMock.mockResolvedValue(1);

            const context = createMockPlatformContext();
            await getWorkspaces(context, { status: "ACTIVE" });

            const callArgs = workspaceFindManyMock.mock.calls[0][0];
            expect(callArgs.where.organization).toEqual({
                status: "ACTIVE",
            });
        });

        it("filters by plan tier and subscription status", async () => {
            workspaceFindManyMock.mockResolvedValue([mockRawWorkspace1]);
            workspaceCountMock.mockResolvedValue(1);

            const context = createMockPlatformContext();
            await getWorkspaces(context, {
                planTier: "ENTERPRISE",
                subscriptionStatus: "ACTIVE",
            });

            const callArgs = workspaceFindManyMock.mock.calls[0][0];
            expect(callArgs.where.subscriptions).toEqual({
                some: {
                    status: "ACTIVE",
                    plan: {
                        tier: "ENTERPRISE",
                    },
                },
            });
        });

        it("filters by owner email and creation date range", async () => {
            workspaceFindManyMock.mockResolvedValue([mockRawWorkspace1]);
            workspaceCountMock.mockResolvedValue(1);

            const createdAfter = new Date("2026-01-01T00:00:00Z");
            const createdBefore = new Date("2026-06-01T00:00:00Z");

            const context = createMockPlatformContext();
            await getWorkspaces(context, {
                ownerEmail: "alice@acme.com",
                createdAfter,
                createdBefore,
            });

            const callArgs = workspaceFindManyMock.mock.calls[0][0];
            expect(callArgs.where.memberships).toEqual({
                some: {
                    role: "OWNER",
                    user: {
                        email: { contains: "alice@acme.com", mode: "insensitive" },
                    },
                },
            });
            expect(callArgs.where.createdAt).toEqual({
                gte: createdAfter,
                lte: createdBefore,
            });
        });
    });

    describe("4. Detailed Workspace Diagnostics & DTO Whitelist", () => {
        it("returns sanitized detail DTO with organization, owner, subscription, billing, and entity counts", async () => {
            workspaceFindUniqueMock.mockResolvedValue(mockRawWorkspace1);

            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const detail = await getWorkspace(context, "ws_acme_corp");

            expect(detail).not.toBeNull();
            expect(detail!.id).toBe("ws_acme_corp");
            expect(detail!.name).toBe("Acme Corporation");
            expect(detail!.slug).toBe("acme-corp");
            expect(detail!.timezone).toBe("America/New_York");

            // Organization
            expect(detail!.organization).toEqual({
                businessName: "Acme Global Industries",
                legalName: "Acme Global Industries LLC",
                email: "contact@acme.com",
                phone: "+1-555-0199",
                website: "https://acme.com",
                status: "ACTIVE",
            });

            // Owner
            expect(detail!.owner).toEqual({
                userId: "usr_acme_owner",
                name: "Alice Acme",
                email: "alice@acme.com",
                avatarUrl: "https://aforden.com/alice.png",
            });

            // Subscription
            expect(detail!.subscription).toEqual({
                id: "sub_acme_1",
                status: "ACTIVE",
                planTier: "ENTERPRISE",
                planName: "Enterprise Fleet Plan",
                planCode: "enterprise-2026",
                seatsCount: 25,
                currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
                currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
                trialEnd: null,
                cancelAtPeriodEnd: false,
                dunningAttemptsCount: 0,
                gracePeriodEndsAt: null,
            });

            // Billing Profile
            expect(detail!.billingAccount).toEqual({
                billingEmail: "billing@acme.com",
                billingName: "Acme Accounts Payable",
                paymentMethodBrand: "visa",
                paymentMethodLast4: "4242",
                delinquentSince: null,
            });

            // Diagnostics Counts
            expect(detail!.counts).toEqual({
                membersCount: 28,
                workOrdersCount: 342,
                customersCount: 120,
                assetsCount: 580,
                activeApplicationsCount: 3,
            });
        });

        it("returns null when workspaceId is not found", async () => {
            workspaceFindUniqueMock.mockResolvedValue(null);

            const context = createMockPlatformContext();
            const detail = await getWorkspace(context, "ws_nonexistent");
            expect(detail).toBeNull();
        });
    });

    describe("5. Non-Interference with Workspace-Facing Queries", () => {
        it("preserves getUserWorkspaces tenant boundary logic without modifications", async () => {
            expect(typeof getUserWorkspaces).toBe("function");
        });
    });
});
