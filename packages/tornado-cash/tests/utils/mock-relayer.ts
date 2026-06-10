import { Contract, parseEther, Wallet } from 'ethers';

import { poolAbi } from '../../src/data/abis/pool.abi';
import { IRelayerClient, IRelayerStatusResponse, ITornadoWithdrawRequest, ITornadoWithdrawResponse } from '../../src/relayer/interfaces/relayer-client.interface';

export interface MockRelayerOptions {
  chainId: 1 | 11155111;
  fees?: {
    cheap: number;
    expensive: number;
  };
  signer?: Wallet;
}

const relayersHostnames = new Set<keyof Exclude<MockRelayerOptions['fees'], undefined>>(['cheap', 'expensive']);

export const createMockRelayerClient = (options?: MockRelayerOptions) => {
  const {
    chainId,
    fees = {
      cheap: 0.03,
      expensive: 0.04
    },
    signer,
  } = options || {};

  if (!chainId) {
    throw new Error('Provide a chainId');
  }

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
        ethPrices: {
          DAI: parseEther('0.000468371').toString(),
        },
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
