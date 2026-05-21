import { BundlerClient } from 'privacy-paymaster';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

import type { SignedDelegation } from '../plugin/interfaces/protocol-params.interface';

export function setupBundlerClient({
  bundlerUrl,
  entryPointAddress
}: {
  chainId: number,
  bundlerUrl: string,
  entryPointAddress: `0x${string}`;
}) {
  return new BundlerClient(bundlerUrl, entryPointAddress);
}

export async function signDelegationAuthorization({
  privateKey,
  accountAddress,
  chainId,
  nonce,
}: {
  privateKey: Hex;
  accountAddress: `0x${string}`;
  chainId: number;
  nonce: number;
}): Promise<SignedDelegation> {
  const account = privateKeyToAccount(privateKey);
  const authorization = await account.signAuthorization({
    contractAddress: accountAddress,
    chainId,
    nonce,
  });

  return { authorization, senderAddress: account.address };
}
