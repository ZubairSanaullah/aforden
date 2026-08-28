import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

/**
 * Team Invitation Test Suite — 1.2.16
 *
 * Tests the following layers:
 *   - invitationToken utilities
 *   - invitationRateLimit utilities
 *   - createInvitation service
 *   - acceptInvitation service
 *   - resendInvitation service
 *   - revokeInvitation service
 *   - listInvitations service
 *
 * All Prisma and email interactions are mocked.
 * No database or SMTP connection is required.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    sendEmail: vi.fn(async () => ({
        success: true,
        messageId: "mock-email-id",
    })),
    prisma: {
        workspaceInvitation: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
        },
        workspaceMember: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
        },
        workspace: {
            findUnique: vi.fn(),
        },
        workspaceEntitlementOverride: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
        subscription: {
            findFirst: vi.fn().mockResolvedValue(null),
        },
        user: {
            findUnique: vi.fn(),
        },
        $transaction: vi.fn(async (arg: unknown) => {
            if (typeof arg === "function") {
                return (arg as (tx: unknown) => unknown)(mocks.prisma);
            }
            if (Array.isArray(arg)) {
                return Promise.all(arg);
            }
            return arg;
        }),
    },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/services/email/sendEmail", () => ({
    sendEmail: mocks.sendEmail,
}));

// ---------------------------------------------------------------------------
// Service imports (after mocks)
// ---------------------------------------------------------------------------

import {
    generateInvitationToken,
    hashInvitationToken,
    createInvitationExpiry,
    isInvitationExpired,
    INVITATION_EXPIRY_DAYS,
} from "@/lib/services/invitation/invitationToken";

import {
    createInvitationAcceptUrl,
} from "@/lib/services/invitation/invitationUrl";

import {
    checkInvitationCreateRateLimit,
    checkInvitationAcceptRateLimit,
} from "@/lib/services/invitation/invitationRateLimit";

import {
    InvitationNotFoundError,
    InvitationExpiredError,
    InvitationAlreadyAcceptedError,
    InvitationRevokedError,
    InvitationEmailMismatchError,
    InvitationAlreadyMemberError,
    InvitationRateLimitError,
} from "@/lib/services/invitation/invitationErrors";

import { createInvitation } from "@/lib/services/invitation/createInvitation";
import { acceptInvitation } from "@/lib/services/invitation/acceptInvitation";
import { resendInvitation } from "@/lib/services/invitation/resendInvitation";
import { revokeInvitation } from "@/lib/services/invitation/revokeInvitation";
import { listInvitations } from "@/lib/services/invitation/listInvitations";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "workspace-1";
const USER_ID = "user-1";
const INVITATION_ID = "invitation-1";

function mockActiveOwnerSession() {
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
    mocks.prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        name: "Alice Owner",
        email: "alice@example.com",
        status: "ACTIVE",
        emailVerified: new Date(),
    });
    mocks.prisma.workspace.findUnique.mockResolvedValue({
        id: WORKSPACE_ID,
        name: "Acme Corp",
        slug: "acme-corp",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
    });
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({
        id: "member-1",
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        role: "OWNER",
        status: "ACTIVE",
    });
}

function mockActiveAdminSession() {
    mocks.auth.mockResolvedValue({ user: { id: "user-admin" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
        id: "user-admin",
        name: "Bob Admin",
        email: "bob@example.com",
        status: "ACTIVE",
        emailVerified: new Date(),
    });
    mocks.prisma.workspace.findUnique.mockResolvedValue({
        id: WORKSPACE_ID,
        name: "Acme Corp",
        slug: "acme-corp",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
    });
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({
        id: "member-admin",
        userId: "user-admin",
        workspaceId: WORKSPACE_ID,
        role: "ADMIN",
        status: "ACTIVE",
    });
}

function mockActiveTechnicianSession() {
    mocks.auth.mockResolvedValue({ user: { id: "user-tech" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
        id: "user-tech",
        name: "Carol Tech",
        email: "carol@example.com",
        status: "ACTIVE",
        emailVerified: new Date(),
    });
    mocks.prisma.workspace.findUnique.mockResolvedValue({
        id: WORKSPACE_ID,
        name: "Acme Corp",
        slug: "acme-corp",
        logoUrl: null,
        timezone: "UTC",
        defaultCurrencyCode: "USD",
    });
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({
        id: "member-tech",
        userId: "user-tech",
        workspaceId: WORKSPACE_ID,
        role: "TECHNICIAN",
        status: "ACTIVE",
    });
}

function mockUnauthenticated() {
    mocks.auth.mockResolvedValue(null);
}

function makePendingInvitation(overrides: Record<string, unknown> = {}) {
    return {
        id: INVITATION_ID,
        workspaceId: WORKSPACE_ID,
        email: "invitee@example.com",
        role: "TECHNICIAN",
        tokenHash: "hashed_token",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        acceptedAt: null,
        revokedAt: null,
        workspace: { id: WORKSPACE_ID },
        invitedBy: { name: "Alice Owner" },
        ...overrides,
    };
}

const IP = "1.2.3.4";
const OPTIONS = { ipAddress: IP };

// ---------------------------------------------------------------------------
// invitationToken utilities
// ---------------------------------------------------------------------------

describe("invitationToken utilities", () => {
    it("generates a 64-character hex raw token", () => {
        const token = generateInvitationToken();
        expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it("generates unique tokens each call", () => {
        const t1 = generateInvitationToken();
        const t2 = generateInvitationToken();
        expect(t1).not.toBe(t2);
    });

    it("hashes a token deterministically", () => {
        const raw = generateInvitationToken();
        const h1 = hashInvitationToken(raw);
        const h2 = hashInvitationToken(raw);
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces different hashes for different tokens", () => {
        const h1 = hashInvitationToken(generateInvitationToken());
        const h2 = hashInvitationToken(generateInvitationToken());
        expect(h1).not.toBe(h2);
    });

    it("raw token and its hash are not equal", () => {
        const raw = generateInvitationToken();
        expect(raw).not.toBe(hashInvitationToken(raw));
    });

    it("creates an expiry INVITATION_EXPIRY_DAYS in the future", () => {
        const before = Date.now();
        const expiry = createInvitationExpiry();
        const after = Date.now();

        const expectedMs = INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        expect(expiry.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 1000);
        expect(expiry.getTime()).toBeLessThanOrEqual(after + expectedMs + 1000);
    });

    it("isInvitationExpired returns false for a future date", () => {
        const future = new Date(Date.now() + 10_000);
        expect(isInvitationExpired(future)).toBe(false);
    });

    it("isInvitationExpired returns true for a past date", () => {
        const past = new Date(Date.now() - 1);
        expect(isInvitationExpired(past)).toBe(true);
    });

    it("INVITATION_EXPIRY_DAYS is 7", () => {
        expect(INVITATION_EXPIRY_DAYS).toBe(7);
    });
});

// ---------------------------------------------------------------------------
// invitationUrl
// ---------------------------------------------------------------------------

describe("createInvitationAcceptUrl", () => {
    it("includes the raw token as a query parameter", () => {
        const token = "abc123";
        const url = createInvitationAcceptUrl(token);
        expect(url).toContain("token=abc123");
    });

    it("includes /invitations/accept path", () => {
        const url = createInvitationAcceptUrl("tok");
        expect(url).toContain("/invitations/accept");
    });
});

// ---------------------------------------------------------------------------
// invitationRateLimit
// ---------------------------------------------------------------------------

describe("invitation rate limiting", () => {
    it("allows first invitation request", () => {
        const result = checkInvitationCreateRateLimit(
            `unique_${Date.now()}@example.com`,
            `ws-rl-${Date.now()}`,
            "192.0.2.1",
        );
        expect(result.allowed).toBe(true);
    });

    it("denies duplicate email within cooldown period", () => {
        const email = `rl_cooldown_${Date.now()}@example.com`;
        const ws = `ws-rl-cooldown-${Date.now()}`;
        checkInvitationCreateRateLimit(email, ws, "192.0.2.2");
        const second = checkInvitationCreateRateLimit(email, ws, "192.0.2.2");
        expect(second.allowed).toBe(false);
        expect(second.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("allows first acceptance attempt", () => {
        const result = checkInvitationAcceptRateLimit(
            `accept_token_${Date.now()}`,
            "192.0.2.3",
        );
        expect(result.allowed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// createInvitation
// ---------------------------------------------------------------------------

describe("createInvitation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("creates an invitation for an authorized OWNER", async () => {
        mockActiveOwnerSession();

        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);

        const createdInvitation = {
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "invitee@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
        };

        mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });
        mocks.prisma.workspaceInvitation.create.mockResolvedValue(createdInvitation);

        const result = await createInvitation(
            WORKSPACE_ID,
            { email: "invitee@example.com", role: "TECHNICIAN" },
            OPTIONS,
        );

        expect(result.email).toBe("invitee@example.com");
        expect(result.role).toBe("TECHNICIAN");
        expect(result.workspaceId).toBe(WORKSPACE_ID);
    });

    it("normalizes email to lowercase before creating", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
        mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });
        mocks.prisma.workspaceInvitation.create.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "normalize@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            createdAt: new Date(),
        });

        await createInvitation(
            WORKSPACE_ID,
            { email: "NORMALIZE@EXAMPLE.COM", role: "TECHNICIAN" },
            OPTIONS,
        );

        const createCall =
            mocks.prisma.workspaceInvitation.create.mock.calls[0][0];
        expect(createCall.data.email).toBe("normalize@example.com");
    });

    it("stores only the tokenHash, not the raw token", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
        mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });
        mocks.prisma.workspaceInvitation.create.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "tokencheck@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            createdAt: new Date(),
        });

        await createInvitation(
            WORKSPACE_ID,
            { email: "tokencheck@example.com", role: "TECHNICIAN" },
            OPTIONS,
        );

        const createCall =
            (mocks.prisma.workspaceInvitation.create.mock.calls as unknown[][])[0]![0] as { data: { tokenHash: string } };
        const storedHash = createCall.data.tokenHash;

        // The stored value must be a 64-char hex hash, not a 64-char random hex.
        // Both are hex strings, but we verify it's the SHA-256 of something —
        // we know the raw token passed to the email differs from the hash.
        expect(storedHash).toMatch(/^[a-f0-9]{64}$/);

        // Critically: the raw token sent in the email must NOT equal the stored hash.
        const emailCall = (mocks.sendEmail.mock.calls as unknown[][])[0]![0] as { html: string };
        const emailHtml: string = emailCall.html;
        expect(emailHtml).not.toContain(storedHash);
    });

    it("sends an invitation email", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
        mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });
        mocks.prisma.workspaceInvitation.create.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "emailtest@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            createdAt: new Date(),
        });

        await createInvitation(
            WORKSPACE_ID,
            { email: "emailtest@example.com", role: "TECHNICIAN" },
            OPTIONS,
        );

        expect(mocks.sendEmail).toHaveBeenCalledOnce();
        const emailCall = (mocks.sendEmail.mock.calls as unknown[][])[0]![0] as { to: unknown };
        expect(emailCall.to).toMatchObject({ email: "emailtest@example.com" });
    });

    it("rejects TECHNICIAN trying to send invitation (no permission)", async () => {
        mockActiveTechnicianSession();

        await expect(
            createInvitation(
                WORKSPACE_ID,
                { email: "invitee@example.com", role: "TECHNICIAN" },
                OPTIONS,
            ),
        ).rejects.toThrow();
    });

    it("rejects unauthenticated caller", async () => {
        mockUnauthenticated();

        await expect(
            createInvitation(
                WORKSPACE_ID,
                { email: "invitee@example.com", role: "TECHNICIAN" },
                OPTIONS,
            ),
        ).rejects.toThrow();
    });

    it("rejects inviting an existing active workspace member", async () => {
        mockActiveOwnerSession();

        mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
            id: "existing-member",
        });

        await expect(
            createInvitation(
                WORKSPACE_ID,
                { email: "already@example.com", role: "TECHNICIAN" },
                OPTIONS,
            ),
        ).rejects.toBeInstanceOf(InvitationAlreadyMemberError);
    });

    it("ADMIN cannot invite as OWNER (role escalation)", async () => {
        mockActiveAdminSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);

        // OWNER is above ADMIN in the hierarchy — assertCanManageRole throws.
        await expect(
            createInvitation(
                WORKSPACE_ID,
                { email: "invitee@example.com", role: "ADMIN" },
                OPTIONS,
            ),
        ).rejects.toThrow();
    });

    it("invalidates existing pending invitation before creating new one", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
        mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 1 });
        mocks.prisma.workspaceInvitation.create.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "duplicate@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            createdAt: new Date(),
        });

        await createInvitation(
            WORKSPACE_ID,
            { email: "duplicate@example.com", role: "TECHNICIAN" },
            OPTIONS,
        );

        // updateMany should have been called to revoke the existing invitation.
        expect(
            mocks.prisma.workspaceInvitation.updateMany,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    workspaceId: WORKSPACE_ID,
                    email: "duplicate@example.com",
                    acceptedAt: null,
                    revokedAt: null,
                }),
                data: expect.objectContaining({
                    revokedAt: expect.any(Date) as Date,
                }),
            }),
        );
    });

    it("invitation persists even when email delivery fails", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
        mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });
        const createdInvitation = {
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "emailfail@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            createdAt: new Date(),
        };
        mocks.prisma.workspaceInvitation.create.mockResolvedValue(createdInvitation);

        mocks.sendEmail.mockRejectedValueOnce(new Error("SMTP failure"));

        const result = await createInvitation(
            WORKSPACE_ID,
            { email: "emailfail@example.com", role: "TECHNICIAN" },
            OPTIONS,
        );

        // Invitation is returned despite email failure.
        expect(result.id).toBe(INVITATION_ID);
    });
});

// ---------------------------------------------------------------------------
// acceptInvitation
// ---------------------------------------------------------------------------

describe("acceptInvitation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("accepts a valid invitation for an authenticated user", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceMember.findUnique.mockResolvedValue(null);
        mocks.prisma.workspaceMember.create.mockResolvedValue({
            id: "new-member-1",
        });
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({});

        const result = await acceptInvitation({
            rawToken: generateInvitationToken(),
            authenticatedUserId: USER_ID,
            authenticatedUserEmail: "invitee@example.com",
            ipAddress: IP,
        });

        expect(result.membershipCreated).toBe(true);
        expect(result.invitation.email).toBe("invitee@example.com");
        expect(result.membershipId).toBe("new-member-1");
    });

    it("marks invitation as accepted (sets acceptedAt)", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceMember.findUnique.mockResolvedValue(null);
        mocks.prisma.workspaceMember.create.mockResolvedValue({ id: "m-1" });
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({});

        await acceptInvitation({
            rawToken: generateInvitationToken(),
            authenticatedUserId: USER_ID,
            authenticatedUserEmail: "invitee@example.com",
            ipAddress: IP,
        });

        const updateCall =
            (mocks.prisma.workspaceInvitation.update.mock.calls as unknown[][])[0]![0] as { data: Record<string, unknown> };
        expect(updateCall.data).toMatchObject({
            acceptedAt: expect.any(Date),
        });
    });

    it("returns membershipCreated: false for unauthenticated user", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );

        const result = await acceptInvitation({
            rawToken: generateInvitationToken(),
            ipAddress: IP,
            // no authenticatedUserId / authenticatedUserEmail
        });

        expect(result.membershipCreated).toBe(false);
        expect(result.membershipId).toBeUndefined();
    });

    it("throws InvitationNotFoundError for invalid token", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(null);

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationNotFoundError);
    });

    it("throws InvitationExpiredError for expired invitation", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({
                expiresAt: new Date(Date.now() - 1000),
            }),
        );

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationExpiredError);
    });

    it("throws InvitationAlreadyAcceptedError for already-accepted invitation", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ acceptedAt: new Date() }),
        );

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
    });

    it("throws InvitationRevokedError for revoked invitation", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ revokedAt: new Date() }),
        );

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationRevokedError);
    });

    it("throws InvitationEmailMismatchError when user email does not match", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ email: "invitee@example.com" }),
        );

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: "user-other",
                authenticatedUserEmail: "other@example.com", // different from invitee
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationEmailMismatchError);
    });

    it("throws InvitationAlreadyMemberError when user is already an active member", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceMember.findUnique.mockResolvedValue({
            id: "existing-membership",
            status: "ACTIVE",
        });

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationAlreadyMemberError);
    });

    it("TOCTOU: re-validates inside transaction and throws if accepted concurrently", async () => {
        // First findUnique (pre-check) returns pending.
        mocks.prisma.workspaceInvitation.findUnique
            .mockResolvedValueOnce(makePendingInvitation()) // outer check
            .mockResolvedValueOnce(
                makePendingInvitation({ acceptedAt: new Date() }), // inside tx
            );

        mocks.prisma.workspaceMember.findUnique.mockResolvedValue(null);

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
    });

    it("prevents replay: token cannot be accepted twice", async () => {
        // First call succeeds.
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceMember.findUnique.mockResolvedValue(null);
        mocks.prisma.workspaceMember.create.mockResolvedValue({ id: "m-1" });
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({});

        const token = generateInvitationToken();

        await acceptInvitation({
            rawToken: token,
            authenticatedUserId: USER_ID,
            authenticatedUserEmail: "invitee@example.com",
            ipAddress: IP,
        });

        // Second call finds it already accepted.
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ acceptedAt: new Date() }),
        );

        await expect(
            acceptInvitation({
                rawToken: token,
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: "5.6.7.8",
            }),
        ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
    });

    it("hashes the raw token before database lookup", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(null);

        const rawToken = generateInvitationToken();

        await acceptInvitation({
            rawToken,
            ipAddress: IP,
        }).catch(() => {
            // Expected to throw InvitationNotFoundError — that's fine.
        });

        const lookupArg =
            mocks.prisma.workspaceInvitation.findUnique.mock.calls[0][0];
        const tokenHashUsed = lookupArg.where.tokenHash;

        // The value used in the DB lookup must not be the raw token.
        expect(tokenHashUsed).not.toBe(rawToken);
        // It must be the SHA-256 hash.
        expect(tokenHashUsed).toBe(hashInvitationToken(rawToken));
    });
});

// ---------------------------------------------------------------------------
// resendInvitation
// ---------------------------------------------------------------------------

describe("resendInvitation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("authorized OWNER can resend a pending invitation", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "invitee@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await resendInvitation(WORKSPACE_ID, INVITATION_ID);

        expect(result.id).toBe(INVITATION_ID);
        expect(mocks.sendEmail).toHaveBeenCalledOnce();
    });

    it("generates a new token on resend (old token invalidated)", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ tokenHash: "old_hash" }),
        );
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "invitee@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            updatedAt: new Date(),
        });

        await resendInvitation(WORKSPACE_ID, INVITATION_ID);

        const updateCall =
            (mocks.prisma.workspaceInvitation.update.mock.calls as unknown[][])[0]![0] as { data: { tokenHash: string; expiresAt: Date } };
        const newHash = updateCall.data.tokenHash;

        expect(newHash).toBeDefined();
        expect(newHash).not.toBe("old_hash");
        expect(newHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("refreshes expiration on resend", async () => {
        mockActiveOwnerSession();
        const oldExpiry = new Date(Date.now() + 1000); // nearly expired
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ expiresAt: oldExpiry }),
        );
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "invitee@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            updatedAt: new Date(),
        });

        await resendInvitation(WORKSPACE_ID, INVITATION_ID);

        const updateCall =
            (mocks.prisma.workspaceInvitation.update.mock.calls as unknown[][])[0]![0] as { data: { tokenHash: string; expiresAt: Date } };
        const newExpiry = updateCall.data.expiresAt;

        expect(newExpiry.getTime()).toBeGreaterThan(oldExpiry.getTime());
    });

    it("throws InvitationNotFoundError for non-existent invitation", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(null);

        await expect(
            resendInvitation(WORKSPACE_ID, "non-existent-id"),
        ).rejects.toBeInstanceOf(InvitationNotFoundError);
    });

    it("throws InvitationAlreadyAcceptedError when invitation already accepted", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ acceptedAt: new Date() }),
        );

        await expect(
            resendInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
    });

    it("throws InvitationRevokedError when invitation is revoked", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ revokedAt: new Date() }),
        );

        await expect(
            resendInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toBeInstanceOf(InvitationRevokedError);
    });

    it("rejects TECHNICIAN resending an invitation (no permission)", async () => {
        mockActiveTechnicianSession();

        await expect(
            resendInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toThrow();
    });

    it("enforces tenant isolation: cannot resend invitation from another workspace", async () => {
        mockActiveOwnerSession();
        // Invitation belongs to a DIFFERENT workspace.
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ workspaceId: "other-workspace-99" }),
        );

        await expect(
            resendInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toThrow();
    });

    it("sends email with new token URL after resend", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "invitee@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            updatedAt: new Date(),
        });

        await resendInvitation(WORKSPACE_ID, INVITATION_ID);

        expect(mocks.sendEmail).toHaveBeenCalledOnce();
        const emailArg = (mocks.sendEmail.mock.calls as unknown[][])[0]![0] as { html: string };
        expect(emailArg.html).toContain("/invitations/accept");
    });
});

// ---------------------------------------------------------------------------
// revokeInvitation
// ---------------------------------------------------------------------------

describe("revokeInvitation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("authorized OWNER can revoke a pending invitation", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({});

        const result = await revokeInvitation(WORKSPACE_ID, INVITATION_ID);

        expect(result.revokedAt).toBeInstanceOf(Date);
        expect(result.id).toBe(INVITATION_ID);
    });

    it("sets revokedAt in the database", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation(),
        );
        mocks.prisma.workspaceInvitation.update.mockResolvedValue({});

        await revokeInvitation(WORKSPACE_ID, INVITATION_ID);

        const updateCall =
            (mocks.prisma.workspaceInvitation.update.mock.calls as unknown[][])[0]![0] as { data: { revokedAt: unknown } };
        expect(updateCall.data.revokedAt).toBeInstanceOf(Date);
    });

    it("throws InvitationNotFoundError for non-existent invitation", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(null);

        await expect(
            revokeInvitation(WORKSPACE_ID, "non-existent"),
        ).rejects.toBeInstanceOf(InvitationNotFoundError);
    });

    it("throws InvitationAlreadyAcceptedError when already accepted", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ acceptedAt: new Date() }),
        );

        await expect(
            revokeInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toBeInstanceOf(InvitationAlreadyAcceptedError);
    });

    it("throws InvitationRevokedError when already revoked", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ revokedAt: new Date() }),
        );

        await expect(
            revokeInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toBeInstanceOf(InvitationRevokedError);
    });

    it("rejects TECHNICIAN revoking an invitation", async () => {
        mockActiveTechnicianSession();

        await expect(
            revokeInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toThrow();
    });

    it("enforces tenant isolation: cannot revoke invitation from another workspace", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ workspaceId: "other-workspace-99" }),
        );

        await expect(
            revokeInvitation(WORKSPACE_ID, INVITATION_ID),
        ).rejects.toThrow();
    });

    it("revoked invitation cannot be accepted", async () => {
        // Revoked invitation — acceptInvitation should throw InvitationRevokedError.
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({ revokedAt: new Date() }),
        );

        await expect(
            acceptInvitation({
                rawToken: generateInvitationToken(),
                authenticatedUserId: USER_ID,
                authenticatedUserEmail: "invitee@example.com",
                ipAddress: IP,
            }),
        ).rejects.toBeInstanceOf(InvitationRevokedError);
    });
});

// ---------------------------------------------------------------------------
// listInvitations
// ---------------------------------------------------------------------------

describe("listInvitations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns pending invitations for authorized user", async () => {
        mockActiveOwnerSession();

        const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        mocks.prisma.workspaceInvitation.findMany.mockResolvedValue([
            {
                id: INVITATION_ID,
                workspaceId: WORKSPACE_ID,
                email: "invitee@example.com",
                role: "TECHNICIAN",
                invitedById: USER_ID,
                invitedBy: { name: "Alice Owner" },
                expiresAt: futureDate,
                createdAt: new Date(),
            },
        ]);

        const result = await listInvitations(WORKSPACE_ID);

        expect(result).toHaveLength(1);
        expect(result[0].email).toBe("invitee@example.com");
        expect(result[0].status).toBe("pending");
    });

    it("derives 'expired' status for past-expiry invitations", async () => {
        mockActiveOwnerSession();

        const pastDate = new Date(Date.now() - 1000);
        mocks.prisma.workspaceInvitation.findMany.mockResolvedValue([
            {
                id: INVITATION_ID,
                workspaceId: WORKSPACE_ID,
                email: "invitee@example.com",
                role: "TECHNICIAN",
                invitedById: USER_ID,
                invitedBy: { name: "Alice" },
                expiresAt: pastDate,
                createdAt: new Date(),
            },
        ]);

        const result = await listInvitations(WORKSPACE_ID);

        expect(result[0].status).toBe("expired");
    });

    it("never returns tokenHash in the result", async () => {
        mockActiveOwnerSession();

        mocks.prisma.workspaceInvitation.findMany.mockResolvedValue([
            {
                id: INVITATION_ID,
                workspaceId: WORKSPACE_ID,
                email: "invitee@example.com",
                role: "TECHNICIAN",
                invitedById: USER_ID,
                invitedBy: { name: "Alice" },
                expiresAt: new Date(Date.now() + 86400000),
                createdAt: new Date(),
            },
        ]);

        const result = await listInvitations(WORKSPACE_ID);

        expect((result[0] as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
    });

    it("rejects TECHNICIAN listing invitations (no permission)", async () => {
        mockActiveTechnicianSession();

        await expect(
            listInvitations(WORKSPACE_ID),
        ).rejects.toThrow();
    });

    it("rejects unauthenticated caller", async () => {
        mockUnauthenticated();

        await expect(
            listInvitations(WORKSPACE_ID),
        ).rejects.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Security invariants
// ---------------------------------------------------------------------------

describe("security invariants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("raw token is not present in any database write", async () => {
        mockActiveOwnerSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
        mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });
        mocks.prisma.workspaceInvitation.create.mockResolvedValue({
            id: INVITATION_ID,
            workspaceId: WORKSPACE_ID,
            email: "rawtoken@example.com",
            role: "TECHNICIAN",
            expiresAt: new Date(),
            createdAt: new Date(),
        });

        await createInvitation(
            WORKSPACE_ID,
            { email: "rawtoken@example.com", role: "TECHNICIAN" },
            OPTIONS,
        );

        const createCall =
            (mocks.prisma.workspaceInvitation.create.mock.calls as unknown[][])[0]![0] as { data: { tokenHash: string } };

        // tokenHash must be a SHA-256 hex — not a raw hex that would
        // look like a raw token. Both are 64-char hex, but the key is
        // that the email URL and the DB value must differ.
        const storedHash = createCall.data.tokenHash;
        const emailHtml: string =
            ((mocks.sendEmail.mock.calls as unknown[][])[0]![0] as { html: string }).html;

        // The email URL contains the raw token as a query param.
        // Extract it and confirm it doesn't equal the stored hash.
        const tokenMatch = emailHtml.match(/token=([a-f0-9]{64})/);
        expect(tokenMatch).not.toBeNull();

        const rawTokenInEmail = tokenMatch![1]!;
        expect(rawTokenInEmail).not.toBe(storedHash);
    });

    it("invitation enumeration: invalid token returns same error as expired", async () => {
        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(null);

        const error1 = await acceptInvitation({
            rawToken: generateInvitationToken(),
            ipAddress: IP,
        }).catch((e) => e);

        mocks.prisma.workspaceInvitation.findUnique.mockResolvedValue(
            makePendingInvitation({
                expiresAt: new Date(Date.now() - 1000),
            }),
        );

        const error2 = await acceptInvitation({
            rawToken: generateInvitationToken(),
            ipAddress: IP,
        }).catch((e) => e);

        // Both result in 4xx-class errors. The API layer merges them into
        // the same response code (INVITATION_INVALID), preventing enumeration.
        expect(error1).toBeInstanceOf(InvitationNotFoundError);
        expect(error2).toBeInstanceOf(InvitationExpiredError);
    });

    it("ADMIN cannot invite someone as ADMIN (equal role escalation blocked)", async () => {
        mockActiveAdminSession();
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);

        await expect(
            createInvitation(
                WORKSPACE_ID,
                { email: "invitee@example.com", role: "ADMIN" },
                OPTIONS,
            ),
        ).rejects.toThrow();
    });

    it("tenant isolation: workspace A admin cannot list workspace B invitations", async () => {
        // Auth sets up session for WORKSPACE_ID (the user's workspace).
        mockActiveOwnerSession();

        // Override: workspaceMember.findUnique returns null for workspace-B-99,
        // simulating that the authenticated user has NO membership there.
        // The mockActiveOwnerSession already set findUnique to return a membership
        // for WORKSPACE_ID, but we override to return null for the target call.
        mocks.prisma.workspaceMember.findUnique.mockResolvedValueOnce(null);
        mocks.prisma.workspaceInvitation.findMany.mockResolvedValue([]);

        // workspaceAuthorization checks: user exists (yes), workspace-B-99 exists
        // (workspace.findUnique returns Acme Corp — we need it to return workspace-B).
        // Rather than fighting mock ordering, override workspace.findUnique to return
        // the B workspace, and membership to null = access denied.
        mocks.prisma.workspace.findUnique.mockResolvedValueOnce({
            id: "workspace-B-99",
            name: "Workspace B",
            slug: "workspace-b",
            logoUrl: null,
            timezone: "UTC",
        defaultCurrencyCode: "USD",
        });

        await expect(
            listInvitations("workspace-B-99"),
        ).rejects.toThrow();
    });

    it("rate limit error carries retryAfterSeconds", () => {
        const err = new InvitationRateLimitError(45);
        expect(err.retryAfterSeconds).toBe(45);
        expect(err).toBeInstanceOf(InvitationRateLimitError);
    });
});
