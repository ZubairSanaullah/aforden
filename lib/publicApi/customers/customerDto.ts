import type { Customer, ServiceLocation } from "@/generated/prisma/client";

/**
 * Public Customer DTO conforming to Section 4 & 5 of Phase 1.18.1 Architecture Standard.
 *
 * Strict 15-key contract.
 * Excluded internal fields:
 * - `workspaceId` (Tenant boundary security)
 * - `notes` (Internal private workspace notes)
 * - Relational joins (contacts, locations, workOrders, assets, quotes, invoices, payments, workspace)
 */
export interface PublicCustomerDto {
    id: string;
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
    status: "ACTIVE" | "INACTIVE";
    createdAt: string;
    updatedAt: string;
}

export const APPROVED_PUBLIC_CUSTOMER_DTO_KEYS: readonly (keyof PublicCustomerDto)[] = [
    "id",
    "customerNumber",
    "name",
    "email",
    "phone",
    "website",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "postalCode",
    "country",
    "status",
    "createdAt",
    "updatedAt",
] as const;

/**
 * Public ServiceLocation DTO conforming to Section 4 & 5 of Phase 1.18.1 Architecture Standard.
 *
 * Strict 14-key contract.
 * Excluded internal fields:
 * - `notes` (Internal private notes)
 * - Relational joins (customer, workOrders, assets, quotes, invoices)
 */
export interface PublicServiceLocationDto {
    id: string;
    customerId: string;
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    country: string;
    latitude: number | null;
    longitude: number | null;
    isPrimary: boolean;
    createdAt: string;
    updatedAt: string;
}

export const APPROVED_PUBLIC_SERVICE_LOCATION_DTO_KEYS: readonly (keyof PublicServiceLocationDto)[] = [
    "id",
    "customerId",
    "name",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "postalCode",
    "country",
    "latitude",
    "longitude",
    "isPrimary",
    "createdAt",
    "updatedAt",
] as const;

/**
 * Maps a Prisma Customer model to canonical PublicCustomerDto.
 */
export function toPublicCustomerDto(record: Customer): PublicCustomerDto {
    return {
        id: record.id,
        customerNumber: record.customerNumber ?? null,
        name: record.name,
        email: record.email ?? null,
        phone: record.phone ?? null,
        website: record.website ?? null,
        addressLine1: record.addressLine1 ?? null,
        addressLine2: record.addressLine2 ?? null,
        city: record.city ?? null,
        state: record.state ?? null,
        postalCode: record.postalCode ?? null,
        country: record.country ?? null,
        status: record.status as "ACTIVE" | "INACTIVE",
        createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
        updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt),
    };
}

/**
 * Maps a Prisma ServiceLocation model to canonical PublicServiceLocationDto.
 */
export function toPublicServiceLocationDto(record: ServiceLocation): PublicServiceLocationDto {
    return {
        id: record.id,
        customerId: record.customerId,
        name: record.name,
        addressLine1: record.addressLine1,
        addressLine2: record.addressLine2 ?? null,
        city: record.city,
        state: record.state ?? null,
        postalCode: record.postalCode ?? null,
        country: record.country,
        latitude: record.latitude !== null && record.latitude !== undefined ? Number(record.latitude) : null,
        longitude: record.longitude !== null && record.longitude !== undefined ? Number(record.longitude) : null,
        isPrimary: Boolean(record.isPrimary),
        createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
        updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt),
    };
}
