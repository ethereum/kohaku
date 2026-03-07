import { InsufficientBalanceError, UnsupportedAssetError, type AssetAmount, type CreatePluginFn, type Host, type PluginInstance, type PublicOperation } from '@kohaku-eth/plugins';
import { JsNote, JsSyncer, JsTornadoProvider, pools } from 'node_modules/tc-js/dist/pkg/tc_rs';
import { EthereumProviderAdapter } from './ethereum-provider';
import { RemoteArtifactLoader, TornadoClassicProver } from 'tc-js';
import { TxData } from '@kohaku-eth/provider';

export type TornadoInstance = PluginInstance<
    TornadoAddress,
    {
        privateOp: TornadoPrivateOperation,
        features: {
            prepareShield: true,
            prepareUnshield: true,
        },
    }
>;

export type TornadoAddress = `${string}`;
export type TornadoPrivateOperation = {

};

export async function createTornadoPlugin(host: Host): TornadoInstance {
    const provider = await newTornadoProvider(host);
    const notes: JsNote[] = [];

    /**
     * Return the balance of the given asset, or all assets if `assets` is undefined.
     */
    async function balance(assets: TornadoAddress[] | undefined): Promise<AssetAmount[]> {
        let balances: AssetAmount[] = [];
        for (const note of notes) {
            const pool = note.pool();
            if (pool === undefined) {
                continue;
            }

            if (pool.asset)
        }
        // let filtered: JsNote[] = [];
        // if (assets === undefined) {
        //     filtered = notes;
        // } else {
        //     filtered = notes.filter((note) => assets.includes(note.pool()?.asset as TornadoAddress));
        // }

        // filtered = filtered.filter((note) => note.pool() !== undefined);
        // return filtered.map((note) => ({
        //     asset: {
        //         __type: 'erc20',
        //         contract: note.pool()!.address,
        //     },
        //     amount: BigInt(note.amount),
        // }));
    }

    async function prepareShield(asset: AssetAmount): Promise<TxData> {
        const pool = pools().find((p) => p.address === asset.asset.contract && BigInt(p.amount_wei) === asset.amount);
        if (!pool) {
            throw new UnsupportedAssetError(asset.asset);
        }

        const shield = provider.deposit(pool);
        notes.push(shield.note);
        return {
            to: shield.txData.to,
            data: shield.txData.data,
            value: BigInt(shield.txData.value)
        }
    }

    async function prepareUnshield(asset: AssetAmount, to: `0x${string}`): Promise<TornadoPrivateOperation> {
        const note = notes.find((n) => n.pool()?.address === asset.asset && BigInt(n.amount) === asset.amount);
        if (!note) {
            throw new InsufficientBalanceError(asset.asset, asset.amount, 0n);
        }
    }


    return {
        balance,
        prepareShield,
        instanceId: async () => "0",

    }
}

async function newTornadoProvider(host: Host): Promise<JsTornadoProvider> {
    const ethRpcProvider = new EthereumProviderAdapter(host.provider);
    const syncer = await JsSyncer.newRpc(ethRpcProvider, 10000n);

    const loader = new RemoteArtifactLoader(
        "https://raw.githubusercontent.com/Robert-MacWha/privacy-protocol-artifacts/refs/heads/main/artifacts/tornadocash-classic/tornado.json",
        "https://raw.githubusercontent.com/Robert-MacWha/privacy-protocol-artifacts/refs/heads/main/artifacts/tornadocash-classic/tornadoProvingKey.bin"
    );
    const prover = new TornadoClassicProver(loader);
    return JsTornadoProvider.new(ethRpcProvider, syncer, prover);
}