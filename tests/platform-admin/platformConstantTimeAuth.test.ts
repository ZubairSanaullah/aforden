import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import bcrypt from "bcrypt";

const {
    authMock,
    userFindUniqueMock,
    profileUpdateMock,
    auditCreateMock,
    apiKeyFindUniqueMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
    profileUpdateMock: vi.fn(),
    auditCreateMock: vi.fn(),
    apiKeyFindUniqueMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: userFindUniqueMock,
        },
        platformAdminProfile: {
            update: profileUpdateMock,
        },
        platformAuditLog: {
            create: auditCreateMock,
        },
        apiKey: {
            findUnique: apiKeyFindUniqueMock,
        },
    },
}));

import {
    timingSafeEqualStrings,
    timingSafeEqualBuffers,
    constantTimeHashCompare,
    constantTimeBcryptCompare,
    DUMMY_BCRYPT_HASH,
} from "@/lib/services/platform/security";
import {
    PlatformRole,
    PlatformAdminStatus,
    PlatformAuthorizationContext,
} from "@/lib/services/platform/authorization/types";
import {
    hashApiKey,
    verifyApiKeyTimingSafe,
    resolveActiveApiKeyByKeyHash,
} from "@/lib/services/developerApp/developerAppService";

describe("Phase 1.19.18 — Security Hardening (Constant-Time Authentication) Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function createMockPlatformContext(
        role: PlatformRole = PlatformRole.PLATFORM_ADMIN,
        stepUpConfirmedAt: Date | null = new Date()
    ): PlatformAuthorizationContext {
        return {
            userId: "usr_operator_1",
            email: "operator@aforden.com",
            name: "Platform Operator",
            avatarUrl: null,
            platformRole: role,
            profileId: "prof_operator_1",
            status: PlatformAdminStatus.ACTIVE,
            lastActiveAt: new Date(),
            lastLoginAt: new Date(),
            stepUpConfirmedAt,
            metadata: null,
        };
    }

    // =========================================================================
    // 1. String Constant-Time Equality (timingSafeEqualStrings)
    // =========================================================================
    describe("1. timingSafeEqualStrings (Digest-Normalized Constant Time)", () => {
        it("returns true for identical strings", () => {
            expect(timingSafeEqualStrings("secret_token_12345", "secret_token_12345")).toBe(true);
            expect(timingSafeEqualStrings("", "")).toBe(true);
            expect(
                timingSafeEqualStrings(
                    "afd_live_9f83ab283c7482349182374981273948127394812",
                    "afd_live_9f83ab283c7482349182374981273948127394812"
                )
            ).toBe(true);
        });

        it("returns false for different strings of identical length", () => {
            expect(timingSafeEqualStrings("secret_token_12345", "secret_token_99999")).toBe(false);
            expect(timingSafeEqualStrings("a", "b")).toBe(false);
        });

        it("returns false for strings of differing lengths without throwing TypeError", () => {
            // Raw crypto.timingSafeEqual throws if lengths differ; our wrapper normalizes via SHA-256
            expect(() => timingSafeEqualStrings("short", "much_longer_secret_token")).not.toThrow();
            expect(timingSafeEqualStrings("short", "much_longer_secret_token")).toBe(false);
            expect(timingSafeEqualStrings("a", "")).toBe(false);
            expect(timingSafeEqualStrings("", "a")).toBe(false);
        });

        it("returns false safely when either or both arguments are null or undefined", () => {
            expect(timingSafeEqualStrings(null, "secret")).toBe(false);
            expect(timingSafeEqualStrings("secret", null)).toBe(false);
            expect(timingSafeEqualStrings(undefined, "secret")).toBe(false);
            expect(timingSafeEqualStrings("secret", undefined)).toBe(false);
            expect(timingSafeEqualStrings(null, null)).toBe(false);
            expect(timingSafeEqualStrings(undefined, undefined)).toBe(false);
            expect(timingSafeEqualStrings(null, undefined)).toBe(false);
        });

        it("correctly compares 64-character SHA-256 hex strings", () => {
            const hash1 = crypto.createHash("sha256").update("token_A").digest("hex");
            const hash2 = crypto.createHash("sha256").update("token_A").digest("hex");
            const hash3 = crypto.createHash("sha256").update("token_B").digest("hex");

            expect(timingSafeEqualStrings(hash1, hash2)).toBe(true);
            expect(timingSafeEqualStrings(hash1, hash3)).toBe(false);
        });
    });

    // =========================================================================
    // 2. Buffer Constant-Time Equality (timingSafeEqualBuffers)
    // =========================================================================
    describe("2. timingSafeEqualBuffers", () => {
        it("returns true for identical buffers", () => {
            const buf1 = Buffer.from("super_secret_payload");
            const buf2 = Buffer.from("super_secret_payload");
            expect(timingSafeEqualBuffers(buf1, buf2)).toBe(true);
        });

        it("returns false for differing buffers of same length", () => {
            const buf1 = Buffer.from("super_secret_payload_A");
            const buf2 = Buffer.from("super_secret_payload_B");
            expect(timingSafeEqualBuffers(buf1, buf2)).toBe(false);
        });

        it("returns false for buffers of differing lengths without throwing", () => {
            const buf1 = Buffer.from("short");
            const buf2 = Buffer.from("very_long_buffer_payload");
            expect(() => timingSafeEqualBuffers(buf1, buf2)).not.toThrow();
            expect(timingSafeEqualBuffers(buf1, buf2)).toBe(false);
        });

        it("handles null and undefined buffers safely", () => {
            expect(timingSafeEqualBuffers(null, Buffer.from("a"))).toBe(false);
            expect(timingSafeEqualBuffers(Buffer.from("a"), undefined)).toBe(false);
            expect(timingSafeEqualBuffers(null, null)).toBe(false);
        });
    });

    // =========================================================================
    // 3. Hash Comparison (constantTimeHashCompare)
    // =========================================================================
    describe("3. constantTimeHashCompare", () => {
        it("hashes candidate and verifies matching expected hash", () => {
            const secret = "my_api_key_secret_value";
            const expectedHash = crypto.createHash("sha256").update(secret).digest("hex");

            expect(constantTimeHashCompare(secret, expectedHash)).toBe(true);
            expect(constantTimeHashCompare("wrong_secret", expectedHash)).toBe(false);
        });

        it("returns false on invalid or non-string inputs", () => {
            expect(constantTimeHashCompare(null as any, "hash")).toBe(false);
            expect(constantTimeHashCompare("secret", undefined as any)).toBe(false);
        });
    });

    // =========================================================================
    // 4. Bcrypt Timing-Safe Comparison (constantTimeBcryptCompare)
    // =========================================================================
    describe("4. constantTimeBcryptCompare", () => {
        it("verifies correct password against valid hash", async () => {
            const password = "OperatorStrongPassword123!";
            const validHash = await bcrypt.hash(password, 10);

            const result = await constantTimeBcryptCompare(password, validHash);
            expect(result).toBe(true);
        });

        it("rejects incorrect password against valid hash", async () => {
            const validHash = await bcrypt.hash("RealPassword", 10);

            const result = await constantTimeBcryptCompare("WrongPassword", validHash);
            expect(result).toBe(false);
        });

        it("safely handles null, undefined, or malformed hashes by running against DUMMY_BCRYPT_HASH", async () => {
            const bcryptCompareSpy = vi.spyOn(bcrypt, "compare");

            // Null hash
            const resNull = await constantTimeBcryptCompare("AnyPassword", null);
            expect(resNull).toBe(false);
            expect(bcryptCompareSpy).toHaveBeenCalledWith("AnyPassword", DUMMY_BCRYPT_HASH);

            bcryptCompareSpy.mockClear();

            // Undefined hash
            const resUndef = await constantTimeBcryptCompare("AnyPassword", undefined);
            expect(resUndef).toBe(false);
            expect(bcryptCompareSpy).toHaveBeenCalledWith("AnyPassword", DUMMY_BCRYPT_HASH);

            bcryptCompareSpy.mockClear();

            // Malformed short string
            const resShort = await constantTimeBcryptCompare("AnyPassword", "invalid_plain_text");
            expect(resShort).toBe(false);
            expect(bcryptCompareSpy).toHaveBeenCalledWith("AnyPassword", DUMMY_BCRYPT_HASH);

            bcryptCompareSpy.mockRestore();
        });
    });

    // =========================================================================
    // 5. API Key Timing-Safe Verification (Developer Platform)
    // =========================================================================
    describe("5. API Key Timing-Safe Verification", () => {
        const rawKey = "afd_live_abcdef1234567890abcdef1234567890";
        const keyHash = hashApiKey(rawKey);

        it("verifyApiKeyTimingSafe validates matching raw key and keyHash", () => {
            expect(verifyApiKeyTimingSafe(rawKey, keyHash)).toBe(true);
            expect(verifyApiKeyTimingSafe("afd_live_wrongkey1234567890", keyHash)).toBe(false);
        });

        it("resolveActiveApiKeyByKeyHash verifies keyHash via timingSafeEqualStrings", async () => {
            apiKeyFindUniqueMock.mockResolvedValueOnce({
                id: "key_1",
                keyHash,
                status: "ACTIVE",
                expiresAt: null,
                environment: "LIVE",
                scopes: ["technicians:read"],
                developerApplication: {
                    id: "app_1",
                    name: "Test App",
                    workspaceId: "ws_1",
                    status: "ACTIVE",
                },
            });

            const resolved = await resolveActiveApiKeyByKeyHash(keyHash);
            expect(resolved).not.toBeNull();
            expect(resolved?.apiKeyId).toBe("key_1");
        });

        it("resolveActiveApiKeyByKeyHash safely returns null when key does not exist", async () => {
            apiKeyFindUniqueMock.mockResolvedValueOnce(null);

            const resolved = await resolveActiveApiKeyByKeyHash("nonexistent_hash");
            expect(resolved).toBeNull();
        });
    });
});
