import { transitionAssetStatus } from "./transitionAssetStatus";
import type { AssetDetailViewModel } from "./asset.types";

export interface RetireAssetInput {
    statusReason: string;
}

/**
 * Dedicated ergonomic service wrapper for retiring physical equipment.
 *
 * Internally delegates directly to transitionAssetStatus() with toStatus = "RETIRED".
 *
 * @param workspaceId Tenant workspace ID
 * @param assetId Target equipment ID
 * @param input Payload containing required retirement justification reason
 */
export async function retireAsset(
    workspaceId: string,
    assetId: string,
    input: RetireAssetInput,
): Promise<AssetDetailViewModel> {
    return transitionAssetStatus(workspaceId, assetId, {
        toStatus: "RETIRED",
        statusReason: input?.statusReason,
    });
}
