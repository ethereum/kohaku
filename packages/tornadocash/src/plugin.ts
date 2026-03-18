import { AssetId, InsufficientBalanceError, UnsupportedAssetError, UnsupportedChainError, type AssetAmount, type CreatePluginFn, type Host, type PluginInstance, type PublicOperation } from '@kohaku-eth/plugins';
import { JsNote, JsPool, JsRelayerProvider, JsSyncer, JsTornadoProvider, pools } from 'node_modules/tc-js/dist/pkg/tc_rs';
import { RemoteArtifactLoader, TornadoClassicProver } from 'tc-js';
import { TxData } from '@kohaku-eth/provider';
import { Broadcaster } from '@kohaku-eth/plugins/broadcaster';
import { EthereumProviderAdapter } from './ethereum-provider';

export type TcInstance = PluginInstance<
    TcAddress,
    {
        privateOp: TcPrivateOperation,
        features: {
            prepareShield: true,
            prepareUnshield: true,
        },
    }
>;

export type TcBroadcaster = Broadcaster<TcPrivateOperation>;

export type TcAddress = `${string}`;
export type TcPrivateOperation = {

};

export async function createTornadoPlugin(host: Host): TcInstance {
    return;
}

export class TornadoClassicPlugin implements TcInstance, TcBroadcaster {
    constructor(
        private provider: JsRelayerProvider,
        private notes: JsNote[],
    ) { }

    async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
        let balances = new Map<`0x${string}`, bigint>();

        for (const note of this.notes) {
            const pool = note.pool();
            if (pool === undefined) { continue; }
            const asset = pool.asset;
            if (asset.type !== "Erc20") { continue; }
            if (assets !== undefined && !assets.some((a) => a.__type === 'erc20' && a.contract === asset.address)) {
                continue;
            }

            if (!balances.has(asset.address)) {
                balances.set(asset.address, 0n);
            }
            balances.set(asset.address, balances.get(asset.address)! + BigInt(note.amount));
        }

        return Array.from(balances.entries()).map(([address, amount]) => ({
            asset: {
                __type: 'erc20',
                contract: address,
            },
            amount,
        }));
    }

    async prepareShield(token: AssetAmount): Promise<TxData> {
        const pool = pools().find((p) => p.address === token.asset.contract && BigInt(p.amountWei) === token.amount);

        // TODO: Consider splitting into multiple deposits?
        if (!pool) {
            console.warn(`No pool found for asset ${token.asset.contract} with amount ${token.amount}`);
            throw new UnsupportedAssetError(token.asset);
        }

        const shield = this.provider.deposit(pool);
        this.notes.push(shield.note);
        return {
            to: shield.txData.to,
            data: shield.txData.data,
            value: BigInt(shield.txData.value),
        }
    }

    async prepareUnshield(token: AssetAmount, to: `0x${string}`): Promise<TcPrivateOperation> {
        const note = this.notes.find((n) => {
            const pool = n.pool();
            const asset = pool?.asset;
            return asset?.type == "Erc20" && asset.address === token.asset.contract && BigInt(n.amount) === token.amount;
        });

        // TODO: Consider splitting up larger notes into smaller ones.  This would 
        // however require re-shielding the change, which adds complexity.
        if (!note) {
            throw new InsufficientBalanceError(token.asset, token.amount, 0n);
        }

        const unshield = await this.provider.withdraw(note, to);
    }
}

async function newTornadoProvider(host: Host, pool: JsPool): Promise<JsRelayerProvider> {
    const ethRpcProvider = new EthereumProviderAdapter(host.provider);
    const chainId = await ethRpcProvider.getChainId();

    // TODO: Support other chains.
    //
    // This will require updating the sync snapshots, 
    if (chainId !== 1n) {
        throw new UnsupportedChainError(chainId);
    }

    // const cacheSyncer = await JsSyncer.newCache()
    const syncer = await JsSyncer.newRpc(ethRpcProvider, 10000n);

    const loader = new RemoteArtifactLoader(
        "https://raw.githubusercontent.com/Robert-MacWha/privacy-protocol-artifacts/refs/heads/main/artifacts/tornadocash-classic/tornado.json",
        "https://raw.githubusercontent.com/Robert-MacWha/privacy-protocol-artifacts/refs/heads/main/artifacts/tornadocash-classic/tornadoProvingKey.bin"
    );
    const prover = new TornadoClassicProver(loader);
    return JsRelayerProvider.new(ethRpcProvider, syncer, prover, ethRpcProvider);
}
