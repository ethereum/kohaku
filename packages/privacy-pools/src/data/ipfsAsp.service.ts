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
  private providerUrl = "https://ipfs.io/ipfs/";
  private fetch: Network["fetch"];

  constructor({ network: { fetch }, ipfsUrl }: IPFSAspServiceParams) {
    this.fetch = fetch;

    if (ipfsUrl) {
      this.providerUrl = ipfsUrl;
    }
  }

  async getAspTreeIPFS({ ipfsCID }: IPFSGetTreeParams): Promise<bigint[][]> {
    const response = await this.fetch(`${this.providerUrl}${ipfsCID}`);
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
