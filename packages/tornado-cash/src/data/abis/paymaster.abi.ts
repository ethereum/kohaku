import type { Abi } from 'viem';

export const paymasterAbi = [
  {
    type: 'function',
    name: 'quoteWeiInToken',
    stateMutability: 'view',
    inputs: [
      { name: 'feeToken', type: 'address' },
      { name: 'weiAmount', type: 'uint256' },
    ],
    outputs: [{ name: 'tokenAmount', type: 'uint256' }],
  },
] as const satisfies Abi;
