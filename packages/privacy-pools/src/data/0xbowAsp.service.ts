import { Network } from "@kohaku-eth/plugins";
import { getNumber } from "ethers";
import { computeMerkleTreeRoot } from "../utils/proof.util.js";
import { IAspService, IAspServiceParams } from "./asp.interface.js";
import { RootState } from "../state/store.js";

export type MtLeavesResponse = {
  aspLeaves: string[];
  stateTreeLeaves: string[];
};


function isMtLeaves(x: unknown): x is MtLeavesResponse {
  const _x = x as MtLeavesResponse;

  if ((_x.aspLeaves !== undefined) && (_x.stateTreeLeaves !== undefined)) {
    if (
      (_x.aspLeaves.every(leaf => leaf.toUpperCase !== undefined)) &&
      (_x.stateTreeLeaves.every(leaf => leaf.toUpperCase !== undefined))
    ) {
      return true;
    }
    else { return false; }
  }

  return false;
}


export type OxBowAspGetTreeParams = {
  chainId: bigint;
  scope: bigint;
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

  private async getMtLeaves({ chainId, scope }: { chainId: bigint, scope: bigint; }) {

    const route = `${getNumber(chainId)}/public/mt-leaves`;

    const headers: Record<string, string> = {
      "X-Pool-Scope": scope.toString(10),
    } as const;

    const raw = await (
      this.fetch(this.buildUrl(route), {
        method: "GET",
        headers,
      })
        .then(x => x.json())
        .catch(e => {
          console.error(e);
          throw new Error(`Can't obtain Association Set from ${this.aspUrl}`);
        })
    );

    if (isMtLeaves(raw)) {
      return raw.aspLeaves.map(BigInt);
    } else {
      throw new Error(`Unexpected response \`${raw}\` from ${this.aspUrl} for ${route}`);
    }

  }

  private buildUrl(route: string) {
    return `${this.aspUrl}/${route}`;
  }

  async getAspTreeOxBow({ chainId, scope }: OxBowAspGetTreeParams): Promise<bigint[][]> {
    const leaves = await this.getMtLeaves({ chainId, scope });
    const root = computeMerkleTreeRoot(leaves);

    return [
      leaves,
      [root]
    ];
  }

  async getAspTree(state: RootState): Promise<bigint[][]> {
    const chainId = state.entrypointInfo.chainId;
    const somePool = state.pools.poolsTuples[0];

    if (!somePool) {
      throw new Error("Not a single pool found. Protocol is inactive.");
    }

    const [, { scope }] = somePool;

    return this.getAspTreeOxBow({ chainId: BigInt(chainId), scope: BigInt(scope) });
  }

}
