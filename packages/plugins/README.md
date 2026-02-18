# Plugins

Kohaku SDK provides a set of private transaction protocol plugins out-of-the-box. These plugins are used to interface with various private transaction protocols in a standard way. Plugins can either be bundled with the SDK, or loaded dynamically at runtime by wallets.

## Interface Outline

### Plugin Interface

Every plugin must comply with the standard interface. Plugins may extend interface, or opt-in to additional features.

[File: src/base.ts](./src/base.ts)
```ts
export type AssetAmount = {
    asset: AssetId;
    amount: bigint;
};

export type PluginInstance = {
    // Returns the internal instance identifier (0zk, 0x, etc)
    instanceId: () => Promise<string>;
    // Fetch balances for a given set of assets
    balance: (assets: Array<AssetId> | undefined) => Promise<Array<AssetAmount>>;
    // Shield a given asset to a given address
    prepareShield: (asset: AssetAmount, to: string) => Promise<PublicOperation>;
    prepareShieldMulti: (assets: Array<AssetAmount>, to: string) => Promise<PublicOperation>;
    // Transfer a given asset to a given address
    prepareTransfer: (asset: AssetAmount, to: string) => Promise<PrivateOperation>;
    prepareTransferMulti: (assets: Array<AssetAmount>, to: string) => Promise<PrivateOperation>;
    // Unshield a given asset from a given address
    prepareUnshield: (asset: AssetAmount, to: string) => Promise<PrivateOperation>;
    prepareUnshieldMulti: (assets: Array<AssetAmount>, to: string) => Promise<PrivateOperation>;

    // Broadcast a private operation
    broadcastPrivateOperation: (operation: PrivateOperation) => Promise<void>;
};

// Specify any other generics you might want to narrow down here
export type MyPlugin = Plugin<"my-plugin", MyPluginInstance, MyPrivateOperation, Host, never, MyPluginParameters>;
```

### Host interfaces

When initializing a plugin, the host (the consuming app) provides a set of standardized interfaces. Plugins uses these interfaces to interact with the host environment, store data, and perform actions on behalf of the user.

[File: src/host.ts](./src/host.ts)
```ts
export type Host = {
    network: Network;
    storage: Storage;
    keystore: Keystore;
    provider: EthereumProvider;
}

export type Network = {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export type Storage = {
    set(key: string, value: string): void;
    get(key: string): string | null;
}

export type Keystore = {
    deriveAt(path: string): Hex;
}
```

### Errors

Plugins should throw errors using the standard `Error` class. Certain error conditions are standardized:

[File: src/errors.ts](./src/errors.ts)
```ts
export class UnsupportedAssetError extends PluginError {
    constructor(public readonly assetId: AssetId) {
        super(`Unsupported asset: ${assetId}`);
    }
}

export class UnsupportedChainError extends PluginError {
    constructor(public readonly chainId: ChainId) {
        super(`Unsupported chain: ${chainId}`);
    }
}

export class InvalidAddressError extends PluginError {
    constructor(public readonly address: string) {
        super(`Invalid address: ${address}`);
    }
}

export class InsufficientBalanceError extends PluginError {
    constructor(public readonly assetId: AssetId, public readonly required: bigint, public readonly available: bigint) {
        super(`Insufficient balance for asset ${assetId}: required ${required}, have ${available}`);
    }
}

export class MultiAssetsNotSupportedError extends PluginError {
    constructor() {
        super(`Multiple assets are not supported by this plugin.`);
    }
}
```

### Key Material

Plugins will derive all new key material from the `Keystore` interface and therefore the host's mnemonic. This makes all such material portable. For example:

- The Railgun plugin may attempt to claim the lowest key in the `m/420'/1984'/0'/0'/x` + `m/44'/1984'/0'/0'/x` paths.
- The TC Classic plugin might claim all keys in the `m/44'/tc'/0/0/x` path until it reaches its gap limit.

Plugins can also import key material through their `options` . This imported material is not derived from `Keystore.deriveAt` and, therefore, it is not portable. When a wallet is backed up or transferred it will either need to copy the plugin's state (IE for cross-device syncs) or backup the key material from the plugin's exposed `options` (IE for manual end-user backups).

## Example Usage

```ts
import { createRailgunPlugin } from '@kohaku-eth/railgun';

// Setup host & plugin
const host: Host = {
    storage,
    network,
    provider,
};
const config: RGPluginParameters = {};
const railgun = await createRailgunPlugin(host, config);

// Create instance
const account = await railgun.createInstance();

// Get balance
const balances = await account.balance();

// Shield
const tokenToShield = {
    asset: 'erc20:0x0000000000000000000000000000000000000000',
    amount: 100n,
};
const publicTx = await account.prepareShield(tokenToShield);

await myWallet.sendTransaction(publicTx);

// Unshield
const recipient = '0x0000000000000000000000000000000000000000';
const myPrivateTx = await account.prepareUnshield(balances[0], recipient);

await railgun.broadcastPrivateOperation(myPrivateTx);
```
