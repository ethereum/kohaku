import { TxData } from "../tx";
import { TxSigner } from "../provider";
import { Wallet } from "ethers";

/**
 * Ethers v6 signer adapter
 */
export class EthersSignerAdapter implements TxSigner {
    constructor(private signer: Wallet) { }
  
    async signMessage(message: string | Uint8Array): Promise<string> {
      return await this.signer.signMessage(message);
    }
  
    async sendTransaction(tx: TxData): Promise<string> {
      const txResponse = await this.signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ?? 0n,
        // gasLimit: tx.gasLimit ?? tx.gas ?? 6000000, // Ethers uses 'gasLimit', fallback to gas then default
      });
  
      return txResponse.hash;
    }
  
    async getAddress(): Promise<string> {
      return await this.signer.getAddress();
    }
  }
  