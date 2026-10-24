import { KeystorePathNotAllowedError } from '@kohaku-eth/plugins';
import type { ExternalSyncClient, Keystore, Storage } from '@kohaku-eth/plugins';
import type { EthereumProvider } from '@kohaku-eth/provider';
import type { ISecretManager } from '../account/keys';
import type { IRelayerClient } from '../relayer/interfaces/relayer-client.interface';
import { anyArgs, type ArgsCheck, type MethodPolicy } from './host-bridge';

// Every host method the state worker calls, and nothing else. A worker call
// missing here fails with "<method> is not exposed to the worker".

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// JSON-RPC the worker sends through `provider.request`: reads only. Nothing that
// signs, sends, or lists accounts reaches a wallet-backed provider.
const READ_ONLY_RPC = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
]);

export const providerPolicy: MethodPolicy<EthereumProvider> = {
  getChainId: anyArgs,
  getBlockNumber: anyArgs,
  getLogs: anyArgs,
  getCode: anyArgs,
  request: ([request]) => {
    const method = (request as { method?: unknown } | undefined)?.method;

    check(typeof method === 'string' && READ_ONLY_RPC.has(method), `RPC method ${String(method)} is not allowed from the worker`);
  },
};

export const relayerClientPolicy: MethodPolicy<IRelayerClient> = {
  getStatus: anyArgs,
};

// Shape only; the scoped keystore behind it decides which paths derive.
export const keystorePolicy: MethodPolicy<Keystore> = {
  deriveAt: (args) => check(args.length === 1 && typeof args[0] === 'string' && args[0].length <= 512, 'deriveAt takes one path string'),
};

// The worker only touches its own keys, even in a store shared with other plugins.
const ownKey = (key: unknown) =>
  check(typeof key === 'string' && key.startsWith('tornado-cash-'), `Storage key ${String(key)} is outside the tornado-cash- namespace`);

export const storagePolicy: MethodPolicy<Storage> = {
  get: ([key]) => ownKey(key),
  set: ([key, value]) => {
    ownKey(key);
    check(typeof value === 'string', 'Storage values must be strings');
  },
};

export const externalSyncPolicy: MethodPolicy<ExternalSyncClient> = {
  getEvents: anyArgs,
  firstCoveredBlock: anyArgs,
  lastCoveredBlock: anyArgs,
};

/**
 * `deriveDelegatorSigner` returns a raw wallet key, so it only answers paths the
 * integrator named in `delegation.path`, even if a custom manager holds an
 * unscoped keystore.
 */
export const secretManagerPolicy = (delegationPaths: ReadonlySet<string>): MethodPolicy<ISecretManager> => ({
  getLegacyDepositSecrets: anyArgs,
  getSignatureSecrets: anyArgs,
  deriveEphemeralSigner: anyArgs,
  deriveSignatureEphemeralSigner: anyArgs,
  deriveLegacyEphemeralSigner: anyArgs,
  deriveDelegatorSigner: ([params]) => {
    const path = (params as { path?: unknown } | undefined)?.path;

    if (typeof path !== 'string' || !delegationPaths.has(path)) throw new KeystorePathNotAllowedError(String(path));
  },
});

// `tailCalls(delegatorAddress)`
export const tailCallsCheck: ArgsCheck = (args) =>
  check(args.length === 1 && typeof args[0] === 'string' && /^0x[0-9a-fA-F]{40}$/.test(args[0]), 'tailCalls takes one address');

const normalizeUrl = (url: string): string | undefined => {
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
};

// `bundlerPost(url, body)`: only to a bundler named in the paymaster config.
// Compared as parsed URLs: viem's transport adds a trailing slash to a bare origin.
export const bundlerPostCheck = (bundlerUrls: Iterable<string>): ArgsCheck => {
  const allowed = new Set([...bundlerUrls].map(normalizeUrl));

  return (args) =>
    check(
      args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string' &&
        normalizeUrl(args[0]) !== undefined && allowed.has(normalizeUrl(args[0])),
      'bundler requests may only go to a configured bundler',
    );
};
