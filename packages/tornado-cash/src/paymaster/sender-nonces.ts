import type { EthereumProvider } from '@kohaku-eth/provider';
import { entryPointNonce } from '../account/execution-account';
import { type IGenericPaymasterWithdrawalPayload, PaymasterBroadcastError, type StaleSenderNonce } from '../relayer/interfaces/paymaster-client.interface';

type Provider = Pick<EthereumProvider, 'request'>;

async function transactionCount(provider: Provider, address: `0x${string}`): Promise<bigint> {
  const value = await provider.request({ method: 'eth_getTransactionCount', params: [address, 'latest'] });

  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid transaction count response');

  return BigInt(value);
}

async function currentNonces(provider: Provider, { entryPointAddress, userOperation }: IGenericPaymasterWithdrawalPayload) {
  const { sender, eip7702Auth } = userOperation;
  const [entryPoint, authorization] = await Promise.all([
    entryPointNonce(provider, entryPointAddress, sender, BigInt(userOperation.nonce) >> 64n),
    eip7702Auth ? transactionCount(provider, sender) : undefined,
  ]);

  return { entryPoint, authorization };
}

const NONCE_NAMES: Record<StaleSenderNonce['kind'], string> = {
  'entry-point': 'EntryPoint',
  authorization: 'transaction (EIP-7702 authorization)',
};

const staleNonceError = (staleNonce: StaleSenderNonce, rejection: PaymasterBroadcastError) => new PaymasterBroadcastError('not-accepted',
  `The sender's ${NONCE_NAMES[staleNonce.kind]} nonce changed since this withdrawal was prepared (signed ${staleNonce.signed}, now ${staleNonce.current}); prepare it again.`,
  { userOpHash: rejection.userOpHash, staleNonce });

/**
 * Rethrows a broadcast error. When the bundler refused the withdrawal because
 * the sender's nonces moved after it was prepared (another transaction from the
 * sender, or another withdrawal of the same sender that landed first), throws
 * a `not-accepted` error with `staleNonce` set, saying to prepare it again instead. Checked only after
 * a refusal: a rebroadcast of a withdrawal that already landed also finds the
 * nonce moved, and must keep resolving. A failed read keeps the original error.
 */
export async function rethrowWithStaleNonces(provider: Provider, withdrawal: IGenericPaymasterWithdrawalPayload, error: unknown): Promise<never> {
  if (!(error instanceof PaymasterBroadcastError) || error.failure !== 'not-accepted') throw error;

  const current = await currentNonces(provider, withdrawal).catch(() => undefined);

  if (!current) throw error;

  const { nonce, eip7702Auth } = withdrawal.userOperation;

  if (current.entryPoint !== BigInt(nonce)) {
    throw staleNonceError({ kind: 'entry-point', signed: BigInt(nonce), current: current.entryPoint }, error);
  }

  if (eip7702Auth && current.authorization !== BigInt(eip7702Auth.nonce)) {
    throw staleNonceError({ kind: 'authorization', signed: BigInt(eip7702Auth.nonce), current: current.authorization! }, error);
  }

  throw error;
}
