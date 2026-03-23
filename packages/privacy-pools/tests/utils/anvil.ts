import { createServer } from 'prool';
import { anvil, type AnvilParameters } from 'prool/instances';
import { JsonRpcProvider } from 'ethers';
import getPort from 'get-port';

type DefineAnvilParameters = {
  forkUrl: string;
  forkBlockNumber?: string | number;
  chainId: number;
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
  port: number;
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

export async function defineAnvil(params: DefineAnvilParameters): Promise<AnvilInstance> {
  const {
    forkUrl,
    forkBlockNumber,
    chainId
  } = params;

  const port = await getPort();
  const baseUrl = `${forkUrl}`;
  let stopFn: (() => Promise<void>) | undefined;

  return {
    baseUrl,
    port,
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
      const server = createServer({
        limit: 100,
        instance,
        port,
      });

      stopFn = await server.start();
    },

    async stop() {
      if (stopFn) {
        await stopFn();
        stopFn = undefined;
      }
    },

    pool(poolId: number): AnvilPool {
      return createPool(`http://127.0.0.1:${port}`, poolId);
    },

    raw(): AnvilPool {
      const anvilUrl = baseUrl;

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
