import { Network } from "@kohaku-eth/plugins";
import { getNumber } from "ethers";
import { computeMerkleTreeRoot } from "../utils/proof.util.js";
import { IAspService, IAspServiceParams } from "./asp.interface.js";
import { RootState } from "../state/store.js";
import { parseAspLeaves, readAspJson } from "./asp.utils.js";

export type MtLeavesResponse = {
  aspLeaves: string[];
  stateTreeLeaves: string[];
};


function isMtLeaves(x: unknown): x is MtLeavesResponse {
  const value = x as Partial<MtLeavesResponse> | null;

  return Array.isArray(value?.aspLeaves) && Array.isArray(value?.stateTreeLeaves);
}


export type OxBowAspGetTreeParams = {
  chainId: bigint;
  scope: bigint;
  signal?: AbortSignal;
};

export interface OxBowAspServiceParams extends IAspServiceParams {
  aspUrl?: string;
}

export class OxBowAspService implements IAspService {
  private aspUrl = "https://api.0xbow.io";
  private fetch: Network["fetch"];

  constructor({ network: { fetch }, aspUrl }: OxBowAspServiceParams) {
    this.fetch = fetch;

    if (aspUrl) {
      this.aspUrl = aspUrl;
    }
  }

  private async getMtLeaves({ chainId, scope, signal }: OxBowAspGetTreeParams) {

    const route = `${getNumber(chainId)}/public/mt-leaves`;

    const headers: Record<string, string> = {
      "X-Pool-Scope": scope.toString(10),
    } as const;

    const raw = await (
      this.fetch(this.buildUrl(route), {
        method: "GET",
        headers,
        signal,
      })
        .then(readAspJson)
        .catch(e => {
          console.error(e);
          throw new Error(`Can't obtain Association Set from ${this.aspUrl}`);
        })
    );

    if (isMtLeaves(raw)) {
      return parseAspLeaves(raw.aspLeaves);
    } else {
      throw new Error(`Unexpected response from ${this.aspUrl} for ${route}`);
    }

  }

  private buildUrl(route: string) {
    return `${this.aspUrl}/${route}`;
  }

  async getAspTreeOxBow({ chainId, scope, signal }: OxBowAspGetTreeParams): Promise<bigint[][]> {
    const leaves = await this.getMtLeaves({ chainId, scope, signal });
    const root = await computeMerkleTreeRoot(leaves);

    return [
      leaves,
      [root]
    ];
  }

  async getAspTree(state: RootState, signal?: AbortSignal): Promise<bigint[][]> {
    const chainId = state.entrypointInfo.chainId;
    const somePool = state.pools.poolsTuples[0];

    if (!somePool) {
      throw new Error("Not a single pool found. Protocol is inactive.");
    }

    const [, { scope }] = somePool;

    // The sync thunk validates these leaves with the configured Merkle builder.
    // Avoid an extra default/local build before an offscreen builder can run.
    return [await this.getMtLeaves({ chainId: BigInt(chainId), scope: BigInt(scope), signal })];
  }

}
