import { Plugin, AssetAmount, ShieldPreparation, PrivateOperation, CustomAccountId, CustomChainId, UnsupportedAssetError, InsufficientBalanceError, Keystore } from "@kohaku-eth/plugins";
import { AccountId, AssetId, Host, MultiAssetsNotSupportedError } from "@kohaku-eth/plugins";
import { Address } from "@kohaku-eth/provider";
import { pubKeyBase58ToAffine, Account as TongoAccount } from "@fatsolutions/tongo-evm";

import { IKeystoreManager, IKeystoreManagerFactory, KeystoreManagerFactory } from "./keystoreManager";

interface TongoPluginConfig {
    chain: number;
    deploys: Map<AssetId, Address>;
    keystoreManager: IKeystoreManagerFactory
}

export class TongoPlugin extends Plugin<AssetAmount, ShieldPreparation, PrivateOperation> {
    chain: number;
    deploys: Map<AssetId, Address>;
    keystoreManager: IKeystoreManager;

    constructor(readonly host: Host, {
        chain = 1,
        deploys = new Map(),
        keystoreManager = KeystoreManagerFactory,
    }: Partial<TongoPluginConfig> = {}) {
        super();
        this.chain = chain;
        this.deploys = deploys;
        this.keystoreManager = keystoreManager({ host });
    }

    private deriveAccount(tongoContract: string): TongoAccount {
        return this.deriveAccountFromKey(tongoContract, this.keystoreManager.deriveKey());
    }

    private deriveAccountFromKey(tongoContract: string, derivedKey: bigint): TongoAccount {
        return new TongoAccount(derivedKey, tongoContract, this.host.ethProvider);
    }

    async account(): Promise<AccountId> {
        return new CustomAccountId(this.deriveAccount("").tongoAddress(), new CustomChainId("tongo-evm", this.chain));
    }

    private async _balance(account: TongoAccount): Promise<bigint> {
        const state = await account.state();

        return state.balance + state.pending;
    }

    async balance(assets: Array<AssetId> | undefined): Promise<Array<AssetAmount>> {
        const derivedKey = this.keystoreManager.deriveKey();

        const balances: Promise<AssetAmount>[] = [];

        this.deploys.forEach(async (tongoContract, assetId) => {
            if (assets === undefined || assets.includes(assetId)) {
                const tongoAccount = this.deriveAccountFromKey(tongoContract, derivedKey);
                const amount = await this._balance(tongoAccount);

                balances.push(new Promise((resolve) => { resolve({ asset: assetId, amount }); }));
            }
        });

        return Promise.all(balances);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async prepareShield(asset: AssetAmount, from?: AccountId): Promise<ShieldPreparation> {
        const tongoContract = this.deploys.get(asset.asset);

        if (tongoContract === undefined) { throw UnsupportedAssetError; }

        const fund = await this.deriveAccount(tongoContract).fund({ amount: asset.amount, sender: "sender" });

        return { txns: [fund.approve, fund.toCalldata()] };
    }

    async prepareUnshield(asset: AssetAmount, to: AccountId): Promise<PrivateOperation> {
        const tongoContract = this.deploys.get(asset.asset);

        if (tongoContract === undefined) { throw UnsupportedAssetError; }

        const tongoAccount = this.deriveAccount(tongoContract);

        if (asset.amount > await this._balance(tongoAccount)) { throw InsufficientBalanceError; }

        const rollover = await tongoAccount.rollover({ sender: "sender" });
        const withdraw = await tongoAccount.withdraw({ amount: asset.amount, to: to.address, sender: "sender" });

        return { txns: [rollover.toCalldata(), withdraw.toCalldata()] };
    }

    override async prepareTransfer(asset: AssetAmount, to: AccountId): Promise<PrivateOperation> {
        const tongoContract = this.deploys.get(asset.asset);

        if (tongoContract === undefined) { throw UnsupportedAssetError; }

        const tongoAccount = this.deriveAccount(tongoContract);

        if (asset.amount > await this._balance(tongoAccount)) { throw InsufficientBalanceError; }

        const rollover = await tongoAccount.rollover({ sender: "sender" });
        const transfer = await tongoAccount.transfer({ amount: asset.amount, to: pubKeyBase58ToAffine(to.address), sender: "sender" });

        return { txns: [rollover.toCalldata(), transfer.toCalldata()] };
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    override prepareTransferMulti(assets: Array<AssetAmount>, to: AccountId): Promise<PrivateOperation> {
        throw new MultiAssetsNotSupportedError();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async broadcastPrivateOperation(operation: PrivateOperation): Promise<void> {
        throw new Error("Method not implemented.");
    }
}
