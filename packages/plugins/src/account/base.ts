import { AssetAmount, AssetId, PrivateOperation, PublicOperation } from "~/shared";
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { Address } from "ox/Address";

export type TxFeatureMap<TAccountId extends string = string, TPrivateOperation extends PrivateOperation = PrivateOperation> = {
    shield: (asset: AssetAmount, to: TAccountId) => Promise<PublicOperation>;
    shieldMulti: (assets: Array<AssetAmount>, to: TAccountId) => Promise<PublicOperation>;
    transfer: (asset: AssetAmount, to: TAccountId) => Promise<TPrivateOperation>;
    transferMulti: (assets: Array<AssetAmount>, to: TAccountId) => Promise<TPrivateOperation>;
    unshield: (asset: AssetAmount, to: Address) => Promise<TPrivateOperation>;
    unshieldMulti: (assets: Array<AssetAmount>, to: Address) => Promise<TPrivateOperation>;
};

type EnabledKeys<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Features extends Record<string, any>,
    Flags extends Partial<Record<keyof Features, boolean>>,
> = {
    [K in keyof Features]-?: Flags[K] extends true ? K : never
}[keyof Features];

export type TxFeatures<TAccountId extends string = string, TPrivateOperation extends PrivateOperation = PrivateOperation> = Partial<Record<keyof TxFeatureMap<TAccountId, TPrivateOperation>, boolean>>;

export type Transact<
    TAccountId extends string = string,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    AvailableFeatures extends TxFeatures<TAccountId, TPrivateOperation> = {},
> = Pick<TxFeatureMap<TAccountId, TPrivateOperation>, EnabledKeys<TxFeatureMap<TAccountId, TPrivateOperation>, AvailableFeatures>>;

export type Account<
    TAccountId extends string = string,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    TransactionFeatures extends TxFeatures<TAccountId, TPrivateOperation> = TxFeatures<TAccountId, TPrivateOperation>,
> = {
    account: () => Promise<TAccountId>;
    balance: (assets: Array<AssetId> | undefined) => Promise<Array<AssetAmount>>;
} & Transact<TAccountId, TPrivateOperation, TransactionFeatures>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAccount = Account<any, any>;
