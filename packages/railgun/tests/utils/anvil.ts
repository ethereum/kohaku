import { createServer } from 'prool';
import { anvil, type AnvilParameters } from 'prool/instances';
import { JsonRpcProvider } from 'ethers';
import { poolId } from './test-accounts';

type DefineAnvilParameters = {
  forkUrl: string;
  forkBlockNumber?: number;
  port?: number;
  chainId?: number;
};

export type AnvilInstance = {
  rpcUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getProvider(): Promise<JsonRpcProvider>;
  mine(blocks?: number): Promise<void>;
  setBalance(address: string, balance: string): Promise<void>;
};

export function defineAnvil(params: DefineAnvilParameters): AnvilInstance {
  const {
    forkUrl,
    forkBlockNumber,
    port = 8545,
    chainId = 11155111,
  } = params;

  const rpcUrl = `http://127.0.0.1:${port}/${poolId}`;
  let stopFn: (() => Promise<void>) | undefined;

  return {
    rpcUrl,

    async start() {
      const anvilOptions: AnvilParameters = {
        chainId,
        forkUrl,
        stepsTracing: true,
        gasPrice: 1n,
        blockBaseFeePerGas: 1n,
        ...(forkBlockNumber && { forkBlockNumber: BigInt(forkBlockNumber) }),
      };

      stopFn = await createServer({
        instance: anvil(anvilOptions),
        port,
      }).start();
    },

    async stop() {
      if (stopFn) {
        await stopFn();
        stopFn = undefined;
      }
    },

    async getProvider() {
      const provider = new JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
      });

      // Ensure the provider is connected
      await provider.getBlockNumber();

      return provider;
    },

    async mine(blocks = 1) {
      const provider = new JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true,
      });
      await provider.send('anvil_mine', [`0x${blocks.toString(16)}`]);
    },

    async setBalance(address: string, balance: string) {
      const provider = new JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true,
      });
      await provider.send('anvil_setBalance', [address, balance]);
    },
  };
}
