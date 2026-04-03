import { encodeAbiParameters, getAddress } from 'viem';

import {
  IQuoteRequest,
  IQuoteResponse,
  IRelayerClient,
  IRelayerFeeResponse,
  IRelayFeesRequest,
  IRelayRequest,
  ISuccessfullRelayResponse,
} from '../../src/relayer/interfaces/relayer-client.interface';

export interface MockRelayerOptions {
  feeBPS?: string;
  baseFeeBPS?: string;
  gasPrice?: string;
  shouldFail?: boolean;
}

export const createMockRelayerClient = (options: MockRelayerOptions = {}): IRelayerClient => {
  const {
    feeBPS = '100',        // 1%
    baseFeeBPS = '50',     // 0.5%
    gasPrice = '1000000000', // 1 gwei
    shouldFail = false,
  } = options;

  const feeRecipient = getAddress("0x976EA74026E726554dB657fA54763abd0C3a0aa9"); // junk[6]
  const RelayDataAbi = [
    {
      name: "RelayData",
      type: "tuple",
      components: [
        { name: "recipient", type: "address" },
        { name: "feeRecipient", type: "address" },
        { name: "relayFeeBPS", type: "uint256" },
      ],
    },
  ] as const;

  return {

    async getQuote(body: IQuoteRequest): Promise<IQuoteResponse> {
      if (shouldFail) {
        throw new Error('Mock relayer failed');
      }

      const RelayData = {
        recipient: getAddress("0x" + BigInt(body.recipient).toString(16)),
        feeRecipient,
        relayFeeBPS: BigInt(feeBPS)
      };
      const withdrawalData = encodeAbiParameters(RelayDataAbi, [RelayData]);

      return {
        baseFeeBPS,
        feeBPS,
        gasPrice,
        feeCommitment: {
          expiration: Date.now() + 3600000, // 1 hour from now
          withdrawalData,
          signedRelayerCommitment: '0xmocksignature',
          extraGas: body.extraGas,
        },
        detail: {
          relayTxCost: { gas: '100000', eth: '100000000000000' },
        },
      };
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async relay(body: IRelayRequest): Promise<ISuccessfullRelayResponse> {
      if (shouldFail) {
        throw new Error('Mock relay failed');
      }

      return {
        success: true,
        timestamp: Date.now(),
        requestId: 'mock-request-id',
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };
    },

    async getFees(body: IRelayFeesRequest): Promise<IRelayerFeeResponse> {
      return {
        feeBPS,
        feeReceiverAddress: '0x0000000000000000000000000000000000000001',
        chainId: Number(body.chainId),
        assetAddress: String(body.assetAddress),
        minWithdrawAmount: '1000000000000000', // 0.001 ETH
        maxGasPrice: '100000000000', // 100 gwei
      };
    },
  };
};
