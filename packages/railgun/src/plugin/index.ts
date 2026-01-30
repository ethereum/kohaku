import { AccountId, AssetAmount, AssetId, CustomAccountId, CustomChainId, Eip155ChainId, Erc20Id, Host, InvalidAddressError, Keystore, NativeId, Network, Plugin, PrivateOperation, SecretStorage, ShieldPreparation, Storage, UnsupportedAssetError, UnsupportedChainError } from "@kohaku-eth/plugins";
import { Address, checksumAddress, createPublicClient, custom, isAddress, PublicClient, zeroAddress } from "viem";
import { EIP1193ProviderAdapter } from "./provider-adapter";
import { derivePathsForIndex } from "./wallet-node";
import { TxData } from "@kohaku-eth/provider";
import { HostStorageAdapter } from "./storage-adaopter";
import { createRailgunIndexer, Indexer, IndexerConfig } from "~/indexer/base";
import { createRailgunAccount, RailgunAccount, RailgunAccountParameters } from "~/account/base";
import { getNetworkConfig } from "~/config";

const CHAIN_ID_STORAGE_KEY = "railgun-chain-id";
const ACCOUNT_INDEX_STORAGE_KEY = "railgun-account-index";
const INDEXER_CACHE_STORAGE_KEY = "railgun-indexer-cache";
const ACCOUNT_CACHE_STORAGE_KEY = "railgun-account-cache";
const MAX_ACCOUNT_SEARCH_DEPTH = 100;

type RailgunOperation = TransferOperation | UnshieldOperation;

interface TransferOperation {
    kind: 'transfer';
    txns: TxData[];
}

interface UnshieldOperation {
    kind: 'unshield';
    txns: TxData[];
}

const RAILGUN_CHAIN_NAMESPACE = 'railgun' as const;

const RAILGUN_CHAINS = [
    new Eip155ChainId(1),
    new Eip155ChainId(111555111),
    new CustomChainId(RAILGUN_CHAIN_NAMESPACE, 1),
    new CustomChainId(RAILGUN_CHAIN_NAMESPACE, 111555111),
] as const;

type RailgunAssetAmount = {
    asset: NativeId<(typeof RAILGUN_CHAINS)[number]> | Erc20Id<(typeof RAILGUN_CHAINS)[number], Address>;
    amount: bigint;
};

function isRailgunAssetAmount(input: AssetAmount): input is RailgunAssetAmount {
    const asset = input.asset;
    if (!(asset instanceof NativeId) && !(asset instanceof Erc20Id)) {
        return false;
    }
    return RAILGUN_CHAINS.some(c => c.equals(asset.chainId));
}

function asRailgunAssetAmount(input: AssetAmount): RailgunAssetAmount {
    if (!isRailgunAssetAmount(input)) {
        throw new UnsupportedAssetError(input.asset);
    }
    return input;
}

export class RailgunPlugin implements Plugin<RailgunAssetAmount> {
    private constructor(
        private network: Network,
        private storage: Storage,
        private secretStorage: SecretStorage,
        private keystore: Keystore,
        private ethProvider: PublicClient,
        private indexer: Indexer,
        private railgunAccount: RailgunAccount,
        private chainId: number,
    ) { }

    static async create(host: Host): Promise<Plugin> {
        const publicClient = createPublicClient({
            transport: custom({
                request: async ({ method, params }) => {
                    return host.ethProvider.request({ method, params });
                }
            })
        })

        const storedChainId = host.storage.get(CHAIN_ID_STORAGE_KEY);
        const chainId = await publicClient.getChainId();
        if (storedChainId === null) {
            host.storage.set(CHAIN_ID_STORAGE_KEY, chainId.toString());
        } else if (storedChainId !== chainId.toString()) {
            throw new UnsupportedChainError(new Eip155ChainId(chainId));
        }

        const indexerNetwork = getNetworkConfig(`${BigInt(chainId)}`);

        // TODO: Figure out how to handle snapshots (maybe bundled in the sdk?)
        // and startBlock (maybe via a UI option? Or add as a constructor param?)
        const indexerConfig: IndexerConfig = {
            network: indexerNetwork,
            provider: new EIP1193ProviderAdapter(publicClient),
            storage: new HostStorageAdapter(host.storage, INDEXER_CACHE_STORAGE_KEY),
        };
        const indexer = await createRailgunIndexer(indexerConfig);

        const account = await createAccount(
            host.secretStorage,
            host.keystore,
            indexer,
        );

        return new RailgunPlugin(
            host.network,
            host.storage,
            host.secretStorage,
            host.keystore,
            publicClient,
            indexer,
            account,
            chainId,
        );
    }

    async account(): Promise<AccountId> {
        const chainId = new CustomChainId(RAILGUN_CHAIN_NAMESPACE, this.chainId);
        const railgunAddress = await this.railgunAccount.getRailgunAddress();
        const accountId = new CustomAccountId(railgunAddress, chainId);

        return accountId;
    }

    async balance(assets: Array<AssetId>): Promise<Array<AssetAmount>> {
        await this.sync();

        let balances: Array<AssetAmount> = [];
        for (const asset of assets) {
            if (asset.namespace === 'erc20') {
                const amount = await this.railgunAccount.getBalance(asset.reference);
                balances.push({ asset, amount });
            } else {
                console.warn(`Railgun balance does not support asset: ${asset.toString()}`);
            }
        }


        return balances;
    }

