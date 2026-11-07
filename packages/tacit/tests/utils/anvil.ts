import { createServer } from 'prool';
import { anvil } from 'prool/instances';
import getPort from 'get-port';

export type AnvilFork = {
  /** An isolated fork: each pool id is its own anvil instance behind the same server. */
  rpcUrl(poolId: number): string;
  stop(): Promise<void>;
};

export async function startAnvilFork(args: { forkUrl: string; forkBlockNumber: number; chainId: number }): Promise<AnvilFork> {
  const port = await getPort();
  const instance = anvil({
    chainId: args.chainId,
    forkUrl: args.forkUrl,
    forkBlockNumber: BigInt(args.forkBlockNumber),
    gasPrice: 1n,
    blockBaseFeePerGas: 1n,
  });
  const stop = await createServer({ limit: 100, instance, port }).start();

  return {
    rpcUrl: (poolId) => `http://127.0.0.1:${port}/${poolId}`,
    stop: async () => {
      await stop();
    },
  };
}
