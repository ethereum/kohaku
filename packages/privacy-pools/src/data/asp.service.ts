import { Network } from "@kohaku-eth/plugins";

// TODO: This is a very basic limiting, non-exhaustive ASP interface; we can refactor later
export interface IAspService {
  getAspTree(ipfsCID: string): Promise<bigint[][]>;
}

export interface IAspServiceParams {
  network: Network;
  ipfsUrl?: string;
}

export class AspService implements IAspService {
  private providerUrl = "https://ipfs.io/ipfs/";
  private fetch: Network["fetch"];

  constructor({ network: { fetch }, ipfsUrl }: IAspServiceParams) {
    this.fetch = fetch;

    if (ipfsUrl) {
      this.providerUrl = ipfsUrl;
    }
  }

  async getAspTree(ipfsCID: string): Promise<bigint[][]> {
    const response = await this.fetch(`${this.providerUrl}${ipfsCID}`);
    const tree: string[][] = await response.json();

    return tree.map((level) => level.map(BigInt));
  }
}
