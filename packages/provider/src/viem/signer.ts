import type { TxSigner } from '../provider';
import type { TxData } from '../tx';
import type { ViemWalletClient } from './types';

export class ViemSignerAdapter implements TxSigner {
  constructor(private readonly wallet: ViemWalletClient) {}

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.wallet.signMessage({
      message: typeof message === 'string' ? message : { raw: message },
    });
  }

  async sendTransaction(tx: TxData): Promise<string> {
    return this.wallet.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: tx.value ?? 0n,
      // gas: tx.gas ?? tx.gasLimit,
    });
  }

  async getAddress(): Promise<string> {
    if (!this.wallet.account) {
      throw new Error('Wallet client does not have an account');
    }

    return this.wallet.account.address;
  }
}
