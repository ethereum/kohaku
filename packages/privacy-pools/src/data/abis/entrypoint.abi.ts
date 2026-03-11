import { Abi } from "viem";

export const entrypointDepositErc20Abi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "_asset",
        type: "address",
        internalType: "contract IERC20",
      },
      {
        name: "_value",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "_precommitment",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "_commitment",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

export const entrypointDepositNativeAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "_precommitment",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "_commitment",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "payable",
  },
] as const satisfies Abi;

export const entrypointAbi = [
  {
    type: "function",
    name: "relay",
    inputs: [
      {
        name: "_withdrawal",
        type: "tuple",
        internalType: "struct IPrivacyPool.Withdrawal",
        components: [
          {
            name: "processooor",
            type: "address",
            internalType: "address",
          },
          {
            name: "data",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
      {
        name: "_proof",
        type: "tuple",
        internalType: "struct ProofLib.WithdrawProof",
        components: [
          {
            name: "pA",
            type: "uint256[2]",
            internalType: "uint256[2]",
          },
          {
            name: "pB",
            type: "uint256[2][2]",
            internalType: "uint256[2][2]",
          },
          {
            name: "pC",
            type: "uint256[2]",
            internalType: "uint256[2]",
          },
          {
            name: "pubSignals",
            type: "uint256[8]",
            internalType: "uint256[8]",
          },
        ],
      },
      {
        name: "_scope",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "assetConfig",
    inputs: [
      {
        name: "_asset",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    outputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract IPrivacyPool",
      },
      {
        name: "minimumDepositAmount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "vettingFeeBPS",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maxRelayFeeBPS",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const relayDataAbi = {
  name: "RelayData",
  type: "tuple",
  internalType: "struct IEntrypoint.RelayData",
  components: [
    {
      name: "recipient",
      type: "address",
      internalType: "address"
    },
    {
      name: "feeRecipient",
      type: "address",
      internalType: "address"
    },
    {
      name: "relayFeeBps",
      type: "uint256",
      internalType: "uint256"
    },
  ]
} as const;
