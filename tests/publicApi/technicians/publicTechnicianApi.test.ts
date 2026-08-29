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
    APPROVED_PUBLIC_TECHNICIAN_DTO_KEYS,
} from "@/lib/publicApi/technicians/technicianDto";
import { GET as listTechniciansHandler } from "@/app/api/v1/technicians/route";
import * as techniciansRouteModule from "@/app/api/v1/technicians/route";
import { GET as getTechnicianHandler } from "@/app/api/v1/technicians/[id]/route";
import * as technicianItemRouteModule from "@/app/api/v1/technicians/[id]/route";

describe("Phase 1.18.10 — Public Technician Read API Endpoints", () => {
    let prisma: PrismaClient;
    const runId = `tech_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Tenant 1
    const ws1Id = `ws_tech_1_${runId}`;
    const user1Id = `usr_tech_1_${runId}`;
    const techUser1Id = `usr_tech_staff1_${runId}`;
    let app1Id: string;
    let fullKey1Secret: string;
    let unrelatedKey1Secret: string; // key without technicians:read scope

    let techProfile1Id: string;
    let skill1Id: string;
    let serviceArea1Id: string;

    // Tenant 2
    const ws2Id = `ws_tech_2_${runId}`;
    const user2Id = `usr_tech_2_${runId}`;
    const techUser2Id = `usr_tech_staff2_${runId}`;
    let app2Id: string;
    let fullKey2Secret: string;

    let foreignTechProfile2Id: string;

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
                email: `tech-admin1-${runId}@example.com`,
                name: "Tech Admin 1",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws1Id,
                name: "Technician Workspace 1",
                slug: `tech-ws1-${runId}`,
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
                email: `tech-admin2-${runId}@example.com`,
                name: "Tech Admin 2",
                status: "ACTIVE",
            },
        });
        await prisma.workspace.create({
            data: {
                id: ws2Id,
                name: "Technician Workspace 2",
                slug: `tech-ws2-${runId}`,
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
            name: "Technician Integration App 1",
            createdByUserId: user1Id,
        });
        app1Id = app1.id;

        const fullKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [
                PUBLIC_API_SCOPES.TECHNICIANS_READ,
                PUBLIC_API_SCOPES.SCHEDULES_READ,
            ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey1Secret = fullKey1.rawSecretKey;

        const unrelatedKey1 = await createApiKey(ws1Id, app1Id, {
            scopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        unrelatedKey1Secret = unrelatedKey1.rawSecretKey;

        // 4. Setup Developer Application & API Key for Workspace 2
        const app2 = await createDeveloperApplication(ws2Id, {
            name: "Technician Integration App 2",
            createdByUserId: user2Id,
        });
        app2Id = app2.id;

        const fullKey2 = await createApiKey(ws2Id, app2Id, {
            scopes: [PUBLIC_API_SCOPES.TECHNICIANS_READ],
            environment: ApiKeyEnvironment.LIVE,
        });
        fullKey2Secret = fullKey2.rawSecretKey;

        // 5. Seed Technician Staff & Profile in Workspace 1
        await prisma.user.create({
            data: {
                id: techUser1Id,
                email: `tech-staff1-${runId}@example.com`,
                name: "Sarah Jenkins",
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
        const dept1 = await prisma.department.create({
            data: {
                workspaceId: ws1Id,
                name: "Field Operations",
            },
        });
        const job1 = await prisma.jobTitle.create({
            data: {
                workspaceId: ws1Id,
                name: "Senior HVAC Specialist",
            },
        });
        const emp1 = await prisma.employee.create({
            data: {
                workspaceId: ws1Id,
                workspaceMemberId: member1.id,
                employeeNumber: "EMP-TECH-001",
                displayName: "Sarah Jenkins",
                phone: "+1-555-0199",
                hireDate: new Date("2021-03-15"),
                notes: "Sensitive internal HR performance review notes",
                departmentId: dept1.id,
                jobTitleId: job1.id,
                status: "ACTIVE",
            },
        });
        const profile1 = await prisma.technicianProfile.create({
            data: {
                employeeId: emp1.id,
                licenseNumber: "HVAC-LIC-998822",
                yearsExperience: 8,
                emergencyContact: "+1-555-9911 (Spouse)",
                notes: "Private supervisor notes regarding equipment certifications",
            },
        });
        techProfile1Id = profile1.id;

        const skill1 = await prisma.skill.create({
            data: {
                workspaceId: ws1Id,
                name: "Chiller Overhaul",
                description: "HVAC Chiller maintenance and overhaul",
            },
        });
        skill1Id = skill1.id;

        await prisma.technicianSkill.create({
            data: {
                technicianProfileId: techProfile1Id,
                skillId: skill1.id,
                proficiency: "EXPERT",
            },
        });

        const area1 = await prisma.serviceArea.create({
            data: {
                workspaceId: ws1Id,
                name: "Metro Detroit North",
                description: "Northern suburbs of Detroit",
            },
        });
        serviceArea1Id = area1.id;

        await prisma.technicianServiceArea.create({
            data: {
                technicianProfileId: techProfile1Id,
                serviceAreaId: area1.id,
            },
        });

        // 6. Seed Technician Staff & Profile in Workspace 2
        await prisma.user.create({
            data: {
                id: techUser2Id,
                email: `tech-staff2-${runId}@example.com`,
                name: "Peter Parker",
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
                employeeNumber: "EMP-TECH-002",
                displayName: "Peter Parker",
                phone: "+1-555-0288",
                hireDate: new Date("2023-01-10"),
                notes: "Workspace 2 internal notes",
                status: "ACTIVE",
            },
        });
        const foreignProfile2 = await prisma.technicianProfile.create({
            data: {
                employeeId: emp2.id,
                licenseNumber: "ELEC-LIC-443311",
                yearsExperience: 4,
                emergencyContact: "+1-555-8822 (Aunt)",
            },
        });
        foreignTechProfile2Id = foreignProfile2.id;
    });

    afterAll(async () => {
        if (prisma) {
            const wsIds = [ws1Id, ws2Id].filter(Boolean);
            if (wsIds.length > 0) {
                await prisma.technicianServiceArea.deleteMany({
                    where: { technicianProfile: { employee: { workspaceId: { in: wsIds } } } },
                });
                await prisma.serviceArea.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.technicianSkill.deleteMany({
                    where: { technicianProfile: { employee: { workspaceId: { in: wsIds } } } },
                });
                await prisma.skill.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.technicianProfile.deleteMany({
                    where: { employee: { workspaceId: { in: wsIds } } },
                });
                await prisma.employee.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.department.deleteMany({
                    where: { workspaceId: { in: wsIds } },
                });
                await prisma.jobTitle.deleteMany({
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
    describe("1. Canonical Public DTO Projection & Sensitive Field Protection", () => {
        it("should return the exact approved PublicTechnicianDto key set and exclude sensitive personal/internal data", async () => {
            const req = mockRequest(`/api/v1/technicians/${techProfile1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getTechnicianHandler(req, {
                params: Promise.resolve({ id: techProfile1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toBeDefined();

            const returnedKeys = Object.keys(json.data).sort();
            const expectedKeys = [...APPROVED_PUBLIC_TECHNICIAN_DTO_KEYS].sort();

            expect(returnedKeys).toEqual(expectedKeys);

            // Explicit assertion of privacy and security protections
            expect(json.data).not.toHaveProperty("emergencyContact");
            expect(json.data).not.toHaveProperty("notes");
            expect(json.data).not.toHaveProperty("hireDate");
            expect(json.data).not.toHaveProperty("workspaceId");
            expect(json.data).not.toHaveProperty("passwordHash");
            expect(json.data).not.toHaveProperty("compensation");
            expect(json.data).not.toHaveProperty("payRate");
            expect(json.data).not.toHaveProperty("homeAddress");

            expect(json.data.id).toBe(techProfile1Id);
            expect(json.data.displayName).toBe("Sarah Jenkins");
            expect(json.data.phone).toBe("+1-555-0199");
            expect(json.data.employeeNumber).toBe("EMP-TECH-001");
            expect(json.data.licenseNumber).toBe("HVAC-LIC-998822");
            expect(json.data.yearsExperience).toBe(8);
            expect(json.data.department).toBe("Field Operations");
            expect(json.data.jobTitle).toBe("Senior HVAC Specialist");
            expect(json.data.skills).toHaveLength(1);
            expect(json.data.skills[0].name).toBe("Chiller Overhaul");
            expect(json.data.skills[0].proficiency).toBe("EXPERT");
            expect(json.data.serviceAreas).toHaveLength(1);
            expect(json.data.serviceAreas[0].name).toBe("Metro Detroit North");
        });
    });

    // -------------------------------------------------------------------------
    // 2. Collection & Item Endpoints
    // -------------------------------------------------------------------------
    describe("2. Technician Endpoints (GET list, GET item)", () => {
        it("GET /api/v1/technicians should return paginated list of technicians", async () => {
            const req = mockRequest("/api/v1/technicians?limit=10", {
                token: fullKey1Secret,
            });

            const res = await listTechniciansHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBeGreaterThanOrEqual(1);
            expect(json.meta?.pagination).toBeDefined();
            expect(json.meta.pagination.limit).toBe(10);
        });

        it("GET /api/v1/technicians/:id should fetch single technician profile by ID", async () => {
            const req = mockRequest(`/api/v1/technicians/${techProfile1Id}`, {
                token: fullKey1Secret,
            });

            const res = await getTechnicianHandler(req, {
                params: Promise.resolve({ id: techProfile1Id }),
            });
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe(techProfile1Id);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Read-Only Enforce & Mutation Rejection
    // -------------------------------------------------------------------------
    describe("3. Strict Read-Only Invariant", () => {
        it("should confirm route handlers ONLY export GET (no POST, PATCH, or DELETE methods exist)", () => {
            expect(techniciansRouteModule).toHaveProperty("GET");
            expect(techniciansRouteModule).not.toHaveProperty("POST");
            expect(techniciansRouteModule).not.toHaveProperty("PATCH");
            expect(techniciansRouteModule).not.toHaveProperty("DELETE");
            expect(techniciansRouteModule).not.toHaveProperty("PUT");

            expect(technicianItemRouteModule).toHaveProperty("GET");
            expect(technicianItemRouteModule).not.toHaveProperty("POST");
            expect(technicianItemRouteModule).not.toHaveProperty("PATCH");
            expect(technicianItemRouteModule).not.toHaveProperty("DELETE");
            expect(technicianItemRouteModule).not.toHaveProperty("PUT");
        });
    });

    // -------------------------------------------------------------------------
    // 4. Authentication & Scope Enforcement (401 & 403)
    // -------------------------------------------------------------------------
    describe("4. Authentication & Scope Enforcement", () => {
        it("should return HTTP 401 UNAUTHORIZED when Authorization header is missing", async () => {
            const req = mockRequest("/api/v1/technicians");
            const res = await listTechniciansHandler(req);

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("GET /api/v1/technicians should reject key lacking technicians:read scope with 403 FORBIDDEN", async () => {
            const req = mockRequest("/api/v1/technicians", {
                token: unrelatedKey1Secret,
            });

            const res = await listTechniciansHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("GET /api/v1/technicians/:id should reject key lacking technicians:read scope with 403 FORBIDDEN", async () => {
            const req = mockRequest(`/api/v1/technicians/${techProfile1Id}`, {
                token: unrelatedKey1Secret,
            });

            const res = await getTechnicianHandler(req, {
                params: Promise.resolve({ id: techProfile1Id }),
            });
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    // -------------------------------------------------------------------------
    // 5. Tenant Isolation & Enumeration Resistance (1.18.6 contract)
    // -------------------------------------------------------------------------
    describe("5. Tenant Isolation & Enumeration Resistance", () => {
        it("GET /api/v1/technicians/:id should return 404 NOT_FOUND for foreign workspace technician", async () => {
            const req = mockRequest(`/api/v1/technicians/${foreignTechProfile2Id}`, {
                token: fullKey1Secret,
            });

            const res = await getTechnicianHandler(req, {
                params: Promise.resolve({ id: foreignTechProfile2Id }),
            });
            expect(res.status).toBe(404);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("NOT_FOUND");
        });

        it("should return byte-identical 404 responses for nonexistent vs foreign-tenant technician ID under identical requestId", async () => {
            const testReqId = `fixed-trace-tech-${Date.now()}`;

            const nonExistentReq = mockRequest(
                "/api/v1/technicians/tech_nonexistent_999999999999",
                {
                    token: fullKey1Secret,
                    headers: { "x-request-id": testReqId },
                },
            );
            const nonExistentRes = await getTechnicianHandler(nonExistentReq, {
                params: Promise.resolve({ id: "tech_nonexistent_999999999999" }),
            });

            const foreignReq = mockRequest(`/api/v1/technicians/${foreignTechProfile2Id}`, {
                token: fullKey1Secret,
                headers: { "x-request-id": testReqId },
            });
            const foreignRes = await getTechnicianHandler(foreignReq, {
                params: Promise.resolve({ id: foreignTechProfile2Id }),
            });

            const nonExistentText = await nonExistentRes.text();
            const foreignText = await foreignRes.text();

            expect(nonExistentRes.status).toBe(404);
            expect(foreignRes.status).toBe(404);
            expect(nonExistentText).toBe(foreignText);
        });

        it("GET /api/v1/technicians (list) should strictly isolate records: Workspace 1 list NEVER contains Workspace 2 technicians", async () => {
            const req1 = mockRequest("/api/v1/technicians", { token: fullKey1Secret });
            const res1 = await listTechniciansHandler(req1);
            const json1 = await res1.json();

            const ws1TechIds = json1.data.map((t: any) => t.id);
            expect(ws1TechIds).toContain(techProfile1Id);
            expect(ws1TechIds).not.toContain(foreignTechProfile2Id);

            const req2 = mockRequest("/api/v1/technicians", { token: fullKey2Secret });
            const res2 = await listTechniciansHandler(req2);
            const json2 = await res2.json();

            const ws2TechIds = json2.data.map((t: any) => t.id);
            expect(ws2TechIds).toContain(foreignTechProfile2Id);
            expect(ws2TechIds).not.toContain(techProfile1Id);
        });
    });

    // -------------------------------------------------------------------------
    // 6. Pagination & Filtering
    // -------------------------------------------------------------------------
    describe("6. Pagination & Filtering", () => {
        it("should apply search query correctly", async () => {
            const req = mockRequest("/api/v1/technicians?search=Jenkins", {
                token: fullKey1Secret,
            });

            const res = await listTechniciansHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.data.length).toBe(1);
            expect(json.data[0].displayName).toBe("Sarah Jenkins");
        });

        it("should filter by status (status=ACTIVE)", async () => {
            const req = mockRequest("/api/v1/technicians?status=ACTIVE", {
                token: fullKey1Secret,
            });

            const res = await listTechniciansHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            for (const item of json.data) {
                expect(item.status).toBe("ACTIVE");
            }
        });
    });
});
