import { simpleAccountFactoryData } from './execution-account';
import { getAddress, recoverTypedDataAddress } from 'viem';
import { getUserOperationTypedData } from 'viem/account-abstraction';
import { recoverAuthorizationAddress } from 'viem/utils';
import type { DelegatorAccount } from '../interfaces/user-ops.interface';
import { SIMPLE_7702_IMPLEMENTATION } from '../paymaster/utils';

interface SigningScope {
  implementation?: `0x${string}`;
  sender?: `0x${string}`;
  userOpNonce?: bigint;
  smartAccount?: boolean;
  factory?: { address: `0x${string}`; salt: bigint };
  chainId: number;
  nonce: bigint;
  entryPointAddress: `0x${string}`;
  paymasterAddress: `0x${string}`;
}
const same = (value: unknown, expected: string) => typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
const only = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** PP's state manager runs in the host, so these are ordinary awaited callbacks,
 * not transferred functions. Pin the account and scope, verify both signatures,
 * and reuse only the authorization while the gas/fee-bearing UserOp changes.
 * Hosts must still review calldata, recipients, proof-bound fees and gas limits. */
export function verifiedExternalDelegator(signer: DelegatorAccount, scope: SigningScope): DelegatorAccount {
  const address = getAddress(signer.address);

  if ((!scope.smartAccount && typeof signer.signAuthorization !== 'function') || typeof signer.signTypedData !== 'function') {
    throw new Error('External delegation requires authorization and typed-data signing methods.');
  }

  const signAuthorization = signer.signAuthorization.bind(signer);
  const signTypedData = signer.signTypedData.bind(signer);
  const canonical = getUserOperationTypedData({ chainId: scope.chainId, entryPointAddress: scope.entryPointAddress,
    userOperation: { sender: address, nonce: 0n, callData: '0x', callGasLimit: 0n, verificationGasLimit: 0n, preVerificationGas: 0n,
      maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, signature: '0x' } });
  let authorization: ReturnType<DelegatorAccount['signAuthorization']> | undefined;

  return {
    address,
    signAuthorization: async request => {
      if (scope.smartAccount || !only(request, ['address', 'chainId', 'nonce']) || request.chainId !== scope.chainId || BigInt(request.nonce) !== scope.nonce || !same(request.address, (scope.implementation ?? SIMPLE_7702_IMPLEMENTATION))) {
        throw new Error('External authorization request is outside the selected Privacy Pools delegation scope.');
      }

      authorization ??= (async () => {
        const signed = await signAuthorization(request);

        if (signed.chainId !== scope.chainId || BigInt(signed.nonce) !== scope.nonce || !same(signed.address, (scope.implementation ?? SIMPLE_7702_IMPLEMENTATION)) ||
          !same(await recoverAuthorizationAddress({ authorization: signed }), address)) {
          throw new Error('External authorization does not match the selected signer and request.');
        }

        return signed;
      })();

      return authorization;
    },
    signTypedData: async typedData => {
      const request = typedData as unknown as ReturnType<typeof getUserOperationTypedData>;

      if (!only(request, ['types', 'primaryType', 'domain', 'message']) || request.primaryType !== canonical.primaryType ||
        request.domain?.name !== canonical.domain!.name || request.domain?.version !== canonical.domain!.version ||
        !only(request.domain!, ['name', 'version', 'chainId', 'verifyingContract']) || Number(request.domain?.chainId) !== scope.chainId ||
        !same(request.domain?.verifyingContract, scope.entryPointAddress) || JSON.stringify(request.types) !== JSON.stringify(canonical.types) ||
        !same(request.message?.initCode, scope.factory ? `${scope.factory.address}${simpleAccountFactoryData(address, scope.factory).slice(2)}` : '0x') ||
        !same(request.message?.sender, scope.sender ?? address) || BigInt(request.message.nonce) !== (scope.userOpNonce ?? 0n) ||
        typeof request.message.paymasterAndData !== 'string' || !same(request.message.paymasterAndData.slice(0, 42), scope.paymasterAddress)) {
        throw new Error('UserOperation signing request is outside the selected Privacy Pools delegation scope.');
      }

      const signature = await signTypedData(typedData);

      if (!same(await recoverTypedDataAddress({ ...typedData, signature } as Parameters<typeof recoverTypedDataAddress>[0]), address)) {
        throw new Error('External UserOperation signature does not match the selected signer.');
      }

      return signature;
    },
  };
}
