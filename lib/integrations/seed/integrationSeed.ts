/**
 * Phase 1.17.2 — Idempotent Platform Integration Catalog Seed
 * Seeds standard catalog integrations (Resend, Twilio, QuickBooks Online, Google Calendar)
 * with platform metadata and capabilities without live credentials or adapter implementations.
 */

import { Prisma, type PrismaClient, type Integration } from "@/generated/prisma/client";
import {
  IntegrationStatus,
  IntegrationCapability,
} from "@/generated/prisma/client";

export interface SeedIntegrationData {
  id: string;
  name: string;
  description: string;
  logoUrl?: string;
  status: IntegrationStatus;
  capabilities: IntegrationCapability[];
  authType: string;
  configSchemaJson?: Prisma.InputJsonValue;
}

export const SEED_INTEGRATIONS: readonly SeedIntegrationData[] = [
  {
    id: "resend",
    name: "Resend",
    description: "Transactional email delivery service built for modern development teams.",
    logoUrl: "/integrations/resend.svg",
    status: IntegrationStatus.ACTIVE,
    capabilities: [
      IntegrationCapability.EMAIL_SEND,
      IntegrationCapability.WEBHOOK_RECEIVE,
    ],
    authType: "API_KEY",
    configSchemaJson: {
      type: "object",
      properties: {
        fromEmail: { type: "string", format: "email" },
        fromName: { type: "string" },
        replyTo: { type: "string", format: "email" },
      },
      required: ["fromEmail"],
    },
  },
  {
    id: "brevo",
    name: "Brevo",
    description: "Transactional email delivery platform with native REST API dispatch.",
    logoUrl: "/integrations/brevo.svg",
    status: IntegrationStatus.ACTIVE,
    capabilities: [
      IntegrationCapability.EMAIL_SEND,
      IntegrationCapability.WEBHOOK_RECEIVE,
    ],
    authType: "API_KEY",
    configSchemaJson: {
      type: "object",
      properties: {
        fromEmail: { type: "string", format: "email" },
        fromName: { type: "string" },
        replyTo: { type: "string", format: "email" },
      },
      required: ["fromEmail"],
    },
  },
  {
    id: "twilio",
    name: "Twilio",
    description: "Cloud communications platform for outbound SMS notifications and messaging.",
    logoUrl: "/integrations/twilio.svg",
    status: IntegrationStatus.ACTIVE,
    capabilities: [
      IntegrationCapability.SMS_SEND,
      IntegrationCapability.WEBHOOK_RECEIVE,
    ],
    authType: "API_KEY",
    configSchemaJson: {
      type: "object",
      properties: {
        accountSid: { type: "string" },
        fromPhoneNumber: { type: "string" },
        messagingServiceSid: { type: "string" },
      },
    },
  },
  {
    id: "quickbooks_online",
    name: "QuickBooks Online",
    description: "Cloud accounting software for invoice, payment, and customer ledger synchronization.",
    logoUrl: "/integrations/quickbooks.svg",
    status: IntegrationStatus.ACTIVE,
    capabilities: [
      IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
      IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
      IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
      IntegrationCapability.WEBHOOK_RECEIVE,
    ],
    authType: "OAUTH2",
    configSchemaJson: {
      type: "object",
      properties: {
        realmId: { type: "string" },
        defaultIncomeAccountId: { type: "string" },
        defaultDepositAccountId: { type: "string" },
      },
    },
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "External calendar scheduling synchronization and technician availability checks.",
    logoUrl: "/integrations/google_calendar.svg",
    status: IntegrationStatus.ACTIVE,
    capabilities: [
      IntegrationCapability.CALENDAR_WRITE,
      IntegrationCapability.CALENDAR_READ,
      IntegrationCapability.WEBHOOK_RECEIVE,
    ],
    authType: "OAUTH2",
    configSchemaJson: {
      type: "object",
      properties: {
        calendarId: { type: "string" },
        timeZone: { type: "string" },
      },
    },
  },
  {
    id: "aws_s3",
    name: "Amazon S3",
    description: "Cloud object storage for work order attachments, invoice PDFs, and photographic evidence.",
    logoUrl: "/integrations/aws_s3.svg",
    status: IntegrationStatus.ACTIVE,
    capabilities: [
      IntegrationCapability.FILE_UPLOAD,
      IntegrationCapability.FILE_DOWNLOAD,
    ],
    authType: "API_KEY",
    configSchemaJson: {
      type: "object",
      properties: {
        bucketName: { type: "string" },
        region: { type: "string" },
      },
      required: ["bucketName"],
    },
  },
] as const;

export interface SeedIntegrationResult {
  seededCount: number;
  integrations: Integration[];
}

/**
 * Idempotently seeds standard integration catalog entries into the platform database.
 */
export async function seedIntegrationCatalog(
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<SeedIntegrationResult> {
  const seededIntegrations: Integration[] = [];

  for (const item of SEED_INTEGRATIONS) {
    const upserted = await prisma.integration.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        name: item.name,
        description: item.description,
        logoUrl: item.logoUrl,
        status: item.status,
        capabilities: item.capabilities,
        authType: item.authType,
        configSchemaJson: item.configSchemaJson ?? Prisma.DbNull,
      },
      update: {
        name: item.name,
        description: item.description,
        logoUrl: item.logoUrl,
        status: item.status,
        capabilities: item.capabilities,
        authType: item.authType,
        configSchemaJson: item.configSchemaJson ?? Prisma.DbNull,
      },
    });

    seededIntegrations.push(upserted);
  }

  return {
    seededCount: seededIntegrations.length,
    integrations: seededIntegrations,
  };
}
