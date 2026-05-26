import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';
import { hardhat } from '@cofhe/sdk/chains';
import { Account } from 'viem';
import { CofheClient } from '@cofhe/sdk';
import { createPublicClient, createWalletClient, http, parseAbi, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ACL_ABI = parseAbi([
  'function setCirclePermissionLevel(string circleId, uint8 level)',
  'function addCircleDelegate(string circleId, address delegate)',
  'function removeCircleDelegate(string circleId, address delegate)',
  'function applyCircleACL(string circleId, uint256 fhenixHandle)',
  'function verifyAccess(uint256 handle, address account, string circleId) view returns (bool)',
  'function emergencyRevokeCircle(string circleId)',
  'event CirclePermissionSet(string circleId, uint8 level, address setter)',
]);

export enum CirclePermissionLevel {
  NONE = 0,      // Nenhum acesso
  THIS = 1,      // Apenas contrato
  DELEGATED = 2, // Endereços delegados
  DECRYPT = 3,   // Threshold Network
  PUBLIC = 4,    // Público
}

export class OctraACLManager {
  private cofheClient: CofheClient;
  private aclContract: `0x${string}`;
  private publicClient: PublicClient;
  private walletClient: WalletClient;

  constructor(privateKey: `0x${string}`, aclContract: `0x${string}`, chainConfig: any) {
    const account = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({ account, chain: chainConfig, transport: http() }) as unknown as WalletClient;
    this.publicClient = createPublicClient({ chain: chainConfig, transport: http() }) as unknown as PublicClient;

        this.cofheClient = createCofheClient(createCofheConfig({ supportedChains: [hardhat] }));
    this.cofheClient.connect(this.publicClient as any, this.walletClient as any);
    this.aclContract = aclContract;
  }

  /**
   * Configura nível de permissão para um Circle
   */
  async setCirclePermission(
    circleId: string,
    level: CirclePermissionLevel
  ): Promise<`0x${string}`> {
        const tx = await this.walletClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'setCirclePermissionLevel',
      args: [circleId, level],
      account: this.walletClient.account as Account,
      chain: null,
    });
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }

  /**
   * Adiciona delegado ao Circle
   */
  async addDelegate(circleId: string, delegate: `0x${string}`): Promise<`0x${string}`> {
        const tx = await this.walletClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'addCircleDelegate',
      args: [circleId, delegate],
      account: this.walletClient.account as Account,
      chain: null,
    });
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }

  /**
   * Aplica ACL a um handle Fhenix
   */
  async applyACL(circleId: string, fhenixHandle: bigint): Promise<`0x${string}`> {
        const tx = await this.walletClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'applyCircleACL',
      args: [circleId, fhenixHandle],
      account: this.walletClient.account as Account,
      chain: null,
    });
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }

  /**
   * Verifica acesso (view function)
   */
  async verifyAccess(
    handle: bigint,
    account: `0x${string}`,
    circleId: string
  ): Promise<boolean> {
        return await this.publicClient.readContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'verifyAccess',
      args: [handle, account, circleId],
    }) as boolean;
  }

  /**
   * Revogação de emergência
   */
  async emergencyRevoke(circleId: string): Promise<`0x${string}`> {
        const tx = await this.walletClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'emergencyRevokeCircle',
      args: [circleId],
      account: this.walletClient.account as Account,
      chain: null,
    });
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }
}
