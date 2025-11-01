import { RailgunNetworkConfig } from "~/config";
import { GetRailgunAddress, makeGetRailgunAddress } from "./actions/address";
import { DerivedKeys, deriveKeys, KeyConfig } from "./keys";
import { GetMasterPublicKey } from "./actions/masterKey";
import { Notebook } from "~/utils/notebook";
import { GetBalance, makeGetBalance } from "./actions/balance";
import { GetNotes, makeGetNotes } from "./actions/notes";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { GetMerkleRoot, makeGetMerkleRoot } from "./actions/root";
import { RailgunProvider } from "~/provider";
import { makeProcessLog, ProcessLog } from "./events";
import { CreateShield, makeCreateShield } from "./tx/shield";
import { CreateUnshield, makeCreateUnshield } from "./tx/unshield";
import { CreateTransfer, makeCreateTransfer } from "./tx/transfer";
import { Indexer, makeIndexer } from "./events/sync";
import { AccountConfig } from "./config";

export type RailgunAccountParameters = {
    // Configuration for the account, network, deployment, etc.
    config: AccountConfig;
    // RPC Provider, either ethers or viem.
    provider: RailgunProvider;
    // Key configuration for the account, either a private key or a mnemonic.
    credential: KeyConfig,
};

export type InternalRailgunAccount = DerivedKeys;

export type RailgunAccount = GetRailgunAddress &
    GetMasterPublicKey &
    GetBalance &
    GetNotes &
    GetMerkleRoot &
    ProcessLog &
    CreateShield &
    CreateTransfer &
    CreateUnshield &
    Indexer &
{ _internal: InternalRailgunAccount };

export const createRailgunAccount: (params: RailgunAccountParameters) => Promise<RailgunAccount> = async ({ credential, config, provider }) => {
    const { spending, viewing, master, signer } = await deriveKeys(credential);
    const notebooks: Notebook[] = [];
    const trees: MerkleTree[] = [];
    const { network } = config;

    const getRailgunAddress = makeGetRailgunAddress({ master, viewing });
    const getBalance = makeGetBalance({ notebooks, trees, network });
    const getNotes = await makeGetNotes({ notebooks, trees, spending, viewing });
    const { getTransactNotes } = getNotes;
    const processLog = await makeProcessLog({ notebooks, trees, viewing, spending });
    const sync = await makeIndexer({ config, provider, processLog });

    const shield = await makeCreateShield({ network, master, viewing, signer });
    const transfer = await makeCreateTransfer({ network, trees, getTransactNotes });
    const unshield = await makeCreateUnshield({ network, trees, master, viewing, getTransactNotes });

    const getMerkleRoot = makeGetMerkleRoot({ trees });

    const _internal = {
        spending,
        viewing,
        master,
        signer,
    };

    return Object.assign({
        getRailgunAddress,
        getMasterPublicKey: async () => master,
        getBalance,
        processLog,
        _internal,
    }, getMerkleRoot, getNotes, shield, transfer, unshield, sync);
};
