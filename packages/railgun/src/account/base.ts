import { RailgunNetworkConfig } from "~/config";
import { GetRailgunAddress, makeGetRailgunAddress } from "./actions/address";
import { DerivedKeys, deriveKeys, KeyConfig } from "./keys";
import { GetMasterPublicKey } from "./actions/masterKey";
import { GetBalance, makeGetBalance } from "./actions/balance";
import { GetNotes, makeGetNotes } from "./actions/notes";
import { GetMerkleRoot, makeGetMerkleRoot } from "./actions/root";
import { makeProcessLog, ProcessLog } from "./events";
import { CreateShield, makeCreateShield } from "./tx/shield";
import { CreateUnshield, makeCreateUnshield } from "./tx/unshield";
import { CreateTransfer, makeCreateTransfer } from "./tx/transfer";
import { createRailgunIndexer, Indexer } from "~/indexer/base";
import { EthereumProvider } from "@kohaku-eth/provider";
import { StorageLayer } from "~/storage/base";
import { createAccountStorage, serializeAccountStorage, CachedAccountStorage } from "./storage";
import { RGCircuitGetterFn } from "~/circuits";
import { rgHttpFetcher } from "~/circuits/fetchers/http";

export type RailgunAccountBaseParameters = {
    // Key configuration for the account, either a private key or a mnemonic.
    credential: KeyConfig,
    // Function to get circuits
    getCircuits?: RGCircuitGetterFn;
} & (
        | { storage: StorageLayer; loadState?: never }
        | { storage?: never; loadState?: CachedAccountStorage }
    );

export type RailgunAccountParamsIndexer = RailgunAccountBaseParameters & {
    // Indexer configuration
    indexer: Indexer;
};

export type RailgunAccountParamsIndexerConfig = RailgunAccountBaseParameters & {
    // Indexer configuration
    provider?: EthereumProvider;
    // Network configuration
    network: RailgunNetworkConfig;
};

export type RailgunAccountParameters = RailgunAccountParamsIndexer | RailgunAccountParamsIndexerConfig;

export type InternalRailgunAccount = DerivedKeys & ProcessLog & {
    accountEndBlock: number;
    setAccountEndBlock?: (endBlock: number) => void;
};

export type RailgunAccount = GetRailgunAddress &
    GetMasterPublicKey &
    GetBalance &
    GetNotes &
    GetMerkleRoot &
    CreateShield &
    CreateTransfer &
    CreateUnshield &
{ indexer: Indexer } &
{ _internal: InternalRailgunAccount } &
{ getNetwork: () => RailgunNetworkConfig } &
{ getEndBlock: () => number } &
{ getSerializedState: () => CachedAccountStorage };

export const createRailgunAccount: (params: RailgunAccountParameters) => Promise<RailgunAccount> = async ({ credential, storage, loadState, ...params }) => {
    const { spending, viewing, master, signer } = await deriveKeys(credential);
    const { notebooks, getEndBlock: getAccountEndBlock, saveNotebooks, setEndBlock: setAccountEndBlock } = await createAccountStorage({ storage, loadState, spending, viewing });
    const indexer = 'indexer' in params ? params.indexer : await createRailgunIndexer({ network: params.network, provider: params.provider });
    const { getTrees, network } = indexer;
    // TODO: remove this github url override once we have a stable release url of the circuits
    const getCircuits = params.getCircuits ?? rgHttpFetcher('https://raw.githubusercontent.com/lucemans/railguntemp/refs/heads/master/package/');

    // Validate that account endBlock doesn't exceed indexer endBlock
    // Account notebooks can't reference merkle tree state that doesn't exist yet
    const indexerEndBlock = indexer.getSerializedState().endBlock;
    const accountEndBlock = getAccountEndBlock();

    if (accountEndBlock > indexerEndBlock) {
        console.warn(
            `Account endBlock (${accountEndBlock}) exceeds indexer endBlock (${indexerEndBlock}). ` +
            `Account notebooks may reference commitments that don't exist in merkle trees. ` +
            `This could cause errors when querying balances or notes.`
        );
        // Cap account endBlock to indexer endBlock to prevent issues
        setAccountEndBlock(indexerEndBlock);
    }

    const getRailgunAddress = makeGetRailgunAddress({ master, viewing });
    const getBalance = makeGetBalance({ notebooks, network, getTrees });
    const getNotes = await makeGetNotes({ notebooks, getTrees, spending, viewing });
    const { getTransactNotes } = getNotes;
    const processLog = await makeProcessLog({ notebooks, getTrees, viewing, spending, saveNotebooks, getAccountEndBlock, setAccountEndBlock });

    const shield = await makeCreateShield({ network, master, viewing, signer });
    const transfer = await makeCreateTransfer({ network, getTrees, getTransactNotes, getCircuits });
    const unshield = await makeCreateUnshield({ network, getTrees, getTransactNotes, getCircuits });

    const getMerkleRoot = makeGetMerkleRoot({ getTrees });

    const getNetwork = () => network;

    const getEndBlock = () => getAccountEndBlock();

    const getSerializedState = () => {
        return serializeAccountStorage({ notebooks, endBlock: getAccountEndBlock() });
    };

    const _internal = {
        spending,
        viewing,
        master,
        signer,
        ...processLog,
        get accountEndBlock() {
            return getAccountEndBlock();
        },
        setAccountEndBlock,
    };

    const account = Object.assign({
        getRailgunAddress,
        getMasterPublicKey: async () => master,
        getBalance,
        indexer,
        _internal,
        getNetwork,
        getEndBlock,
        getSerializedState,
    }, getMerkleRoot, getNotes, shield, transfer, unshield);

    indexer.registerAccount(account);

    return account;
};
