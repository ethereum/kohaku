import { getAddress, recoverTypedDataAddress } from 'viem';
import { recoverAuthorizationAddress } from 'viem/utils';
import type { DelegatorAccount } from './delegation.interface';
import { SIMPLE_7702_IMPLEMENTATION } from '../paymaster/utils';

/** One preparation owns one pinned signer and one cached authorization. A gas
 * refinement changes the UserOperation, so each distinct payload still needs a
 * fresh typed-data signature. No fallback to a derived key on rejection. */
export function verifiedExternalDelegator(signer: DelegatorAccount, chainId: number, nonce: bigint, execution: { implementation?: `0x${string}`; sender?: `0x${string}`; userOpNonce?: bigint; smartAccount?: boolean } = {}): DelegatorAccount {
  const address = getAddress(signer.address);
  const implementation = execution.implementation ?? SIMPLE_7702_IMPLEMENTATION;

  if ((!execution.smartAccount && typeof signer.signAuthorization !== 'function') || typeof signer.signTypedData !== 'function') {
    throw new Error('External delegation requires authorization and typed-data signing methods.');
  }

  let authorization: ReturnType<DelegatorAccount['signAuthorization']> | undefined;

  return {
    address,
    signAuthorization: (request) => {
      if (execution.smartAccount || request.chainId !== chainId || BigInt(request.nonce) !== nonce || request.address?.toLowerCase() !== implementation.toLowerCase()) {
        throw new Error('External authorization request does not match the selected chain, nonce and executor.');
      }

      authorization ??= (async () => {
        const signed = await signer.signAuthorization(request);

        if (signed.chainId !== chainId || BigInt(signed.nonce) !== nonce || signed.address?.toLowerCase() !== implementation.toLowerCase() ||
          (await recoverAuthorizationAddress({ authorization: signed })).toLowerCase() !== address.toLowerCase()) {
          throw new Error('External authorization does not match the selected signer and request.');
        }

        return signed;
      })();

      return authorization;
    },
    signTypedData: async (typedData) => {
      const signature = await signer.signTypedData(typedData);

      if ((await recoverTypedDataAddress({ ...typedData, signature } as Parameters<typeof recoverTypedDataAddress>[0])).toLowerCase() !== address.toLowerCase()) {
        throw new Error('External UserOperation signature does not match the selected signer.');
      }

      return signature;
    },
  };
}
