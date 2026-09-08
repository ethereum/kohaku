import { Abi } from "viem";

// Canonical Simple7702Account (EntryPoint v0.8) execution entrypoints, used to
// encode the userOp `callData` for a paymaster withdrawal's execution phase
// (tail calls). The ephemeral sender is 7702-delegated to this implementation.
export const SIMPLE_7702_EXECUTE_ABI = [
  {
    name: "execute",
    type: "function",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "executeBatch",
    type: "function",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;
