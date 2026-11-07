import type { EthereumProvider } from '@kohaku-eth/provider';
import { encodeFunctionData, getAddress, zeroAddress } from 'viem';
import type { DelegationConfig, DelegatorAccount, ExecutionAccountConfig } from '../interfaces/user-ops.interface';

/** A single normalization point: protocol proof/call builders only need sender,
 * nonce and the standard execution ABI, independently of the account family. */
export function executionAccount(config?: DelegationConfig): ExecutionAccountConfig {
  if (config?.nonce !== undefined && (typeof config.nonce !== 'bigint' || config.nonce < 0n || config.nonce >= 2n ** 256n)) throw new Error('Invalid EntryPoint nonce');

  const address = config?.mode === 'smart-account' ? config.account.address : config?.implementation;

  if (address && getAddress(address) === zeroAddress) throw new Error('Execution account address cannot be zero');

  if (config?.mode === 'smart-account' && config.account.factory) {
    const { address: factory, salt } = config.account.factory;

    if (getAddress(factory) === zeroAddress || typeof salt !== 'bigint' || salt < 0n || salt >= 2n ** 256n) throw new Error('Invalid SimpleAccount factory configuration');
  }

  return config?.mode === 'smart-account' ? config.account : { kind: 'eip7702', implementation: config?.implementation };
}

export function externalAccountSigner(config: Extract<DelegationConfig, { mode: 'external' | 'smart-account' }>): DelegatorAccount {
  if (config.mode === 'external') return config.signer;

  return {
    address: config.signer.address,
    signTypedData: request => config.signer.signTypedData(request),
    signAuthorization: async () => { throw new Error('Deployed smart accounts do not sign EIP-7702 authorizations.'); },
  };
}

export function executionSender(config: DelegationConfig | undefined, signer: DelegatorAccount): `0x${string}` {
  return config?.mode === 'smart-account' ? config.account.address : signer.address;
}

export function requiresAccountSimulation(config?: DelegationConfig): boolean {
  return config?.allowUsed === true || config?.mode === 'external' || config?.mode === 'smart-account' || !!config?.implementation || (config?.nonce ?? 0n) !== 0n;
}

/** Only ABI metadata is held here. Deployments and Solidity sources stay external. */
export function simpleAccountFactoryData(owner: `0x${string}`, factory: { salt: bigint }): `0x${string}` {
  return encodeFunctionData({ abi: [{ type: 'function', name: 'createAccount', stateMutability: 'nonpayable',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'salt', type: 'uint256' }], outputs: [{ name: 'account', type: 'address' }] }],
    functionName: 'createAccount', args: [owner, factory.salt] });
}

export function executionGasBaseline<T extends { verificationGasLimit: bigint }>(config: DelegationConfig | undefined, gas: T): T {
  // Factory creation is charged to verificationGasLimit, before the withdrawal.
  return config?.mode === 'smart-account' && config.account.factory ? { ...gas, verificationGasLimit: 500_000n } : gas;
}

const nonceAbi = [{ type: 'function', name: 'getNonce', stateMutability: 'view',
  inputs: [{ name: 'sender', type: 'address' }, { name: 'key', type: 'uint192' }], outputs: [{ type: 'uint256' }] }] as const;

export async function readEntryPointNonce(provider: Pick<EthereumProvider, 'request'>, entryPoint: `0x${string}`, sender: `0x${string}`, expected?: bigint): Promise<bigint> {
  const data = encodeFunctionData({ abi: nonceAbi, functionName: 'getNonce', args: [sender, (expected ?? 0n) >> 64n] });
  const value = await provider.request({ method: 'eth_call', params: [{ to: entryPoint, data }, 'latest'] });

  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid EntryPoint nonce response');

  const nonce = BigInt(value);

  if (expected !== undefined && nonce !== expected) throw new Error('Requested EntryPoint nonce does not match the current on-chain nonce');

  return nonce;
}

/** Reject a touched sender before proving or signing unless the caller opts in.
 * ERC20 balances and history that leaves no current state are not enumerated. */
export async function prepareExecutionAccount(config: DelegationConfig | undefined, signer: DelegatorAccount,
  provider: Pick<EthereumProvider, 'request'> | undefined, entryPoint: `0x${string}`, knownNativeNonce?: bigint) {
  const account = executionAccount(config);

  if (!provider) throw new Error('Execution account checks require the host provider');

  const sender = executionSender(config, signer);
  const [code, balance, native, nonce] = await Promise.all([
    provider.request({ method: 'eth_getCode', params: [sender, 'latest'] }),
    provider.request({ method: 'eth_getBalance', params: [sender, 'latest'] }),
    knownNativeNonce !== undefined ? Promise.resolve(`0x${knownNativeNonce.toString(16)}`) : provider.request({ method: 'eth_getTransactionCount', params: [sender, 'latest'] }),
    readEntryPointNonce(provider, entryPoint, sender, config?.nonce),
  ]);

  if (typeof code !== 'string' || !/^0x([0-9a-f]{2})*$/i.test(code) || typeof balance !== 'string' || !/^0x[0-9a-f]+$/i.test(balance) || typeof native !== 'string' || !/^0x[0-9a-f]+$/i.test(native)) throw new Error('Invalid execution account state response');

  const nativeNonce = BigInt(native);

  if (config?.allowUsed !== true && (code !== '0x' || BigInt(balance) !== 0n || nativeNonce !== 0n || nonce !== 0n)) {
    throw new Error('Execution account appears touched (code/delegation, nonce or ETH balance); explicitly set allowUsed: true to use it');
  }

  if (account.kind === 'simple-account') {
    if (code === '0x' && !account.factory) throw new Error('Undeployed SimpleAccount requires factory configuration');

    // The same factory config remains usable after the first deployment.
    return { account: code === '0x' ? account : { ...account, factory: undefined }, sender, nonce, authorizationNonce: undefined };
  }

  if (code !== '0x' && !/^0xef0100[0-9a-f]{40}$/i.test(code)) throw new Error('EIP-7702 sender has incompatible existing account code');

  return { account, sender, nonce, authorizationNonce: nativeNonce };
}
