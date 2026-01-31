import { createConfig, http } from "wagmi";
import { arbitrumSepolia, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

import deploymentsData from "../../../deployments/deployments.json";
import type { Deployments } from "../types";

export const deployments = deploymentsData as Deployments;

export const chainToDeploymentKey: Record<number, string> = {
  [sepolia.id]: "sepolia",
  [arbitrumSepolia.id]: "arbitrumSepolia",
};

export const wagmiConfig = createConfig({
  chains: [sepolia, arbitrumSepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
});

export function getFactoryAddress(chainId: number | undefined): string {
  if (!chainId) return "—";

  const networkKey = chainToDeploymentKey[chainId];

  if (!networkKey) return "Not deployed on this network";

  const accountMode = "mldsa_k1";

  return (
    deployments[networkKey]?.accounts?.[accountMode]?.address ??
    "Not deployed on this network"
  );
}
