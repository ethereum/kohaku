import { Abi } from "viem";

export const instanceRegistryAbi = [
  {
    type: "function",
    name: "getAllInstanceAddresses",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPoolToken",
    inputs: [{
      type: "uint256",
      name: 'instance'
    }],
    outputs: [
      {
        name: "address",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getPoolToken",
    inputs: [{
      type: "uint256",
      name: 'instance'
    }],
    outputs: [
      {
        name: "address",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "instances",
    inputs: [{
      type: "address",
      name: "instance"
    }],
    outputs: [
      {
        name: "isERC20",
        type: "bool",
      },
      {
        name: "token",
        type: "address"
      },
      {
        name: "state",
        type: "uint8"
      },
      {
        name: "uniswapPoolSwappingFee",
        type: "uint24"
      },
      {
        name: "protocolFeePercentage",
        type: "uint32"
      }
    ],
    stateMutability: "view"
  },
] as const satisfies Abi;
