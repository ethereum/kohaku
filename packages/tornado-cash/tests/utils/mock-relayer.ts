import { Contract, Wallet } from 'ethers';

import { poolAbi } from '../../src/data/abis/pool.abi';
import { IRelayerClient, IRelayerStatusResponse, ITornadoWithdrawRequest, ITornadoWithdrawResponse } from '../../src/relayer/interfaces/relayer-client.interface';

export interface MockRelayerOptions {
  chainId: 1 | 1155511;
  fees: {
    cheap: number;
    expensive: number;
  };
  signer?: Wallet;
}

const relayersHostnames = new Set<keyof MockRelayerOptions['fees']>(['cheap', 'expensive']);

export const createMockRelayerClient = (options: Partial<MockRelayerOptions> = {}) => {
  const {
    chainId = 1,
    fees = {
      cheap: 0.03,
      expensive: 0.04
    },
    signer,
  } = options;

  let alwaysFail = false;
  const setAlwaysFail = (bool: boolean) => {
    alwaysFail = bool;
  }

  const relayer: IRelayerClient = {
    getStatus: async (hostname: keyof MockRelayerOptions['fees']): Promise<IRelayerStatusResponse> => {
      if (alwaysFail) {
        throw new Error('Set to always fail');
      }

      if (!relayersHostnames.has(hostname)) {
        throw new Error('Invalid hostname, must be either \'cheap\' or \'expensive\'');
      }
  
      return {
        currentQueue: 0,
        ethPrices: {},
        netId: chainId,
        rewardAccount: '0x0000000000000000000000000000000000000001',
        tornadoServiceFee: fees[hostname],
        version: '1'
      }
    },
    withdraw: async (_relayerUrl: string, body: ITornadoWithdrawRequest): Promise<ITornadoWithdrawResponse> => {
      if (!signer) {
        // eslint-disable-next-line no-restricted-syntax
        return { id: '1' };
      }

      const { proof, args, contract } = body;
      const [root, nullifierHash, recipient, relayer, fee, refund] = args;

      const pool = new Contract(contract, poolAbi, signer);
      const tx = await pool.withdraw(proof, root, nullifierHash, recipient, relayer, fee, refund, {
        value: BigInt(refund),
      });
      const receipt = await tx.wait();

      // eslint-disable-next-line no-restricted-syntax
      return { id: receipt.hash };
    }
  };

  return {
    ...relayer,
    setAlwaysFail,
  };
};
