import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { AssetAmount, ERC20AssetId, Host, PluginInstance, PrivateOperation, PublicOperation } from "@kohaku-eth/plugins";
import { Address } from "@kohaku-eth/provider";

export type TongoBroadcasterParameters = {
    broadcasterUrl: string | Record<string, string>;
};

export interface IEntrypoint {
  address: Address;
  deploymentBlock: bigint;
}

export type TongoBroadcaster = Broadcaster<TongoBroadcasterParameters, PrivateOperation>;
export interface TongoPluginParameters extends TongoBroadcasterParameters, TongoCredentials {
    entrypoint: IEntrypoint;
    ipfsUrl?: string;
};

export type TongoAddress = Address;

export type TongoAssetAmount<Tag extends string | undefined = undefined> = AssetAmount<ERC20AssetId, bigint, Tag>;
export type TongoAssetBalance = TongoAssetAmount<'pending'>;

export interface TongoCredentials {
    accountIndex: number;
}

export interface IKeystoreManager {
    deriveKey: () => bigint;
}

export interface KeystoreManagerParams {
    host: Host;
    groupOrder?: bigint;
    accountIndex?: number;
}

export interface TongoPluginConfig {
    chain: number;
    groupOrder: bigint;
    accountIndex: number;
    deploys: Map<ERC20AssetId, Address>;
    keystoreManagerFactory: (params: KeystoreManagerParams) => IKeystoreManager;
}

export type TongoInstance = PluginInstance<
    TongoAddress,
    {
        features: {
            prepareShield: true,
            prepareUnshield: true,
            prepareTransfer: true,
            prepareTransferMulti: false,
        },
        assetAmounts: {
            input: TongoAssetAmount,
            internal: TongoAssetAmount,
            output: TongoAssetAmount,
            read: TongoAssetBalance,
        },
        // extras: {
        // },
        publicOp: PublicOperation,
        privateOp: PrivateOperation,
    }
>;