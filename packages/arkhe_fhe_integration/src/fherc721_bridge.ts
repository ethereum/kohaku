import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';
import { hardhat } from '@cofhe/sdk/chains';
import { Account } from 'viem';
import { CofheClient } from '@cofhe/sdk';
import { ThresholdNetworkClient } from './threshold_client';
import { parseEventLogs, createPublicClient, createWalletClient, http, parseAbi, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const FHERC721_ABI = parseAbi([
  'function shieldFromOctra(string circleId, uint256 tokenId, tuple(uint256 ctHash, bytes signature) encryptedMetadata)',
  'function unshieldToOctra(string circleId, uint256 tokenId, uint64 plaintextMetadata, bytes thresholdSignature)',
  'event TokenBridged(string circleId, uint256 tokenId, uint256 metadataHandle)',
  'event TokenUnshielded(string circleId, uint256 tokenId, bytes thresholdSignature)',
]);

export class OctraFHERC721Client {
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

  async shield(
    circleId: string,
    tokenId: bigint,
    publicMetadata: bigint
  ): Promise<{ handle: bigint; txHash: `0x${string}` }> {
        const encryptedMetadata = await this.cofheClient.encryptInputs([{ utype: 5, securityZone: 0, data: publicMetadata }]).execute();

        const tx = await this.walletClient.writeContract({
      address: this.tokenContract,
      abi: FHERC721_ABI,
      functionName: 'shieldFromOctra',
      args: [circleId, tokenId, encryptedMetadata[0]],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    const parsedLogs = parseEventLogs({
      abi: FHERC721_ABI,
      eventName: 'TokenBridged',
      logs: receipt.logs,
    });
    const event: any = parsedLogs[0];
    const handle = event?.args?.metadataHandle || 0n;

    return { handle, txHash: receipt.transactionHash };
  }

  async unshield(
    circleId: string,
    tokenId: bigint,
    metadataHandle: bigint
  ): Promise<{ plaintext: bigint; txHash: `0x${string}` }> {
    const decryptResult = await this.thresholdClient.fullThresholdDecrypt(circleId, metadataHandle);

        const tx = await this.walletClient.writeContract({
      address: this.tokenContract,
      abi: FHERC721_ABI,
      functionName: 'unshieldToOctra',
      args: [circleId, tokenId, decryptResult.plaintext, decryptResult.signature],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });

    return {
      plaintext: decryptResult.plaintext,
      txHash: receipt.transactionHash,
    };
  }
}
