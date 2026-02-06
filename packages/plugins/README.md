# Plugins

Kohaku SDK provides a set of privacy protocol plugins out-of-the-box. These plugins are used to interface with various privacy pools in a standard way. Plugins can either be bundled with the SDK, or loaded dynamically at runtime by wallets.

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

The plugin interface is implemented by the privacy protocol objects. The host should not need to treat any one plugin impl differently from any other.

[File: src/plugin.ts](./src/plugin.ts)
```ts
export interface ShieldPreparation {
    txns: Array<TxData>;
}

export interface PrivateOperation {

}

export type AssetAmount = {
    asset: AssetId;
    amount: bigint;
};

abstract class Plugin {
    abstract account(): Promise<AccountId>;
    abstract balance(assets: Array<AssetId> | undefined): Promise<Array<AssetAmount>>;
    abstract prepareShield(asset: AssetAmount, from?: AccountId): Promise<ShieldPreparation>;
    prepareShieldMulti(assets: Array<AssetAmount>, from?: AccountId): Promise<ShieldPreparation> {
        throw new MultiAssetsNotSupportedError();
    }
    
    abstract prepareUnshield(asset: AssetAmount, to: AccountId): Promise<PrivateOperation>;
    prepareUnshieldMulti(assets: Array<AssetAmount>, to: AccountId): Promise<PrivateOperation> {
        throw new MultiAssetsNotSupportedError();
    }
    
    prepareTransfer(asset: AssetAmount, to: AccountId): Promise<PrivateOperation> {
        throw new TransferNotSupportedError();
    }
    prepareTransferMulti(assets: Array<AssetAmount>, to: AccountId): Promise<PrivateOperation> {
        throw new TransferNotSupportedError();
    }
    
    abstract broadcastPrivateOperation(operation: PrivateOperation): Promise<void>;
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

All plugins MUST implement a static `create` method used for initialization. This method MUST accept the `Host` interface as its first parameter, followed by any plugin-specific options. It MUST return a `Promise` that resolves to an instance of the plugin.

```ts
class ExamplePlugin extends Plugin {
    static async create(host: Host, ...): Promise<ExamplePlugin>;
}
```

### Key Material

Plugins will derive all new key material from the `Keystore` interface and therefore the host’s mnemonic. This makes all such material portable. For example:

- The Railgun plugin may attempt to claim the lowest key in the `m/420'/1984'/0'/0'/x` + `m/44'/1984'/0'/0'/x` paths.
- The TC Classic plugin might claim all keys in the `m/44’/tc’/0/0/x` path until it reaches its gap limit.

Plugins can also import key material through their `options` . This imported material is not derived from `Keystore.deriveAt` and, therefore, it is not portable. When a wallet is backed up or transferred it will either need to copy the plugin’s state (IE for cross-device syncs) or backup the key material from the plugin’s exposed `options` (IE for manual end-user backups).

## Example Usage

```ts
import { RailgunInstance } from '@kohaku-eth/railgun';
const railgunController = await RailgunInstance.create(hostInterfaces);

const balances = await railgunController.balances();
const operation = await railgunController.prepareUnshield(balances[0], new AccountId(signer.address()));
await railgunController.broadcast(operation);
```
