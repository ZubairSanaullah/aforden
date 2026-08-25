/**
 * Phase 1.13.7 — Notification Provider Interfaces & Data Types
 * Vendor-agnostic communication provider abstractions for Email, In-App, SMS, and Push.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";

// ==========================================
// EMAIL PROVIDER CONTRACTS
// ==========================================

export interface SendEmailInput {
    workspaceId: string;
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    from?: string;
    replyTo?: string;
    metadata?: Record<string, unknown>;
}

export interface SendEmailResult {
    success: boolean;
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    isRetryable: boolean;
}

export interface EmailProvider {
    readonly name: string;
    sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

// ==========================================
// IN-APP PROVIDER CONTRACTS
// ==========================================

export interface PublishInAppInput {
    workspaceId: string;
    memberId: string;
    notificationId: string;
    title: string;
    body: string;
    linkUrl?: string | null;
    sourceEntity?: string | null;
    sourceId?: string | null;
}

export interface PublishInAppResult {
    success: boolean;
    feedItemId?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
}

export interface InAppProvider {
    readonly name: string;
    publishInApp(
        prisma: PrismaClient | Prisma.TransactionClient,
        input: PublishInAppInput,
    ): Promise<PublishInAppResult>;
}

// ==========================================
// SMS PROVIDER CONTRACTS
// ==========================================

export interface SendSmsInput {
    workspaceId: string;
    to: string; // E.164 phone number
    body: string;
    from?: string;
    metadata?: Record<string, unknown>;
}

export interface SendSmsResult {
    success: boolean;
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    isRetryable: boolean;
}

export interface SMSProvider {
    readonly name: string;
    sendSms(input: SendSmsInput): Promise<SendSmsResult>;
}

// ==========================================
// PUSH PROVIDER CONTRACTS
// ==========================================

export interface SendPushInput {
    workspaceId: string;
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
}

export interface SendPushResult {
    success: boolean;
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    isRetryable: boolean;
}

export interface PushProvider {
    readonly name: string;
    sendPush(input: SendPushInput): Promise<SendPushResult>;
}
