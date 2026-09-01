import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock functions
const {
    workspaceFindUniqueMock,
    organizationUpdateMock,
    organizationCreateMock,
    auditLogCreateMock,
    transactionMock,
    customerDeleteMock,
    workOrderDeleteMock,
    membershipDeleteMock,
    assetDeleteMock,
} = vi.hoisted(() => ({
    workspaceFindUniqueMock: vi.fn(),
    organizationUpdateMock: vi.fn(),
    organizationCreateMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    transactionMock: vi.fn(),
    customerDeleteMock: vi.fn(),
    workOrderDeleteMock: vi.fn(),
    membershipDeleteMock: vi.fn(),
    assetDeleteMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        workspace: {
            findUnique: workspaceFindUniqueMock,
        },
        organization: {
            update: organizationUpdateMock,
            create: organizationCreateMock,
        },
        platformAuditLog: {
            create: auditLogCreateMock,
        },
        customer: {
            delete: customerDeleteMock,
        },
        workOrder: {
            delete: workOrderDeleteMock,
        },
        workspaceMember: {
            delete: membershipDeleteMock,
        },
        asset: {
            delete: assetDeleteMock,
        },
        $transaction: transactionMock,
    },
}));

import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
    PlatformAccessDeniedError,
} from "@/lib/services/platform/authorization";
import {
    suspendWorkspace,
    reactivateWorkspace,
    validateDangerousActionReason,
    assertTier2StepUpAuthenticated,
    PlatformActionValidationError,
    PlatformWorkspaceNotFoundError,
    PlatformWorkspaceConflictError,
    MIN_JUSTIFICATION_REASON_LENGTH,
} from "@/lib/services/platform/workspaces";
import { PLATFORM_AUDIT_EVENTS } from "@/lib/services/platform/audit";
import { OrganizationStatus } from "@/generated/prisma/client";

