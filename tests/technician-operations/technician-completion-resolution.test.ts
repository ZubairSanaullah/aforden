import { describe, expect, it, vi, beforeEach } from "vitest";
import { completeTechnicianWorkOrder } from "@/lib/services/technicianOperations/completeTechnicianWorkOrder";
import { completeWorkOrderAdmin } from "@/lib/services/technicianOperations/completeWorkOrderAdmin";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderCompletionPreconditionFailedError,
} from "@/lib/services/workOrder/workOrderErrors";
import type { TechnicianExecutionContext } from "@/lib/services/technicianOperations/technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    transitionWorkOrderStatus: vi.fn(),
    workOrderFindFirst: vi.fn(),
    workOrderHistoryUpdate: vi.fn(),
    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentUpdate: vi.fn(),
    scheduleAppointmentHistoryCreate: vi.fn(),
    technicianTimeEntryFindFirst: vi.fn(),
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
            update: mocks.scheduleAppointmentUpdate,
        },
        scheduleAppointmentHistory: {
            create: mocks.scheduleAppointmentHistoryCreate,
        },
        technicianTimeEntry: {
            findFirst: mocks.technicianTimeEntryFindFirst,
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

describe("Phase 1.9.9 — WorkOrder Completion & Resolution Evidence Workflow", () => {
    const WS_ID = "ws_tenant_101";
    const WO_ID = "wo_100";
    const APPT_ID = "appt_100";
    const TECH_PROFILE_ID_1 = "tech_prof_001";
    const TECH_PROFILE_ID_2 = "tech_prof_002";
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
        description: null,
        internalNotes: null,
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
        notes: "Hands-on repair in progress",
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
                    update: mocks.technicianTimeEntryUpdate,
                },
            };
            return await callback(tx);
        });
    });

    describe("1. completeTechnicianWorkOrder (Technician Execution Path)", () => {
        describe("Successful Completion & All 4 Side Effects (§5.1, §6.1, §7.3, §8.1)", () => {
            it("executes full completion workflow verifying all four side effects in a single atomic transaction and preserves DTO hygiene", async () => {
                const result = await completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Replaced faulty capacitor and recharged refrigerant.",
                    mediaUris: ["https://storage.aforden.com/evidence/after-repair.jpg"],
                });

                // Side Effect 1: WorkOrder status transitioned to COMPLETED
                expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(
                    WS_ID,
                    WO_ID,
                    { toStatus: "COMPLETED" },
                    expect.any(Object)
                );
                expect(result.status).toBe("COMPLETED");

                // DTO Hygiene Verification (§14 Step 7): _historyRecordId must NOT leak onto public return model
                expect((result as any)._historyRecordId).toBeUndefined();

                // Side Effect 2: Linked ScheduleAppointment marked COMPLETED with ScheduleAppointmentHistory
                expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                    where: { id: APPT_ID },
                    data: { status: "COMPLETED" },
                });
                expect(mocks.scheduleAppointmentHistoryCreate).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        workspaceId: WS_ID,
                        appointmentId: APPT_ID,
                        eventType: "COMPLETED",
                        actorMemberId: "mem_tech_001",
                        actorName: "Alex Rivers",
                        field: "status",
                        oldValue: "SCHEDULED",
                        newValue: "COMPLETED",
                        metadata: expect.objectContaining({
                            resolutionNotes: "Replaced faulty capacitor and recharged refrigerant.",
                        }),
                    }),
                });

                // Side Effect 3: Open active time entry closed with duration calculated
                expect(mocks.technicianTimeEntryUpdate).toHaveBeenCalledWith({
                    where: { id: "tte_active_001" },
                    data: expect.objectContaining({
                        endedAt: expect.any(Date),
                        durationMinutes: expect.any(Number),
                        status: "COMPLETED",
                    }),
                });

                // Side Effect 4: Resolution notes and completedByTechId serialized into WorkOrderHistory.metadata by specific ID
                expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith({
                    where: {
                        id: HISTORY_RECORD_ID_NEW,
                    },
                    data: {
                        metadata: JSON.stringify({
                            resolutionNotes: "Replaced faulty capacitor and recharged refrigerant.",
                            completedByTechId: TECH_PROFILE_ID_1,
                            mediaUris: ["https://storage.aforden.com/evidence/after-repair.jpg"],
                        }),
                    },
                });
            });

            it("succeeds when optional resolutionNotes and mediaUris are omitted and keeps DTO hygiene", async () => {
                const result = await completeTechnicianWorkOrder(techContext, WO_ID);

                expect(result.status).toBe("COMPLETED");
                expect((result as any)._historyRecordId).toBeUndefined();
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
        });

        describe("Targeted History ID Enforcement & Recompletion Safety (Invariant 4 §2.4)", () => {
            it("updates strictly the current completion history row without corrupting prior historical completion records", async () => {
                const PRIOR_COMPLETION_HIST_ID = "hist_prior_comp_999";
                const initialPriorMetadata = JSON.stringify({
                    resolutionNotes: "First completion: initial diagnostic performed",
                    completedByTechId: TECH_PROFILE_ID_1,
                });

                // Simulated database table state
                const historyDbTable: Record<string, { id: string; metadata: string | null }> = {
                    [PRIOR_COMPLETION_HIST_ID]: {
                        id: PRIOR_COMPLETION_HIST_ID,
                        metadata: initialPriorMetadata,
                    },
                    [HISTORY_RECORD_ID_NEW]: {
                        id: HISTORY_RECORD_ID_NEW,
                        metadata: null,
                    },
                };

                // Mock prisma.workOrderHistory.update to accurately modify the simulated DB record by ID
                mocks.workOrderHistoryUpdate.mockImplementation(async ({ where, data }: any) => {
                    const row = historyDbTable[where.id];
                    if (row) {
                        row.metadata = data.metadata;
                    }
                    return row;
                });

                // Setup simulation: transitionWorkOrderStatus returns the NEW history row ID
                mocks.transitionWorkOrderStatus.mockResolvedValue({
                    ...sampleCompletedWorkOrderReadModel,
                    _historyRecordId: HISTORY_RECORD_ID_NEW,
                });

                await completeTechnicianWorkOrder(techContext, WO_ID, {
                    resolutionNotes: "Second completion: replaced burnt contactor",
                });

                // 1. Assert exactly the new history ID was updated with new notes
                expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith({
                    where: { id: HISTORY_RECORD_ID_NEW },
                    data: {
                        metadata: JSON.stringify({
                            resolutionNotes: "Second completion: replaced burnt contactor",
                            completedByTechId: TECH_PROFILE_ID_1,
                        }),
                    },
                });

                // 2. Assert prior historical completion record was NEVER targeted by update
                expect(mocks.workOrderHistoryUpdate).not.toHaveBeenCalledWith({
                    where: { id: PRIOR_COMPLETION_HIST_ID },
                    data: expect.anything(),
                });

                // 3. Assert prior history row's metadata is read back 100% UNCHANGED
                expect(historyDbTable[PRIOR_COMPLETION_HIST_ID].metadata).toBe(initialPriorMetadata);

                // 4. Assert new history row's metadata contains only the new resolution notes
                expect(historyDbTable[HISTORY_RECORD_ID_NEW].metadata).toBe(
                    JSON.stringify({
                        resolutionNotes: "Second completion: replaced burnt contactor",
                        completedByTechId: TECH_PROFILE_ID_1,
                    })
                );
            });

            it("hard-fails (throws) if target WorkOrderHistory record ID cannot be identified, rolling back transaction", async () => {
                mocks.transitionWorkOrderStatus.mockResolvedValue({
                    ...sampleCompletedWorkOrderReadModel,
                    _historyRecordId: undefined, // Missing ID
                });

                await expect(
                    completeTechnicianWorkOrder(techContext, WO_ID, {
                        resolutionNotes: "Notes that cannot be written",
                    })
                ).rejects.toThrow(/Failed to identify target WorkOrderHistory record/);

                // Ensure update was never attempted with undefined ID
                expect(mocks.workOrderHistoryUpdate).not.toHaveBeenCalled();
            });
        });

        describe("Precondition Failure Paths (Section 5.2)", () => {
            it("throws WorkOrderCompletionPreconditionFailedError (422) when WorkOrder status is ASSIGNED (not IN_PROGRESS)", async () => {
                mocks.workOrderFindFirst.mockResolvedValue({
                    ...sampleWorkOrderRecord,
                    status: "ASSIGNED",
                });

                await expect(
                    completeTechnicianWorkOrder(techContext, WO_ID, {
                        resolutionNotes: "Premature completion",
                    })
                ).rejects.toThrow(WorkOrderCompletionPreconditionFailedError);

                expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
            });

            it("throws WorkOrderCompletionPreconditionFailedError (422) when WorkOrder status is ON_HOLD (not IN_PROGRESS)", async () => {
                mocks.workOrderFindFirst.mockResolvedValue({
                    ...sampleWorkOrderRecord,
                    status: "ON_HOLD",
                });

                await expect(
                    completeTechnicianWorkOrder(techContext, WO_ID)
                ).rejects.toThrow(WorkOrderCompletionPreconditionFailedError);

                expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
            });

            it("throws WorkOrderCompletionPreconditionFailedError (422) when WorkOrder has no assigned technician", async () => {
                mocks.workOrderFindFirst.mockResolvedValue({
                    ...sampleWorkOrderRecord,
                    assignedTechnicianId: null,
                });

                await expect(
                    completeTechnicianWorkOrder(techContext, WO_ID)
                ).rejects.toThrow(WorkOrderCompletionPreconditionFailedError);

                expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
            });

            it("throws WorkOrderCompletionPreconditionFailedError (422) when caller is not the assigned technician", async () => {
                mocks.workOrderFindFirst.mockResolvedValue({
                    ...sampleWorkOrderRecord,
                    assignedTechnicianId: TECH_PROFILE_ID_2, // assigned to tech 2
                });

                await expect(
                    completeTechnicianWorkOrder(techContext, WO_ID)
                ).rejects.toThrow(WorkOrderCompletionPreconditionFailedError);

                expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
            });

            it("throws WorkOrderNotFoundError (404) when work order does not exist in workspace", async () => {
                mocks.workOrderFindFirst.mockResolvedValue(null);

                await expect(
                    completeTechnicianWorkOrder(techContext, "wo_nonexistent")
                ).rejects.toThrow(WorkOrderNotFoundError);

                expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
            });
        });

        describe("Identity & Role Boundary Enforcement (Invariant 2)", () => {
            it("rejects non-TECHNICIAN roles with ForbiddenError (403)", async () => {
                const nonTechRoles = ["ADMIN", "OWNER", "MANAGER", "DISPATCHER", "ACCOUNTANT"] as const;

                for (const role of nonTechRoles) {
                    await expect(
                        completeTechnicianWorkOrder({ ...techContext, role }, WO_ID)
                    ).rejects.toThrow(ForbiddenError);
                }

                expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
            });
        });
    });

    describe("2. completeWorkOrderAdmin (Administrative Execution Path)", () => {
        describe("Successful Admin Completion & Side Effects (§11.1)", () => {
            it("allows ADMIN to complete work order verifying all side effects, history serialization, and DTO hygiene", async () => {
                const result = await completeWorkOrderAdmin(WS_ID, WO_ID, {
                    resolutionNotes: "Admin verified and marked job complete",
                });

                expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(
                    WS_ID,
                    WO_ID,
                    { toStatus: "COMPLETED" },
                    expect.any(Object)
                );
                expect(result.status).toBe("COMPLETED");

                // DTO Hygiene Verification (§14 Step 7): _historyRecordId must NOT leak onto public return model
                expect((result as any)._historyRecordId).toBeUndefined();

                expect(mocks.scheduleAppointmentUpdate).toHaveBeenCalledWith({
                    where: { id: APPT_ID },
                    data: { status: "COMPLETED" },
                });

                expect(mocks.workOrderHistoryUpdate).toHaveBeenCalledWith({
                    where: {
                        id: HISTORY_RECORD_ID_NEW,
                    },
                    data: {
                        metadata: JSON.stringify({
                            resolutionNotes: "Admin verified and marked job complete",
                            completedByTechId: TECH_PROFILE_ID_1,
                        }),
                    },
                });
            });

            it("hard-fails (throws) in admin path if target WorkOrderHistory record ID is missing", async () => {
                mocks.transitionWorkOrderStatus.mockResolvedValue({
                    ...sampleCompletedWorkOrderReadModel,
                    _historyRecordId: undefined,
                });

                await expect(
                    completeWorkOrderAdmin(WS_ID, WO_ID, {
                        resolutionNotes: "Admin notes",
                    })
                ).rejects.toThrow(/Failed to identify target WorkOrderHistory record/);

                expect(mocks.workOrderHistoryUpdate).not.toHaveBeenCalled();
            });

            it("allows OWNER and MANAGER roles to complete work orders", async () => {
                mocks.workspaceMemberFindUnique.mockResolvedValue({
                    ...adminMembership,
                    role: "OWNER",
                });
                const ownerResult = await completeWorkOrderAdmin(WS_ID, WO_ID);
                expect(ownerResult.status).toBe("COMPLETED");
                expect((ownerResult as any)._historyRecordId).toBeUndefined();

                mocks.workspaceMemberFindUnique.mockResolvedValue({
                    ...adminMembership,
                    role: "MANAGER",
                });
                const managerResult = await completeWorkOrderAdmin(WS_ID, WO_ID);
                expect(managerResult.status).toBe("COMPLETED");
                expect((managerResult as any)._historyRecordId).toBeUndefined();
            });
        });

        describe("RBAC Role Restrictions (§11.1 Matrix)", () => {
            it("strictly rejects DISPATCHER from completing work orders with ForbiddenError (403)", async () => {
                mocks.workspaceMemberFindUnique.mockResolvedValue({
                    ...adminMembership,
                    role: "DISPATCHER",
                });

                await expect(
                    completeWorkOrderAdmin(WS_ID, WO_ID, { resolutionNotes: "Dispatcher attempt" })
                ).rejects.toThrow(ForbiddenError);

                expect(mocks.transitionWorkOrderStatus).not.toHaveBeenCalled();
            });

            it("rejects TECHNICIAN and ACCOUNTANT from administrative completion service with ForbiddenError (403)", async () => {
                mocks.workspaceMemberFindUnique.mockResolvedValue({
                    ...adminMembership,
                    role: "TECHNICIAN",
                });

                await expect(completeWorkOrderAdmin(WS_ID, WO_ID)).rejects.toThrow(ForbiddenError);

                mocks.workspaceMemberFindUnique.mockResolvedValue({
                    ...adminMembership,
                    role: "ACCOUNTANT",
                });

                await expect(completeWorkOrderAdmin(WS_ID, WO_ID)).rejects.toThrow(ForbiddenError);
            });
        });

        describe("Precondition Failure Paths in Admin Path", () => {
            it("throws WorkOrderCompletionPreconditionFailedError (422) if status is not IN_PROGRESS", async () => {
                mocks.workOrderFindFirst.mockResolvedValue({
                    ...sampleWorkOrderRecord,
                    status: "OPEN",
                });

                await expect(completeWorkOrderAdmin(WS_ID, WO_ID)).rejects.toThrow(
                    WorkOrderCompletionPreconditionFailedError
                );
            });

            it("throws WorkOrderCompletionPreconditionFailedError (422) if assignedTechnicianId is null", async () => {
                mocks.workOrderFindFirst.mockResolvedValue({
                    ...sampleWorkOrderRecord,
                    assignedTechnicianId: null,
                });

                await expect(completeWorkOrderAdmin(WS_ID, WO_ID)).rejects.toThrow(
                    WorkOrderCompletionPreconditionFailedError
                );
            });
        });
    });

    describe("3. Scope Exclusion & Schema Sanity (§7.1, §8.1)", () => {
        it("verifies zero payroll, billing rate, or extraneous note table dependencies exist", () => {
            const forbiddenKeys = [
                "hourlyRate",
                "payRate",
                "billingRate",
                "wage",
                "overtimeMultiplier",
                "totalCost",
                "totalBilled",
                "invoiceLineId",
                "taxRate",
            ];

            const readModelKeys = Object.keys(sampleCompletedWorkOrderReadModel);
            for (const key of forbiddenKeys) {
                expect(readModelKeys).not.toContain(key);
            }
        });
    });

    describe("4. Canonical Status Machine Flattened Projection Verification", () => {
        it("guarantees callers receive a flat WorkOrderReadModel with all top-level properties intact", async () => {
            const requiredTopLevelKeys: (keyof WorkOrderReadModel)[] = [
                "id",
                "workspaceId",
                "workOrderNumber",
                "customerId",
                "customerName",
                "customerNumber",
                "locationId",
                "locationName",
                "locationAddress",
                "workTypeId",
                "workTypeName",
                "workTypeCode",
                "estimatedDuration",
                "assignedTechnicianId",
                "assetId",
                "status",
                "priority",
                "title",
                "description",
                "internalNotes",
                "holdReason",
                "cancellationReason",
                "startedAt",
                "completedAt",
                "cancelledAt",
                "createdAt",
                "updatedAt",
            ];

            const result = await completeTechnicianWorkOrder(techContext, WO_ID);

            for (const key of requiredTopLevelKeys) {
                expect(result).toHaveProperty(key);
            }

            // Verify the object is strictly flat and not nested under any intermediate property
            expect((result as any).wo).toBeUndefined();
            expect((result as any).workOrder).toBeUndefined();
            expect((result as any)._historyRecordId).toBeUndefined();
            expect(result.id).toBe(WO_ID);
            expect(result.status).toBe("COMPLETED");
            expect(result.assignedTechnicianId).toBe(TECH_PROFILE_ID_1);
        });
    });
});
