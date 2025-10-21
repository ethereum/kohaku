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
  let instance: ReturnType<typeof anvil> | undefined;

  console.log('Anvil defined');

  return {
    rpcUrl,

    async start() {
      console.log('Starting Anvil...');
      const anvilOptions: AnvilParameters = {
        chainId,
        forkUrl,
        stepsTracing: true,
        gasPrice: 1n,
        blockBaseFeePerGas: 1n,
        ...(forkBlockNumber && { forkBlockNumber: BigInt(forkBlockNumber) }),
      };

      instance = anvil(anvilOptions, {messageBuffer: 100});

      instance.on('stdout', (data) => {
        console.log('Anvil stdout:', data);
      });
      instance.on('stderr', (data) => {
        console.error('Anvil stderr:', data);
      });
      instance.on('message', (data) => {
        console.log('Anvil message:', data);
      });

      stopFn = await createServer({
        instance,
        port,
      }).start();
      console.log('Anvil started');
    },

    async stop() {
      console.log('Stopping Anvil...');
      if (instance) {
        console.log('Anvil messages:', instance.messages.get());
      }

      if (stopFn) {
        await stopFn();
        stopFn = undefined;
      }
    },

    async getProvider() {

      console.log('Getting provider...');
      const provider = new JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
      });

      console.log('Provider created');
      console.log(instance?.messages.get())

      // Ensure the provider is connected
      await provider.getBlockNumber();

      console.log('Provider connected');

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
