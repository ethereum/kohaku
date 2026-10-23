import { Network } from "@kohaku-eth/plugins";
import { IAspService, IAspServiceParams } from "./asp.interface";
import { RootState } from "../state";
import { lastUpdateRootEventSelector } from "../state/selectors/slices.selectors";

export type IPFSGetTreeParams = {
  ipfsCID: string;
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

  async getAspTreeIPFS({ ipfsCID }: IPFSGetTreeParams): Promise<bigint[][]> {
    const url = `${this.providerUrl}${ipfsCID}`;
    const response = await this.fetch(url);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `IPFS gateway returned ${response.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }

    const tree: string[][] = await response.json();

    return tree.map((level) => level.map(BigInt));
  }

  async getAspTree(state: RootState): Promise<bigint[][]> {
    const lastUpdateRootEvent = lastUpdateRootEventSelector(state);

    if (!lastUpdateRootEvent) {
      throw new Error("No update root events");
    }

    return this.getAspTreeIPFS({ ipfsCID: lastUpdateRootEvent.ipfsCID });
  }

}
