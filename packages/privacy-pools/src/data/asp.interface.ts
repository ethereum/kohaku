import { Network } from "@kohaku-eth/plugins";

import { RootState } from "../state";

// TODO: This is a very basic limiting, non-exhaustive ASP interface; we can refactor later
export interface IAspService {
  getAspTree(state: RootState): Promise<bigint[][]>;
}

export interface IAspServiceParams {
  network: Network;
}
