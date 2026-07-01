import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';
import { hardhat } from '@cofhe/sdk/chains';
import { Account } from 'viem';
import { CofheClient } from '@cofhe/sdk';
import { ThresholdNetworkClient } from './threshold_client';
import { parseEventLogs, createPublicClient, createWalletClient, http, parseAbi, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const FHERC20_ABI = parseAbi([
  'function shieldFromOctra(string circleId, tuple(uint256 ctHash, bytes signature) encryptedAmount, uint64 publicAmount) returns (uint256)',
  'function confidentialCircleTransfer(string fromCircle, string toCircle, tuple(uint256 ctHash, bytes signature) encryptedAmount) returns (uint256)',
  'function unshieldToOctra(string circleId, uint64 plaintextAmount, bytes thresholdSignature)',
  'function circleIndicatorOf(string circleId) view returns (uint256)',
  'function confidentialCircleBalance(string circleId) view returns (uint256)',
  'event CircleBridged(string circleId, uint64 amount, uint256 fhenixHandle)',
  'event CircleUnshielded(string circleId, uint64 plaintext, bytes thresholdSignature)',
]);

export class OctraFHERC20Client {
  private cofheClient: CofheClient;
  private tokenContract: `0x${string}`;
  private thresholdClient: ThresholdNetworkClient;
  private publicClient: PublicClient;
  private walletClient: WalletClient;

  constructor(
    privateKey: `0x${string}`,
    tokenContract: `0x${string}`,
    thresholdClient: ThresholdNetworkClient,
    chainConfig: any
  ) {
    const account = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({ account, chain: chainConfig, transport: http() }) as unknown as WalletClient;
    this.publicClient = createPublicClient({ chain: chainConfig, transport: http() }) as unknown as PublicClient;

        this.cofheClient = createCofheClient(createCofheConfig({ supportedChains: [hardhat] }));
    this.cofheClient.connect(this.publicClient as any, this.walletClient as any);

    this.tokenContract = tokenContract;
    this.thresholdClient = thresholdClient;
  }

  /**
   * Shield: converte tokens públicos em FHERC20 cifrados
   */
  async shield(
    circleId: string,
    publicAmount: bigint
  ): Promise<{ handle: bigint; txHash: `0x${string}` }> {
    // 1. Criptografa amount off-chain
        const encryptedAmount = await this.cofheClient.encryptInputs([{ utype: 5, securityZone: 0, data: publicAmount }]).execute();

    // 2. Chama shieldFromOctra
        const tx = await this.walletClient.writeContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'shieldFromOctra',
      args: [circleId, encryptedAmount[0], publicAmount],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    const handle = this.extractHandle(receipt, 'CircleBridged');

    return { handle, txHash: receipt.transactionHash };
  }

  /**
   * Transferência confidencial entre Circles
   */
  async confidentialTransfer(
    fromCircle: string,
    toCircle: string,
    amount: bigint
  ): Promise<`0x${string}`> {
        const encryptedAmount = await this.cofheClient.encryptInputs([{ utype: 5, securityZone: 0, data: amount }]).execute();

        const tx = await this.walletClient.writeContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'confidentialCircleTransfer',
      args: [fromCircle, toCircle, encryptedAmount[0]],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }

  /**
   * Unshield completo: decripta via Threshold + publica on-chain
   */
  async unshield(circleId: string, fhenixHandle: bigint): Promise<{
    plaintext: bigint;
    txHash: `0x${string}`;
  }> {
    // 1. Solicita decriptação Threshold
    const decryptResult = await this.thresholdClient.fullThresholdDecrypt(circleId, fhenixHandle);

    // 2. Chama unshieldToOctra com resultado verificado
        const tx = await this.walletClient.writeContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'unshieldToOctra',
      args: [circleId, decryptResult.plaintext, decryptResult.signature],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });

    return {
      plaintext: decryptResult.plaintext,
      txHash: receipt.transactionHash,
    };
  }

  /**
   * Query indicador (público)
   */
  async getIndicator(circleId: string): Promise<bigint> {
        return await this.publicClient.readContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'circleIndicatorOf',
      args: [circleId],
    }) as bigint;
  }

  /**
   * Query balanço cifrado (requer permissão ACL)
   */
  async getConfidentialBalance(circleId: string): Promise<bigint> {
        return await this.publicClient.readContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'confidentialCircleBalance',
      args: [circleId],
    }) as bigint;
  }

  private extractHandle(receipt: any, eventName: string): bigint {
    const parsedLogs = parseEventLogs({
      abi: FHERC20_ABI,
      eventName: eventName,
      logs: receipt.logs,
    });
    const event = parsedLogs[0];
    return (event as any)?.args?.fhenixHandle || 0n;
  }
}
