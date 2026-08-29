import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  seedIntegrationCatalog,
  SEED_INTEGRATIONS,
  IntegrationCapability,
  IntegrationStatus,
} from "@/lib/integrations";

describe("Phase 1.17.2 — Platform Integration Catalog Seed", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("should define 5 standard catalog entries in SEED_INTEGRATIONS", () => {
    expect(SEED_INTEGRATIONS).toHaveLength(5);
    const ids = SEED_INTEGRATIONS.map((i) => i.id);
    expect(ids).toContain("resend");
    expect(ids).toContain("twilio");
    expect(ids).toContain("quickbooks_online");
    expect(ids).toContain("google_calendar");
    expect(ids).toContain("aws_s3");
  });

  it("should idempotently seed the integration catalog", async () => {
    // First run
    const result1 = await seedIntegrationCatalog(prisma);
    expect(result1.seededCount).toBe(5);
    expect(result1.integrations).toHaveLength(5);

    // Verify entries in DB
    const resend = await prisma.integration.findUnique({ where: { id: "resend" } });
    expect(resend).toBeDefined();
    expect(resend?.name).toBe("Resend");
    expect(resend?.status).toBe(IntegrationStatus.ACTIVE);
    expect(resend?.capabilities).toContain(IntegrationCapability.EMAIL_SEND);
    expect(resend?.capabilities).toContain(IntegrationCapability.WEBHOOK_RECEIVE);
    expect(resend?.authType).toBe("API_KEY");

    const quickbooks = await prisma.integration.findUnique({ where: { id: "quickbooks_online" } });
    expect(quickbooks).toBeDefined();
    expect(quickbooks?.capabilities).toContain(IntegrationCapability.ACCOUNTING_INVOICE_SYNC);
    expect(quickbooks?.authType).toBe("OAUTH2");

    const s3 = await prisma.integration.findUnique({ where: { id: "aws_s3" } });
    expect(s3).toBeDefined();
    expect(s3?.name).toBe("Amazon S3");
    expect(s3?.capabilities).toContain(IntegrationCapability.FILE_UPLOAD);
    expect(s3?.capabilities).toContain(IntegrationCapability.FILE_DOWNLOAD);

    // Second run (Idempotency test)
    const result2 = await seedIntegrationCatalog(prisma);
    expect(result2.seededCount).toBe(5);
  });
});
