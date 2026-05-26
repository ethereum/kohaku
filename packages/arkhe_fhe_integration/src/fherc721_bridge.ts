import { createCofheClient } from '@cofhe/sdk';
import { ThresholdNetworkClient } from './threshold_client';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const FHERC721_ABI = [
  'function shieldFromOctra(string circleId, uint256 tokenId, tuple(uint256 ctHash, bytes signature) encryptedMetadata)',
  'function unshieldToOctra(string circleId, uint256 tokenId, uint64 plaintextMetadata, bytes thresholdSignature)',
  'event TokenBridged(string circleId, uint256 tokenId, uint256 metadataHandle)',
  'event TokenUnshielded(string circleId, uint256 tokenId, bytes thresholdSignature)',
];

export class OctraFHERC721Client {
  private cofheClient: any;
  private tokenContract: `0x${string}`;
  private thresholdClient: ThresholdNetworkClient;

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

  async shield(
    circleId: string,
    tokenId: bigint,
    publicMetadata: bigint
  ): Promise<{ handle: bigint; txHash: `0x${string}` }> {
    const encryptedMetadata = await this.cofheClient.encryptUint64(publicMetadata);

    const tx = await this.cofheClient.writeContract({
      address: this.tokenContract,
      abi: FHERC721_ABI,
      functionName: 'shieldFromOctra',
      args: [circleId, tokenId, encryptedMetadata],
    });

    const receipt = await tx.wait();
    const event = receipt.logs.find((log: any) => log.eventName === 'TokenBridged');
    const handle = event?.args?.metadataHandle || 0n;

    return { handle, txHash: receipt.transactionHash };
  }

  async unshield(
    circleId: string,
    tokenId: bigint,
    metadataHandle: bigint
  ): Promise<{ plaintext: bigint; txHash: `0x${string}` }> {
    const decryptResult = await this.thresholdClient.fullThresholdDecrypt(circleId, metadataHandle);

    const tx = await this.cofheClient.writeContract({
      address: this.tokenContract,
      abi: FHERC721_ABI,
      functionName: 'unshieldToOctra',
      args: [circleId, tokenId, decryptResult.plaintext, decryptResult.signature],
    });

    const receipt = await tx.wait();

    return {
      plaintext: decryptResult.plaintext,
      txHash: receipt.transactionHash,
    };
  }
}
