import { describe, it, expect, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import {
  resolveEffectiveTechnicianScope,
  ReportScopeViolationError,
} from "@/lib/services/reporting";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

describe("Phase 1.14.5 — Part A: Technician Self-Scoping Engine", () => {
  const mockAdminContext: WorkspaceAuthorizationContext = {
    user: { id: "user_admin", email: "admin@test.com" } as any,
    membership: { id: "mem_admin", role: "ADMIN" } as any,
    workspace: { id: "ws_alpha", name: "Alpha Corp", timezone: "America/New_York" } as any,
  };

  const mockDispatcherContext: WorkspaceAuthorizationContext = {
    user: { id: "user_disp", email: "disp@test.com" } as any,
    membership: { id: "mem_disp", role: "DISPATCHER" } as any,
    workspace: { id: "ws_alpha", name: "Alpha Corp", timezone: "America/New_York" } as any,
  };

  const mockTechnicianContext: WorkspaceAuthorizationContext = {
    user: { id: "user_tech", email: "tech@test.com" } as any,
    membership: { id: "mem_tech", role: "TECHNICIAN" } as any,
    workspace: { id: "ws_alpha", name: "Alpha Corp", timezone: "America/New_York" } as any,
  };

  const mockAccountantContext: WorkspaceAuthorizationContext = {
    user: { id: "user_acct", email: "acct@test.com" } as any,
    membership: { id: "mem_acct", role: "ACCOUNTANT" } as any,
    workspace: { id: "ws_alpha", name: "Alpha Corp", timezone: "America/New_York" } as any,
  };

  // Rule 1: Deny by default
  it("Rule 1 (Deny by default): rejects principal lacking both read-all and read-self permissions", async () => {
    const mockDb: any = {};
    await expect(
      resolveEffectiveTechnicianScope("ws_alpha", mockAccountantContext, null, mockDb),
    ).rejects.toThrow(ReportScopeViolationError);
  });

  // Rule 2: Read-all, no filter
  it("Rule 2: read-all principal with no filter resolves to isAll=true (all workspace technicians)", async () => {
    const mockDb: any = {};
    const scope = await resolveEffectiveTechnicianScope("ws_alpha", mockAdminContext, null, mockDb);

    expect(scope.isAll).toBe(true);
    expect(scope.workspaceId).toBe("ws_alpha");
    expect(scope.technicianIds).toEqual([]);

    // Check generated query predicates
    expect(scope.toWorkOrderWhere()).toEqual({ workspaceId: "ws_alpha" });
    expect(scope.toScheduleWhere()).toEqual({ workspaceId: "ws_alpha" });
    expect(scope.toTimeEntryWhere()).toEqual({ workspaceId: "ws_alpha" });
    expect(scope.toTechnicianProfileWhere()).toEqual({ employee: { workspaceId: "ws_alpha" } });
  });

  // Rule 3: Read-all, valid filter requested
  it("Rule 3: read-all principal with valid technician filter resolves to exactly requested IDs", async () => {
    const mockDb: any = {
      technicianProfile: {
        findMany: vi.fn().mockResolvedValue([
          { id: "tech_1" },
          { id: "tech_2" },
        ]),
      },
    };

    const scope = await resolveEffectiveTechnicianScope(
      "ws_alpha",
      mockDispatcherContext,
      ["tech_1", "tech_2"],
      mockDb,
    );

    expect(scope.isAll).toBe(false);
    expect(scope.technicianIds).toEqual(["tech_1", "tech_2"]);
    expect(scope.toWorkOrderWhere()).toEqual({
      workspaceId: "ws_alpha",
      assignedTechnicianId: { in: ["tech_1", "tech_2"] },
    });
    expect(scope.toScheduleWhere()).toEqual({
      workspaceId: "ws_alpha",
      technicianId: { in: ["tech_1", "tech_2"] },
    });
    expect(scope.toTimeEntryWhere()).toEqual({
      workspaceId: "ws_alpha",
      technicianProfileId: { in: ["tech_1", "tech_2"] },
    });
  });

  // Rule 3 Rejection: Read-all, foreign filter requested
  it("Rule 3 Rejection: read-all principal requesting foreign technician ID throws ReportScopeViolationError", async () => {
    const mockDb: any = {
      technicianProfile: {
        findMany: vi.fn().mockResolvedValue([
          { id: "tech_1" }, // tech_foreign not found in workspace
        ]),
      },
    };

    await expect(
      resolveEffectiveTechnicianScope(
        "ws_alpha",
        mockAdminContext,
        ["tech_1", "tech_foreign"],
        mockDb,
      ),
    ).rejects.toThrow(ReportScopeViolationError);
  });

  // Rule 4: Read-self, no filter requested
  it("Rule 4: read-self principal with no filter silently narrows to own technician profile ID", async () => {
    const mockDb: any = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          technicianProfile: { id: "tech_self_123" },
        }),
      },
    };

    const scope = await resolveEffectiveTechnicianScope(
      "ws_alpha",
      mockTechnicianContext,
      null,
      mockDb,
    );

    expect(scope.isAll).toBe(false);
    expect(scope.technicianIds).toEqual(["tech_self_123"]);
    expect(scope.toWorkOrderWhere()).toEqual({
      workspaceId: "ws_alpha",
      assignedTechnicianId: { in: ["tech_self_123"] },
    });
  });

  // Rule 5: Read-self, filter requesting own ID
  it("Rule 5: read-self principal requesting own technician ID is allowed", async () => {
    const mockDb: any = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          technicianProfile: { id: "tech_self_123" },
        }),
      },
    };

    const scope = await resolveEffectiveTechnicianScope(
      "ws_alpha",
      mockTechnicianContext,
      "tech_self_123",
      mockDb,
    );

    expect(scope.isAll).toBe(false);
    expect(scope.technicianIds).toEqual(["tech_self_123"]);
  });

  // Rule 6: Read-self, filter requesting other/unauthorized ID
  it("Rule 6: read-self principal requesting another technician ID throws ReportScopeViolationError without returning partial data", async () => {
    const mockDb: any = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          technicianProfile: { id: "tech_self_123" },
        }),
      },
    };

    await expect(
      resolveEffectiveTechnicianScope(
        "ws_alpha",
        mockTechnicianContext,
        ["tech_self_123", "tech_other_456"],
        mockDb,
      ),
    ).rejects.toThrow(ReportScopeViolationError);
  });

  // Rule 7: Read-self, caller has no technician profile
  it("Rule 7: read-self principal with no technician profile throws ReportScopeViolationError", async () => {
    const mockDb: any = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          technicianProfile: null, // Employee exists but no technician profile
        }),
      },
    };

    await expect(
      resolveEffectiveTechnicianScope(
        "ws_alpha",
        mockTechnicianContext,
        null,
        mockDb,
      ),
    ).rejects.toThrow(ReportScopeViolationError);
  });

  // Cross-tenant isolation test
  it("Cross-tenant test: read-self principal in workspace A cannot access technician in workspace B", async () => {
    const mockDb: any = {
      employee: {
        findFirst: vi.fn(async (args) => {
          if (args.where.workspaceId === "ws_alpha") {
            return { technicianProfile: { id: "tech_alpha_1" } };
          }
          return null; // not found in workspace B
        }),
      },
    };

    await expect(
      resolveEffectiveTechnicianScope(
        "ws_beta", // attempting to resolve in workspace B
        mockTechnicianContext, // member of workspace A
        null,
        mockDb,
      ),
    ).rejects.toThrow(ReportScopeViolationError);
  });
});