    async prepareShield(asset: AssetAmount, from?: AccountId): Promise<ShieldPreparation> {
        return this.prepareShieldMulti([asset], from);
    }

    async prepareShieldMulti(assets: AssetAmount[], from?: AccountId): Promise<ShieldPreparation> {
        await this.sync();

        const filteredAssets: Array<{ address: Address; amount: bigint }> = assets.map(aa => {
            const { asset, amount } = asRailgunAssetAmount(aa);
            if (asset.namespace === 'erc20') {
                return {
                    address: asset.reference,
                    amount,
                }
            } else if (asset.namespace === 'slip44') {
                //? The railgun SDK uses the zero address to represent native assets
                return {
                    address: zeroAddress,
                    amount
                }
            }
            throw new UnsupportedAssetError(aa.asset);
        }).filter(a => a !== undefined);

        if (filteredAssets.length === 0) {
            return { txns: [] };
        }

        const addresses = filteredAssets.map(a => a.address);
        const values = filteredAssets.map(a => a.amount);
        const tx = await this.railgunAccount.shieldMulti(addresses, values);
        const txns = [tx];

        return { txns };
    }

    async prepareUnshield(assets: AssetAmount, to: AccountId): Promise<PrivateOperation> {
        return this.prepareUnshieldMulti([assets], to);
    }

    async prepareUnshieldMulti(assets: AssetAmount[], to: AccountId): Promise<PrivateOperation> {
        await this.sync();

        if (to.kind !== 'eip155') {
            throw new InvalidAddressError(to.address);
        }

        const txns: TxData[] = [];
        for (const assetAmount of assets) {
            const { asset, amount } = asRailgunAssetAmount(assetAmount);
            if (asset.namespace === 'erc20') {
                const txn = await this.railgunAccount.unshield(asset.reference, amount, to.address);
                txns.push(txn);
            } else if (asset.namespace === 'slip44') {
                const txn = await this.railgunAccount.unshieldNative(amount, to.address);
                txns.push(txn);
            } else {
                throw new UnsupportedAssetError(asset);
            }
        }

        const operation: UnshieldOperation = {
            kind: 'unshield',
            txns,
        };
        return { inner: operation };
    }

    async prepareTransfer(assets: AssetAmount, to: AccountId): Promise<PrivateOperation> {
        return this.prepareTransferMulti([assets], to);
    }

    async prepareTransferMulti(assets: AssetAmount[], to: AccountId): Promise<PrivateOperation> {
        await this.sync();

        if (to.chainId.namespace !== RAILGUN_CHAIN_NAMESPACE || to.chainId.reference !== this.chainId) {
            throw new UnsupportedChainError(to.chainId);
        }

        const txns: TxData[] = [];
        for (const assetAmount of assets) {
            const { asset, amount } = asRailgunAssetAmount(assetAmount);
            if (asset.namespace === 'erc20') {
                const txn = await this.railgunAccount.transfer(asset.reference, amount, to.address);
                txns.push(txn);
            } else {
                throw new UnsupportedAssetError(asset);
            }
        }

        const operation: TransferOperation = {
            kind: 'transfer',
            txns,
        };
        return { inner: operation };
    }

    async broadcastPrivateOperation(operation: PrivateOperation): Promise<void> {
        const railgunOperation = operation.inner as RailgunOperation;
        throw new Error("Method not implemented.");
    }

    private async sync(): Promise<void> {
        if (!this.indexer.sync) {
            console.error("Railgun indexer does not support sync");
            return;
        }

        await this.indexer.sync({
            logProgress: true,
        });
    }
}

async function createAccount(storage: SecretStorage, keystore: Keystore, indexer: Indexer): Promise<RailgunAccount> {
    const { viewingKey, spendingKey } = getKeys(storage, keystore);
    const accountConfig: RailgunAccountParameters = {
        indexer,
        credential: {
            type: 'key',
            viewingKey: viewingKey,
            spendingKey: spendingKey,
        },
        storage: new HostStorageAdapter(storage, ACCOUNT_CACHE_STORAGE_KEY),
    }
    const account = await createRailgunAccount(accountConfig);
    return account;
}

function getKeys(storage: SecretStorage, keystore: Keystore): {
    viewingKey: string;
    spendingKey: string;
} {
    const index = storage.get(ACCOUNT_INDEX_STORAGE_KEY);

    if (index !== null) {
        const indexNumber = parseInt(index, 10);
        const paths = derivePathsForIndex(indexNumber);
        const spendingKey = keystore.deriveAt(paths.spending);
        const viewingKey = keystore.deriveAt(paths.viewing);
        return {
            spendingKey,
            viewingKey,
        };
    }

    for (let i = 0; i < MAX_ACCOUNT_SEARCH_DEPTH; i++) {
        const paths = derivePathsForIndex(i);
        try {
            const spendingKey = keystore.deriveAt(paths.spending);
            const viewingKey = keystore.deriveAt(paths.viewing);

            storage.set(ACCOUNT_INDEX_STORAGE_KEY, i.toString());

            return {
                spendingKey,
                viewingKey,
            };
        } catch (e) {
            // Continue searching
        }
    }

    throw new Error("No keys found in keystore");
}