describe("Phase 1.19.7 — Workspace Lifecycle Administration Suite", () => {
    let mockWorkspaceStore: any;

    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN
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
            stepUpConfirmedAt: new Date(),
            metadata: null,
        };
    }

    function createSeededWorkspace(orgStatus: OrganizationStatus = "ACTIVE") {
        return {
            id: "ws_acme_corp",
            name: "Acme Corporation",
            slug: "acme-corp",
            logoUrl: "https://aforden.com/acme.png",
            timezone: "America/New_York",
            defaultCurrencyCode: "USD",
            createdAt: new Date("2026-01-15T00:00:00Z"),
            updatedAt: new Date("2026-08-01T00:00:00Z"),
            organization: {
                id: "org_acme_1",
                workspaceId: "ws_acme_corp",
                businessName: "Acme Global Industries",
                legalName: "Acme Global Industries LLC",
                email: "contact@acme.com",
                phone: "+1-555-0199",
                website: "https://acme.com",
                status: orgStatus,
            },
            memberships: [
                {
                    user: {
                        id: "usr_acme_owner",
                        name: "Alice Acme",
                        email: "alice@acme.com",
                        avatarUrl: null,
                    },
                },
            ],
            subscriptions: [],
            platformBillingAccount: null,
            _count: {
                memberships: 15,
                workOrders: 142,
                customers: 65,
                assets: 230,
                developerApplications: 2,
            },
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockWorkspaceStore = createSeededWorkspace("ACTIVE");

        // Transaction mock simulates atomic execution with rollback on error
        transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
            const backup = JSON.parse(JSON.stringify(mockWorkspaceStore));
            const txClient = {
                workspace: {
                    findUnique: vi.fn().mockImplementation(async (args: any) => {
                        if (args?.where?.id === mockWorkspaceStore?.id) {
                            return mockWorkspaceStore;
                        }
                        return null;
                    }),
                },
                organization: {
                    update: vi.fn().mockImplementation(async (args: any) => {
                        organizationUpdateMock(args);
                        if (mockWorkspaceStore?.organization) {
                            mockWorkspaceStore.organization.status = args.data.status;
                        }
                        return mockWorkspaceStore?.organization;
                    }),
                    create: vi.fn().mockImplementation(async (args: any) => {
                        organizationCreateMock(args);
                        mockWorkspaceStore.organization = {
                            id: "org_new",
                            workspaceId: args.data.workspaceId,
                            businessName: args.data.businessName,
                            status: args.data.status,
                        };
                        return mockWorkspaceStore.organization;
                    }),
                },
                platformAuditLog: {
                    create: vi.fn().mockImplementation(async (args: any) => {
                        auditLogCreateMock(args);
                        return {
                            id: `audit_${Date.now()}`,
                            ...args.data,
                            createdAt: new Date(),
                        };
                    }),
                },
            };

            try {
                return await callback(txClient);
            } catch (err) {
                // Roll back state mutation on failure
                mockWorkspaceStore = backup;
                throw err;
            }
        });

        workspaceFindUniqueMock.mockImplementation(async (args: any) => {
            if (args?.where?.id === mockWorkspaceStore?.id) {
                return mockWorkspaceStore;
            }
            return null;
        });
    });

    describe("1. Permission Gating (platform.workspaces.suspend)", () => {
        it("allows PLATFORM_OWNER and PLATFORM_ADMIN to execute suspendWorkspace", async () => {
            const authorizedRoles = [
                PlatformRole.PLATFORM_OWNER,
                PlatformRole.PLATFORM_ADMIN,
            ];

            for (const role of authorizedRoles) {
                mockWorkspaceStore = createSeededWorkspace("ACTIVE");
                const context = createMockPlatformContext(role);
                const result = await suspendWorkspace(
                    context,
                    "ws_acme_corp",
                    "Suspension authorized for enterprise delinquent review."
                );
                expect(result.organization?.status).toBe("INACTIVE");
            }
        });

        it("denies suspendWorkspace for roles lacking platform.workspaces.suspend", async () => {
            const unauthorizedRoles = [
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of unauthorizedRoles) {
                const context = createMockPlatformContext(role);
                await expect(
                    suspendWorkspace(
                        context,
                        "ws_acme_corp",
                        "Attempting unauthorized workspace suspension."
                    )
                ).rejects.toThrow(PlatformAccessDeniedError);

                // Zero DB interactions should occur
                expect(transactionMock).not.toHaveBeenCalled();
            }
        });

        it("denies reactivateWorkspace for roles lacking platform.workspaces.suspend", async () => {
            mockWorkspaceStore = createSeededWorkspace("INACTIVE");
            const unauthorizedRoles = [
                PlatformRole.PLATFORM_SUPPORT,
                PlatformRole.PLATFORM_OPERATIONS,
                PlatformRole.PLATFORM_SECURITY,
                PlatformRole.PLATFORM_BILLING,
            ];

            for (const role of unauthorizedRoles) {
                const context = createMockPlatformContext(role);
                await expect(
                    reactivateWorkspace(
                        context,
                        "ws_acme_corp",
                        "Attempting unauthorized workspace reactivation."
                    )
                ).rejects.toThrow(PlatformAccessDeniedError);

                expect(transactionMock).not.toHaveBeenCalled();
            }
        });

        it("denies non-operator context with PlatformAccessDeniedError", async () => {
            const nonOperatorContext = {
                userId: "usr_member",
                email: "member@tenant.com",
                name: "Tenant Member",
                avatarUrl: null,
                platformRole: null as any,
                profileId: "prof_none",
                status: PlatformAdminStatus.ACTIVE,
                lastActiveAt: new Date(),
                lastLoginAt: new Date(),
                stepUpConfirmedAt: null,
                metadata: null,
            };

            await expect(
                suspendWorkspace(
                    nonOperatorContext,
                    "ws_acme_corp",
                    "Unauthorized call from non-platform context."
                )
            ).rejects.toThrow(PlatformAccessDeniedError);
        });
    });

    describe("2. Tier-2 Dangerous Action Reason Validation", () => {
        it("rejects reason shorter than 10 characters before executing any mutation", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            const shortReasons = ["short", "bad", "123456789", "         "];
            for (const reason of shortReasons) {
                await expect(
                    suspendWorkspace(context, "ws_acme_corp", reason)
                ).rejects.toThrow(PlatformActionValidationError);

                expect(transactionMock).not.toHaveBeenCalled();
                expect(auditLogCreateMock).not.toHaveBeenCalled();
            }
        });

        it("rejects missing, null, or non-string reason types", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            const invalidReasons = [null, undefined, 1234567890, {}] as any[];
            for (const invalidReason of invalidReasons) {
                await expect(
                    suspendWorkspace(context, "ws_acme_corp", invalidReason)
                ).rejects.toThrow(PlatformActionValidationError);

                expect(transactionMock).not.toHaveBeenCalled();
            }
        });

        it("validates that reason trimming correctly enforces MIN_JUSTIFICATION_REASON_LENGTH", () => {
            expect(MIN_JUSTIFICATION_REASON_LENGTH).toBe(10);
            expect(() => validateDangerousActionReason("  123456789  ")).toThrow(
                PlatformActionValidationError
            );
            const valid = validateDangerousActionReason("  1234567890  ");
            expect(valid).toBe("1234567890");
        });

        it("exposes assertTier2StepUpAuthenticated hook for Phase 1.19.17 readiness", () => {
            const context = createMockPlatformContext();
            expect(() => assertTier2StepUpAuthenticated(context)).not.toThrow();
            const unauthenticatedContext = { ...context, stepUpConfirmedAt: null };
            expect(() => assertTier2StepUpAuthenticated(unauthenticatedContext)).toThrow();
        });
    });

    describe("3. Successful Suspension & Compliance Audit Record", () => {
        it("updates workspace organization status to INACTIVE and creates WORKSPACE_SUSPENDED audit record", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const reason = "Severe terms of service violation: automated spam activity.";

            const result = await suspendWorkspace(
                context,
                "ws_acme_corp",
                reason,
                {
                    requestId: "req_audit_suspend_001",
                    ipAddress: "198.51.100.42",
                    userAgent: "PlatformAdminConsole/1.0",
                    metadata: { violationNoticeId: "VN-9921" },
                }
            );

            // Workspace organization status updated
            expect(result.organization?.status).toBe("INACTIVE");
            expect(mockWorkspaceStore.organization.status).toBe("INACTIVE");

            // Audit record verified
            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const auditCall = auditLogCreateMock.mock.calls[0][0].data;

            expect(auditCall.action).toBe(PLATFORM_AUDIT_EVENTS.WORKSPACE_SUSPENDED);
            expect(auditCall.targetType).toBe("WORKSPACE");
            expect(auditCall.targetId).toBe("ws_acme_corp");
            expect(auditCall.workspaceId).toBe("ws_acme_corp");
            expect(auditCall.actorUserId).toBe(context.userId);
            expect(auditCall.actorEmail).toBe(context.email);
            expect(auditCall.actorRole).toBe(PlatformRole.PLATFORM_ADMIN);
            expect(auditCall.reason).toBe(reason);
            expect(auditCall.requestId).toBe("req_audit_suspend_001");
            expect(auditCall.ipAddress).toBe("198.51.100.42");
            expect(auditCall.userAgent).toBe("PlatformAdminConsole/1.0");

            // Structured state diff
            expect(auditCall.previousState).toEqual({ status: "ACTIVE" });
            expect(auditCall.newState).toEqual({ status: "INACTIVE" });
            expect(auditCall.metadata).toEqual({ violationNoticeId: "VN-9921" });
        });
    });

    describe("4. Successful Reactivation & Compliance Audit Record", () => {
        it("updates workspace organization status to ACTIVE and creates WORKSPACE_REACTIVATED audit record", async () => {
            mockWorkspaceStore = createSeededWorkspace("INACTIVE");
            const context = createMockPlatformContext(PlatformRole.PLATFORM_OWNER);
            const reason = "Account settlement confirmed: delinquent balance paid in full.";

            const result = await reactivateWorkspace(
                context,
                "ws_acme_corp",
                reason,
                {
                    requestId: "req_audit_reactivate_001",
                    ipAddress: "203.0.113.88",
                }
            );

            expect(result.organization?.status).toBe("ACTIVE");
            expect(mockWorkspaceStore.organization.status).toBe("ACTIVE");

            expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
            const auditCall = auditLogCreateMock.mock.calls[0][0].data;

            expect(auditCall.action).toBe(PLATFORM_AUDIT_EVENTS.WORKSPACE_REACTIVATED);
            expect(auditCall.targetType).toBe("WORKSPACE");
            expect(auditCall.targetId).toBe("ws_acme_corp");
            expect(auditCall.workspaceId).toBe("ws_acme_corp");
            expect(auditCall.actorUserId).toBe(context.userId);
            expect(auditCall.actorRole).toBe(PlatformRole.PLATFORM_OWNER);
            expect(auditCall.reason).toBe(reason);
            expect(auditCall.requestId).toBe("req_audit_reactivate_001");
            expect(auditCall.ipAddress).toBe("203.0.113.88");

            // Structured state diff
            expect(auditCall.previousState).toEqual({ status: "INACTIVE" });
            expect(auditCall.newState).toEqual({ status: "ACTIVE" });
        });
    });

    describe("5. Transaction Atomicity (Audit-Write Failure Rollback)", () => {
        it("rolls back workspace status mutation when audit logging fails inside transaction", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            // Reconfigure transaction mock to simulate audit failure
            transactionMock.mockImplementationOnce(async (callback: (tx: any) => Promise<any>) => {
                const backup = JSON.parse(JSON.stringify(mockWorkspaceStore));
                const txClient = {
                    workspace: {
                        findUnique: vi.fn().mockResolvedValue(mockWorkspaceStore),
                    },
                    organization: {
                        update: vi.fn().mockImplementation(async (args: any) => {
                            mockWorkspaceStore.organization.status = args.data.status;
                            return mockWorkspaceStore.organization;
                        }),
                    },
                    platformAuditLog: {
                        create: vi.fn().mockRejectedValue(
                            new Error("Database connection lost during audit ledger append")
                        ),
                    },
                };

                try {
                    return await callback(txClient);
                } catch (err) {
                    mockWorkspaceStore = backup;
                    throw err;
                }
            });

            await expect(
                suspendWorkspace(
                    context,
                    "ws_acme_corp",
                    "Suspension with simulated audit failure."
                )
            ).rejects.toThrow("Database connection lost during audit ledger append");

            // Status must remain ACTIVE due to rollback
            expect(mockWorkspaceStore.organization.status).toBe("ACTIVE");
        });
    });

    describe("6. Non-Destructive Invariant (Tenant Data Preservation)", () => {
        it("confirms suspension updates status without deleting any child tenant records", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            const result = await suspendWorkspace(
                context,
                "ws_acme_corp",
                "Administrative suspension for compliance audit."
            );

            expect(result.organization?.status).toBe("INACTIVE");

            // Direct assertion: zero delete calls on customer, workOrder, member, or asset
            expect(customerDeleteMock).not.toHaveBeenCalled();
            expect(workOrderDeleteMock).not.toHaveBeenCalled();
            expect(membershipDeleteMock).not.toHaveBeenCalled();
            expect(assetDeleteMock).not.toHaveBeenCalled();

            // Direct assertion: diagnostics counts remain completely intact
            expect(result.counts.customersCount).toBe(65);
            expect(result.counts.workOrdersCount).toBe(142);
            expect(result.counts.membersCount).toBe(15);
            expect(result.counts.assetsCount).toBe(230);
            expect(result.counts.activeApplicationsCount).toBe(2);
        });
    });

    describe("7. Idempotency & State Conflict Protection", () => {
        it("rejects suspending an already-suspended workspace with PlatformWorkspaceConflictError", async () => {
            mockWorkspaceStore = createSeededWorkspace("INACTIVE");
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                suspendWorkspace(
                    context,
                    "ws_acme_corp",
                    "Attempting to re-suspend an already suspended workspace."
                )
            ).rejects.toThrow(PlatformWorkspaceConflictError);

            // Confirms error message
            await expect(
                suspendWorkspace(
                    context,
                    "ws_acme_corp",
                    "Attempting to re-suspend an already suspended workspace."
                )
            ).rejects.toThrow("Workspace 'ws_acme_corp' is already suspended.");

            // Zero mutation & zero audit logs created
            expect(organizationUpdateMock).not.toHaveBeenCalled();
            expect(auditLogCreateMock).not.toHaveBeenCalled();
        });

        it("rejects reactivating an already-active workspace with PlatformWorkspaceConflictError", async () => {
            mockWorkspaceStore = createSeededWorkspace("ACTIVE");
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                reactivateWorkspace(
                    context,
                    "ws_acme_corp",
                    "Attempting to re-activate an already active workspace."
                )
            ).rejects.toThrow(PlatformWorkspaceConflictError);

            await expect(
                reactivateWorkspace(
                    context,
                    "ws_acme_corp",
                    "Attempting to re-activate an already active workspace."
                )
            ).rejects.toThrow("Workspace 'ws_acme_corp' is already active.");

            expect(organizationUpdateMock).not.toHaveBeenCalled();
            expect(auditLogCreateMock).not.toHaveBeenCalled();
        });
    });

    describe("8. Target Entity Not Found", () => {
        it("throws PlatformWorkspaceNotFoundError when target workspace does not exist", async () => {
            const context = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);

            await expect(
                suspendWorkspace(
                    context,
                    "ws_missing",
                    "Suspension of non-existent workspace."
                )
            ).rejects.toThrow(PlatformWorkspaceNotFoundError);

            await expect(
                reactivateWorkspace(
                    context,
                    "ws_missing",
                    "Reactivation of non-existent workspace."
                )
            ).rejects.toThrow(PlatformWorkspaceNotFoundError);
        });
    });
});
