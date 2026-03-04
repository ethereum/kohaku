import { createServer } from 'prool';
import { anvil, type AnvilParameters } from 'prool/instances';
import { JsonRpcProvider } from 'ethers';

export const ANVIL_PORT = 8545;

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
  getBlockNumber(): Promise<number>;
  setBalance(address: string, balance: string): Promise<void>;
}

export interface AnvilInstance {
  baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  pool(poolId: number): AnvilPool;

  raw(): AnvilPool;

}

function createPool(baseUrl: string, poolId: number): AnvilPool {
  const rpcUrl = `${baseUrl}/${poolId}`;

  const provider = new JsonRpcProvider(rpcUrl, undefined, {
    staticNetwork: true,
    batchMaxCount: 1,
    cacheTimeout: 0,
  });

  return {
    rpcUrl,
    poolId,

    getBlockNumber() {
      return provider.getBlockNumber();
    },

    getProvider() {
      return Promise.resolve(provider);
    },

    async mine(blocks?: number) {
      await provider.send('anvil_mine', [`0x${(blocks || 1).toString(16)}`]);
    },

    async setBalance(address: string, balance: string) {
      await provider.send('anvil_setBalance', [address, balance]);
    },
  };
}

export function defineAnvil(params: DefineAnvilParameters): AnvilInstance {
  const {
    forkUrl,
    forkBlockNumber,
    port = ANVIL_PORT,
    chainId = 11155111,
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
        limit: 100,
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

    raw(): AnvilPool {
      const anvilUrl = `http://127.0.0.1:8545`;

      const provider = new JsonRpcProvider(anvilUrl, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
        cacheTimeout: 0,
      });

      return {
        rpcUrl: anvilUrl,
        poolId: -1,

        getBlockNumber() {
          return provider.getBlockNumber();
        },

        getProvider() {
          return Promise.resolve(provider);
        },

        async mine(blocks?: number) {
          await provider.send('anvil_mine', [`0x${(blocks || 1).toString(16)}`]);
        },

        setBalance(address: string, balance: string) {
          return provider.send('anvil_setBalance', [address, balance]);
        }
      };

    }

  };
}
