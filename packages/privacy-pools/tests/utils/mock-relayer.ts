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
  /**
   * Fixed relayer gas cost, in the pool asset's base units. When set, the quoted
   * rate becomes amount-dependent (`baseFeeBPS + gasFee/amount`, rounded up to whole
   * bps), modelling a real gas-adjusted relayer whose gas cost is constant across
   * withdrawal sizes. When omitted, the flat `feeBPS` is used.
   */
  gasFee?: string;
  gasPrice?: string;
  shouldFail?: boolean;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export const createMockRelayerClient = (options: MockRelayerOptions = {}): IRelayerClient => {
  const {
    feeBPS = '100',        // 1%
    baseFeeBPS = '50',     // 0.5%
    gasFee,
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

      // A gas-adjusted relayer folds a fixed gas cost into the rate, so the quoted bps
      // depends on the withdrawal amount. Without `gasFee`, fall back to a flat rate.
      const effectiveFeeBPS = gasFee !== undefined && body.amount > 0n
        ? String(BigInt(baseFeeBPS) + ceilDiv(BigInt(gasFee) * 10000n, body.amount))
        : feeBPS;

      const RelayData = {
        recipient: getAddress("0x" + BigInt(body.recipient).toString(16)),
        feeRecipient,
        relayFeeBPS: BigInt(effectiveFeeBPS)
      };
      const withdrawalData = encodeAbiParameters(RelayDataAbi, [RelayData]);

      return {
        baseFeeBPS,
        feeBPS: effectiveFeeBPS,
        gasPrice,
        feeCommitment: {
          expiration: Date.now() + 3600000, // 1 hour from now
          withdrawalData,
          signedRelayerCommitment: '0xmocksignature',
          extraGas: body.extraGas,
        },
        detail: {
          relayTxCost: { gas: '100000', eth: gasFee ?? '100000000000000' },
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
