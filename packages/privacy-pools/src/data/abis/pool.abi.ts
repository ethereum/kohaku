import { Abi } from "viem";

export const poolAbi = [
  {
    "type": "function",
    "name": "ASSET",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SCOPE",
    "inputs": [],
    "outputs": [
      {
        "name": "_scope",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    type: "function",
    name: "ragequit",
    inputs: [
      {
        name: "_proof",
        type: "tuple",
        internalType: "struct ProofLib.RagequitProof",
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
            type: "uint256[4]",
            internalType: "uint256[4]",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  }
] as const satisfies Abi;
