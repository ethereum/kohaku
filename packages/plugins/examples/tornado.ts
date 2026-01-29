/**
 * @fileoverview Example minimal tornadocash plugin.
 * 
 * Demonstrates how to implement a subset of the Pluguin interface, and how to 
 * enforce both compile-time and run-time checks for supported assets.
 */

import { AssetAmount, Plugin, PrivateOperation, ShieldPreparation } from "~/plugin";
import { AccountId, AssetId, Eip155ChainId, Erc20Id, NativeId } from "../src/types";
import { UnsupportedAssetError } from "~/errors";
import { Address } from "viem";

// TODO: Load me from a config file
const TORNADO_ASSETS = {
    eth: {
        asset: new NativeId(new Eip155ChainId(1)),
        amounts: [100000000000000000n, 1000000000000000000n] as const,
    },
    dai: {
        asset: new Erc20Id("0x6B175474E89094C44Da98b954EedeAC495271d0F" as const, new Eip155ChainId(1)),
        amounts: [100000000000000000000n, 1000000000000000000000n] as const,
    },
    usdc: {
        asset: new Erc20Id("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const, new Eip155ChainId(1)),
        amounts: [100000000000000000000n, 1000000000000000000000n, 10000000000000000000000n] as const,
    },
} as const;

type TornadoAssetAmount = {
    [K in keyof typeof TORNADO_ASSETS]: {
        asset: (typeof TORNADO_ASSETS)[K]["asset"];
        amount: (typeof TORNADO_ASSETS)[K]["amounts"][number];
    };
}[keyof typeof TORNADO_ASSETS];

function isTornadoAssetAmount(input: AssetAmount): input is TornadoAssetAmount {
    for (const config of Object.values(TORNADO_ASSETS)) {
        if (config.asset.equals(input.asset)) {
            return (config.amounts as readonly bigint[]).includes(input.amount);
        }
    }
    return false;
}

function asTornadoAssetAmount(input: AssetAmount): TornadoAssetAmount {
    if (!isTornadoAssetAmount(input)) {
        throw new UnsupportedAssetError(input.asset);
    }
    return input;
}

class TornadoPlugin extends Plugin<TornadoAssetAmount> {
    async account(): Promise<AccountId> {
        throw new Error("Method not implemented.");
    }
    async balance(assets: Array<AssetId> | undefined): Promise<Array<TornadoAssetAmount>> {
        throw new Error("Method not implemented.");
    }
    async prepareShield(_asset: TornadoAssetAmount, from?: Address | undefined): Promise<ShieldPreparation> {
        const asset = asTornadoAssetAmount(_asset);
        throw new Error("Method not implemented.");
    }
    async prepareUnshield(_asset: TornadoAssetAmount, to: Address): Promise<PrivateOperation> {
        const asset = asTornadoAssetAmount(_asset);
        throw new Error("Method not implemented.");
    }
    async broadcastPrivateOperation(operation: PrivateOperation): Promise<void> {
        throw new Error("Method not implemented.");
    }
}

// Simpler example that enforces only ETH at compile-time. Don't need to perform
// any checks or guards since the type system guarantees only ETH can be used.
async function shieldEthTornado(plugin: TornadoPlugin, amount: typeof TORNADO_ASSETS.eth.amounts[number]) {
    const assetId = new NativeId(new Eip155ChainId(1));
    const assetAmount = { asset: assetId, amount };
    const tx = await plugin.prepareShield(assetAmount);

    return tx;
}

// Compile-time checked version that only accepts supported assets.
async function shieldTornado(plugin: TornadoPlugin, erc20: Address, chain: number, amount: bigint) {
    const assetId = new Erc20Id(erc20, new Eip155ChainId(chain));
    const assetAmount = { asset: assetId, amount };

    if (!isTornadoAssetAmount(assetAmount)) {
        throw new UnsupportedAssetError(assetAmount.asset);
    }
    const tx = await plugin.prepareShield(assetAmount);

    return tx;
}

// Generic version that doesn't force validation at compile-time. The plugin will
// throw a runtime error if the asset is unsupported.
async function shieldGeneric(plugin: Plugin, erc20: Address, chain: number, amount: bigint) {
    const assetId = new Erc20Id(erc20, new Eip155ChainId(chain));
    const assetAmount = { asset: assetId, amount };

    const tx = await plugin.prepareShield(assetAmount);

    return tx;
}

const plugin = new TornadoPlugin();
shieldEthTornado(plugin, 100000000000000000n);
shieldTornado(plugin, "0x6B175474E89094C44Da98b954EedeAC495271d0F", 1, 100000000000000000000n);
shieldGeneric(plugin, "0xSomeOtherTokenAddress", 1, 123456789n);
