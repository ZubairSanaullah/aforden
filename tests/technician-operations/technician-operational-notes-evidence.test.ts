import { describe, expect, it, vi, beforeEach } from "vitest";
import { completeTechnicianWorkOrder } from "@/lib/services/technicianOperations/completeTechnicianWorkOrder";
import { completeWorkOrderAdmin } from "@/lib/services/technicianOperations/completeWorkOrderAdmin";
import { recordTechnicianTimeEntry } from "@/lib/services/technicianOperations/recordTechnicianTimeEntry";
import { updateTechnicianTimeEntry } from "@/lib/services/technicianOperations/updateTechnicianTimeEntry";
import { updateTechnicianTimeEntryAdmin } from "@/lib/services/technicianOperations/updateTechnicianTimeEntryAdmin";
import { ZodError } from "zod";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    transitionWorkOrderStatus: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderHistoryUpdate: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentFindFirst: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),
    technicianTimeEntryFindFirst: vi.fn(),
    technicianTimeEntryCreate: vi.fn(),
    technicianTimeEntryUpdate: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/services/workOrder/transitionWorkOrderStatus", () => ({
    transitionWorkOrderStatus: mocks.transitionWorkOrderStatus,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
        },
        workOrderHistory: {
            update: mocks.workOrderHistoryUpdate,
        },
        scheduleAppointment: {
            findMany: mocks.scheduleAppointmentFindMany,
            findFirst: mocks.scheduleAppointmentFindFirst,
            update: mocks.scheduleAppointmentUpdate,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        technicianTimeEntry: {
            findFirst: mocks.technicianTimeEntryFindFirst,
            create: mocks.technicianTimeEntryCreate,
            update: mocks.technicianTimeEntryUpdate,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        $transaction: mocks.transaction,
    },
}));

