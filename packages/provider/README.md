# @kohaku-eth/provider

Omni provider helpers that wrap Ethers, Viem, Helios, and Colibri.

## Receipt waiting

`waitForTransaction(txHash)` resolves when the provider returns a receipt. A
receipt can describe a reverted transaction; check its `status` separately.
Waiting does not add confirmations, finality checks or proof verification.
Those properties depend on the selected provider and its configuration.

Configure the interval and total timeout when creating a raw provider:

```ts
import { raw } from '@kohaku-eth/provider/raw';

const provider = raw(rpcClient, {
    waitForTransaction: { pollIntervalMs: 1_000, timeoutMs: 120_000 },
});

await provider.waitForTransaction(txHash);
```

The same settings are available on the verified-provider adapters:

```ts
import { helios } from '@kohaku-eth/provider/helios';
import { colibri } from '@kohaku-eth/provider/colibri';
import type { RawProviderOptions } from '@kohaku-eth/provider/raw';

const options: RawProviderOptions = {
    waitForTransaction: { pollIntervalMs: 1_000, timeoutMs: 120_000 },
};

const heliosProvider = await helios(heliosConfig, 'ethereum', false, options);
const colibriProvider = await colibri(colibriConfig, options);
```

These are Kohaku waiting settings; they are not passed into the underlying
light-client SDKs. The anon adapter continues to accept the same settings
inside `AnonConfig.waitForTransaction` and now uses the shared waiting loop.

| Adapter | Default interval | Default timeout |
| --- | --- | --- |
| raw, Helios, Colibri | 100 ms | 10 seconds |
| anon | 4 seconds | 5 minutes |
| ethers, viem | Managed by the underlying library | Managed by the underlying library |

Existing defaults remain unchanged for compatibility. A wallet that expects
slower inclusion or RPC round trips should choose a longer timeout. Supplying
one setting preserves the other adapter default. Values must be integers from
1 to 2,147,483,647 milliseconds, the supported timer range.

The polling interval starts after the previous request completes, so receipt
requests do not overlap. The timeout includes time spent inside a request and
can reject the wait even if that request never settles. After success, RPC
failure or timeout, the waiting loop clears its timers and starts no further
polls. This provider interface cannot cancel an RPC request already in flight.
Timeout errors use `Timed out waiting for transaction: <hash>`; other RPC
errors propagate unchanged. A timeout does not mean the transaction failed.

Run the provider's offline tests with:

```sh
pnpm --filter @kohaku-eth/provider test
```
