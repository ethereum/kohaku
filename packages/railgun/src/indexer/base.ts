import { RailgunNetworkConfig } from "~/config";
import { EthereumProvider, TxLog } from "@kohaku-eth/provider";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { createRpcSync, RpcSync } from "./sync";
import { RailgunAccount } from "~/account/base";
import { makeProcessLog } from "./events";
import { StorageLayer } from "~/storage/base";
import { createIndexerStorage, serializeMerkleTrees, IndexerLoadData } from "./storage";

export type IndexerConfig = {
    network: RailgunNetworkConfig;
    provider?: EthereumProvider;
    checkpoint?: string;
    startBlock?: number;
} & (
        | { storage: StorageLayer; loadState?: never }
        | { storage?: never; loadState?: IndexerLoadData }
    );

export type ProcessLogsOptions = {
    skipMerkleTree?: boolean;
};

export type Indexer = {
    __type: 'railgun-indexer';
    getTrees: () => MerkleTree[];
    network: RailgunNetworkConfig;
    accounts: RailgunAccount[];
    registerAccount: (account: RailgunAccount) => void;
    processLogs: (logs: TxLog[], options?: ProcessLogsOptions) => Promise<void>;
    getNetwork: () => RailgunNetworkConfig;
    getEndBlock: () => number;
    getSerializedState: () => { merkleTrees: ReturnType<typeof serializeMerkleTrees>; endBlock: number };
    sync?: RpcSync['sync'];
};

export type CreateRailgunIndexerFn = (config: IndexerConfig) => Promise<Indexer>;

export const createRailgunIndexer: CreateRailgunIndexerFn = async ({
    network,
    provider,
    startBlock,
    storage,
    loadState,
}) => {
    const accounts: RailgunAccount[] = [];
    const { trees, saveTrees, getCurrentBlock, setEndBlock } = await createIndexerStorage({ startBlock, storage, loadState });
    const getTrees = () => trees;
    const processLog = await makeProcessLog({ getTrees, accounts });

    // Only create sync if provider is provided
    let sync: RpcSync['sync'] | undefined;

    if (provider) {
        const rpcSync = await createRpcSync({ network, provider, getCurrentBlock, accounts, processLog, getTrees, saveTrees, setEndBlock });

        sync = rpcSync.sync;
    }

    const processLogs = async (logs: TxLog[], options: ProcessLogsOptions = {}) => {
        const { skipMerkleTree = false } = options;

        // Process all logs
        for (const log of logs) {
            await processLog({ log, skipMerkleTree });
        }

        // If we processed merkle trees, rebuild sparse trees at the end
        if (!skipMerkleTree) {
            for (const tree of getTrees()) {
                if (tree) {
                    await tree.rebuildSparseTree();
                }
            }
        }

        // Update endBlock to the highest block number in the logs
        if (logs.length > 0) {
            const maxBlock = Math.max(...logs.map(log => log.blockNumber));

            setEndBlock(maxBlock);

            // Update each account's endBlock to the minimum of their current endBlock and the indexer's endBlock
            // This ensures accounts don't get ahead of the indexer's merkle trees
            const indexerEndBlock = getCurrentBlock();

            for (const account of accounts) {
                const accountEndBlock = account._internal.accountEndBlock ?? 0;

                // Account endBlock should be at most the indexer's endBlock (can't be ahead of merkle trees)
                const newAccountEndBlock = Math.min(Math.max(accountEndBlock, maxBlock), indexerEndBlock);

                account._internal.setAccountEndBlock?.(newAccountEndBlock);
            }
        }
    };

    const getSerializedState = () => {
        return {
            merkleTrees: serializeMerkleTrees(trees),
            endBlock: getCurrentBlock(),
        };
    };

    const baseIndexer = {
        __type: 'railgun-indexer' as const,
        getTrees,
        network,
        accounts,
        registerAccount: (account: RailgunAccount) => {
            console.log('Registering account');
            accounts.push(account);
        },
        processLogs,
        getNetwork: () => network,
        getEndBlock: getCurrentBlock,
        getSerializedState,
    };

    // Conditionally add sync if provider exists
    return {
        ...baseIndexer,
        ...(sync ? { sync } : {}),
    } as Indexer;
};
