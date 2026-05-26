import { createCofheClient, CofheClient } from '@cofhe/sdk';
import { createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const THRESHOLD_BRIDGE_ABI = parseAbi([
  'function requestThresholdDecrypt(string circleId, uint256 fhenixHandle)',
  'function publishThresholdResult(string circleId, uint256 fhenixHandle, uint64 plaintext, bytes signature)',
  'event ThresholdDecryptRequested(string circleId, uint256 handle, address requester)',
  'event ThresholdDecryptVerified(string circleId, uint256 handle, uint64 plaintext, bytes signature)',
]);

export class ThresholdNetworkClient {
  private cofheClient: CofheClient;
  private bridgeContract: `0x${string}`;

  constructor(
    privateKey: `0x${string}`,
    bridgeContractAddress: `0x${string}`,
    chainConfig: any
  ) {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account, chain: chainConfig, transport: http(),
    });
    this.cofheClient = createCofheClient({ walletClient, provider: http() });
    this.bridgeContract = bridgeContractAddress;
  }

  /**
   * Solicita decriptação Threshold para um Circle Octra
   */
  async requestCircleDecrypt(circleId: string, fhenixHandle: bigint): Promise<`0x${string}`> {
    const tx = await this.cofheClient.writeContract({
      address: this.bridgeContract,
      abi: THRESHOLD_BRIDGE_ABI,
      functionName: 'requestThresholdDecrypt',
      args: [circleId, fhenixHandle],
    });

    const receipt = await tx.wait();
    return receipt.transactionHash;
  }

  /**
   * Aguarda e captura evento ThresholdDecryptVerified
   * O Result Processor publica este evento após MPC completion
   */
  async waitForThresholdResult(
    circleId: string,
    fhenixHandle: bigint,
    timeoutMs: number = 30000
  ): Promise<{ plaintext: bigint; signature: `0x${string}` }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Threshold decrypt timeout'));
      }, timeoutMs);

      // Monitora eventos do contrato bridge
      this.cofheClient.watchContractEvent({
        address: this.bridgeContract,
        abi: THRESHOLD_BRIDGE_ABI,
        eventName: 'ThresholdDecryptVerified',
        args: { circleId, fhenixHandle },
        onLogs: (logs: any[]) => {
          clearTimeout(timer);
          const log = logs[0];
          resolve({
            plaintext: log.args.plaintext,
            signature: log.args.signature,
          });
        },
      });
    });
  }

  /**
   * Fluxo completo: request → wait → receive
   */
  async fullThresholdDecrypt(
    circleId: string,
    fhenixHandle: bigint
  ): Promise<{ plaintext: bigint; signature: `0x${string}`; txHash: `0x${string}` }> {
    // 1. Solicita decriptação
    const requestTx = await this.requestCircleDecrypt(circleId, fhenixHandle);
    console.log(`[THRESHOLD] Request sent: ${requestTx}`);

    // 2. Aguarda resultado MPC (Coordinator → Parties → Combine)
    const result = await this.waitForThresholdResult(circleId, fhenixHandle);
    console.log(`[THRESHOLD] Decrypted: ${result.plaintext}`);

    return {
      plaintext: result.plaintext,
      signature: result.signature,
      txHash: requestTx,
    };
  }
}
