import { Abi } from "viem";

export const aggregatorAbi = [
  {
    type: "function",
    name: "relayersData",
    inputs: [
      {
        name: "_relayers",
        type: "bytes32[]",
      },
      {
        name: "_subdomains",
        type: "string[]",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "owner", type: "address" },
          { name: "balance", type: "uint256" },
          { name: "isRegistered", type: "bool" },
          { name: "records", type: "string[20]" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;
