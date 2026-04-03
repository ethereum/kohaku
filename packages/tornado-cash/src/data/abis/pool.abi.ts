import { Abi } from "viem";

export const poolAbi = [
  {
    type: "function",
    name: "getLastRoot",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "currentRootIndex",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "roots",
    inputs: [{
      type: "uint256",
    }],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "denomination",
    inputs: [],
    outputs: [
      {
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
] as const satisfies Abi;

