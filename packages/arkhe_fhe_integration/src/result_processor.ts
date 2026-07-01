import { createWalletClient, http, parseAbi, encodePacked, keccak256, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DecryptRequest } from './slim_listener';

const BRIDGE_ABI = parseAbi([
  'function publishThresholdResult(string circleId, uint256 fhenixHandle, uint64 plaintext, bytes signature)',
]);

export class ResultProcessor {
  private walletClient: any;
  private account: any;
  private bridgeContract: `0x${string}`;
  private chainId: number;

  constructor(privateKey: `0x${string}`, bridgeContractAddress: `0x${string}`, chainConfig: any) {
    this.account = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: chainConfig,
      transport: http(),
    });
    this.bridgeContract = bridgeContractAddress;
    this.chainId = chainConfig.id;
  }

  /**
   * Simulates MPC execution and signs the result
   */
  async mockMPCExecution(request: DecryptRequest): Promise<{ plaintext: bigint; signature: `0x${string}` }> {
    // In a real scenario, the coordinator communicates with MPC nodes.
    // Here we just mock a decrypted value.
    const mockPlaintext = 42n;

    // Construct the 76-byte message hash
    const messageHash = keccak256(
      encodePacked(
        ['uint256', 'int32', 'uint64', 'uint256'],
        [mockPlaintext, 8, BigInt(this.chainId), request.handle]
      )
    );

    // Sign the hash
    const signature = await this.walletClient.signMessage({
      message: { raw: messageHash },
      account: this.account,
    });

    return { plaintext: mockPlaintext, signature };
  }

  /**
   * Processes a request and submits the result to the bridge
   */
  async processRequest(request: DecryptRequest): Promise<`0x${string}`> {
    console.log(`[RESULT PROCESSOR] Processing request for Handle ${request.handle}`);

    const { plaintext, signature } = await this.mockMPCExecution(request);

    const hash = await this.walletClient.writeContract({
      address: this.bridgeContract,
      abi: BRIDGE_ABI,
      functionName: 'publishThresholdResult',
      args: [request.circleId, request.handle, plaintext, signature],
    });

    console.log(`[RESULT PROCESSOR] Result published! Tx: ${hash}`);
    return hash;
  }
}
