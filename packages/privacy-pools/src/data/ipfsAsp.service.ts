import { Network } from "@kohaku-eth/plugins";
import { IAspService, IAspServiceParams } from "./asp.interface";
import { RootState } from "../state";
import { lastUpdateRootEventSelector } from "../state/selectors/slices.selectors";
import { MAX_ASP_LEAVES, parseAspLeaves, readAspJson } from "./asp.utils";

export type IPFSGetTreeParams = {
  ipfsCID: string;
  signal?: AbortSignal;
};

export interface IPFSAspServiceParams extends IAspServiceParams {
  ipfsUrl?: string;
}

export class IPFSAspService implements IAspService {
  private providerUrl = "https://ipfs.filebase.io/ipfs/";
  private fetch: Network["fetch"];

  constructor({ network: { fetch }, ipfsUrl }: IPFSAspServiceParams) {
    this.fetch = fetch;

    if (ipfsUrl) {
      this.providerUrl = ipfsUrl;
    }
  }

  async getAspTreeIPFS({ ipfsCID, signal }: IPFSGetTreeParams): Promise<bigint[][]> {
    const url = `${this.providerUrl}${ipfsCID}`;
    const response = await this.fetch(url, { signal });

    if (!response.ok) {
      await response.body?.cancel();

      throw new Error(
        `IPFS gateway returned ${response.status} for ${url}`,
      );
    }

    const tree = await readAspJson(response);

    if (
      !Array.isArray(tree) || tree.length > 33 ||
      tree.reduce((count, level) => count + (Array.isArray(level) ? level.length : Infinity), 0) > 2 * MAX_ASP_LEAVES + 33
    ) {
      throw new Error('ASP tree exceeds client limits or contains invalid levels');
    }

    return tree.map(parseAspLeaves);
  }

  async getAspTree(state: RootState, signal?: AbortSignal): Promise<bigint[][]> {
    const lastUpdateRootEvent = lastUpdateRootEventSelector(state);

    if (!lastUpdateRootEvent) {
      throw new Error("No update root events");
    }

    return this.getAspTreeIPFS({ ipfsCID: lastUpdateRootEvent.ipfsCID, signal });
  }

}
