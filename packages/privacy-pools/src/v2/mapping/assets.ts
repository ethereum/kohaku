import { UnsupportedAssetError } from "@kohaku-eth/plugins";
import type { AssetId, ERC20AssetId, NativeAssetId } from "@kohaku-eth/plugins";
import { NATIVE_ASSET_ADDRESS, bigintToHex } from "@0xbow/privacy-pools-v2-sdk";
import type { Address as SdkAddress, Hex } from "@0xbow/privacy-pools-v2-sdk";
import type { Address } from "ox/Address";

/**
 * The subset of Kohaku asset ids Privacy Pools v2 supports: native ETH and
 * ERC-20. ERC-721 is out of scope (FR-024, single-asset transact circuits).
 */
export type PPv2AssetId = NativeAssetId | ERC20AssetId;

/**
 * Map a Kohaku {@link PPv2AssetId} to the SDK's on-chain token id: the
 * `0xEeee…EEeE` sentinel for native ETH, or the ERC-20 contract address.
 *
 * @throws {UnsupportedAssetError} for any non-native / non-ERC20 asset.
 */
export function assetToTokenId(asset: AssetId): SdkAddress {
    if (asset.__type === "native") return NATIVE_ASSET_ADDRESS;

    if (asset.__type === "erc20") return asset.contract as unknown as SdkAddress;

    throw new UnsupportedAssetError(asset);
}

/**
 * Inverse of {@link assetToTokenId}: the native sentinel becomes the native
 * asset id, anything else an ERC-20 asset id at that contract address.
 */
export function tokenIdToAsset(tokenId: SdkAddress): PPv2AssetId {
    if (tokenId.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()) {
        return { __type: "native" };
    }

    return { __type: "erc20", contract: tokenId as unknown as Address };
}

/** `bigint` amount → the SDK's 0x-hex convention. */
export function amountToHex(value: bigint): Hex {
    return bigintToHex(value);
}

/** SDK 0x-hex amount → `bigint`. */
export function hexToAmount(value: Hex): bigint {
    return BigInt(value);
}

/** True when two asset ids denote the same on-chain token. */
export function sameAsset(a: PPv2AssetId, b: PPv2AssetId): boolean {
    return assetToTokenId(a).toLowerCase() === assetToTokenId(b).toLowerCase();
}
