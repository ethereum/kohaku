import { ERC20AssetId, PrivateOperation, PublicOperation, UnsupportedAssetError, InsufficientBalanceError, Host, MultiAssetsNotSupportedError } from "@kohaku-eth/plugins";

import { Address } from "@kohaku-eth/provider";
import { pubKeyBase58ToAffine, Account as TongoAccount } from "@fatsolutions/tongo-evm";

import { KeystoreManagerFactory } from "./keystoreManager";

import {
  IKeystoreManager,
  TongoAddress,
  TongoAssetAmount,
  TongoAssetBalance,
  TongoInstance,
  TongoPluginConfig,
} from "./interfaces";

export class TongoPlugin implements TongoInstance {
    chain: number;
    deploys: Map<ERC20AssetId, Address>;
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
        const accounts = await this.host.ethProvider.request({ method: 'eth_accounts' }) as string[];     

        return accounts[0]!;
    }

    private deriveAccount(tongoContract: string): TongoAccount {
        return this.deriveAccountFromKey(tongoContract, this.keystoreManager.deriveKey());
    }

    private deriveAccountFromKey(tongoContract: string, derivedKey: bigint): TongoAccount {
        return new TongoAccount(derivedKey, tongoContract, this.host.ethProvider);
    }

    async instanceId(): Promise<TongoAddress> {
        return this.deriveAccount("").tongoAddress() as TongoAddress;
    }

    private async _balance(account: TongoAccount): Promise<bigint> {
        const state = await account.state();

        return state.balance + state.pending;
    }

    async balance(assets: Array<ERC20AssetId> | undefined): Promise<Array<TongoAssetBalance>> {
        const derivedKey = this.keystoreManager.deriveKey();

        const balances = [...this.deploys.entries()]
            .filter(([assetId]) => assets === undefined || assets.includes(assetId))
            .map(async ([assetId, tongoContract]) => {
                const tongoAccount = this.deriveAccountFromKey(tongoContract, derivedKey);
                const amount = await this._balance(tongoAccount);

                return { asset: assetId, amount } as TongoAssetBalance;
            });

        return Promise.all(balances);
    }

    async prepareShield(asset: TongoAssetAmount, to?: TongoAddress, from?: TongoAddress): Promise<PublicOperation> {
        const tongoContract = this.deploys.get(asset.asset);

        if (tongoContract === undefined) { throw UnsupportedAssetError; }

        const fund = await this.deriveAccount(tongoContract).fund({ amount: asset.amount, sender: from! });

        const op = { __type: "publicOperation" as const, txns: [fund.approve, fund.toCalldata()] };
        
        return op;
    }

    async prepareUnshield(asset: TongoAssetAmount, to: TongoAddress, from?: TongoAddress): Promise<PrivateOperation> {
        const tongoContract = this.deploys.get(asset.asset);

        if (tongoContract === undefined) { throw UnsupportedAssetError; }

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

    async prepareTransfer(asset: TongoAssetAmount, to: TongoAddress, from?: TongoAddress): Promise<PrivateOperation> {
        const tongoContract = this.deploys.get(asset.asset);

        if (tongoContract === undefined) { throw UnsupportedAssetError; }

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
    prepareTransferMulti(assets: Array<TongoAssetAmount>, to: TongoAddress, from?: TongoAddress): Promise<PrivateOperation> {
        throw new MultiAssetsNotSupportedError();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async broadcastPrivateOperation(operation: PrivateOperation): Promise<void> {
        throw new Error("Method not implemented.");
    }
}
