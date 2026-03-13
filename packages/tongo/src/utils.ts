import { ERC20AssetId } from "@kohaku-eth/plugins";
import { TongoAssetId } from "./interfaces";

export function isTongoAsset(asset: unknown): asset is TongoAssetId {
    return (
        typeof asset === 'object' &&
        asset !== null &&
        (asset as any).__type === 'tongo'
    );
}

export function isERC20Asset(asset: unknown): asset is ERC20AssetId {
    return (
        typeof asset === 'object' &&
        asset !== null &&
        (asset as any).__type === 'erc20'
    );
}
