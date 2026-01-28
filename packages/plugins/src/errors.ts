import { AssetId, ChainId } from "./types";

export class PluginError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class UnsupportedAssetError extends PluginError {
    constructor(public readonly assetId: AssetId) {
        super(`Unsupported asset: ${assetId}`);
    }
}

export class UnsupportedChainError extends PluginError {
    constructor(public readonly chainId: ChainId) {
        super(`Unsupported chain: ${chainId}`);
    }
}

export class InvalidAddressError extends PluginError {
    constructor(public readonly address: string) {
        super(`Invalid address: ${address}`);
    }
}

export class InsufficientBalanceError extends PluginError {
    constructor(public readonly assetId: AssetId, public readonly required: bigint, public readonly available: bigint) {
        super(`Insufficient balance for asset ${assetId}: required ${required}, have ${available}`);
    }
}

export class MultiAssetsNotSupportedError extends PluginError {
    constructor() {
        super(`Multiple assets are not supported by this plugin.`);
    }
}
