/**
 * T027 fixtures: controllable in-memory implementations of the SDK seams the
 * plugin injects via `PPv2Factories` — ASP client, relayer interactor, proof
 * service, and entrypoint interactor. All imports are type-only (the unpublished
 * SDK build's runtime exports are unreliable — see CORRECTIONS C8).
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
} from "@privacy-pools-v2/sdk";
import { encodeAbiParameters, pad } from "viem";

/**
 * The X25519 base point (u = 9) as the mock ASP public key — a valid, non-low-order
 * curve point, so the SDK's real ECDH encryption of the ASP ciphertext succeeds.
 */
const MOCK_ASP_PUBKEY = `0x09${"00".repeat(31)}` as Hex;

/**
 * Mock ASP implementing BOTH seams over one shared label map: `IASPClient`
 * (deposit-side: pubkey, merkle proofs) and `IASPDataProvider` (discovery-side:
 * per-label statuses, event snapshot). `getNoteEvents` throws so discovery falls
 * back to chain logs (`eth_getLogs`) — the mock chain is the event source. The
 * exposed `snapshot` is mutable so tests can inject transact/ragequit events
 * (the real `syncNotesStatus` path consumes it verbatim).
 */
export function createMockAsp(): IASPClient &
    IASPDataProvider & {
        setLabelStatus: (label: Hash, status: LabelStatus["status"]) => void;
        snapshot: EventSnapshot;
        associationLeaves: Hash[];
    } {
    const statuses = new Map<Hash, LabelStatus["status"]>();
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

    const provider = {
        snapshot,
        // Mutable association set: tests push approved labelHashes so the SDK's
        // locally-built ASP merkle proofs resolve during transact/withdraw witnesses.
        associationLeaves,
        setLabelStatus(label: Hash, status: LabelStatus["status"]) {
            statuses.set(label.toLowerCase() as Hash, status);
        },
        // ---- IASPClient ----
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
        async getLabelStatus(label: Hash): Promise<LabelStatus> {
            return { status: statuses.get(label.toLowerCase() as Hash) ?? "approved" };
        },
        async getASPPublicKey(): Promise<Hex> {
            return MOCK_ASP_PUBKEY;
        },
        // ---- IASPDataProvider ----
        async getRoot(): Promise<Hash> {
            return pad("0x01");
        },
        async getLeaves(): Promise<Hash[]> {
            return [];
        },
        async getEventSnapshot() {
            return snapshot;
        },
        async getNoteEvents(): Promise<never> {
            // Swallowed by discovery → falls back to chain eth_getLogs.
            throw new Error("mock ASP: no note-event cache (use chain logs)");
        },
    };

    return provider as unknown as ReturnType<typeof createMockAsp>;
}

/** Build an Error carrying an SDK error-class `name` (matched by `mapSdkError`). */
function namedError(name: string): Error {
    const e = new Error(`mock relayer: simulated ${name}`);

    e.name = name;

    return e;
}

/** A fixed relayer identity for quotes/relays. */
export const MOCK_RELAYER_INFO: RelayerInfo = {
    url: "https://relayer.mock",
    name: "mock-relayer",
    chainId: 11155111,
    chainType: "evm",
    status: "active",
    address: pad("0x0e1a", { size: 20 }) as RelayerInfo["address"],
    processorAddress: pad("0x0e1b", { size: 20 }) as RelayerInfo["address"],
};

/**
 * Mock relayer: controllable fee + expiry; relay returns a fixed tx hash.
 * `relayError` makes both relay calls throw an Error with that `name` (e.g.
 * "RelayerRejected") to simulate an execute-time rejection.
 */
export function createMockRelayer(
    options: { feeAmount?: bigint; expiresInSeconds?: number; relayError?: string } = {},
): IRelayerInteractor & { relayedTxHash: Hex } {
    const feeAmount = (options.feeAmount ?? 5n).toString();
    const expiration = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 3600);
    const relayedTxHash = pad("0xbeef") as Hex;

    const transferQuote = (asset: Hex): TransferRelayerQuote => ({
        txCost: "0",
        gasPrice: "0",
        feeAmount,
        feeCommitment: {
            data: "0x" as Hex,
            asset,
            expiration,
            feeAmount,
            signedRelayerCommitment: "0x" as Hex,
        },
    });

    return {
        relayedTxHash,
        async getRelayers() {
            return [MOCK_RELAYER_INFO];
        },
        async getRelayerFees() {
            return { baseFee: "0x0", provider: undefined } as never;
        },
        async getTransferQuote(_relayer, params) {
            return transferQuote(params.asset);
        },
        async getWithdrawalQuote(_relayer, params): Promise<WithdrawalRelayerQuote> {
            const base = transferQuote(params.asset as Hex);
            // Real payout routing: `relayWithdraw` decodes the commitment data and
            // cross-checks recipient/feeAmount/nativeGas against the caller's params.
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
                        feeRecipient: MOCK_RELAYER_INFO.address,
                        feeAmount: BigInt(feeAmount),
                        nativeGas: 0n,
                    },
                ],
            );

            // The pool releases amount + fee; the recipient nets the amount.
            const amountSent = (BigInt(params.amount) + BigInt(feeAmount)).toString();
            const amountReceived = params.amount;

            return {
                ...base,
                amountSent,
                amountReceived,
                feeCommitment: {
                    ...base.feeCommitment,
                    data,
                    recipient: params.recipient as Hex,
                    amountSent,
                    amountReceived,
                    extraGas: false,
                },
            } as unknown as WithdrawalRelayerQuote;
        },
        async relayTransfer() {
            if (options.relayError) throw namedError(options.relayError);

            return relayedTxHash;
        },
        async relayWithdrawal() {
            if (options.relayError) throw namedError(options.relayError);

            return relayedTxHash;
        },
        async waitForRelayedTx() {
            return { txHash: relayedTxHash, status: "confirmed" } as never;
        },
    };
}

/** Mock proof service: instant dummy Groth16 shapes, no artifacts, no proving. */
export function createMockProofService(): IProofService {
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
        // Long enough for any circuit's flat signal layout (transact: nInputs
        // nullifiers + mOutputs commitments + 6 tail signals; max 4+5+6).
        publicSignals: Array<string>(16).fill("0x1"),
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
            /* no artifacts to load */
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

const ENTRYPOINT_ADDRESS = pad("0x0e00", { size: 20 }) as `0x${string}`;

/** Mock entrypoint: enabled asset config, controllable allowance, fixed encodings. */
export function createMockEntrypoint(
    options: { allowance?: bigint } = {},
): IEntrypointInteractor {
    const assetConfig: AssetConfig = {
        enabled: true,
        minAmount: "0x0",
        vettingFeeBPS: "0x0",
        maxRelayFee: `0x${(10n ** 18n).toString(16)}`,
    };

    return {
        getAddress() {
            return ENTRYPOINT_ADDRESS;
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
            return `0x${(options.allowance ?? 0n).toString(16)}` as Hash;
        },
        encodeDeposit(
            _proof: EVMProof,
            _noteData: NoteData,
            _aspCiphertext: Hex,
            msgValue: Hex,
        ): PreparedTransaction {
            return { to: ENTRYPOINT_ADDRESS, data: "0xde9051", value: msgValue };
        },
        encodeApprove(token: `0x${string}`, amount: Hex): PreparedTransaction {
            return { to: token, data: `0x095ea7b3${amount.slice(2)}` as Hex, value: "0x0" };
        },
        async submitTransaction(): Promise<Hex> {
            // The plugin must never reach a submission path (INV-1).
            throw new Error("mock entrypoint: submitTransaction must not be called by the plugin");
        },
    };
}
