import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    createDeveloperApplication,
    createApiKey,
    resolveActiveApiKeyByKeyHash,
    revokeApiKey,
    updateDeveloperApplicationStatus,
    listDeveloperApplicationKeys,
    hashApiKey,
    generateRawApiKey,
    DeveloperApplicationStatus,
    ApiKeyStatus,
    ApiKeyEnvironment,
} from "@/lib/services/developerApp";

describe("Phase 1.18.2 — Developer Application & API Client Data Model Tests", () => {
    let prisma: PrismaClient;
    const runId = `devapp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const ws1Id = `ws_1_${runId}`;
    const ws2Id = `ws_2_${runId}`;
    const userId = `usr_${runId}`;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Create a test user
        await prisma.user.create({
            data: {
                id: userId,
                email: `dev-${runId}@example.com`,
                name: "Developer Test User",
                status: "ACTIVE",
            },
        });

        // 2. Create two test workspaces for tenant isolation verification
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Primary Developer Workspace",
                slug: `primary-slug-${runId}`,
            },
        });

        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Secondary Isolated Workspace",
                slug: `secondary-slug-${runId}`,
            },
        });
    });

    afterAll(async () => {
        if (prisma) {
            // Clean up created entities
            await prisma.developerApplication.deleteMany({
                where: { createdByUserId: userId },
            });
            await prisma.workspace.deleteMany({
                where: { id: { in: [ws1Id, ws2Id] } },
            });
            await prisma.user.deleteMany({
                where: { id: userId },
            });
            await prisma.$disconnect();
        }
    });

    it("1. should successfully create a DeveloperApplication and an associated ApiKey", async () => {
        const app = await createDeveloperApplication(ws1Id, {
            name: "ERP Integration Hub",
            description: "Syncs inventory and work orders to ERP",
            createdByUserId: userId,
        });

        expect(app).toBeDefined();
        expect(app.id).toBeDefined();
        expect(app.workspaceId).toBe(ws1Id);
        expect(app.name).toBe("ERP Integration Hub");
        expect(app.status).toBe(DeveloperApplicationStatus.ACTIVE);
        expect(app.createdByUserId).toBe(userId);

        const keyResult = await createApiKey(ws1Id, app.id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: ["work_orders:read", "work_orders:write"],
            metadata: { clientVersion: "1.0.0" },
        });

        expect(keyResult).toBeDefined();
        expect(keyResult.id).toBeDefined();
        expect(keyResult.developerApplicationId).toBe(app.id);
        expect(keyResult.environment).toBe(ApiKeyEnvironment.LIVE);
        expect(keyResult.status).toBe(ApiKeyStatus.ACTIVE);
        expect(keyResult.scopes).toEqual(["work_orders:read", "work_orders:write"]);
        expect(keyResult.rawSecretKey.startsWith("afd_live_")).toBe(true);
        expect(keyResult.keyPrefix.startsWith("afd_live_")).toBe(true);

        // Verify the database stored ONLY keyHash, not the raw secret
        const dbKey = await prisma.apiKey.findUnique({
            where: { id: keyResult.id },
        });
        expect(dbKey).toBeDefined();
        expect(dbKey!.keyHash).toBe(hashApiKey(keyResult.rawSecretKey));
        // Verify raw secret is nowhere in the database row
        expect(JSON.stringify(dbKey)).not.toContain(keyResult.rawSecretKey);
    });

    it("2. should enforce unique constraint on ApiKey.keyHash", async () => {
        const app = await createDeveloperApplication(ws1Id, {
            name: "Uniqueness Test App",
            createdByUserId: userId,
        });

        const fixedKeyHash = hashApiKey(`afd_live_fixed_test_key_${runId}`);

        // Insert first key
        await prisma.apiKey.create({
            data: {
                developerApplicationId: app.id,
                keyHash: fixedKeyHash,
                keyPrefix: "afd_live_fixe...key",
                environment: ApiKeyEnvironment.LIVE,
                status: ApiKeyStatus.ACTIVE,
                scopes: ["work_orders:read"],
            },
        });

        // Attempt to insert duplicate keyHash
        await expect(
            prisma.apiKey.create({
                data: {
                    developerApplicationId: app.id,
                    keyHash: fixedKeyHash,
                    keyPrefix: "afd_live_dup...key",
                    environment: ApiKeyEnvironment.LIVE,
                    status: ApiKeyStatus.ACTIVE,
                    scopes: ["customers:read"],
                },
            }),
        ).rejects.toThrow();
    });

    it("3. should enforce strict Tenant Isolation via DeveloperApplication", async () => {
        // Create an app and key in Workspace 1
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "Workspace 1 App",
            createdByUserId: userId,
        });
        const key1 = await createApiKey(ws1Id, app1.id, {
            scopes: ["work_orders:read"],
        });

        // Attempting to create an ApiKey on app1 using Workspace 2 context MUST fail
        await expect(
            createApiKey(ws2Id, app1.id, {
                scopes: ["work_orders:read"],
            }),
        ).rejects.toThrow(/not found in workspace/i);

        // Resolving the key credential resolves strictly to Workspace 1
        const resolved = await resolveActiveApiKeyByKeyHash(hashApiKey(key1.rawSecretKey));
        expect(resolved).not.toBeNull();
        expect(resolved!.workspaceId).toBe(ws1Id);
        expect(resolved!.workspaceId).not.toBe(ws2Id);
        expect(resolved!.developerApplicationId).toBe(app1.id);
    });

    it("4. should support Revocation: revoking a key excludes it from active resolution", async () => {
        const app = await createDeveloperApplication(ws1Id, {
            name: "Revocation Test App",
            createdByUserId: userId,
        });
        const key = await createApiKey(ws1Id, app.id, {
            scopes: ["invoices:read"],
        });

        const keyHash = hashApiKey(key.rawSecretKey);

        // Before revocation: resolves active
        const beforeRevoke = await resolveActiveApiKeyByKeyHash(keyHash);
        expect(beforeRevoke).not.toBeNull();

        // Revoke the key
        const revoked = await revokeApiKey(ws1Id, app.id, key.id);
        expect(revoked.status).toBe(ApiKeyStatus.REVOKED);
        expect(revoked.revokedAt).toBeInstanceOf(Date);

        // After revocation: resolveActiveApiKeyByKeyHash returns null
        const afterRevoke = await resolveActiveApiKeyByKeyHash(keyHash);
        expect(afterRevoke).toBeNull();
    });

    it("5. should support Expiration: expired keys are excluded from active resolution", async () => {
        const app = await createDeveloperApplication(ws1Id, {
            name: "Expiration Test App",
            createdByUserId: userId,
        });

        // Create a key that expired 1 hour ago
        const pastDate = new Date(Date.now() - 3600 * 1000);
        const expiredKey = await createApiKey(ws1Id, app.id, {
            scopes: ["customers:read"],
            expiresAt: pastDate,
        });

        const expiredKeyHash = hashApiKey(expiredKey.rawSecretKey);

        // Lookup must exclude expired key
        const resolved = await resolveActiveApiKeyByKeyHash(expiredKeyHash);
        expect(resolved).toBeNull();

        // Create a key that expires in the future
        const futureDate = new Date(Date.now() + 3600 * 1000 * 24 * 30);
        const futureKey = await createApiKey(ws1Id, app.id, {
            scopes: ["customers:read"],
            expiresAt: futureDate,
        });

        const futureKeyHash = hashApiKey(futureKey.rawSecretKey);
        const resolvedFuture = await resolveActiveApiKeyByKeyHash(futureKeyHash);
        expect(resolvedFuture).not.toBeNull();
        expect(resolvedFuture!.apiKeyId).toBe(futureKey.id);
    });

    it("6. should exclude keys when parent DeveloperApplication is SUSPENDED or REVOKED", async () => {
        const app = await createDeveloperApplication(ws1Id, {
            name: "Suspension Test App",
            createdByUserId: userId,
        });

        const key = await createApiKey(ws1Id, app.id, {
            scopes: ["reporting:read"],
        });

        const keyHash = hashApiKey(key.rawSecretKey);

        // Initially active
        expect(await resolveActiveApiKeyByKeyHash(keyHash)).not.toBeNull();

        // Suspend the application
        await updateDeveloperApplicationStatus(ws1Id, app.id, DeveloperApplicationStatus.SUSPENDED);
        expect(await resolveActiveApiKeyByKeyHash(keyHash)).toBeNull();

        // Reactivate the application
        await updateDeveloperApplicationStatus(ws1Id, app.id, DeveloperApplicationStatus.ACTIVE);
        expect(await resolveActiveApiKeyByKeyHash(keyHash)).not.toBeNull();

        // Revoke the application
        await updateDeveloperApplicationStatus(ws1Id, app.id, DeveloperApplicationStatus.REVOKED);
        expect(await resolveActiveApiKeyByKeyHash(keyHash)).toBeNull();
    });

    it("7. should cascade delete DeveloperApplication and ApiKeys when Workspace is deleted", async () => {
        // Create an ephemeral workspace
        const tempWsId = `ws_temp_${runId}`;
        await prisma.workspace.create({
            data: {
                id: tempWsId,
                name: "Ephemeral Workspace",
                slug: `temp-slug-${runId}`,
            },
        });

        const tempApp = await createDeveloperApplication(tempWsId, {
            name: "Ephemeral App",
            createdByUserId: userId,
        });

        const tempKey = await createApiKey(tempWsId, tempApp.id, {
            scopes: ["work_orders:read"],
        });

        expect(await prisma.developerApplication.findUnique({ where: { id: tempApp.id } })).not.toBeNull();
        expect(await prisma.apiKey.findUnique({ where: { id: tempKey.id } })).not.toBeNull();

        // Delete the workspace
        await prisma.workspace.delete({
            where: { id: tempWsId },
        });

        // Verify cascade deletion
        expect(await prisma.developerApplication.findUnique({ where: { id: tempApp.id } })).toBeNull();
        expect(await prisma.apiKey.findUnique({ where: { id: tempKey.id } })).toBeNull();
    });

    it("8. should list active keys for an application", async () => {
        const app = await createDeveloperApplication(ws1Id, {
            name: "Key Listing App",
            createdByUserId: userId,
        });

        const key1 = await createApiKey(ws1Id, app.id, {
            environment: ApiKeyEnvironment.LIVE,
            scopes: ["work_orders:read"],
        });
        const key2 = await createApiKey(ws1Id, app.id, {
            environment: ApiKeyEnvironment.TEST,
            scopes: ["work_orders:read", "work_orders:write"],
        });

        const keys = await listDeveloperApplicationKeys(ws1Id, app.id);
        expect(keys.length).toBe(2);
        expect(keys.map((k) => k.id)).toContain(key1.id);
        expect(keys.map((k) => k.id)).toContain(key2.id);
    });
});
