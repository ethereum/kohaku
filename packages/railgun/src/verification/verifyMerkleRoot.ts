import { EthereumProvider } from "@kohaku-eth/provider";
import { Interface } from 'ethers';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { ABIRailgunSmartWallet } from '../railgun/lib/abi/abi';

const VERIFICATION_TIMEOUT_MS = 25_000;

export class MerkleRootVerificationError extends Error {
    readonly localRoot: string;
    readonly onChainRoot: string;
    readonly atBlock: number;
    readonly contractAddress: string;

    constructor(params: { localRoot: string; onChainRoot: string; atBlock: number; contractAddress: string }) {
        super(
            `Merkle root verification failed at block ${params.atBlock}: ` +
            `local=${params.localRoot}, onChain=${params.onChainRoot}`
        );
        this.name = 'MerkleRootVerificationError';
        this.localRoot = params.localRoot;
        this.onChainRoot = params.onChainRoot;
        this.atBlock = params.atBlock;
        this.contractAddress = params.contractAddress;
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Verification timed out: ${label} did not complete within ${ms}ms`));
        }, ms);

        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); },
        );
    });
}

function normalizeRoot(hex: string): string {
    const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;

    return stripped.toLowerCase().padStart(64, '0');
}

export interface VerifyMerkleRootParams {
    provider: EthereumProvider;
    contractAddress: string;
    localRoot: Uint8Array;
    atBlock: number;
    timeoutMs?: number;
}

/**
 * Verifies the locally-computed merkle root matches the on-chain root at a
 * specific block. Throws {@link MerkleRootVerificationError} on mismatch.
 */
export async function verifyMerkleRoot({
    provider,
    contractAddress,
    localRoot,
    atBlock,
    timeoutMs = VERIFICATION_TIMEOUT_MS,
}: VerifyMerkleRootParams): Promise<void> {
    const railgunInterface = new Interface(ABIRailgunSmartWallet);
    const merkleRootCalldata = railgunInterface.encodeFunctionData('merkleRoot', []);

    const result = await withTimeout(
        provider.request({
            method: 'eth_call',
            params: [
                { to: contractAddress, data: merkleRootCalldata },
                '0x' + atBlock.toString(16),
            ],
        }),
        timeoutMs,
        `eth_call to ${contractAddress} at block ${atBlock}`,
    ) as string;

    const onChainRootHex = normalizeRoot(result);
    const localRootHex = normalizeRoot(bytesToHex(localRoot));

    if (localRootHex !== onChainRootHex) {
        throw new MerkleRootVerificationError({
            localRoot: '0x' + localRootHex,
            onChainRoot: '0x' + onChainRootHex,
            atBlock,
            contractAddress,
        });
    }
}
