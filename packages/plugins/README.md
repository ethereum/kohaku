# Plugins

Kohaku SDK provides a set of private transaction protocol plugins out-of-the-box. These plugins are used to interface with various private transaction protocols in a standard way. Plugins are bundled with the SDK; nothing in it loads plugin code at runtime. A plugin runs with the privileges of the code that loads it, so a wallet that loads third-party plugin code must isolate it (worker, iframe or process) and hand it a scoped keystore (`scopeKeystore`), its own storage and a filtered network. See [The host](../../docs/pages/host.mdx) for the boundary the bundled plugins keep.

## Interface Outline

### Plugin Interface

Every plugins by default follows a standard format. Plugins may extend the interface, or opt-in to additional features.

```ts
export type MyInstance = PluginInstance<
  // The account ID type
  MyAccountId,
  {
    credential: MyCredential;
    assetAmounts: { input: MyInput; internal: MyInternal; output: MyOutput };
    privateOp: MyPrivateOperation;
    // The features the plugin supports
    features: {
      prepareShield: true;
      prepareShieldMulti: true;
      prepareTransfer: false;
      prepareTransferMulti: false;
      prepareUnshield: true;
      prepareUnshieldMulti: true;
    };
  }
>;
```

And so the final plugin ends up looking like this:

```ts
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

Plugins will derive all new key material from the `Keystore` interface and therefore the host's mnemonic. This makes all such material portable. Each plugin only gets its own subtree, through `scopeKeystore`:

- Tornado Cash derives below `m/29795'/1'` and Privacy Pools below `m/28784'/1'`, plus the exact wallet path passed as `delegation.path` to a paymaster unshield.

Plugins can also import key material through their `options` . This imported material is not derived from `Keystore.deriveAt` and, therefore, it is not portable. When a wallet is backed up or transferred it will either need to copy the plugin's state (IE for cross-device syncs) or backup the key material from the plugin's exposed `options` (IE for manual end-user backups).
