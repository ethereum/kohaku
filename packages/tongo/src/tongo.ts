import { ERC20AssetId, UnsupportedAssetError, InsufficientBalanceError, Host, MultiAssetsNotSupportedError } from "@kohaku-eth/plugins";

import { pubKeyBase58ToAffine, Account as TongoAccount } from "@fatsolutions/tongo-evm";

import { KeystoreManagerFactory } from "./keystoreManager";

import {
  IKeystoreManager,
  TongoAddress,
  TongoAssetAmount,
  TongoAssetAmountInput,
  TongoAssetBalance,
  TongoAssetId,
  TongoInstance,
  TongoPluginConfig,
  TongoPublicOperation,
  TongoPrivateOperation,
} from "./interfaces";

export class TongoPlugin implements TongoInstance {
    chain: number;
    deploys: Map<ERC20AssetId, TongoAddress>;
    keystoreManager: IKeystoreManager;

    constructor(readonly host: Host, {
        chain,
        deploys = new Map(),
        accountIndex,
        groupOrder,
        keystoreManagerFactory = KeystoreManagerFactory,
    }: Pick<TongoPluginConfig, 'chain'> & Partial<Omit<TongoPluginConfig, 'chain'>>) {
        this.chain = chain;
        this.deploys = deploys;
        this.keystoreManager = keystoreManagerFactory({ host, accountIndex, groupOrder });
    }

    private getTongoContract(asset: TongoAssetId | ERC20AssetId): TongoAddress {
        if ('__type' in asset && asset.__type === 'tongo') {
            const { contract } = asset;
            if (![...this.deploys.values()].includes(contract)) throw new UnsupportedAssetError(asset);
            return contract;
        }
        const contract = this.deploys.get(asset as ERC20AssetId);
        if (contract === undefined) throw new UnsupportedAssetError(asset as ERC20AssetId);
        return contract;
    }

    private deriveAccount(tongoContract: string): TongoAccount {
        return this.deriveAccountFromKey(tongoContract, this.keystoreManager.deriveKey());
    }

    private deriveAccountFromKey(tongoContract: string, derivedKey: bigint): TongoAccount {
        return new TongoAccount(derivedKey, tongoContract, this.host.provider);
    }

    async instanceId(): Promise<TongoAddress> {
        return this.deriveAccount("").tongoAddress() as TongoAddress;
    }


    async balance(assets: Array<TongoAssetId> | undefined): Promise<Array<TongoAssetBalance>> {
        const derivedKey = this.keystoreManager.deriveKey();

       return (await Promise.all(
            [...this.deploys.entries()]
            .filter(([, tongoContract]) => assets === undefined || assets.some(a => a.contract === tongoContract))
            .map(async ([, tongoContract]) => {
                const tongoAssetId: TongoAssetId = { __type: 'tongo', contract: tongoContract };
                const tongoAccount = this.deriveAccountFromKey(tongoContract, derivedKey);
                const state = await tongoAccount.state();

                return [
                    { asset: tongoAssetId, amount: state.balance },
                    { asset: tongoAssetId, amount: state.pending, tag: 'pending' as const },
                ];
            })
        )).flat();
    }

    async prepareShield(asset: TongoAssetAmountInput, to: TongoAddress | undefined, from: TongoAddress): Promise<TongoPublicOperation> {
        const tongoContract = this.getTongoContract(asset.asset);
        const fund = await this.deriveAccount(tongoContract).fund({ amount: asset.amount, sender: from });

        return { __type: "publicOperation" as const, txns: [fund.approve, fund.toCalldata()] };
    }

    async prepareUnshield(asset: TongoAssetAmount, to: TongoAddress, from: TongoAddress): Promise<TongoPrivateOperation> {
        const tongoContract = this.getTongoContract(asset.asset);
        const tongoAccount = this.deriveAccount(tongoContract);
        const state = await tongoAccount.state();
        const balance = state.balance + state.pending;

        if (asset.amount > balance) { throw new InsufficientBalanceError(asset.asset, asset.amount, balance); }

        const { pending } = state;
        const txns = [];

//        if (pending > 0n) {
//            const rollove = await tongoAccount.rollover({ sender: from });

//            txns.push(rollover.toCalldata());
//        } TODO: FIX

        const withdraw = await tongoAccount.withdraw({ amount: asset.amount, to, sender: from });

        txns.push(withdraw.toCalldata());

        const op = { __type: "privateOperation" as const, txns };

        return op;
    }

    async prepareTransfer(asset: TongoAssetAmount, to: TongoAddress, from: TongoAddress): Promise<TongoPrivateOperation> {
        const tongoContract = this.getTongoContract(asset.asset);
        const tongoAccount = this.deriveAccount(tongoContract);
        const state = await tongoAccount.state();
        const balance = state.balance + state.pending;

        if (asset.amount > balance) { throw new InsufficientBalanceError(asset.asset, asset.amount, balance); }

        const { pending } = state;
        const txns = [];

//        if (pending > 0n) {
//            const rollover = await tongoAccount.rollover({ sender: from });
//
//            txns.push(rollover.toCalldata());
//        } TODO: FIX

        const transfer = await tongoAccount.transfer({ amount: asset.amount, to: pubKeyBase58ToAffine(to), sender: from });

        txns.push(transfer.toCalldata());

        const op = { __type: "privateOperation" as const, txns };
        return op;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    prepareTransferMulti(assets: Array<TongoAssetAmount>, to: TongoAddress, from?: TongoAddress): Promise<TongoPrivateOperation> {
        throw new MultiAssetsNotSupportedError();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async broadcastPrivateOperation(operation: TongoPrivateOperation): Promise<void> {
        throw new Error("Method not implemented.");
    }
}
