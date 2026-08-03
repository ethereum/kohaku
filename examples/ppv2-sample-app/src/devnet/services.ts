/**
 * DEVNET SIDE — in-process stand-ins for the protocol's off-chain services:
 * the ASP (association-set provider), a relayer, the Groth16 prover, and the
 * Entrypoint contract reads. They are injected through `PPv2Factories`, the
 * plugin's documented test seam; a production wallet never sets factories and
 * gets the real HTTP/proving services instead.
 *
 * Adapted from `packages/privacy-pools/tests/v2/utils/mock-services.ts`.
 */
import type {
    AssetConfig,
    EventSnapshot,
    EVMProof,
    Hash,
    Hex,
    IASPClient,
    IASPDataProvider,
    IEntrypointInteractor,
    IProofService,
    IRelayerInteractor,
    LabelStatus,
    MerkleProof,
    NoteData,
    PreparedTransaction,
    ProofResult,
    RelayerInfo,
    TransferRelayerQuote,
    WithdrawalRelayerQuote,
} from "@0xbow-io/privacy-pools-v2-sdk";
import { encodeAbiParameters, pad } from "viem";
import type { DevnetChain } from "./chain";

/**
 * The X25519 base point as the ASP public key — a valid curve point, so the
 * SDK's real ECDH encryption of deposit ciphertexts succeeds.
 */
const DEVNET_ASP_PUBKEY = `0x09${"00".repeat(31)}` as Hex;

export type DevnetAsp = IASPClient &
    IASPDataProvider & {
        /** Approve a deposit's label (push it into the association set). */
        approveLabel(labelHash: Hash): void;
    };

/**
 * The devnet ASP: every queried label defaults to `approved`, and the mutable
 * association set backs the SDK's locally built ASP merkle proofs.
 *
 * `snapshotBlock` sets how far the (event-empty) snapshot claims to cover —
 * the SDK's status sync scans the chain only PAST this block, so live mode
 * passes the current head to avoid a from-genesis scan (the devnet's tiny
 * chain is fine with the 0 default).
 */
export function createDevnetAsp(
    options: { snapshotBlock?: () => Promise<bigint> } = {},
): DevnetAsp {
    const associationLeaves: Hash[] = [];
    const snapshot: EventSnapshot = {
        chainId: "0xaa36a7" as Hex,
        snapshotBlockNumber: "0x0" as Hex,
        generatedAt: "1970-01-01T00:00:00Z",
        deposits: [],
        transacts: [],
        ragequits: [],
        leaves: [],
        keystoreLeaves: [],
    };

    const asp = {
        approveLabel(labelHash: Hash) {
            associationLeaves.push(labelHash);
        },
        // ---- IASPClient (deposit side) ----
        async getAssociationSetRoot(): Promise<Hash> {
            return pad("0x01");
        },
        async getAssociationSetLeaves(): Promise<Hash[]> {
            return associationLeaves;
        },
        async getMerkleProof(labelHash: Hash): Promise<MerkleProof> {
            return {
                leaf: labelHash,
                root: pad("0x01"),
                siblings: [],
                index: 0,
            } as unknown as MerkleProof;
        },
        async getLabelStatus(): Promise<LabelStatus> {
            return { status: "approved" };
        },
        async getASPPublicKey(): Promise<Hex> {
            return DEVNET_ASP_PUBKEY;
        },
        // ---- IASPDataProvider (discovery side) ----
        async getRoot(): Promise<Hash> {
            return pad("0x01");
        },
        async getLeaves(): Promise<Hash[]> {
            return [];
        },
        async getEventSnapshot() {
            if (!options.snapshotBlock) return snapshot;

            const block = await options.snapshotBlock();

            return { ...snapshot, snapshotBlockNumber: `0x${block.toString(16)}` as Hex };
        },
        async getNoteEvents(): Promise<never> {
            // Swallowed by discovery → it falls back to chain `eth_getLogs`.
            throw new Error("devnet ASP: no note-event cache (use chain logs)");
        },
    };

    return asp as unknown as DevnetAsp;
}

/** The devnet relayer's public identity. */
export const DEVNET_RELAYER_INFO: RelayerInfo = {
    url: "https://relayer.demo.invalid",
    name: "devnet-relayer",
    chainId: 11155111,
    chainType: "evm",
    status: "active",
    address: pad("0x0e1a", { size: 20 }) as RelayerInfo["address"],
    processorAddress: pad("0x0e1b", { size: 20 }) as RelayerInfo["address"],
};

/**
 * The devnet relayer: quotes a flat fee and, on relay, mines the transaction
 * onto the devnet chain so the receipt the SDK waits for resolves.
 */
