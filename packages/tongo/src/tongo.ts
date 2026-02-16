import { Plugin, AssetAmount, ShieldPreparation, PrivateOperation, CustomAccountId, CustomChainId, UnsupportedAssetError, InsufficientBalanceError } from "@kohaku-eth/plugins";
import { AccountId, AssetId, Host, MultiAssetsNotSupportedError } from "@kohaku-eth/plugins";
import { createPublicClient, http, PublicClient } from "viem";
import { Address } from "@kohaku-eth/provider";
import { pubKeyBase58ToAffine, Account as TongoAccount } from "tongo-sdk";

interface TongoPluginConfig {
    chain: number;
    client: PublicClient;
    deploys: Map<AssetId, Address>;
}

export class TongoPlugin extends Plugin<AssetAmount, ShieldPreparation, PrivateOperation> {
    host: Host; 
    config: TongoPluginConfig;

    tempmocktongoaccount!: TongoAccount;
    
    constructor(readonly _host: Host, config: TongoPluginConfig) {
        super();
        this.host = _host;
        this.config = config;
    }

    async account(): Promise<AccountId> {
        const client = createPublicClient({ transport: http() })
        //new TongoAccount(0n, "", client); // TODO: typing fails here, but why? viem version?
        const tongoAccount = this.tempmocktongoaccount;//new TongoAccount(0n, "", this.config.client);
        return new CustomAccountId(tongoAccount.tongoAddress(), new CustomChainId("tongo-evm", this.config.chain));
    }

    async balance(assets: Array<AssetId> | undefined): Promise<Array<AssetAmount>> {
        let balances = [];
        this.config.deploys.forEach(async (tongoAddress, assetId) => {
            if (assets === undefined || assets.includes(assetId)) {
                const tongoAccount = this.tempmocktongoaccount;//new TongoAccount(0n, tongoAddress, this.config.client);
                const state = await tongoAccount.state();
                balances.push({ asset: assetId, amount: state.balance + state.pending })
            }
        })
        throw new Error("Method not implemented.");
    }

    async prepareShield(_asset: AssetAmount, from?: AccountId): Promise<ShieldPreparation> {
        const tongoAddress = this.config.deploys.get(_asset.asset);
        if (tongoAddress === undefined) { throw UnsupportedAssetError; }
        const tongoAccount = this.tempmocktongoaccount;//new TongoAccount(0n, tongoAddress, this.config.client);
        const fund = await tongoAccount.fund({ amount: _asset.amount, sender: "sender" });
        return { txns: [fund.approve, fund.toCalldata()] };
    }

    async prepareUnshield(_asset: AssetAmount, to: AccountId): Promise<PrivateOperation> {
        if (_asset.amount > (await this.balance([_asset.asset]))[0]!.amount) { throw InsufficientBalanceError; }
        const tongoAddress = this.config.deploys.get(_asset.asset);
        if (tongoAddress === undefined) { throw UnsupportedAssetError; }
        const tongoAccount = this.tempmocktongoaccount;//new TongoAccount(0n, tongoAddress, this.config.client);
        const rollover = await tongoAccount.rollover({ sender: "sender" });
        const withdraw = await tongoAccount.withdraw({ amount: _asset.amount, to: to.address, sender: "sender" });
        return { txns: [rollover.toCalldata(), withdraw.toCalldata()] };
    }

    override async prepareTransfer(asset: AssetAmount, to: AccountId): Promise<PrivateOperation> {
        if (asset.amount > (await this.balance([asset.asset]))[0]!.amount) { throw InsufficientBalanceError; }
        const tongoAddress = this.config.deploys.get(asset.asset);
        if (tongoAddress === undefined) { throw UnsupportedAssetError; }
        const tongoAccount = this.tempmocktongoaccount;//new TongoAccount(0n, tongoAddress, this.config.client);
        const rollover = await tongoAccount.rollover({ sender: "sender" });
        const transfer = await tongoAccount.transfer({ amount: asset.amount, to: pubKeyBase58ToAffine(to.address), sender: "sender" });
        return { txns: [rollover.toCalldata(), transfer.toCalldata()] };
    }
    override prepareTransferMulti(assets: Array<AssetAmount>, to: AccountId): Promise<PrivateOperation> {
        throw new MultiAssetsNotSupportedError();
    }

    async broadcastPrivateOperation(operation: PrivateOperation): Promise<void> {
        throw new Error("Method not implemented.");
    }
}
