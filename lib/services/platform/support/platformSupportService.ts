import { prisma } from "@/lib/prisma";
import {
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    assertPlatformPermission,
} from "../authorization";
import {
    recordPlatformAuditEvent,
    PLATFORM_AUDIT_EVENTS,
} from "../audit";
import {
    WorkspaceSupportDiagnosticsDto,
    SupportDiagnosticsOptions,
} from "./types";
import { PlatformWorkspaceSupportNotFoundError } from "./errors";

/**
 * Retrieves comprehensive read-only support diagnostics for a target workspace.
 * 
 * Guarantees & Invariants:
 * - Zero Write-Impersonation Invariant: Read-only by construction. Only invokes read methods.
 * - Gated by platform.workspaces.support_view (OWNER, ADMIN, SUPPORT, SECURITY).
 * - Synchronously records a WORKSPACE_SUPPORT_ACCESSED audit record before returning tenant data.
 * - Non-dangerous read access: exempt from Tier-2 step-up auth and justification reason length validation.
 */
export async function getWorkspaceSupportDiagnostics(
    context: PlatformAuthorizationContext,
    workspaceId: string,
    options?: SupportDiagnosticsOptions
): Promise<WorkspaceSupportDiagnosticsDto> {
    // 1. Permission Gate (OWNER, ADMIN, SUPPORT, SECURITY)
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.WORKSPACES_SUPPORT_VIEW);

    const accessedAt = new Date();

    // 2. Synchronous Compliance Audit Record (records privacy boundary access before returning payload)
    await recordPlatformAuditEvent({
        actor: context,
        action: PLATFORM_AUDIT_EVENTS.WORKSPACE_SUPPORT_ACCESSED,
        targetType: "WORKSPACE",
        targetId: workspaceId,
        workspaceId,
        requestId: options?.requestId ?? `req_support_${Date.now()}`,
        ipAddress: options?.ipAddress ?? "127.0.0.1",
        userAgent: options?.userAgent ?? null,
        reason: null,
        previousState: null,
        newState: null,
        metadata: options?.ticketReference ? { ticketReference: options.ticketReference } : null,
    });

    // 3. Read-Only Diagnostics Data Fetching
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            defaultCurrencyCode: true,
            createdAt: true,
            updatedAt: true,
            organization: {
                select: {
                    id: true,
                    businessName: true,
                    legalName: true,
                    logoUrl: true,
                    email: true,
                    phone: true,
                    status: true,
                },
            },
        },
    });

    if (!workspace) {
        throw new PlatformWorkspaceSupportNotFoundError(workspaceId);
    }

    const [
        members,
        customerCount,
        workOrderCount,
        assetCount,
        invoiceCount,
        partCount,
        quoteCount,
        appointmentCount,
        workOrdersByStatus,
        outboxByStatus,
        outboxTotal,
        automationByStatus,
        automationTotal,
        connections,
        connByStatus,
        connTotal,
    ] = await Promise.all([
        prisma.workspaceMember.findMany({
            where: { workspaceId },
            select: {
                id: true,
                userId: true,
                role: true,
                status: true,
                createdAt: true,
                user: {
                    select: {
                        name: true,
                        email: true,
                        avatarUrl: true,
                        status: true,
                    },
                },
            },
        }),
        prisma.customer.count({ where: { workspaceId } }),
        prisma.workOrder.count({ where: { workspaceId } }),
        prisma.asset.count({ where: { workspaceId } }),
        prisma.invoice.count({ where: { workspaceId } }),
        prisma.part.count({ where: { workspaceId } }),
        prisma.quote.count({ where: { workspaceId } }),
        prisma.scheduleAppointment.count({ where: { workspaceId } }),
        prisma.workOrder.groupBy({
            by: ["status"],
            where: { workspaceId },
            _count: true,
        }),
        prisma.notificationOutbox.groupBy({
            by: ["status"],
            where: { workspaceId },
            _count: true,
        }),
        prisma.notificationOutbox.count({ where: { workspaceId } }),
        prisma.automationExecution.groupBy({
            by: ["status"],
            where: { workspaceId },
            _count: true,
        }),
        prisma.automationExecution.count({ where: { workspaceId } }),
        prisma.integrationConnection.findMany({
            where: { workspaceId },
            select: {
                id: true,
                integrationId: true,
                connectionKey: true,
                status: true,
                lastTestedAt: true,
                externalAccountName: true,
            },
        }),
        prisma.integrationConnection.groupBy({
            by: ["status"],
            where: { workspaceId },
            _count: true,
        }),
        prisma.integrationConnection.count({ where: { workspaceId } }),
    ]);

    const memberRoleBreakdown: Record<string, number> = {};
    const memberStatusBreakdown: Record<string, number> = {};
    const memberDirectory = members.map((m) => {
        memberRoleBreakdown[m.role] = (memberRoleBreakdown[m.role] ?? 0) + 1;
        memberStatusBreakdown[m.status] = (memberStatusBreakdown[m.status] ?? 0) + 1;
        return {
            id: m.id,
            userId: m.userId,
            role: m.role,
            status: m.status,
            joinedAt: m.createdAt,
            user: {
                name: m.user.name,
                email: m.user.email,
                avatarUrl: m.user.avatarUrl,
                userStatus: m.user.status,
            },
        };
    });

    const workOrderStatusBreakdown: Record<string, number> = {};
    for (const row of workOrdersByStatus) {
        workOrderStatusBreakdown[row.status] = row._count;
    }

    const outboxStatusBreakdown: Record<string, number> = {};
    for (const row of outboxByStatus) {
        outboxStatusBreakdown[row.status] = row._count;
    }

    const automationStatusBreakdown: Record<string, number> = {};
    for (const row of automationByStatus) {
        automationStatusBreakdown[row.status] = row._count;
    }

    const connectionStatusBreakdown: Record<string, number> = {};
    for (const row of connByStatus) {
        connectionStatusBreakdown[row.status] = row._count;
    }

    return {
        workspaceId,
        accessedAt,
        ticketReference: options?.ticketReference ?? null,
        configuration: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
            timezone: workspace.timezone,
            defaultCurrencyCode: workspace.defaultCurrencyCode,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
            organization: workspace.organization
                ? {
                      id: workspace.organization.id,
                      businessName: workspace.organization.businessName,
                      legalName: workspace.organization.legalName,
                      logoUrl: workspace.organization.logoUrl,
                      email: workspace.organization.email,
                      phone: workspace.organization.phone,
                      status: workspace.organization.status,
                  }
                : null,
        },
        memberships: {
            totalMembers: members.length,
            roleBreakdown: memberRoleBreakdown,
            statusBreakdown: memberStatusBreakdown,
            members: memberDirectory,
        },
        operationalMetadata: {
            counts: {
                customers: customerCount,
                workOrders: workOrderCount,
                assets: assetCount,
                invoices: invoiceCount,
                parts: partCount,
                quotes: quoteCount,
                scheduleAppointments: appointmentCount,
            },
            workOrderStatusBreakdown,
        },
        queueStatuses: {
            notificationOutbox: {
                total: outboxTotal,
                statusBreakdown: outboxStatusBreakdown,
            },
            automationExecutions: {
                total: automationTotal,
                statusBreakdown: automationStatusBreakdown,
            },
        },
        integrationStatuses: {
            totalConnections: connTotal,
            statusBreakdown: connectionStatusBreakdown,
            activeConnections: connections.map((c) => ({
                id: c.id,
                integrationId: c.integrationId,
                connectionKey: c.connectionKey,
                status: c.status,
                lastTestedAt: c.lastTestedAt,
                externalAccountName: c.externalAccountName,
            })),
        },
    };
}
