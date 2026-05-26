import { createCofheClient } from '@cofhe/sdk';
import { ThresholdNetworkClient } from './threshold_client';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const FHERC20_ABI = [
  'function shieldFromOctra(string circleId, tuple(uint256 ctHash, bytes signature) encryptedAmount, uint64 publicAmount) returns (uint256)',
  'function confidentialCircleTransfer(string fromCircle, string toCircle, tuple(uint256 ctHash, bytes signature) encryptedAmount) returns (uint256)',
  'function unshieldToOctra(string circleId, uint64 plaintextAmount, bytes thresholdSignature)',
  'function circleIndicatorOf(string circleId) view returns (uint256)',
  'function confidentialCircleBalance(string circleId) view returns (uint256)',
  'event CircleBridged(string circleId, uint64 amount, uint256 fhenixHandle)',
  'event CircleUnshielded(string circleId, uint64 plaintext, bytes thresholdSignature)',
];

export class OctraFHERC20Client {
  private cofheClient: any;
  private tokenContract: `0x${string}`;
  private thresholdClient: ThresholdNetworkClient; // da Parte 1

  constructor(
    privateKey: `0x${string}`,
    tokenContract: `0x${string}`,
    thresholdClient: ThresholdNetworkClient,
    chainConfig: any
  ) {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: chainConfig, transport: http() });
    this.cofheClient = createCofheClient({ walletClient, provider: http() });
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
    const encryptedAmount = await this.cofheClient.encryptUint64(publicAmount);

    // 2. Chama shieldFromOctra
    const tx = await this.cofheClient.writeContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'shieldFromOctra',
      args: [circleId, encryptedAmount, publicAmount],
    });

    const receipt = await tx.wait();
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
    const encryptedAmount = await this.cofheClient.encryptUint64(amount);

    const tx = await this.cofheClient.writeContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'confidentialCircleTransfer',
      args: [fromCircle, toCircle, encryptedAmount],
    });

    const receipt = await tx.wait();
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
    const tx = await this.cofheClient.writeContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'unshieldToOctra',
      args: [circleId, decryptResult.plaintext, decryptResult.signature],
    });

    const receipt = await tx.wait();

    return {
      plaintext: decryptResult.plaintext,
      txHash: receipt.transactionHash,
    };
  }

  /**
   * Query indicador (público)
   */
  async getIndicator(circleId: string): Promise<bigint> {
    return await this.cofheClient.readContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'circleIndicatorOf',
      args: [circleId],
    });
  }

  /**
   * Query balanço cifrado (requer permissão ACL)
   */
  async getConfidentialBalance(circleId: string): Promise<bigint> {
    return await this.cofheClient.readContract({
      address: this.tokenContract,
      abi: FHERC20_ABI,
      functionName: 'confidentialCircleBalance',
      args: [circleId],
    });
  }

  private extractHandle(receipt: any, eventName: string): bigint {
    const event = receipt.logs.find((log: any) => log.eventName === eventName);
    return event?.args?.fhenixHandle || 0n;
  }
}
