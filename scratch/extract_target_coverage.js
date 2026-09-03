const fs = require('fs');

const summary = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));

const targetFiles = [
    // 1. Invitation Acceptance API
    "app/api/invitations/accept/route.ts",
    "lib/validations/invitation.ts",

    // 2. Workspace Creation & Membership Services
    "lib/services/workspace/createWorkspace.ts",
    "lib/services/workspace/getWorkspaces.ts",
    "lib/services/workspace/getUserWorkspaces.ts",
    "lib/services/workspace/getWorkspaceMembership.ts",
    "lib/services/workspace/requireWorkspaceMembership.ts",
    "app/api/workspaces/route.ts",
    "lib/validations/workspace.ts",

    // 3. Session Revocation Edge Cases
    "app/api/auth/sessions/[sessionId]/route.ts",
    "app/api/auth/sessions/revoke-all/route.ts",
    "app/api/auth/sessions/route.ts",
    "lib/services/auth/sessionManagement.ts",

    // 4. WorkType Querying & Creation
    "lib/services/workType/getWorkTypes.ts",
    "lib/services/workType/createWorkType.ts",
    "lib/validations/workType.ts",

    // 5. Role Hierarchy Boundary Completeness
    "lib/auth/authorization.ts",
    "lib/auth/roles.ts",
    "lib/services/authorization/roleHierarchy.ts",
    "lib/services/authorization/rolePermissions.ts",
    "lib/services/authorization/permissionService.ts",

    // 6. Workspace Notification Routes
    "app/api/workspaces/[workspaceId]/notifications/route.ts",
    "app/api/workspaces/[workspaceId]/notifications/unread-count/route.ts",
    "app/api/workspaces/[workspaceId]/notifications/read-all/route.ts",
    "app/api/workspaces/[workspaceId]/notifications/[feedItemId]/read/route.ts",
    "app/api/workspaces/[workspaceId]/notifications/[feedItemId]/archive/route.ts",
    "app/api/workspaces/[workspaceId]/notifications/deliveries/[deliveryId]/logs/route.ts",
    "app/api/workspaces/[workspaceId]/notifications/history/route.ts",
    "app/api/workspaces/[workspaceId]/notifications/preferences/route.ts",

    // 7. Public API Domain Error Handlers
    "lib/publicApi/assets/assetErrorHandler.ts",
    "lib/publicApi/customers/customerErrorHandler.ts",
    "lib/publicApi/inventory/inventoryErrorHandler.ts",
    "lib/publicApi/invoices/invoiceErrorHandler.ts",
    "lib/publicApi/parts/partErrorHandler.ts",
    "lib/publicApi/quotes/quoteErrorHandler.ts",
    "lib/publicApi/schedules/scheduleErrorHandler.ts",
    "lib/publicApi/technicians/technicianErrorHandler.ts",
    "lib/publicApi/workOrders/workOrderErrorHandler.ts"
];

console.log("File | Line % | Branch % | Func % | Stmt %");
console.log("---|---|---|---|---");
for (const [key, val] of Object.entries(summary)) {
    if (key === 'total') continue;
    const normKey = key.replace(/\\/g, '/');
    for (const target of targetFiles) {
        if (normKey.endsWith(target)) {
            console.log(`${target} | ${val.lines.pct}% (${val.lines.covered}/${val.lines.total}) | ${val.branches.pct}% (${val.branches.covered}/${val.branches.total}) | ${val.functions.pct}% (${val.functions.covered}/${val.functions.total}) | ${val.statements.pct}% (${val.statements.covered}/${val.statements.total})`);
        }
    }
}
