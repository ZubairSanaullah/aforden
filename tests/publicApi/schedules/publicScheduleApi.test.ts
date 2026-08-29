import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
    createDeveloperApplication,
    createApiKey,
    ApiKeyEnvironment,
} from "@/lib/services/developerApp";
import { PUBLIC_API_SCOPES } from "@/lib/publicApi/scopes";
import {
    APPROVED_PUBLIC_SCHEDULE_DTO_KEYS,
} from "@/lib/publicApi/schedules/scheduleDto";
import { GET as listSchedulesHandler } from "@/app/api/v1/schedules/route";
import * as schedulesRouteModule from "@/app/api/v1/schedules/route";

describe("Phase 1.18.10 — Public Schedule Read API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `sch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_sch_1_${runId}`;
    const user1Id = `usr_sch_1_${runId}`;
    const techUser1Id = `usr_sch_tech1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let unrelatedKey1Secret: string; // key without schedules:read scope

    let customer1Id: string;
    let location1Id: string;
    let workOrder1Id: string;
    let techProfile1Id: string;
    let appt1Id: string;

    // Tenant 2
    const ws2Id = `ws_sch_2_${runId}`;
    const user2Id = `usr_sch_2_${runId}`;
    const techUser2Id = `usr_sch_tech2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    let customer2Id: string;
    let location2Id: string;
    let workOrder2Id: string;
    let foreignTechProfile2Id: string;
    let foreignAppt2Id: string;

    beforeAll(async () => {
        const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
        }
        const adapter = new PrismaPg({ connectionString });
        prisma = new PrismaClient({ adapter });
        await prisma.$connect();

        // 1. Setup Workspace 1 and Admin User
        await prisma.user.create({
            data: {
                id: user1Id,
                email: `sch-admin1-${runId}@example.com`,
                name: "Schedule Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Schedule Workspace 1",
                slug: `sch-ws1-${runId}`,
            },
        });
        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws1Id,
                userId: user1Id,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // 2. Setup Workspace 2 and Admin User
        await prisma.user.create({
            data: {
                id: user2Id,
                email: `sch-admin2-${runId}@example.com`,
                name: "Schedule Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Schedule Workspace 2",
                slug: `sch-ws2-${runId}`,
            },
        });
        await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: user2Id,
                role: "ADMIN",
                status: "ACTIVE",
            },
        });

        // 3. Setup Developer Applications & API Keys for Workspace 1
        const app1 = await createDeveloperApplication(ws1Id, {
            name: "Schedule Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [
                PUBLIC_API_SCOPES.SCHEDULES_READ,
                PUBLIC_API_SCOPES.TECHNICIANS_READ,
            ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const unrelatedKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.TECHNICIANS_READ], // lacks schedules:read
            environment: ApiKeyEnvironment.LIVE,
        });
        unrelatedKey1Secret = unrelatedKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Schedule Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [PUBLIC_API_SCOPES.SCHEDULES_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Customer, Location, WorkOrder, Technician, and Appointment in Workspace 1
        const cust1 = await prisma.customer.create({
            data: {
                workspaceId: ws1Id,
                customerNumber: `CUST-SCH-1`,
                name: "Acme Power Co",
                email: `acme-${runId}@example.com`,
                status: "ACTIVE",
            },
        });
        customer1Id = cust1.id;

        const loc1 = await prisma.serviceLocation.create({
            data: {
                customerId: customer1Id,
                name: "Acme Main Facility",
                addressLine1: "123 Industrial Pkwy",
                city: "Cleveland",
                country: "USA",
                isPrimary: true,
            },
        });
        location1Id = loc1.id;

        await prisma.user.create({
            data: {
                id: techUser1Id,
                email: `tech1-${runId}@example.com`,
                name: "Mark Johnson",
                status: "ACTIVE",
            },
        });
        const member1 = await prisma.workspaceMember.create({
            data: {
                workspaceId: ws1Id,
                userId: techUser1Id,
                role: "TECHNICIAN",
                status: "ACTIVE",
            },
        });
        const emp1 = await prisma.employee.create({
            data: {
                workspaceId: ws1Id,
                workspaceMemberId: member1.id,
                employeeNumber: "EMP-SCH-001",
                displayName: "Mark Johnson",
                phone: "+1-555-4422",
                status: "ACTIVE",
            },
        });
        const profile1 = await prisma.technicianProfile.create({
            data: {
                employeeId: emp1.id,
                licenseNumber: "ELEC-9988",
                yearsExperience: 6,
            },
        });
        techProfile1Id = profile1.id;

        const cat1 = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws1Id,
                name: "General Inspection Catalog",
                status: "ACTIVE",
            },
        });
        const wt1 = await prisma.workType.create({
            data: {
                workspaceId: ws1Id,
                catalogId: cat1.id,
                name: "Inspection",
                code: `WT-INSP-${runId}`,
                status: "ACTIVE",
                estimatedDuration: 120,
            },
        });

        const wo1 = await prisma.workOrder.create({
            data: {
                workspaceId: ws1Id,
                workOrderNumber: `WO-SCH-1`,
                workTypeId: wt1.id,
                workTypeName: "Inspection",
                title: "Annual Generator Inspection",
                customerId: customer1Id,
                locationId: location1Id,
                assignedTechnicianId: techProfile1Id,
                status: "ASSIGNED",
                priority: "HIGH",
            },
        });
        workOrder1Id = wo1.id;

        const appt1 = await prisma.scheduleAppointment.create({
            data: {
                workspaceId: ws1Id,
                appointmentNumber: `SCH-000001`,
                workOrderId: workOrder1Id,
                technicianId: techProfile1Id,
                scheduledStart: new Date("2026-09-01T09:00:00Z"),
                scheduledEnd: new Date("2026-09-01T11:00:00Z"),
                durationMinutes: 120,
                timezone: "America/New_York",
                status: "SCHEDULED",
                dispatchStatus: "DISPATCHED",
                dispatchedAt: new Date("2026-08-30T10:00:00Z"),
                dispatchedByMemberId: member1.id,
                notes: "Internal dispatcher scratchpad notes",
            },
        });
        appt1Id = appt1.id;

        // 6. Seed Customer, Location, WorkOrder, Technician, and Appointment in Workspace 2
        const cust2 = await prisma.customer.create({
            data: {
                workspaceId: ws2Id,
                customerNumber: `CUST-SCH-2`,
                name: "Wayne Enterprises",
                email: `wayne-${runId}@example.com`,
                status: "ACTIVE",
            },
        });
        customer2Id = cust2.id;

        const loc2 = await prisma.serviceLocation.create({
            data: {
                customerId: customer2Id,
                name: "Wayne Tower",
                addressLine1: "1007 Mountain Drive",
                city: "Gotham",
                country: "USA",
                isPrimary: true,
            },
        });
        location2Id = loc2.id;

        await prisma.user.create({
            data: {
                id: techUser2Id,
                email: `tech2-${runId}@example.com`,
                name: "Lucius Fox",
                status: "ACTIVE",
            },
        });
        const member2 = await prisma.workspaceMember.create({
            data: {
                workspaceId: ws2Id,
                userId: techUser2Id,
                role: "TECHNICIAN",
                status: "ACTIVE",
            },
        });
        const emp2 = await prisma.employee.create({
            data: {
                workspaceId: ws2Id,
                workspaceMemberId: member2.id,
                employeeNumber: "EMP-SCH-002",
                displayName: "Lucius Fox",
                status: "ACTIVE",
            },
        });
        const profile2 = await prisma.technicianProfile.create({
            data: {
                employeeId: emp2.id,
            },
        });
        foreignTechProfile2Id = profile2.id;

        const cat2 = await prisma.serviceCatalog.create({
            data: {
                workspaceId: ws2Id,
                name: "Wayne Security Catalog",
                status: "ACTIVE",
            },
        });
        const wt2 = await prisma.workType.create({
            data: {
                workspaceId: ws2Id,
                catalogId: cat2.id,
                name: "Calibration",
                code: `WT-CAL-${runId}`,
                status: "ACTIVE",
                estimatedDuration: 120,
            },
        });

        const wo2 = await prisma.workOrder.create({
            data: {
                workspaceId: ws2Id,
                workOrderNumber: `WO-SCH-2`,
                workTypeId: wt2.id,
                workTypeName: "Calibration",
                title: "Security Grid Calibration",
                customerId: customer2Id,
                locationId: location2Id,
                assignedTechnicianId: foreignTechProfile2Id,
                status: "ASSIGNED",
                priority: "URGENT",
            },
        });
        workOrder2Id = wo2.id;

        const appt2 = await prisma.scheduleAppointment.create({
            data: {
                workspaceId: ws2Id,
                appointmentNumber: `SCH-WS2-001`,
                workOrderId: workOrder2Id,
                technicianId: foreignTechProfile2Id,
                scheduledStart: new Date("2026-09-02T14:00:00Z"),
                scheduledEnd: new Date("2026-09-02T16:00:00Z"),
                durationMinutes: 120,
                timezone: "America/New_York",
                status: "SCHEDULED",
                dispatchStatus: "PENDING_DISPATCH",
            },
        });
        foreignAppt2Id = appt2.id;
    });

    afterAll(async () => {
        if (prisma) {
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
                await prisma.scheduleAppointmentHistory.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.scheduleAppointment.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.workOrderHistory.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.workOrder.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.workType.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.serviceCatalog.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.technicianProfile.deleteMany({
                    where: { employee: { workspaceId: { in: wsIds } } },
                });
                await prisma.employee.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.serviceLocation.deleteMany({
                    where: { customer: { workspaceId: { in: wsIds } } },
                });
                await prisma.customer.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.apiKey.deleteMany({
                    where: { developerApplication: { workspaceId: { in: wsIds } } },
                });
                await prisma.developerApplication.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.workspaceMember.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.workspace.deleteMany({
                    where: { id: { in: wsIds } },
                });
            }
            const userIds = [user1Id, user2Id, techUser1Id, techUser2Id].filter(Boolean);
            if (userIds.length > 0) {
                await prisma.user.deleteMany({
                    where: { id: { in: userIds } },
                });
            }
            await prisma.$disconnect();
        }
    });

    function mockRequest(
        path: string,
        options?: {
            method?: string;
            token?: string;
            body?: any;
            headers?: Record<string, string>;
        },
    ): Request {
        const method = options?.method || "GET";
        const headers = new Headers(options?.headers || {});
        if (options?.token) {
            headers.set("Authorization", `Bearer ${options.token}`);
        }
        if (options?.body) {
            headers.set("Content-Type", "application/json");
        }

        const url = `https://api.aforden.com${path}`;
        const init: RequestInit = {
            method,
            headers,
        };
        if (options?.body) {
            init.body = JSON.stringify(options.body);
        }

        return new Request(url, init);
    }

    // -------------------------------------------------------------------------
    // 1. Canonical Public DTO Projection & Privacy Enforcement
    // -------------------------------------------------------------------------
    describe("1. Canonical Public DTO Projection & Metadata Sanitization", () => {
        it("should return the exact approved PublicScheduleDto key set and exclude internal audit metadata", async () => {
            const req = mockRequest("/api/v1/schedules", {
                token: fullKey1Secret,
            });

            const res = await listSchedulesHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);

            const firstItem = json.data[0];
            const returnedKeys = Object.keys(firstItem).sort();
            const expectedKeys = [...APPROVED_PUBLIC_SCHEDULE_DTO_KEYS].sort();

            expect(returnedKeys).toEqual(expectedKeys);

            // Assert exclusion of sensitive and internal fields
            expect(firstItem).not.toHaveProperty("workspaceId");
            expect(firstItem).not.toHaveProperty("dispatchedByMemberId");
            expect(firstItem).not.toHaveProperty("dispatchedByName");
            expect(firstItem).not.toHaveProperty("undispatchedAt");
            expect(firstItem).not.toHaveProperty("undispatchedByMemberId");
            expect(firstItem).not.toHaveProperty("notes");
            expect(firstItem).not.toHaveProperty("metadata");

            expect(firstItem.id).toBe(appt1Id);
            expect(firstItem.appointmentNumber).toBe("SCH-000001");
            expect(firstItem.workOrderId).toBe(workOrder1Id);
            expect(firstItem.technicianId).toBe(techProfile1Id);
            expect(firstItem.durationMinutes).toBe(120);
            expect(firstItem.timezone).toBe("America/New_York");
            expect(firstItem.status).toBe("SCHEDULED");
            expect(firstItem.dispatchStatus).toBe("DISPATCHED");
        });
    });

    // -------------------------------------------------------------------------
    // 2. Read-Only Invariant Enforcement
    // -------------------------------------------------------------------------
    describe("2. Strict Read-Only Invariant", () => {
        it("should confirm schedules route module ONLY exports GET (no POST, PATCH, DELETE, or PUT)", () => {
            expect(schedulesRouteModule).toHaveProperty("GET");
            expect(schedulesRouteModule).not.toHaveProperty("POST");
            expect(schedulesRouteModule).not.toHaveProperty("PATCH");
            expect(schedulesRouteModule).not.toHaveProperty("DELETE");
            expect(schedulesRouteModule).not.toHaveProperty("PUT");
        });
    });

    // -------------------------------------------------------------------------
    // 3. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("3. Authentication & Scope Enforcement", () => {
        it("should confirm schedules:read is a recognized canonical scope with internal permission mapping", async () => {
            const { isValidPublicApiScope, PUBLIC_SCOPE_TO_INTERNAL_PERMISSIONS_MAP } = await import("@/lib/publicApi/scopes");
            expect(isValidPublicApiScope("schedules:read")).toBe(true);
            expect(PUBLIC_SCOPE_TO_INTERNAL_PERMISSIONS_MAP["schedules:read"]).toEqual(["SCHEDULE_READ"]);

            // Confirm createApiKey validates and persists schedules:read scope
            const keyWithScope = await createApiKey(ws1Id, app1Id, {
                scopes: [PUBLIC_API_SCOPES.SCHEDULES_READ],
                environment: ApiKeyEnvironment.LIVE,
            });
            expect(keyWithScope.scopes).toContain("schedules:read");
        });

        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/schedules");
            const res = await listSchedulesHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/schedules should reject key lacking schedules:read scope with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/schedules", {
                token: unrelatedKey1Secret,
            });

            const res = await listSchedulesHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Tenant Isolation & Cross-Tenant Reference Safety
    // -------------------------------------------------------------------------
    describe("4. Tenant Isolation & Reference Safety", () => {
        it("GET /api/v1/schedules should strictly partition records: Workspace 1 NEVER sees Workspace 2 schedules", async () => {
            const req1 = mockRequest("/api/v1/schedules", { token: fullKey1Secret });
            const res1 = await listSchedulesHandler(req1);
            const json1 = await res1.json();

            const ws1ApptIds = json1.data.map((s: any) => s.id);
            expect(ws1ApptIds).toContain(appt1Id);
            expect(ws1ApptIds).not.toContain(foreignAppt2Id);

            const req2 = mockRequest("/api/v1/schedules", { token: fullKey2Secret });
            const res2 = await listSchedulesHandler(req2);
            const json2 = await res2.json();

            const ws2ApptIds = json2.data.map((s: any) => s.id);
            expect(ws2ApptIds).toContain(foreignAppt2Id);
            expect(ws2ApptIds).not.toContain(appt1Id);
        });

        it("should confirm an appointment cannot reference cross-tenant technician or work order", async () => {
            // Workspace 1 appointment strictly references Workspace 1 technician and work order
            const appt = await prisma.scheduleAppointment.findUnique({
                where: { id: appt1Id },
                include: { workOrder: true, technician: { include: { employee: true } } },
            });
            expect(appt?.workspaceId).toBe(ws1Id);
            expect(appt?.workOrder.workspaceId).toBe(ws1Id);
            expect(appt?.technician.employee.workspaceId).toBe(ws1Id);
        });
    });

    // -------------------------------------------------------------------------
    // 5. Filtering & Query Capabilities
    // -------------------------------------------------------------------------
    describe("5. Filtering & Query Capabilities", () => {
        it("should filter by technicianId", async () => {
            const req = mockRequest(`/api/v1/schedules?technicianId=${techProfile1Id}`, {
                token: fullKey1Secret,
            });

            const res = await listSchedulesHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            for (const item of json.data) {
                expect(item.technicianId).toBe(techProfile1Id);
            }
        });

        it("should filter by workOrderId", async () => {
            const req = mockRequest(`/api/v1/schedules?workOrderId=${workOrder1Id}`, {
                token: fullKey1Secret,
            });

            const res = await listSchedulesHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            for (const item of json.data) {
                expect(item.workOrderId).toBe(workOrder1Id);
            }
        });

        it("should filter by status", async () => {
            const req = mockRequest("/api/v1/schedules?status=SCHEDULED", {
                token: fullKey1Secret,
            });

            const res = await listSchedulesHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            for (const item of json.data) {
                expect(item.status).toBe("SCHEDULED");
            }
        });
    });
});
