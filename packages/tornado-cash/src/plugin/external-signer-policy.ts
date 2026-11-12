import { simpleAccountFactoryData } from '../account/execution-account';
import { getUserOperationTypedData } from 'viem/account-abstraction';
import type { DelegatorAccount } from '../account/delegation.interface';
import { SIMPLE_7702_IMPLEMENTATION } from '../paymaster/utils';
import type { MethodPolicy } from './host-bridge';

type Scope = { factory?: { address: `0x${string}`; salt: bigint }; implementation?: `0x${string}`; sender?: `0x${string}`; userOpNonce?: bigint; smartAccount?: boolean; address: `0x${string}`; chainId: number; nonce: bigint; entryPointAddress: `0x${string}`; paymasterAddress: `0x${string}` };
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const only = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

function check(ok: boolean): asserts ok {
  if (!ok) throw new Error('Signing request is outside the selected Tornado delegation scope.');
}

/** Signer fields and every other method remain inaccessible. This scopes the
 * signing protocol, not host user consent: the host must still review calldata,
 * note recipients, fees and limits before approving each typed-data request. */
export function externalSignerPolicy(scope: Scope): MethodPolicy<DelegatorAccount> {
  const canonical = getUserOperationTypedData({ chainId: scope.chainId, entryPointAddress: scope.entryPointAddress,
    userOperation: { sender: scope.address, nonce: 0n, callData: '0x', callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n,
      maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, signature: '0x' } });

  return {
    ...(!scope.smartAccount ? { signAuthorization: (args: unknown[]) => {
      check(args.length === 1);
      const request = args[0] as { address?: unknown; chainId?: unknown; nonce?: unknown } | undefined;

      check(!!request && only(request, ['address', 'chainId', 'nonce']) && request.chainId === scope.chainId && BigInt(request.nonce as number) === scope.nonce && same(request.address, scope.implementation ?? SIMPLE_7702_IMPLEMENTATION));
    } } : {}),
    signTypedData: (args) => {
      check(args.length === 1);
      const request = args[0] as typeof canonical | undefined;

      check(!!request && only(request, ['types', 'primaryType', 'domain', 'message']) && request.primaryType === canonical.primaryType && request.domain?.name === canonical.domain!.name && request.domain?.version === canonical.domain!.version &&
        only(request.domain!, ['name', 'version', 'chainId', 'verifyingContract']) &&
        Number(request.domain?.chainId) === scope.chainId && same(request.domain?.verifyingContract, scope.entryPointAddress) &&
        same(request.message?.initCode, scope.factory ? `${scope.factory.address}${simpleAccountFactoryData(scope.address, scope.factory).slice(2)}` : '0x') &&
        JSON.stringify(request.types) === JSON.stringify(canonical.types) && same(request.message?.sender, scope.sender ?? scope.address) && BigInt(request.message.nonce) === (scope.userOpNonce ?? 0n) &&
        typeof request.message.paymasterAndData === 'string' && request.message.paymasterAndData.slice(0, 42).toLowerCase() === scope.paymasterAddress.toLowerCase());
    },
  };
}
