import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

import deploymentsData from "../../../deployments/deployments.json";

export type Deployments = {
  [network: string]: {
    accounts?: {
      [mode: string]: {
        address: string;
      };
    };
  };
};

export const deployments = deploymentsData as Deployments;

export const chainToDeploymentKey: Record<number, string> = {
  [sepolia.id]: "sepolia",
};

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
  },
});
