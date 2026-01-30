import { TxLog, EthereumProvider } from "@kohaku-eth/provider";
import { RailgunNetworkConfig } from "~/config";
import { RailgunAccount } from "~/account/base";
import { ProcessLogFn } from "./events";
import { progressBar } from "~/utils/progress";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { batchBuffer } from "./buffer";

export type RpcSyncFn = (params?: { fromBlock?: number, toBlock?: number, logProgress?: boolean }) => Promise<void>;
export type RpcGetLogsFn = (fromBlock: number, toBlock: number) => AsyncGenerator<{ logs: TxLog[], toBlock: number }>;
export type RpcSyncContext = {
    provider: EthereumProvider;
    network: RailgunNetworkConfig;
    getCurrentBlock: () => number;
    accounts: RailgunAccount[];
    getTrees: () => (MerkleTree | undefined)[];
    processLog: ProcessLogFn;
    saveTrees: () => Promise<void>;
    setEndBlock: (endBlock: number) => void;
};

export type RpcSync = {
    __type: 'rpc-sync';
    sync: RpcSyncFn;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRangeErr(e: any) {
    return (
        e?.error?.code === -32001 ||
        /Under the Free/.test(e['info']['responseBody']) ||
        /failed to resolve block range/i.test(String(e?.error?.message || e?.message || e?.info?.responseBody || e?.toString() || ""))
    );
}

function formatDuration(duration: number) {
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    return `${hours}h ${minutes}m ${seconds}s`;
}

export const createRpcSync: (context: RpcSyncContext) => Promise<RpcSync> = async ({ provider, processLog, getTrees, getCurrentBlock, network, saveTrees, setEndBlock }) => {
    const getLogs: RpcGetLogsFn = async function* (startBlock, endBlock) {
        const MAX_BATCH = 200;
        const MIN_BATCH = 1;
        const railgunAddress = network.RAILGUN_ADDRESS;
        let batch = Math.min(MAX_BATCH, Math.max(1, endBlock - startBlock + 1));
        let fromBlock = startBlock;

        while (fromBlock <= endBlock) {
            const toBlock = Math.min(fromBlock + batch - 1, endBlock);

            try {
                console.log('call');
                const startTime = Date.now();

                await new Promise(r => setTimeout(r, 400)); // light pacing
                const logs = await provider.getLogs({
                    address: railgunAddress,
                    fromBlock,
                    toBlock,
                });

                const duration = Date.now() - startTime;

                console.log('[sync]: yielding logs (duration: ' + formatDuration(duration) + ')');
                yield { logs, toBlock };
                console.log('[sync]: yielded logs');

                fromBlock = toBlock + 1;                 // advance
                batch = Math.min(batch * 1.2, MAX_BATCH); // grow again after success
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                if (isRangeErr(e)) {
                    console.log('range error');

                    if (batch > MIN_BATCH) {
                        batch = Math.max(MIN_BATCH, Math.floor(batch / 2)); // shrink and retry same 'from'
                        console.log('shrinking batch to ' + batch);
                        continue;
                    }

                    // single-block still fails: skip this block to move on
                    fromBlock = toBlock + 1;
                    continue;
                }

                console.log('non range error ', Object.keys(e));

                throw e; // non-range error -> surface it
            }
        }
    };

    const sync: RpcSyncFn = async ({ fromBlock, toBlock, logProgress } = {}) => {
        const startTime = Date.now();
        const startBlock = fromBlock ?? getCurrentBlock();
        const endBlock = toBlock ?? await provider.getBlockNumber();
        const allLogs = getLogs(startBlock, endBlock);

        console.log('Starting sync from block ', startBlock, ' to block ', endBlock);

        const bufferedLogs = batchBuffer(allLogs, { highWater: 50, lowWater: 10 });

        const SAVE_INTERVAL = 1000;
        let lastSave = startBlock;

        for await (const batch of bufferedLogs) {
            let lastBlock = 0;

            console.log('Processing batch of logs (size: ', batch.length, ', entries: ', batch.reduce((acc, { logs }) => acc + logs.length, 0), ')');

            const hasLogs = batch.some(({ logs }) => logs.length > 0);

            for (const { logs, toBlock } of batch) {
                for (const log of logs) {
                    await processLog({ log, skipMerkleTree: false });
                }
                // await Promise.all(logs.map(log => processLog({ log, skipMerkleTree: false })));

                lastBlock = toBlock;
            }

            if (logProgress) {
                console.log(progressBar(startBlock, lastBlock, endBlock))
                const elapsedTime = Date.now() - startTime;
                const estimatedTimeRemaining = elapsedTime * (endBlock - lastBlock) / (lastBlock - startBlock);

                console.log(`Estimated time remaining: ` + formatDuration(estimatedTimeRemaining));
            }

            setEndBlock(lastBlock);

            if (lastBlock > lastSave + SAVE_INTERVAL) {
                if (hasLogs) {
                    console.log('rebuilding sparse trees');

                    for (const tree of getTrees()) {
                        if (!tree) continue; // Skip null trees (sparse array handling)

                        console.log('rebuilding tree');
                        await tree.rebuildSparseTree();
                    }
                }

                console.log('saving trees');
                await saveTrees()

                lastSave = lastBlock;
            }
        }

        for (const tree of getTrees()) {
            if (!tree) continue; // Skip null trees (sparse array handling)

            console.log('rebuilding tree');
            await tree.rebuildSparseTree();
        }

        console.log('saving trees');
        await saveTrees()
    };

    return {
        __type: 'rpc-sync',
        sync
    };
};
