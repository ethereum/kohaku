import { RailgunNetworkConfig } from "~/config";
import { createRailgunIndexer, Indexer } from "~/indexer/base";
import { RailgunProvider } from "~/provider";
import { StorageLayer } from "~/storage/base";

import { GetRailgunAddress, makeGetRailgunAddress } from "./actions/address";
import { GetBalance, makeGetBalance } from "./actions/balance";
import { GetMasterPublicKey } from "./actions/masterKey";
import { GetNotes, makeGetNotes } from "./actions/notes";
import { GetMerkleRoot, makeGetMerkleRoot } from "./actions/root";
import { makeProcessLog, ProcessLog } from "./events";
import { DerivedKeys, deriveKeys, KeyConfig } from "./keys";
import { createAccountStorage } from "./storage";
import { CreateShield, makeCreateShield } from "./tx/shield";
import { CreateTransfer, makeCreateTransfer } from "./tx/transfer";
import { CreateUnshield, makeCreateUnshield } from "./tx/unshield";

export type RailgunAccountBaseParameters = {
  // Key configuration for the account, either a private key or a mnemonic.
  credential: KeyConfig;
  // Storage layer for notebooks
  storage: StorageLayer;
};

export type RailgunAccountParamsIndexer = RailgunAccountBaseParameters & {
  // Indexer configuration
  indexer: Indexer;
};

export type RailgunAccountParamsIndexerConfig = RailgunAccountBaseParameters & {
  // Indexer configuration
  provider: RailgunProvider;
  // Network configuration
  network: RailgunNetworkConfig;
};

export type RailgunAccountParameters =
  | RailgunAccountParamsIndexer
  | RailgunAccountParamsIndexerConfig;

export type InternalRailgunAccount = DerivedKeys & ProcessLog;

export type RailgunAccount = GetRailgunAddress &
  GetMasterPublicKey &
  GetBalance &
  GetNotes &
  GetMerkleRoot &
  CreateShield &
  CreateTransfer &
  CreateUnshield & { indexer: Indexer } & { _internal: InternalRailgunAccount };

export const createRailgunAccount: (
  params: RailgunAccountParameters
) => Promise<RailgunAccount> = async ({ credential, storage, ...params }) => {
  const { spending, viewing, master, signer } = await deriveKeys(credential);
  const { notebooks, saveNotebooks } = await createAccountStorage(storage, {
    spending,
    viewing,
  });
  const indexer =
    "indexer" in params
      ? params.indexer
      : await createRailgunIndexer({
          network: params.network,
          provider: params.provider,
        });
  const { getTrees, network } = indexer;

  const getRailgunAddress = makeGetRailgunAddress({ master, viewing });
  const getBalance = makeGetBalance({ notebooks, network, getTrees });
  const getNotes = await makeGetNotes({
    notebooks,
    getTrees,
    spending,
    viewing,
  });
  const { getTransactNotes } = getNotes;
  const processLog = await makeProcessLog({
    notebooks,
    getTrees,
    viewing,
    spending,
    saveNotebooks,
  });

  const shield = await makeCreateShield({ network, master, viewing, signer });
  const transfer = await makeCreateTransfer({
    network,
    getTrees,
    getTransactNotes,
  });
  const unshield = await makeCreateUnshield({
    network,
    getTrees,
    getTransactNotes,
  });

  const getMerkleRoot = makeGetMerkleRoot({ getTrees });

  const _internal = {
    spending,
    viewing,
    master,
    signer,
    ...processLog,
  };

  const account = Object.assign(
    {
      getRailgunAddress,
      getMasterPublicKey: async () => master,
      getBalance,
      indexer,
      _internal,
    },
    getMerkleRoot,
    getNotes,
    shield,
    transfer,
    unshield
  );

  indexer.registerAccount(account);

  return account;
};
