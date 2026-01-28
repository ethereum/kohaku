# Plugins

Kohaku SDK provides a set of privacy pool plugins out-of-the-box. These plugins are used to interface with various privacy pools in a standard way. Plugins can either be bundled with the SDK, or loaded dynamically at runtime by wallets.

## Interface Outline

### Host interfaces

When constructing a plugin, the host provides a set of standardized interfaces. Plugins uses these interfaces to interact with the host environment, store data, and perform actions on behalf of the user.

[File: src/host.ts](./src/host.ts)
```ts
export interface Host {
    network: Network;
    storage: Storage;
    secretStorage: SecretStorage;
    keystore: Keystore;
    ethProvider: EthProvider;
}

export interface Network {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Storage {
    set(key: string, value: string): void;
    get(key: string): string | null;
}

export interface SecretStorage {
    set(key: string, value: string): void;
    get(key: string): string | null;
}

export interface Keystore {
    deriveAt(path: string): Hex;
}

export interface EthProvider {
    request(args: {
        method: string;
        params?: unknown[] | Record<string, unknown>
    }): Promise<unknown>;
}
```

### Plugin Interface

The plugin interface is implemented by the privacy pool objects. The host should not need to treat any one plugin impl differently from any other.

[File: src/plugin.ts](./src/plugin.ts)
```ts
export interface ShieldPreparation {
    txns: Array<TxData>;
}

export interface Operation {
    inner: unknown;
}

export type AssetAmount = {
    asset: AssetId;
    amount: bigint;
};

export interface Plugin {
    account(): Promise<AccountId>;
    balance(assets: Array<AssetId> | undefined): Promise<Array<AssetAmount>>;
    prepareShield(assets: Array<AssetAmount> | AssetAmount, from?: Address): Promise<ShieldPreparation>;
    prepareUnshield(assets: Array<AssetAmount> | AssetAmount, to: Address): Promise<Operation>;
    prepareTransfer(assets: Array<AssetAmount> | AssetAmount, to: AccountId): Promise<Operation>;
    broadcast(operation: Operation): Promise<void>;
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

### Plugin Initialization

Hosts initialize plugins by constructing them with the host interface. Plugin initialization may vary from plugin to plugin, and is not defined by this spec.

### Key Material

Plugins will derive all new key material from the `Keystore` interface and therefore the host’s mnemonic. This makes all such material portable. For example:

- The Railgun plugin may attempt to claim the lowest key in the `m/420'/1984'/0'/0'/x` + `m/44'/1984'/0'/0'/x` paths.
- The TC Classic plugin might claim all keys in the `m/44’/tc’/0/0/x` path until it reaches its gap limit.

Plugins can also import key material through their `options` . This imported material is not derived from `Keystore.deriveAtPath` and, therefore, it is not portable. When a wallet is backed up or transferred it will either need to copy the plugin’s state (IE for cross-device syncs) or backup the key material from the plugin’s exposed `options` (IE for manual end-user backups).

## Example Usage

### Loading a plugin

```ts
// From bundled library
import { RailgunPool } from '@kohaku/railgun-pool';
const pool = new RailgunPool(hostInterfaces);
```

### Using a plugin

```ts
// Get balances
let balances = pool.balances(pool_account);

// Withdraw to the user's EOA
let account = new AccountId(new Eip155ChainId(1), signer.address());
let operation = pool.unshield(v, balances)
pool.broadcast(operation)
```
