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
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "_commitment",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "_proof", type: "bytes", internalType: "bytes" },
      { name: "_root", type: "bytes32", internalType: "bytes32" },
      { name: "_nullifierHash", type: "bytes32", internalType: "bytes32" },
      { name: "_recipient", type: "address", internalType: "address" },
      { name: "_relayer", type: "address", internalType: "address" },
      { name: "_fee", type: "uint256", internalType: "uint256" },
      { name: "_refund", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "ROOT_HISTORY_SIZE",
    inputs: [],
    outputs: [{
      type: "uint32"
    }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "isKnownRoot",
    inputs: [{
      name: "_root",
      type: "bytes32"
    }],
    outputs: [{
      type: "bool"
    }],
    stateMutability: "view"
  }
] as const satisfies Abi;

