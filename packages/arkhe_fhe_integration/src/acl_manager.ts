import { createCofheClient } from '@cofhe/sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ACL_ABI = [
  'function setCirclePermissionLevel(string circleId, uint8 level)',
  'function addCircleDelegate(string circleId, address delegate)',
  'function removeCircleDelegate(string circleId, address delegate)',
  'function applyCircleACL(string circleId, uint256 fhenixHandle)',
  'function verifyAccess(uint256 handle, address account, string circleId) view returns (bool)',
  'function emergencyRevokeCircle(string circleId)',
  'event CirclePermissionSet(string circleId, uint8 level, address setter)',
];

export enum CirclePermissionLevel {
  NONE = 0,      // Nenhum acesso
  THIS = 1,      // Apenas contrato
  DELEGATED = 2, // Endereços delegados
  DECRYPT = 3,   // Threshold Network
  PUBLIC = 4,    // Público
}

export class OctraACLManager {
  private cofheClient: any;
  private aclContract: `0x${string}`;

  constructor(privateKey: `0x${string}`, aclContract: `0x${string}`, chainConfig: any) {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: chainConfig, transport: http() });
    this.cofheClient = createCofheClient({ walletClient, provider: http() });
    this.aclContract = aclContract;
  }

  /**
   * Configura nível de permissão para um Circle
   */
  async setCirclePermission(
    circleId: string,
    level: CirclePermissionLevel
  ): Promise<`0x${string}`> {
    const tx = await this.cofheClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'setCirclePermissionLevel',
      args: [circleId, level],
    });
    const receipt = await tx.wait();
    return receipt.transactionHash;
  }

  /**
   * Adiciona delegado ao Circle
   */
  async addDelegate(circleId: string, delegate: `0x${string}`): Promise<`0x${string}`> {
    const tx = await this.cofheClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'addCircleDelegate',
      args: [circleId, delegate],
    });
    const receipt = await tx.wait();
    return receipt.transactionHash;
  }

  /**
   * Aplica ACL a um handle Fhenix
   */
  async applyACL(circleId: string, fhenixHandle: bigint): Promise<`0x${string}`> {
    const tx = await this.cofheClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'applyCircleACL',
      args: [circleId, fhenixHandle],
    });
    const receipt = await tx.wait();
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
    return await this.cofheClient.readContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'verifyAccess',
      args: [handle, account, circleId],
    });
  }

  /**
   * Revogação de emergência
   */
  async emergencyRevoke(circleId: string): Promise<`0x${string}`> {
    const tx = await this.cofheClient.writeContract({
      address: this.aclContract,
      abi: ACL_ABI,
      functionName: 'emergencyRevokeCircle',
      args: [circleId],
    });
    const receipt = await tx.wait();
    return receipt.transactionHash;
  }
}
