# Plugins

Kohaku SDK provides a set of privacy pool plugins out-of-the-box. These plugins are used to interface with various privacy pools in a standard way. Plugins can either be bundled with the SDK, or loaded dynamically at runtime by wallets.

## Interface Outline

### Plugin Interface

The plugin interface is implemented by the privacy pool objects. The host should not need to treat any one plugin impl differently from any other.

The plugin interface is defined in [plugins.ts](./src/plugin.ts).

### Plugin Initialization

Plugins are deterministically initialized within their constructor. Plugin constructors ARE NOT defined by this API, and are free to take any arguments they wish.

### Key Material

Plugins will derive all new key material from the `Keystore` interface and therefore the host’s mnemonic. This makes all such material portable. For example:

- The Railgun plugin may attempt to claim the lowest key in the `m/420'/1984'/0'/0'/x` + `m/44'/1984'/0'/0'/x` paths.
- The TC Classic plugin might claim all keys in the `m/44’/tc’/0/0/x` path until it reaches its gap limit.

Plugins can also import key material through their `options` . This imported material is not derived from `Keystore.deriveAtPath` and, therefore, it is not portable. When a wallet is backed up or transferred it will either need to copy the plugin’s state (IE for cross-device syncs) or backup the key material from the plugin’s exposed `options` (IE for manual end-user backups).

### Host interfaces

The host injects standard dependencies into the plugins so sdk consumers can customize functionality. Since the plugin's constructor is standardized, so too are all host interfaces.

While many of these traits would be accessible directly to the plugins (e.g. network requests, local storage, or logging), plugins should use the dependency-injected versions so the host (and wallet SDK) can specify custom implementations.

The host interfaces are defined in [host.ts](./src/host.ts).

## SDK Usage

### Example: Loading a plugin

```ts
// From bundled library
import { RailgunPool } from '@kohaku/railgun-pool';
const pool = new RailgunPool(hostInterfaces);
```

### Example: Using a plugin

```ts
// Get balances
let balances = pool.balances(pool_account);

// Withdraw to the user's EOA
let address = signer.address();
let address_account: AccountId = {
  chainId: { kind: "Evm", chainId: 1n },
  accountId: address,
};
let operation = pool.unshield(address_account, balances)
pool.broadcast(operation)
```

## Design Considerations

- Let end-users load arbitrary privacy pool providers into wallets ~~(including those wallets are not "aware" of)~~
    - ∴ the pools need to be blackbox. Wallets cannot implement specific functionality for plugins they aren't aware of
- Allow plugin-specific constructors
    - ∴ Users can no longer load new plugins at runtime into wallets. Instead, to add new pools, users would need to fork and re-build the wallet with the new plugins included.
- ~~Assert all runtime-loaded code be trusted. Trusted means "developed by kohaku".~~
    - ~~∴ code within pools has the same security & trust assumptions as the rest of the SDK code.~~
    - ~~∴ the pools must be verified / signed by a trusted party. Arbitrary pools cannot be loaded.~~
    - ~~∴ if we want to allow arbitrary pools (IE end-user extensibility) we'd need to include proper sandboxing & permissions.~~

Simplest way to do this is a dependency-injection / plugin-based architecture. Different privacy pools are implemented by plugins, which are loaded from external modules at runtime. These plugins provide a standard interface, are instantiated & called with host-injected functions, and are entirely self-contained.
