export interface WorkspaceConfigurationDto {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    defaultCurrencyCode: string;
    createdAt: Date;
    updatedAt: Date;
    organization: {
        id: string;
        businessName: string;
        legalName: string | null;
        logoUrl: string | null;
        email: string | null;
        phone: string | null;
        status: string;
    } | null;
}

export interface WorkspaceMemberDirectoryItemDto {
    id: string;
    userId: string;
    role: string;
    status: string;
    joinedAt: Date;
    user: {
        name: string | null;
        email: string;
        avatarUrl: string | null;
        userStatus: string;
    };
}

export interface WorkspaceMemberDirectoryDto {
    totalMembers: number;
    roleBreakdown: Record<string, number>;
    statusBreakdown: Record<string, number>;
    members: WorkspaceMemberDirectoryItemDto[];
}

export interface WorkspaceOperationalMetadataDto {
    counts: {
        customers: number;
        workOrders: number;
        assets: number;
        invoices: number;
        parts: number;
        quotes: number;
        scheduleAppointments: number;
    };
    workOrderStatusBreakdown: Record<string, number>;
}

export interface WorkspaceQueueStatusDto {
    notificationOutbox: {
        total: number;
        statusBreakdown: Record<string, number>;
    };
    automationExecutions: {
        total: number;
        statusBreakdown: Record<string, number>;
    };
}

export interface WorkspaceIntegrationStatusDto {
    totalConnections: number;
    statusBreakdown: Record<string, number>;
    activeConnections: Array<{
        id: string;
        integrationId: string;
        connectionKey: string;
        status: string;
        lastTestedAt: Date | null;
        externalAccountName: string | null;
    }>;
}

export interface WorkspaceSupportDiagnosticsDto {
    workspaceId: string;
    accessedAt: Date;
    ticketReference: string | null;
    configuration: WorkspaceConfigurationDto;
    memberships: WorkspaceMemberDirectoryDto;
    operationalMetadata: WorkspaceOperationalMetadataDto;
    queueStatuses: WorkspaceQueueStatusDto;
    integrationStatuses: WorkspaceIntegrationStatusDto;
}

export interface SupportDiagnosticsOptions {
    ticketReference?: string | null;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
}
