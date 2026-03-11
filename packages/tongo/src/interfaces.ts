import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { AssetAmount, ERC20AssetId, Host, PluginInstance, PrivateOperation, PublicOperation } from "@kohaku-eth/plugins";

type Address = ERC20AssetId['contract'];

export type TongoBroadcasterParameters = {
    broadcasterUrl: string | Record<string, string>;
};

export type TongoAssetId = {
    __type: 'tongo';
    contract: Address;
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

export type TongoAssetAmount<Tag extends string | undefined = undefined> = AssetAmount<TongoAssetId, bigint, Tag>;
export type TongoAssetBalance = TongoAssetAmount | TongoAssetAmount<'pending'>;

export type TongoAssetAmountInput<Tag extends string | undefined = undefined> = AssetAmount<ERC20AssetId, bigint, Tag>;

type TxCalldata = { to: string; data: string; value: bigint };
export type TongoPublicOperation = PublicOperation & { txns: TxCalldata[] };
export type TongoPrivateOperation = PrivateOperation & { txns: TxCalldata[] };

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
            input: TongoAssetAmountInput,
            internal: TongoAssetAmount,
            output: TongoAssetAmount,
            read: TongoAssetBalance,
        },
        // extras: {
        // },
        publicOp: TongoPublicOperation,
        privateOp: TongoPrivateOperation,
    }
>;
