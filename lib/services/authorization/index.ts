export {
    requireWorkspaceAuthorization,
} from "./workspaceAuthorization";

export {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
} from "./requirePermission";

export {
    authorizeWorkspace,
    authorizePermission,
    authorizeAnyPermission,
    authorizeAllPermissions,
    authorizeRole,
    authorizeOwner,
    authorizeAdminOrOwner,
} from "./guards";

export {
    authorizationErrorResponse,
} from "./authorizationResponse";

export {
    roleHasPermission,
    roleHasAnyPermission,
    roleHasAllPermissions,
    assertPermission,
    assertAnyPermission,
    assertAllPermissions,
} from "./permissionService";

export {
    ROLE_PERMISSIONS,
} from "./rolePermissions";

export {
    ROLE_HIERARCHY,
    roleHasMinimumLevel,
    roleIsHigherThan,
} from "./roleHierarchy";

export {
    assertMinimumRole,
    assertOwner,
    assertAdminOrOwner,
} from "./roleService";

export {
    assertCanManageRole,
    assertCanChangeMemberRole,
} from "./membershipRoleService";

export {
    assertWorkspaceResource,
    getAuthorizedWorkspaceId,
} from "./tenantIsolation";

export {
    PERMISSIONS,
    ALL_PERMISSIONS,
    isPermission,
} from "./permissions";

export type {
    Permission,
} from "./permissions";

export {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "./authorizationErrors";

export type {
    AuthorizationUser,
    AuthorizationWorkspace,
    AuthorizationMembership,
    WorkspaceAuthorizationContext,
} from "./types";