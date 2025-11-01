import { RailgunLog, RailgunProvider } from "~/provider";
import { ProcessLog } from ".";
import { AccountConfig } from "../config";

export type IndexerSyncFn = (params?: { fromBlock?: number, toBlock?: number }) => Promise<void>;
export type IndexerGetLogsFn = (fromBlock: number, toBlock: number) => AsyncGenerator<RailgunLog[]>;
export type IndexerContext = {
    config: AccountConfig;
    provider: RailgunProvider;
} & Pick<ProcessLog, 'processLog'>;

export type Indexer = {
    sync: IndexerSyncFn;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRangeErr(e: any) {
    return (
        e?.error?.code === -32001 ||
        /failed to resolve block range/i.test(String(e?.error?.message || e?.message || ""))
    );
}

export const makeIndexer: (context: IndexerContext) => Promise<Indexer> = async ({ config, provider, processLog }) => {
    const currentBlock = config.startBlock ?? config.network.GLOBAL_START_BLOCK; // TODO: get from storage

    const getLogs: IndexerGetLogsFn = async function* (startBlock, endBlock) {
        const MAX_BATCH = 10;
        const MIN_BATCH = 1;
        const railgunAddress = config.network.RAILGUN_ADDRESS;
        let batch = Math.min(MAX_BATCH, Math.max(1, endBlock - startBlock + 1));
        let from = startBlock;

        while (from <= endBlock) {
            const to = Math.min(from + batch - 1, endBlock);

            try {
                await new Promise(r => setTimeout(r, 400)); // light pacing
                const logs = await provider.getLogs({
                    address: railgunAddress,
                    fromBlock: from,
                    toBlock: to,
                });

                yield logs;

                from = to + 1;                 // advance
                batch = Math.min(batch * 2, MAX_BATCH); // grow again after success
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) {
                if (isRangeErr(e)) {
                    if (batch > MIN_BATCH) {
                        batch = Math.max(MIN_BATCH, Math.floor(batch / 2)); // shrink and retry same 'from'
                        continue;
                    }

                    // single-block still fails: skip this block to move on
                    from = to + 1;
                    continue;
                }

                throw e; // non-range error -> surface it
            }
        }
    };

    const sync: IndexerSyncFn = async ({ fromBlock, toBlock } = {}) => {
        const startBlock = fromBlock ?? currentBlock;
        const endBlock = toBlock ?? await provider.getBlockNumber();
        const allLogs = getLogs(startBlock, endBlock);

        console.log('Starting sync from block ', startBlock, ' to block ', endBlock);

        for await (const logs of allLogs) {
            console.log('Processing batch of logs (size: ', logs.length, ')');

            for (const log of logs) {
                await processLog({ log, skipMerkleTree: false });
            }
        }
    };

    return {
        sync
    };
};
