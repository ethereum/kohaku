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
        chain = 1,
        deploys = new Map(),
        accountIndex,
        groupOrder,
        keystoreManagerFactory = KeystoreManagerFactory,
    }: Partial<TongoPluginConfig> = {}) {
        this.chain = chain;
        this.deploys = deploys;
        this.keystoreManager = keystoreManagerFactory({ host, accountIndex, groupOrder });
    }

    private async getSender(): Promise<string> {
        const accounts = await this.host.provider.request({ method: 'eth_accounts' }) as string[];     

        return accounts[0]!;
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

    private async _balance(account: TongoAccount): Promise<bigint> {
        const state = await account.state();

        return state.balance + state.pending;
    }

    async balance(assets: Array<TongoAssetId> | undefined): Promise<Array<TongoAssetBalance>> {
        const derivedKey = this.keystoreManager.deriveKey();

        const balances = await Promise.all(
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
        );

        return balances.flat();
    }

    async prepareShield(asset: TongoAssetAmountInput, to?: TongoAddress, from?: TongoAddress): Promise<TongoPublicOperation> {
        const tongoContract = this.deploys.get(asset.asset);

        if (tongoContract === undefined) { throw UnsupportedAssetError; }

        const sender = from ?? to ?? await this.getSender();
        const fund = await this.deriveAccount(tongoContract).fund({ amount: asset.amount, sender });

        return { __type: "publicOperation" as const, txns: [fund.approve, fund.toCalldata()] };
    
    }

    async prepareUnshield(asset: TongoAssetAmount, to: TongoAddress, from?: TongoAddress): Promise<TongoPrivateOperation> {
        const tongoContract = asset.asset.contract;

        if (![...this.deploys.values()].includes(tongoContract)) { throw UnsupportedAssetError; }

        const tongoAccount = this.deriveAccount(tongoContract);

        if (asset.amount > await this._balance(tongoAccount)) { throw InsufficientBalanceError; }

        const sender = from ?? await this.getSender();
        const { pending } = await tongoAccount.state();
        const txns = [];

        if (pending > 0n) {
            const rollover = await tongoAccount.rollover({ sender });

            txns.push(rollover.toCalldata());
        }

        const withdraw = await tongoAccount.withdraw({ amount: asset.amount, to, sender });

        txns.push(withdraw.toCalldata());

        const op = { __type: "privateOperation" as const, txns };

        return op;
    }

    async prepareTransfer(asset: TongoAssetAmount, to: TongoAddress, from?: TongoAddress): Promise<TongoPrivateOperation> {
        const tongoContract = asset.asset.contract;

        if (![...this.deploys.values()].includes(tongoContract)) { throw UnsupportedAssetError; }

        const tongoAccount = this.deriveAccount(tongoContract);

        if (asset.amount > await this._balance(tongoAccount)) { throw InsufficientBalanceError; }

        const sender = from ?? await this.getSender();
        const { pending } = await tongoAccount.state();
        const txns = [];

        if (pending > 0n) {
            const rollover = await tongoAccount.rollover({ sender });

            txns.push(rollover.toCalldata());
        }

        const transfer = await tongoAccount.transfer({ amount: asset.amount, to: pubKeyBase58ToAffine(to), sender });

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
