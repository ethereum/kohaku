import { createCofheClient, createCofheConfig } from '@cofhe/sdk/node';
import { hardhat } from '@cofhe/sdk/chains';
import { CofheClient } from '@cofhe/sdk';
import { ThresholdNetworkClient } from './threshold_client';
import { createPublicClient, createWalletClient, http, parseAbi, PublicClient, WalletClient, Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ONTOLOGY_REGISTRY_ABI = parseAbi([
  'function registerSubstrate(uint256 id, string name, uint64 phiCoherence, uint64 theosisIndex, string status, tuple(uint256 ctHash, bytes signature) encryptedSeal, tuple(uint256 ctHash, bytes signature) encryptedPhi)',
  'function verifyCrossLink(uint256 fromId, uint256 toId, bytes zkProof)',
  'function queryConfidentialPhi(uint256 substrateId, bytes aclPermit) view returns (uint256)',
  'function updateOntology(string ontologyName, string ipfsHash, bytes signature)',
  'function querySubstratesByStatus(string status) view returns (uint256[])',
  'event SubstrateRegistered(uint256 id, string name, string status)',
  'event CrossLinkVerified(uint256 fromId, uint256 toId, bool verified)',
]);

export class ArkheDKGClient {
  private cofheClient: CofheClient;
  private registryContract: `0x${string}`;
  private thresholdClient: ThresholdNetworkClient;
  private publicClient: PublicClient;
  private walletClient: WalletClient;

  constructor(
    privateKey: `0x${string}`,
    registryContract: `0x${string}`,
    thresholdClient: ThresholdNetworkClient,
    chainConfig: any
  ) {
    const account = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({ account, chain: chainConfig, transport: http() }) as unknown as WalletClient;
    this.publicClient = createPublicClient({ chain: chainConfig, transport: http() }) as unknown as PublicClient;

        this.cofheClient = createCofheClient(createCofheConfig({ supportedChains: [hardhat] }));
    this.cofheClient.connect(this.publicClient as any, this.walletClient as any);

    this.registryContract = registryContract;
    this.thresholdClient = thresholdClient;
  }

  /**
   * Registra substrato na ontologia com metadados FHE
   */
  async registerSubstrateOntology(
    id: number,
    name: string,
    phiCoherence: number,
    theosisIndex: number,
    status: string,
    sealPlaintext: bigint,
    phiPlaintext: bigint
  ): Promise<`0x${string}`> {
    // Criptografa selo e Phi
        const encryptedSeal = await this.cofheClient.encryptInputs([{ utype: 6, securityZone: 0, data: sealPlaintext }]).execute();
        const encryptedPhi = await this.cofheClient.encryptInputs([{ utype: 5, securityZone: 0, data: phiPlaintext }]).execute();

        const tx = await this.walletClient.writeContract({
      address: this.registryContract,
      abi: ONTOLOGY_REGISTRY_ABI,
      functionName: 'registerSubstrate',
      args: [
        BigInt(id), name,
        BigInt(Math.round(phiCoherence * 1_000_000)),
        BigInt(Math.round(theosisIndex * 1_000_000)),
        status,
        encryptedSeal[0],
        encryptedPhi[0],
      ],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }

  /**
   * Query confidencial: obtém Phi real via Threshold Network
   */
  async queryConfidentialPhi(substrateId: number): Promise<{
    handle: bigint;
    plaintext: bigint;
    signature: `0x${string}`;
  }> {
    // 1. Obtém handle FHE do Phi
        const phiHandle = await this.publicClient.readContract({
      address: this.registryContract,
      abi: ONTOLOGY_REGISTRY_ABI,
      functionName: 'queryConfidentialPhi',
      args: [BigInt(substrateId), '0x'], // ACL permit placeholder
    }) as bigint;

    // 2. Decripta via Threshold Network
    const circleId = `substrate-${substrateId}`;
    const result = await this.thresholdClient.fullThresholdDecrypt(circleId, phiHandle);

    return {
      handle: phiHandle,
      plaintext: result.plaintext,
      signature: result.signature,
    };
  }

  /**
   * Verifica cross-link on-chain
   */
  async verifyCrossLink(
    fromId: number,
    toId: number,
    zkProof: `0x${string}`
  ): Promise<`0x${string}`> {
        const tx = await this.walletClient.writeContract({
      address: this.registryContract,
      abi: ONTOLOGY_REGISTRY_ABI,
      functionName: 'verifyCrossLink',
      args: [BigInt(fromId), BigInt(toId), zkProof],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }

  /**
   * Atualiza ontologia OWL (governança apenas)
   */
  async updateOntology(
    ontologyName: string,
    ipfsHash: string,
    adminSignature: `0x${string}`
  ): Promise<`0x${string}`> {
        const tx = await this.walletClient.writeContract({
      address: this.registryContract,
      abi: ONTOLOGY_REGISTRY_ABI,
      functionName: 'updateOntology',
      args: [ontologyName, ipfsHash, adminSignature],
      account: this.walletClient.account as Account,
      chain: null,
    });

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
    return receipt.transactionHash;
  }

  /**
   * Query SPARQL-like: substratos por status
   */
  async querySubstratesByStatus(status: string): Promise<number[]> {
        const ids = await this.publicClient.readContract({
      address: this.registryContract,
      abi: ONTOLOGY_REGISTRY_ABI,
      functionName: 'querySubstratesByStatus',
      args: [status],
    }) as readonly bigint[];

    return ids.map((id: bigint) => Number(id));
  }

  /**
   * Constrói Knowledge Asset JSON-LD para um substrato
   */
  buildKnowledgeAsset(substrateId: number, metadata: any): object {
    return {
      '@context': {
        arkhe: 'https://arkhe.org/ontology/841#',
        web3dao: 'https://github.com/Grasia/semantic-web3-dao#',
        grc20: 'https://grc20.io/p/',
      },
      '@type': 'arkhe:Substrate',
      '@id': `arkhe:substrate-${substrateId}`,
      'arkhe:substrateId': substrateId,
      'arkhe:name': metadata.name,
      'arkhe:phiCoherenceValue': metadata.phiCoherence,
      'arkhe:theosisIndex': metadata.theosisIndex,
      'arkhe:status': metadata.status,
      'arkhe:hasSeal': {
        '@type': 'arkhe:Seal',
        'arkhe:hashAlgorithm': 'SHA3-256',
      },
    };
  }
}
