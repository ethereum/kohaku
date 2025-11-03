import { RailgunAccount } from "~/account/base";
import { RailgunNetworkConfig } from "~/config";
import { RailgunProvider } from "~/provider";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { StorageLayer } from "~/storage/base";

import { makeProcessLog } from "./events";
import { createIndexerStorage } from "./storage";
import { createRpcSync, RpcSync } from "./sync";

export type IndexerConfig = {
  provider: RailgunProvider;
  network: RailgunNetworkConfig;
  checkpoint?: string;
  startBlock?: number;
  storage?: StorageLayer;
};

export type Indexer = {
  __type: "railgun-indexer";
  getTrees: () => MerkleTree[];
  network: RailgunNetworkConfig;
  accounts: RailgunAccount[];
  registerAccount: (account: RailgunAccount) => void;
} & Omit<RpcSync, "__type">;
export type CreateRailgunIndexerFn = (
  config: IndexerConfig
) => Promise<Indexer>;

export const createRailgunIndexer: CreateRailgunIndexerFn = async ({
  network,
  provider,
  startBlock,
  storage,
}) => {
  const accounts: RailgunAccount[] = [];
  const { trees, saveTrees, getCurrentBlock, setEndBlock } =
    await createIndexerStorage(storage, { startBlock });
  const getTrees = () => trees;
  const processLog = await makeProcessLog({ getTrees, accounts });
  const { sync } = await createRpcSync({
    network,
    provider,
    getCurrentBlock,
    accounts,
    processLog,
    getTrees,
    saveTrees,
    setEndBlock,
  });

  return {
    __type: "railgun-indexer",
    getTrees,
    network,
    sync,
    accounts,
    registerAccount: (account: RailgunAccount) => {
      console.log("Registering account");
      accounts.push(account);
    },
  };
};