describe("Phase 1.9.10 — Operational Notes & Completion Evidence Architecture", () => {
    const WS_ID = "ws_tenant_101";
    const WO_ID = "wo_100";
    const APPT_ID = "appt_100";
    const TECH_PROFILE_ID_1 = "tech_prof_001";
    const HISTORY_RECORD_ID_NEW = "hist_rec_comp_001";

    const techContext: TechnicianExecutionContext = {
        userId: "usr_tech_001",
        workspaceId: WS_ID,
        membershipId: "mem_tech_001",
        role: "TECHNICIAN",
        employeeId: "emp_001",
        technicianProfileId: TECH_PROFILE_ID_1,
        technicianName: "Alex Rivers",
    };

    const adminSessionUser = {
        id: "usr_admin_001",
        name: "Admin User",
        email: "admin@aforden.com",
    };

    const adminMembership = {
        id: "mem_admin_001",
        userId: "usr_admin_001",
        workspaceId: WS_ID,
        role: "ADMIN",
        status: "ACTIVE",
    };

    const workspaceRecord = {
        id: WS_ID,
        name: "Acme HVAC Workspace",
    };

    const sampleWorkOrderRecord = {
        id: WO_ID,
        workspaceId: WS_ID,
        status: "IN_PROGRESS" as const,
        assignedTechnicianId: TECH_PROFILE_ID_1,
        description: "Customer reports AC unit is making loud banging noise.",
        internalNotes: "VIP customer - priority service required.",
    };

    const sampleCompletedWorkOrderReadModel: WorkOrderReadModel & { _historyRecordId?: string } = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-000100",
        customerId: "cust_1",
        customerName: "Acme Corp",
        customerNumber: "CUST-001",
        locationId: "loc_1",
        locationName: "HQ",
        locationAddress: "123 Main St, Austin, TX, 78701, US",
        workTypeId: "wt_1",
        workTypeName: "HVAC Repair",
        workTypeCode: "HVAC",
        estimatedDuration: 120,
        assignedTechnicianId: TECH_PROFILE_ID_1,
        assetId: null,
        status: "COMPLETED",
        priority: "HIGH",
        title: "Fix AC compressor",
        description: "Customer reports AC unit is making loud banging noise.",
        internalNotes: "VIP customer - priority service required.",
        holdReason: null,
        cancellationReason: null,
        startedAt: new Date("2026-08-21T10:00:00Z"),
        completedAt: new Date("2026-08-21T11:30:00Z"),
        cancelledAt: null,
        createdAt: new Date("2026-08-21T09:00:00Z"),
        updatedAt: new Date("2026-08-21T11:30:00Z"),
        _historyRecordId: HISTORY_RECORD_ID_NEW,
    };

    const sampleAppointment = {
        id: APPT_ID,
        workOrderId: WO_ID,
        workspaceId: WS_ID,
        technicianId: TECH_PROFILE_ID_1,
        status: "SCHEDULED",
        notes: "Gate code is 1234. Knock on side door.",
    };

    const sampleActiveTimeEntry = {
        id: "tte_active_001",
        workspaceId: WS_ID,
        technicianProfileId: TECH_PROFILE_ID_1,
        workOrderId: WO_ID,
        appointmentId: APPT_ID,
        entryType: "ON_SITE" as const,
        status: "ACTIVE" as const,
        startedAt: new Date("2026-08-21T10:30:00Z"),
        endedAt: null,
        durationMinutes: null,
        notes: "Diagnosing motor bearing failure",
        createdByMemberId: "mem_tech_001",
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.auth.mockResolvedValue({
            user: adminSessionUser,
        });

        mocks.userFindUnique.mockResolvedValue({
            ...adminSessionUser,
            status: "ACTIVE",
        });

        mocks.workspaceMemberFindUnique.mockResolvedValue(adminMembership);
        mocks.workspaceFindUnique.mockResolvedValue(workspaceRecord);

        mocks.workOrderFindFirst.mockResolvedValue(sampleWorkOrderRecord);
        mocks.transitionWorkOrderStatus.mockResolvedValue(sampleCompletedWorkOrderReadModel);
        mocks.scheduleAppointmentFindMany.mockResolvedValue([sampleAppointment]);
        mocks.scheduleAppointmentFindFirst.mockResolvedValue(sampleAppointment);
        mocks.scheduleAppointmentUpdate.mockResolvedValue({
            ...sampleAppointment,
            status: "COMPLETED",
        });
        mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleActiveTimeEntry);
        mocks.technicianTimeEntryUpdate.mockResolvedValue({
            ...sampleActiveTimeEntry,
            status: "COMPLETED",
            endedAt: new Date("2026-08-21T11:30:00Z"),
            durationMinutes: 60,
        });
        mocks.technicianTimeEntryCreate.mockResolvedValue({
            id: "tte_manual_001",
            workspaceId: WS_ID,
            technicianProfileId: TECH_PROFILE_ID_1,
            workOrderId: WO_ID,
            appointmentId: null,
            entryType: "BREAK",
            status: "ACTIVE",
            startedAt: new Date("2026-08-21T12:00:00Z"),
            endedAt: null,
            durationMinutes: null,
            notes: "Lunch break",
            createdByMemberId: "mem_tech_001",
        });
        mocks.workOrderHistoryUpdate.mockResolvedValue({
            id: HISTORY_RECORD_ID_NEW,
            workOrderId: WO_ID,
            eventType: "STATUS_CHANGED",
            newValue: "COMPLETED",
        });

        mocks.transaction.mockImplementation(async (callback: any) => {
            const tx = {
                workOrder: {
                    findFirst: mocks.workOrderFindFirst,
                },
                workOrderHistory: {
                    update: mocks.workOrderHistoryUpdate,
                },
                scheduleAppointment: {
                    findMany: mocks.scheduleAppointmentFindMany,
                    update: mocks.scheduleAppointmentUpdate,
                },
                scheduleAppointmentHistory: {
                    create: mocks.scheduleAppointmentHistoryCreate,
                },
                technicianTimeEntry: {
                    findFirst: mocks.technicianTimeEntryFindFirst,
                    create: mocks.technicianTimeEntryCreate,
                    update: mocks.technicianTimeEntryUpdate,
                },
            };
            return await callback(tx);
        });
    });

    describe("1. Structured Completion Evidence Handling (Section 8.2)", () => {
        it("persists valid media URIs and resolution notes into WorkOrderHistory.metadata", async () => {
            const mediaUris = [
                "https://storage.aforden.com/evidence/wo_100/before_repair.jpg",
                "https://storage.aforden.com/evidence/wo_100/after_repair.jpg",
                "https://storage.aforden.com/evidence/wo_100/customer_signoff.pdf",
            ];
            const resolutionNotes = "Replaced faulty motor bearing and verified optimal airflow.";

            const result = await completeTechnicianWorkOrder(techContext, WO_ID, {
                resolutionNotes,
                mediaUris,
            });

            expect(result.status).toBe("COMPLETED");

            // Verify metadata serialization with both resolutionNotes and mediaUris
            expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith({
                where: {
                    id: HISTORY_RECORD_ID_NEW,
                },
                data: {
                    metadata: JSON.stringify({
                        resolutionNotes,
                        completedByTechId: TECH_PROFILE_ID_1,
                        mediaUris,
                    }),
                },
            });
        });

        it("succeeds when evidence is completely omitted (evidence is optional)", async () => {
            const result = await completeTechnicianWorkOrder(techContext, WO_ID);

            expect(result.status).toBe("COMPLETED");
            expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith({
                where: {
                    id: HISTORY_RECORD_ID_NEW,
                },
                data: {
                    metadata: JSON.stringify({
                        completedByTechId: TECH_PROFILE_ID_1,
                    }),
                },
            });
        });

        it("succeeds when mediaUris is an empty array", async () => {
            const result = await completeTechnicianWorkOrder(techContext, WO_ID, {
                resolutionNotes: "Completed without photos",
                mediaUris: [],
            });

            expect(result.status).toBe("COMPLETED");
            expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith({
                where: {
                    id: HISTORY_RECORD_ID_NEW,
                },
                data: {
                    metadata: JSON.stringify({
                        resolutionNotes: "Completed without photos",
                        completedByTechId: TECH_PROFILE_ID_1,
                    }),
                },
            });
        });

        it("allows admin completion with structured media evidence and resolution notes", async () => {
            const mediaUris = ["https://cdn.aforden.com/inspections/audit-final.png"];
            const result = await completeWorkOrderAdmin(WS_ID, WO_ID, {
                resolutionNotes: "Manager verified final installation",
                mediaUris,
            });

            expect(result.status).toBe("COMPLETED");
            expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith({
                where: {
                    id: HISTORY_RECORD_ID_NEW,
                },
                data: {
                    metadata: JSON.stringify({
                        resolutionNotes: "Manager verified final installation",
                        completedByTechId: TECH_PROFILE_ID_1,
                        mediaUris,
                    }),
                },
            });
        });
    });

    describe("2. Evidence Validation Rules & Boundary Limits (Section 8.2)", () => {
        it("rejects completion with malformed media URI format across individual invalid cases", async () => {
            // Case 1: non-URI plain string
            await expect(
                completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Notes",
                    mediaUris: ["not-a-valid-uri"],
                })
            ).rejects.toThrow(ZodError);

            // Case 2: broken protocol typo
            await expect(
                completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Notes",
                    mediaUris: ["htp:/broken-url"],
                })
            ).rejects.toThrow(ZodError);

            // Case 3: disallowed protocol scheme (javascript:)
            await expect(
                completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Notes",
                    mediaUris: ["javascript:alert(1)"],
                })
            ).rejects.toThrow(ZodError);

            // Case 4: empty string URI
            await expect(
                completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Notes",
                    mediaUris: [""],
                })
            ).rejects.toThrow(ZodError);

            // Case 5: admin path also rejects malformed URI
            await expect(
                completeWorkOrderAdmin(WS_ID, WO_ID, {
                    resolutionNotes: "Admin notes",
                    mediaUris: ["ftp://unsupported-scheme.com/photo.jpg"],
                })
            ).rejects.toThrow(ZodError);
        });

        it("rejects completion when mediaUris exceeds maximum count limit (20 URIs)", async () => {
            const tooManyUris = Array.from(
                { length: 21 },
                (_, i) => `https://storage.aforden.com/evidence/photo_${i + 1}.jpg`
            );

            await expect(
                completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Job done",
                    mediaUris: tooManyUris,
                })
            ).rejects.toThrow(ZodError);
        });

        it("rejects completion when individual media URI exceeds maximum length (2048 chars)", async () => {
            const longUri = `https://storage.aforden.com/evidence/${"a".repeat(2030)}.jpg`;

            await expect(
                completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Job done",
                    mediaUris: [longUri],
                })
            ).rejects.toThrow(ZodError);
        });

        it("rejects completion when resolutionNotes exceeds maximum length (4000 chars)", async () => {
            const longNotes = "a".repeat(4001);

            await expect(
                completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: longNotes,
                })
            ).rejects.toThrow(ZodError);
        });
    });

    describe("3. Itemized Time Entry Notes Persistence (Section 8.1)", () => {
        it("persists itemized operational notes on direct time entry creation", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(null); // No active entry

            const result = await recordTechnicianTimeEntry(techContext, WO_ID, {
                entryType: "BREAK",
                notes: "Technician taking mandatory 30-minute meal break",
            });

            expect(result).toBeDefined();
            expect(mocks.technicianTimeEntryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: WS_ID,
                    technicianProfileId: TECH_PROFILE_ID_1,
                    workOrderId: WO_ID,
                    entryType: "BREAK",
                    notes: "Technician taking mandatory 30-minute meal break",
                }),
            });
        });

        it("updates itemized operational notes on active time entry by technician", async () => {
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(sampleActiveTimeEntry);

            await updateTechnicianTimeEntry(techContext, WO_ID, sampleActiveTimeEntry.id, {
                notes: "Updated field diagnostic notes: found secondary compressor coil leak",
            });

            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                where: { id: sampleActiveTimeEntry.id },
                data: expect.objectContaining({
                    notes: "Updated field diagnostic notes: found secondary compressor coil leak",
                }),
            });
        });

        it("updates itemized operational notes on historical completed time entry by admin", async () => {
            const existingEntry = {
                ...sampleActiveTimeEntry,
                id: "tte_hist_001",
                status: "COMPLETED" as const,
                endedAt: new Date("2026-08-21T11:00:00Z"),
                durationMinutes: 30,
                metadata: {},
            };
            mocks.technicianTimeEntryFindFirst.mockResolvedValue(existingEntry);

            await updateTechnicianTimeEntryAdmin(WS_ID, WO_ID, "tte_hist_001", {
                notes: "Admin correction: updated field diagnostic notes",
            });

            expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                where: { id: "tte_hist_001" },
                data: expect.objectContaining({
                    notes: "Admin correction: updated field diagnostic notes",
                }),
            });
        });
    });

    describe("4. Notes Strategy Map & Zero Table Sprawl Verification (Section 8.1)", () => {
        it("verifies zero new notes/evidence tables exist in Prisma schema", async () => {
            const forbiddenModelNames = [
                "WorkOrderNote",
                "WorkOrderNotes",
                "TechnicianNote",
                "TechnicianNotes",
                "CompletionEvidence",
                "MediaAttachment",
                "MediaAttachments",
                "FieldNote",
                "FieldNotes",
                "ResolutionNote",
                "ResolutionNotes",
                "OperationalNote",
                "OperationalNotes",
                "EvidenceAttachment",
            ];

            const fs = await import("node:fs/promises");
            const schemaPath = "prisma/schema.prisma";
            const schemaContent = await fs.readFile(schemaPath, "utf-8");

            for (const forbidden of forbiddenModelNames) {
                expect(schemaContent).not.toMatch(new RegExp(`model\\s+${forbidden}\\s+\\{`));
            }
        });

        it("verifies the discrete roles of the 4 operational note locations without redundant tables", () => {
            // 1. WorkOrder.description -> Intake customer problem
            expect(sampleWorkOrderRecord.description).toBe("Customer reports AC unit is making loud banging noise.");

            // 2. WorkOrder.internalNotes -> Administrative internal notes
            expect(sampleWorkOrderRecord.internalNotes).toBe("VIP customer - priority service required.");

            // 3. ScheduleAppointment.notes -> Dispatch instructions
            expect(sampleAppointment.notes).toBe("Gate code is 1234. Knock on side door.");

            // 4. TechnicianTimeEntry.notes -> Itemized field notes
            expect(sampleActiveTimeEntry.notes).toBe("Diagnosing motor bearing failure");
        });
    });
});
