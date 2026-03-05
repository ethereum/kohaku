import { createServer } from 'prool';
import { anvil, type AnvilParameters } from 'prool/instances';
import { JsonRpcProvider } from 'ethers';

type DefineAnvilParameters = {
  forkUrl: string;
  forkBlockNumber?: number;
  port?: number;
  chainId?: number;
};

export interface AnvilPool {
  rpcUrl: string;
  poolId: number;
  getProvider(): Promise<JsonRpcProvider>;
  mine(blocks?: number): Promise<void>;
  setBalance(address: string, balance: string): Promise<void>;
  setStorageAt(address: string, slot: string, value: string): Promise<void>;
}

export interface AnvilInstance {
  baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  pool(poolId: number): AnvilPool;
}

function createPool(baseUrl: string, poolId: number): AnvilPool {
  const rpcUrl = `${baseUrl}/${poolId}`;

  const provider = new JsonRpcProvider(rpcUrl, undefined, {
    staticNetwork: true,
    batchMaxCount: 1,
    cacheTimeout: 0
  });

  return {
    rpcUrl,
    poolId,

    async getProvider() {
      return provider;
    },

    async mine(blocks = 1) {
      await provider.send('anvil_mine', [`0x${blocks.toString(16)}`]);
    },

    async setBalance(address: string, balance: string) {
      await provider.send('anvil_setBalance', [address, balance]);
    },

    async setStorageAt(address: string, slot: string, value: string) {
      await provider.send('anvil_setStorageAt', [address, slot, value]);
    }

  };
}

export function defineAnvil(params: DefineAnvilParameters): AnvilInstance {
  const {
    forkUrl,
    forkBlockNumber,
    port = 8545,
    chainId = 1,
  } = params;

  const baseUrl = `http://127.0.0.1:${port}`;
  let stopFn: (() => Promise<void>) | undefined;

  return {
    baseUrl,

    async start() {
      const anvilOptions: AnvilParameters = {
        chainId,
        forkUrl,
        stepsTracing: true,
        gasPrice: 1n,
        blockBaseFeePerGas: 1n,
        ...(forkBlockNumber && { forkBlockNumber: BigInt(forkBlockNumber) }),
      };

      const instance = anvil(anvilOptions);

      stopFn = await createServer({
        instance,
        port,
      }).start();
    },

    async stop() {
      if (stopFn) {
        await stopFn();
        stopFn = undefined;
      }
    },

    pool(poolId: number): AnvilPool {
      return createPool(baseUrl, poolId);
    },
  };
}
