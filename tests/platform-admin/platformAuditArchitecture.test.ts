import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const { auditCreateMock, auditFindManyMock, auditCountMock } = vi.hoisted(() => ({
    auditCreateMock: vi.fn(),
    auditFindManyMock: vi.fn(),
    auditCountMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        platformAuditLog: {
            create: auditCreateMock,
            findMany: auditFindManyMock,
            count: auditCountMock,
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
    PLATFORM_AUDIT_EVENTS,
    PlatformAuditEventType,
    recordPlatformAuditEvent,
    queryPlatformAuditLog,
} from "@/lib/services/platform/audit";

describe("Phase 1.19.5 — Platform Audit Architecture Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

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
            stepUpConfirmedAt: null,
            metadata: null,
        };
    }

    describe("1. Audit Record Creation across Taxonomy", () => {
        const taxonomySamples: Array<{
            action: PlatformAuditEventType;
            targetType: string;
            targetId: string;
            workspaceId?: string | null;
            previousState?: Record<string, unknown> | null;
            newState?: Record<string, unknown> | null;
        }> = [
            // Operator Management
            {
                action: PLATFORM_AUDIT_EVENTS.OPERATOR_INVITED,
                targetType: "OPERATOR",
                targetId: "usr_new_op",
                previousState: null,
                newState: { email: "new_op@aforden.com", role: "PLATFORM_SUPPORT" },
            },
            {
                action: PLATFORM_AUDIT_EVENTS.OPERATOR_ROLE_UPDATED,
                targetType: "OPERATOR",
                targetId: "usr_promoted_op",
                previousState: { role: "PLATFORM_SUPPORT" },
                newState: { role: "PLATFORM_ADMIN" },
            },
            {
                action: PLATFORM_AUDIT_EVENTS.OPERATOR_REVOKED,
                targetType: "OPERATOR",
                targetId: "usr_revoked_op",
                previousState: { status: "ACTIVE" },
                newState: { status: "INACTIVE" },
            },
            // Workspace Governance
            {
                action: PLATFORM_AUDIT_EVENTS.WORKSPACE_CREATED,
                targetType: "WORKSPACE",
                targetId: "ws_brand_new",
                workspaceId: "ws_brand_new",
                previousState: null,
                newState: { slug: "acme-corp", tier: "ENTERPRISE" },
            },
            {
                action: PLATFORM_AUDIT_EVENTS.WORKSPACE_SUSPENDED,
                targetType: "WORKSPACE",
                targetId: "ws_bad_actor",
                workspaceId: "ws_bad_actor",
                previousState: { status: "ACTIVE" },
                newState: { status: "SUSPENDED" },
            },
            {
                action: PLATFORM_AUDIT_EVENTS.WORKSPACE_SUPPORT_ACCESSED,
                targetType: "WORKSPACE",
                targetId: "ws_support_ticket_1",
                workspaceId: "ws_support_ticket_1",
                previousState: null,
                newState: { ticketId: "TICKET-1048", reason: "Investigating invoice drift" },
            },
            // Entitlements & Billing
            {
                action: PLATFORM_AUDIT_EVENTS.ENTITLEMENT_OVERRIDDEN,
                targetType: "WORKSPACE",
                targetId: "ws_enterprise",
                workspaceId: "ws_enterprise",
                previousState: { maxTechnicians: 10 },
                newState: { maxTechnicians: 50 },
            },
            // Feature Flags & Config
            {
                action: PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_TOGGLED,
                targetType: "FEATURE_FLAG",
                targetId: "flag_dark_mode",
                previousState: { enabled: false },
                newState: { enabled: true },
            },
            // Developer Platform Administration
            {
                action: PLATFORM_AUDIT_EVENTS.DEVELOPER_API_KEY_REVOKED,
                targetType: "API_KEY",
                targetId: "key_compromised_1",
                workspaceId: "ws_client",
                previousState: { status: "ACTIVE" },
                newState: { status: "REVOKED" },
            },
            // Operations & Jobs
            {
                action: PLATFORM_AUDIT_EVENTS.JOB_RETRIED,
                targetType: "JOB",
                targetId: "job_webhook_outbox_42",
                previousState: { status: "FAILED", attempts: 3 },
                newState: { status: "PENDING", attempts: 4 },
            },
            // Security & Sessions
            {
                action: PLATFORM_AUDIT_EVENTS.SECURITY_SESSION_TERMINATED,
                targetType: "SESSION",
                targetId: "sess_suspicious_1",
                previousState: { status: "ACTIVE" },
                newState: { status: "TERMINATED" },
            },
        ];

        for (const sample of taxonomySamples) {
            it(`records compliance audit event for [${sample.action}]`, async () => {
                const actor = createMockPlatformContext(PlatformRole.PLATFORM_OWNER);
                auditCreateMock.mockImplementationOnce((args) =>
                    Promise.resolve({
                        id: `audit_${Math.random().toString(36).substring(2, 9)}`,
                        actorUserId: args.data.actorUserId,
                        actorEmail: args.data.actorEmail,
                        actorRole: args.data.actorRole,
                        action: args.data.action,
                        targetType: args.data.targetType,
                        targetId: args.data.targetId,
                        workspaceId: args.data.workspaceId,
                        requestId: args.data.requestId,
                        ipAddress: args.data.ipAddress,
                        userAgent: args.data.userAgent,
                        reason: args.data.reason,
                        previousState: args.data.previousState,
                        newState: args.data.newState,
                        metadata: args.data.metadata,
                        createdAt: new Date(),
                    })
                );

                const result = await recordPlatformAuditEvent({
                    actor,
                    action: sample.action,
                    targetType: sample.targetType,
                    targetId: sample.targetId,
                    workspaceId: sample.workspaceId,
                    requestId: "req_test_12345",
                    ipAddress: "198.51.100.42",
                    userAgent: "Mozilla/5.0 (Platform Audit Test)",
                    reason: "Automated audit suite test execution",
                    previousState: sample.previousState,
                    newState: sample.newState,
                    metadata: { suite: "1.19.5" },
                });

                expect(auditCreateMock).toHaveBeenCalledTimes(1);
                expect(result.action).toBe(sample.action);
                expect(result.actorUserId).toBe(actor.userId);
                expect(result.actorEmail).toBe(actor.email);
                expect(result.actorRole).toBe(PlatformRole.PLATFORM_OWNER);
                expect(result.targetType).toBe(sample.targetType);
                expect(result.targetId).toBe(sample.targetId);
                expect(result.requestId).toBe("req_test_12345");
            });
        }
    });

    describe("2. Synchronous & Awaited Invariant (Compliance Durability)", () => {
        it("propagates database errors synchronously to ensure compliance-ledger integrity", async () => {
            const actor = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);
            auditCreateMock.mockRejectedValueOnce(
                new Error("Database connection pool exhausted")
            );

            await expect(
                recordPlatformAuditEvent({
                    actor,
                    action: PLATFORM_AUDIT_EVENTS.WORKSPACE_SUSPENDED,
                    targetType: "WORKSPACE",
                    targetId: "ws_test",
                    requestId: "req_fail_1",
                    ipAddress: "127.0.0.1",
                })
            ).rejects.toThrow("Database connection pool exhausted");
        });
    });

    describe("3. Immutability Structural Proof (Invariant #3)", () => {
        it("proves zero mutating/deleting operations exist against PlatformAuditLog in application code", () => {
            const libDir = path.resolve(process.cwd(), "lib");

            function findTsFiles(dir: string): string[] {
                const results: string[] = [];
                const list = fs.readdirSync(dir);
                for (const file of list) {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isDirectory()) {
                        results.push(...findTsFiles(filePath));
                    } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
                        results.push(filePath);
                    }
                }
                return results;
            }

            const tsFiles = findTsFiles(libDir);
            const prohibitedPatterns = [
                /\.platformAuditLog\.update\(/,
                /\.platformAuditLog\.updateMany\(/,
                /\.platformAuditLog\.delete\(/,
                /\.platformAuditLog\.deleteMany\(/,
                /\.platformAuditLog\.upsert\(/,
            ];

            const violations: string[] = [];

            for (const file of tsFiles) {
                const content = fs.readFileSync(file, "utf-8");
                for (const pattern of prohibitedPatterns) {
                    if (pattern.test(content)) {
                        violations.push(`${file} matched prohibited pattern ${pattern.toString()}`);
                    }
                }
            }

            expect(violations).toHaveLength(0);
        });
    });

    describe("4. Query & Filter Verification (queryPlatformAuditLog)", () => {
        it("queries audit records with workspaceId and action filtering", async () => {
            const securityOperator = createMockPlatformContext(
                PlatformRole.PLATFORM_SECURITY
            );

            const mockRecords = [
                {
                    id: "audit_1",
                    actorUserId: "usr_admin",
                    actorEmail: "admin@aforden.com",
                    actorRole: PlatformRole.PLATFORM_ADMIN,
                    action: PLATFORM_AUDIT_EVENTS.WORKSPACE_SUSPENDED,
                    targetType: "WORKSPACE",
                    targetId: "ws_456",
                    workspaceId: "ws_456",
                    requestId: "req_1",
                    ipAddress: "10.0.0.1",
                    userAgent: "TestAgent",
                    reason: "Policy violation",
                    previousState: { status: "ACTIVE" },
                    newState: { status: "SUSPENDED" },
                    metadata: null,
                    createdAt: new Date(),
                },
            ];

            auditFindManyMock.mockResolvedValueOnce(mockRecords);
            auditCountMock.mockResolvedValueOnce(1);

            const result = await queryPlatformAuditLog(securityOperator, {
                workspaceId: "ws_456",
                action: PLATFORM_AUDIT_EVENTS.WORKSPACE_SUSPENDED,
                limit: 10,
                offset: 0,
            });

            expect(result.total).toBe(1);
            expect(result.records).toHaveLength(1);
            expect(result.records[0].action).toBe(
                PLATFORM_AUDIT_EVENTS.WORKSPACE_SUSPENDED
            );
            expect(result.records[0].workspaceId).toBe("ws_456");

            expect(auditFindManyMock).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_456",
                    action: PLATFORM_AUDIT_EVENTS.WORKSPACE_SUSPENDED,
                },
                orderBy: { createdAt: "desc" },
                take: 10,
                skip: 0,
            });
        });

        it("denies audit log queries from callers lacking platform.audit.view permission", async () => {
            // PLATFORM_SUPPORT does NOT hold platform.audit.view
            const supportOperator = createMockPlatformContext(
                PlatformRole.PLATFORM_SUPPORT
            );

            await expect(
                queryPlatformAuditLog(supportOperator, { limit: 10 })
            ).rejects.toThrow(PlatformAccessDeniedError);

            // PLATFORM_OPERATIONS does NOT hold platform.audit.view
            const opsOperator = createMockPlatformContext(
                PlatformRole.PLATFORM_OPERATIONS
            );

            await expect(
                queryPlatformAuditLog(opsOperator, { limit: 10 })
            ).rejects.toThrow(PlatformAccessDeniedError);

            // PLATFORM_BILLING does NOT hold platform.audit.view
            const billingOperator = createMockPlatformContext(
                PlatformRole.PLATFORM_BILLING
            );

            await expect(
                queryPlatformAuditLog(billingOperator, { limit: 10 })
            ).rejects.toThrow(PlatformAccessDeniedError);
        });

        it("permits audit log queries from PLATFORM_OWNER, PLATFORM_ADMIN, and PLATFORM_SECURITY", async () => {
            auditFindManyMock.mockResolvedValue([]);
            auditCountMock.mockResolvedValue(0);

            const owner = createMockPlatformContext(PlatformRole.PLATFORM_OWNER);
            const admin = createMockPlatformContext(PlatformRole.PLATFORM_ADMIN);
            const security = createMockPlatformContext(PlatformRole.PLATFORM_SECURITY);

            await expect(queryPlatformAuditLog(owner)).resolves.toBeDefined();
            await expect(queryPlatformAuditLog(admin)).resolves.toBeDefined();
            await expect(queryPlatformAuditLog(security)).resolves.toBeDefined();
        });
    });
});
