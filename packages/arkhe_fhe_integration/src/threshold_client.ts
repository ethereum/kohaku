import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';
import { hardhat } from '@cofhe/sdk/chains';
import { Account } from 'viem';
import { CofheClient } from '@cofhe/sdk';
import { createPublicClient, createWalletClient, http, parseAbi, PublicClient, WalletClient } from 'viem';
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
  private publicClient: PublicClient;
  private walletClient: WalletClient;

  constructor(
    privateKey: `0x${string}`,
    bridgeContractAddress: `0x${string}`,
    chainConfig: any
  ) {
    const account = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({
      account, chain: chainConfig, transport: http(),
    }) as unknown as WalletClient;
    this.publicClient = createPublicClient({
      chain: chainConfig, transport: http(),
    }) as unknown as PublicClient;

        this.cofheClient = createCofheClient(createCofheConfig({ supportedChains: [hardhat] }));
    this.cofheClient.connect(this.publicClient as any, this.walletClient as any);
    this.bridgeContract = bridgeContractAddress;
  }

  /**
   * Solicita decriptação Threshold para um Circle Octra
   */
  async requestCircleDecrypt(circleId: string, fhenixHandle: bigint): Promise<`0x${string}`> {
        const tx = await this.walletClient.writeContract({
      address: this.bridgeContract,
      abi: THRESHOLD_BRIDGE_ABI,
      functionName: 'requestThresholdDecrypt',
      args: [circleId, fhenixHandle],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
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
            const unwatch = this.publicClient.watchContractEvent({
        address: this.bridgeContract,
        abi: THRESHOLD_BRIDGE_ABI,
        eventName: 'ThresholdDecryptVerified',
        args: { circleId, handle: fhenixHandle },
        onLogs: (logs: any[]) => {
          clearTimeout(timer);
          unwatch();
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
