import { getWorkspaceMembership } from "@/lib/services/workspace/getWorkspaceMembership";

export async function requireWorkspaceMembership(
    userId: string,
    workspaceId: string
) {
    const membership = await getWorkspaceMembership(
        userId,
        workspaceId
    );

    if (!membership) {
        throw new Error("WORKSPACE_ACCESS_DENIED");
    }

    return membership;
}