export function createDevnetRelayer(
    chain: DevnetChain,
    options: { feeAmount?: bigint } = {},
): IRelayerInteractor {
    const feeAmount = (options.feeAmount ?? 5n).toString();

    const transferQuote = (asset: Hex): TransferRelayerQuote => ({
        txCost: "0",
        gasPrice: "0",
        feeAmount,
        feeCommitment: {
            data: "0x" as Hex,
            asset,
            expiration: Math.floor(Date.now() / 1000) + 3600,
            feeAmount,
            signedRelayerCommitment: "0x" as Hex,
        },
    });

    return {
        async getRelayers() {
            return [DEVNET_RELAYER_INFO];
        },
        async getRelayerFees() {
            return { baseFee: "0x0", provider: undefined } as never;
        },
        async getTransferQuote(_relayer, params) {
            return transferQuote(params.asset);
        },
        async getWithdrawalQuote(_relayer, params): Promise<WithdrawalRelayerQuote> {
            const base = transferQuote(params.asset as Hex);
            // Payout routing rides inside the fee commitment: `relayWithdraw`
            // decodes it and cross-checks recipient/fee against its own params.
            const data = encodeAbiParameters(
                [
                    {
                        type: "tuple",
                        components: [
                            { name: "recipient", type: "address" },
                            { name: "feeRecipient", type: "address" },
                            { name: "feeAmount", type: "uint256" },
                            { name: "nativeGas", type: "uint256" },
                        ],
                    },
                ],
                [
                    {
                        recipient: params.recipient as `0x${string}`,
                        feeRecipient: DEVNET_RELAYER_INFO.address,
                        feeAmount: BigInt(feeAmount),
                        nativeGas: 0n,
                    },
                ],
            );

            // The pool releases amount + fee; the recipient nets the amount.
            const amountSent = (BigInt(params.amount) + BigInt(feeAmount)).toString();

            return {
                ...base,
                amountSent,
                amountReceived: params.amount,
                feeCommitment: {
                    ...base.feeCommitment,
                    data,
                    recipient: params.recipient as Hex,
                    amountSent,
                    amountReceived: params.amount,
                    extraGas: false,
                },
            } as unknown as WithdrawalRelayerQuote;
        },
        async relayTransfer() {
            return chain.mineTransaction().txHash;
        },
        async relayWithdrawal() {
            return chain.mineTransaction().txHash;
        },
        async waitForRelayedTx(txHash: Hex) {
            return { txHash, status: "confirmed" } as never;
        },
    } as IRelayerInteractor;
}

/** Instant dummy Groth16 shapes — no artifact downloads, no proving time. */
export function createDevnetProofService(): IProofService {
    const dummy: ProofResult = {
        proof: {
            pi_a: ["0x1", "0x1"],
            pi_b: [
                ["0x1", "0x1"],
                ["0x1", "0x1"],
            ],
            pi_c: ["0x1", "0x1"],
            protocol: "groth16",
            curve: "bn128",
        },
        publicSignals: Array<Hex>(16).fill("0x1" as Hex),
    };

    return {
        async proveDeposit() {
            return dummy;
        },
        async proveTransact() {
            return dummy;
        },
        async proveRagequit() {
            return dummy;
        },
        async verifyDeposit() {
            return true;
        },
        async verifyTransact() {
            return true;
        },
        async verifyRagequit() {
            return true;
        },
        async loadCircuit() {
            /* nothing to load */
        },
        formatForEVM(): EVMProof {
            return {
                pA: [1n, 1n],
                pB: [
                    [1n, 1n],
                    [1n, 1n],
                ],
                pC: [1n, 1n],
                pubSignals: [1n],
            };
        },
    };
}

/** The devnet Entrypoint contract address deposits are sent to. */
export const DEVNET_ENTRYPOINT = pad("0x0e00", { size: 20 }) as `0x${string}`;

/** Entrypoint reads: enabled asset config, zero vetting fee, fixed encodings. */
export function createDevnetEntrypoint(): IEntrypointInteractor {
    const assetConfig: AssetConfig = {
        enabled: true,
        minAmount: "0x0",
        vettingFeeBPS: "0x0",
        maxRelayFee: `0x${(10n ** 18n).toString(16)}`,
    };

    return {
        getAddress() {
            return DEVNET_ENTRYPOINT;
        },
        async getPoolVaultAddress() {
            return pad("0x0e01", { size: 20 }) as `0x${string}`;
        },
        async getASPRegistryAddress() {
            return pad("0x0e02", { size: 20 }) as `0x${string}`;
        },
        async getAssetConfig() {
            return assetConfig;
        },
        async getAllowance(): Promise<Hash> {
            return "0x0" as Hash;
        },
        encodeDeposit(
            _proof: EVMProof,
            _noteData: NoteData,
            _aspCiphertext: Hex,
            msgValue: Hex,
        ): PreparedTransaction {
            return { to: DEVNET_ENTRYPOINT, data: "0xde9051", value: msgValue };
        },
        encodeApprove(token: `0x${string}`, amount: Hex): PreparedTransaction {
            return { to: token, data: `0x095ea7b3${amount.slice(2)}` as Hex, value: "0x0" };
        },
        async submitTransaction(): Promise<Hex> {
            // The plugin never submits (INV-1) — reaching this is a bug.
            throw new Error("devnet entrypoint: submitTransaction must not be called");
        },
    };
}
