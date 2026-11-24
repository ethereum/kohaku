import { createPublicClient, createWalletClient, http, type Hex, type PublicClient, type TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

/** Anvil's default accounts. */
export const ACCOUNTS = {
  alice: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  bob: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  charlie: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
} as const;

export type FundedWallet = {
  address: Hex;
  client: PublicClient;
  /** Sends a prepared transaction and waits for it; throws when it reverts. */
  send(tx: { to: string; data: string; value: bigint }): Promise<TransactionReceipt>;
};

export async function fundedWallet(rpcUrl: string, privateKey: Hex): Promise<FundedWallet> {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const client = createPublicClient({ chain: mainnet, transport });

  await client.request({ method: 'anvil_setBalance' as never, params: [account.address, '0x56bc75e2d63100000'] as never });

  const wallet = createWalletClient({ account, chain: mainnet, transport });

  return {
    address: account.address,
    client: client as PublicClient,
    async send(tx) {
      const hash = await wallet.sendTransaction({ to: tx.to as Hex, data: tx.data as Hex, value: tx.value, gas: 1_500_000n });
      const receipt = await client.waitForTransactionReceipt({ hash });

      if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);

      return receipt;
    },
  };
}
