import type { Customer, CustomerContact, CustomerStatus, ServiceLocation } from "@/generated/prisma/client";

export interface PaginationMetadata {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

export interface CustomerListResult {
    items: Customer[];
    pagination: PaginationMetadata;
}

export interface CustomerContactListResult {
    items: CustomerContact[];
    pagination: PaginationMetadata;
}

export interface ServiceLocationListResult {
    items: ServiceLocation[];
    pagination: PaginationMetadata;
}

export type CustomerServiceLocationListResult = ServiceLocationListResult;

/**
 * Operational customer summary projection for downstream domains (Work Orders, Scheduling, Billing).
 */
export interface CustomerOperationalReadModel {
    id: string;
    workspaceId: string;
    customerNumber: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    status: CustomerStatus;
    notes: string | null;
    primaryContact: CustomerContact | null;
    primaryLocation: ServiceLocation | null;
    contactsCount: number;
    locationsCount: number;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Operational service location projection for downstream field dispatch and scheduling.
 */
export interface ServiceLocationOperationalReadModel {
    id: string;
    customerId: string;
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    country: string;
    latitude: ServiceLocation["latitude"];
    longitude: ServiceLocation["longitude"];
    notes: string | null;
    isPrimary: boolean;
    customer: {
        id: string;
        customerNumber: string | null;
        name: string;
        status: CustomerStatus;
    };
    createdAt: Date;
    updatedAt: Date;
}
