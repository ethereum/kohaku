/**
 * Mock-chain fixture: mints a REAL protocol note (Poseidon hash chain + AEAD
 * payload encrypted to the account's own viewing key, all via the SDK's own
 * services) and encodes it as a raw `Note(bytes32 indexed hint, bytes data)`
 * event log that `discoverNotes` can find, decode, and decrypt through the
 * plugin's RPC adapter.
 */
import type { Host } from "@kohaku-eth/plugins";
import {
    type Address,
    CryptoService,
    DEPLOYMENTS,
    type Hash,
    type Hex,
    NoteComputationService,
    PoseidonHashService,
    type SnapshotDeposit,
} from "@0xbow/privacy-pools-v2-sdk";
import { encodeAbiParameters, numberToHex, pad, toEventSelector } from "viem";
import { deriveKeystoreManager } from "../../../src/v2/account/derivation";

// The SDK resolves contract addresses from DEPLOYMENTS[chainId] when the tests'
// params omit `deployment` — minted logs must carry the SAME addresses or the
// mock chain's address filter (below) would hide them from discovery.
const SEPOLIA = DEPLOYMENTS[11155111]!;

/** Local copy of the PoolVault Note event (the SDK's constant is not runtime-exported). */
const NOTE_EVENT = "event Note(bytes32 indexed hint, bytes data)";

/** Local copy of the PoolVault Deposited event (the SDK's constant is not runtime-exported). */
const DEPOSITED_EVENT =
    "event Deposited(uint256 outputCommitment, address indexed asset, uint256 depositedValue, address indexed caller)";

/**
 * The `Deposited` companion of every `Note` log minted by {@link mintOwnedNoteLog},
 * keyed by the Note log. A real deposit emits both in one transaction, and the SDK
 * (1.0) promotes a vetted note PENDING → ACTIVE only with such on-chain evidence
 * for its commitment (a `Deposited`/`Transacted` output). {@link chainWithLogs}
 * serves the companion automatically whenever the Note log is on the chain, so
 * fixtures keep listing just the Note log.
 */
const DEPOSIT_COMPANIONS = new Map<RawLog, RawLog>();

/**
 * The ASP-snapshot row of every deposit minted by {@link mintOwnedNoteLog}. A
 * real ASP indexes every deposit; the SDK's promotion evidence for a note
 * approved AFTER its discovery comes from these rows (the chain tail it rescans
 * starts past the sync cursor). The mock ASP serves them from here.
 */
export const MINTED_DEPOSITS: SnapshotDeposit[] = [];

/** Local copy of the PoolVault Transacted event (the SDK's constant is not runtime-exported). */
const TRANSACTED_EVENT =
    "event Transacted(uint256[] outputCommitments, uint256[] nullifierHashes, address indexed asset, uint256 withdrawnValue, address indexed caller)";

/** Local copy of the PoolVault Ragequit event (the SDK's constant is not runtime-exported). */
const RAGEQUIT_EVENT =
    "event Ragequit(address indexed ragequitter, address indexed asset, uint256 value, uint256 commitment, uint256 nullifierHash, uint256 label)";

/**
 * Every label hash minted by {@link mintOwnedNoteLog} in this test process
 * (lowercased). The mock ASP serves these as its association set, so a minted
 * note is approved by default — the SDK decides label approval by set
 * membership, not per-label status. Tests withhold one via `setLabelStatus`.
 */
export const MINTED_LABEL_HASHES = new Set<Hash>();

/** A raw eth_getLogs entry, as the mock provider serves it. */
export type RawLog = {
    address: Hex;
    topics: [Hex, ...Hex[]];
    data: Hex;
    blockNumber: Hex;
    transactionHash: Hex;
    logIndex: Hex;
};

/** A minted note fixture: its event log plus the identifiers tests assert on. */
export type MintedNote = {
    log: RawLog;
    commitment: Hash;
    label: Hash;
    /** `computeLabelHash(label)` — the key the ASP is queried by for label status. */
    labelHash: Hash;
    value: Hex;
};

/**
 * Mint an owned note for the account behind `host.keystore` (same derivation the
 * plugin uses) and return the encoded event log. The payload is produced by the
 * real `NoteComputationService.generateNoteData` (ephemeral ECDH + AEAD), so the
 * plugin's catch-all discovery genuinely decrypts it.
 */
export async function mintOwnedNoteLog(params: {
    host: Host;
    ownerAddress: Address;
    tokenId: Address;
    value: bigint;
    blockNumber?: bigint;
}): Promise<MintedNote> {
    const { keystoreManager } = await deriveKeystoreManager({ keystore: params.host.keystore });
    const viewingPubKey = keystoreManager.getViewingKeyPair().publicKey;

    const cryptoService = new CryptoService();
    const hashService = await PoseidonHashService.create();
    const noteComputation = new NoteComputationService({ hashService, cryptoService });

    const noteSecret = cryptoService.generateSecret();
    const depositSecret = cryptoService.generateSecret();
    const value = numberToHex(params.value, { size: 32 }) as Hex;

    const noteAddressHash = noteComputation.computeNoteAddressHash(
        params.ownerAddress,
        noteSecret,
    );
    const precommitment = noteComputation.computePrecommitment(
        noteAddressHash,
        params.tokenId,
        value,
    );
    const label = noteComputation.computeLabel(precommitment, depositSecret);
    const commitment = noteComputation.computeFullCommitment({
        noteAddressHash,
        tokenId: params.tokenId,
        value,
        label,
    });

    const noteData = noteComputation.generateNoteData(
        { noteSecret, value, tokenId: params.tokenId, label },
        viewingPubKey,
    );

    const log: RawLog = {
        address: SEPOLIA.poolAddress as Hex,
        topics: [toEventSelector(NOTE_EVENT), noteData.hint],
        data: encodeAbiParameters([{ type: "bytes" }], [noteData.data]),
        blockNumber: numberToHex(params.blockNumber ?? 1n),
        transactionHash: pad("0x7357") as Hex,
        logIndex: "0x0",
    };

    const labelHash = noteComputation.computeLabelHash(label);

    MINTED_LABEL_HASHES.add(labelHash.toLowerCase() as Hash);
    DEPOSIT_COMPANIONS.set(log, {
        address: SEPOLIA.poolAddress as Hex,
        topics: [toEventSelector(DEPOSITED_EVENT), pad(params.tokenId), pad(params.ownerAddress)],
        data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [BigInt(commitment), params.value],
        ),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: "0x1",
    });
    MINTED_DEPOSITS.push({
        txHash: log.transactionHash,
        logIndex: 1,
        depositAddress: params.ownerAddress,
        outputCommitment: commitment,
        depositedValue: value,
        fee: "0x0",
        blockNumber: log.blockNumber,
        blockTimestamp: null,
        asset: params.tokenId,
    });

    return {
        log,
        commitment,
        label,
        labelHash,
        value,
    };
}

/** The `eth_getLogs` filter object, as the RPC adapter sends it. */
type LogFilter = {
    address?: Hex | Hex[];
    topics?: Array<Hex | Hex[] | null>;
    fromBlock?: Hex;
    toBlock?: Hex | "latest";
};

/** True when `log` matches an Ethereum `eth_getLogs` filter (address/topics/range). */
function matchesFilter(log: RawLog, filter: LogFilter): boolean {
    if (filter.address !== undefined) {
        const wanted = (Array.isArray(filter.address) ? filter.address : [filter.address]).map(
            (a) => a.toLowerCase(),
        );

        if (!wanted.includes(log.address.toLowerCase())) return false;
    }

    for (const [i, wanted] of (filter.topics ?? []).entries()) {
        if (wanted === null) continue;

        const options = (Array.isArray(wanted) ? wanted : [wanted]).map((t) => t.toLowerCase());

        if (!options.includes(log.topics[i]?.toLowerCase() ?? "")) return false;
    }

    const block = BigInt(log.blockNumber);

    if (filter.fromBlock !== undefined && block < BigInt(filter.fromBlock)) return false;

    if (
        filter.toBlock !== undefined &&
        filter.toBlock !== "latest" &&
        block > BigInt(filter.toBlock)
    ) {
        return false;
    }

    return true;
}

/**
 * RPC handlers for a chain holding the given note logs: `eth_getLogs` serves
 * only the logs matching the requested address/topics/block-range filter (so
 * incremental-sync tests exercise real cursor construction, not dedup), and
 * `eth_call` returns a nonzero word so `getCommitmentTimestamp` is
 * authoritative — discovery refuses to persist a note without an on-chain
 * timestamp.
 */
export function chainWithLogs(logs: RawLog[]): Record<string, (params: unknown[]) => unknown> {
    // Resolved per call: tests mutate `logs` after the handlers are built.
    const served = () =>
        logs.flatMap((log) => {
            const companion = DEPOSIT_COMPANIONS.get(log);

            return companion ? [log, companion] : [log];
        });

    return {
        eth_getLogs: (params: unknown[]) =>
            served().filter((log) => matchesFilter(log, (params[0] ?? {}) as LogFilter)),
        eth_call: () => pad("0x01"),
    };
}

/**
 * Mint the PoolVault `Ragequit` log for a minted note: the on-chain record the
 * SDK (1.0) requires before it flips a note to EXITED — an ASP snapshot row alone
 * is only a claim, corroborated against this event at its block, bound through
 * the note's real nullifier (`Poseidon`-derived from the account's nullifying key).
 */
export async function mintRagequitLog(params: {
    host: Host;
    ownerAddress: Address;
    note: MintedNote;
    tokenId: Address;
    blockNumber: bigint;
}): Promise<{ log: RawLog; nullifierHash: Hash }> {
    const { keystoreManager } = await deriveKeystoreManager({ keystore: params.host.keystore });
    const hashService = await PoseidonHashService.create();
    const noteComputation = new NoteComputationService({
        hashService,
        cryptoService: new CryptoService(),
    });
    const nullifierHash = noteComputation.computeNullifier(
        keystoreManager.getPrivateNullifyingKey(),
        params.note.commitment,
    ) as Hash;

    const log: RawLog = {
        address: SEPOLIA.poolAddress as Hex,
        topics: [toEventSelector(RAGEQUIT_EVENT), pad(params.ownerAddress), pad(params.tokenId)],
        data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [
                BigInt(params.note.value),
                BigInt(params.note.commitment),
                BigInt(nullifierHash),
                BigInt(params.note.label),
            ],
        ),
        blockNumber: numberToHex(params.blockNumber),
        transactionHash: pad("0x7a9e") as Hex,
        logIndex: "0x0",
    };

    return { log, nullifierHash };
}

/**
 * Mint the PoolVault `Transacted` log a relayed transfer/withdrawal leaves in its
 * receipt, consuming the given notes' nullifiers. The SDK (1.0) marks inputs SPENT
 * only once the confirmed receipt's `Transacted` logs are seen to consume exactly
 * the nullifiers it proved — a receipt without them is treated as an unrelated tx.
 * Output commitments are not known before proving and are not needed for that
 * check, so they are left empty unless given.
 *
 * The nullifiers default to the notes' REAL ones. The SDK, however, takes the
 * nullifiers it expects from the proof's first `nInputs` public signals, so a
 * fixture driven by a dummy prover must pass the signals that prover publishes
 * (`nullifierHashes`) — `createMockProofService` publishes `0x1` for every one.
 */
export async function mintTransactedLog(params: {
    host: Host;
    spentNotes: MintedNote[];
    tokenId: Address;
    caller: Address;
    blockNumber: bigint;
    withdrawnValue?: bigint;
    outputCommitments?: Hash[];
    nullifierHashes?: bigint[];
}): Promise<RawLog> {
    const { keystoreManager } = await deriveKeystoreManager({ keystore: params.host.keystore });
    const hashService = await PoseidonHashService.create();
    const noteComputation = new NoteComputationService({
        hashService,
        cryptoService: new CryptoService(),
    });
    const nullifiers =
        params.nullifierHashes ??
        params.spentNotes.map((note) =>
            BigInt(
                noteComputation.computeNullifier(
                    keystoreManager.getPrivateNullifyingKey(),
                    note.commitment,
                ),
            ),
        );

    return {
        address: SEPOLIA.poolAddress as Hex,
        topics: [toEventSelector(TRANSACTED_EVENT), pad(params.tokenId), pad(params.caller)],
        data: encodeAbiParameters(
            [{ type: "uint256[]" }, { type: "uint256[]" }, { type: "uint256" }],
            [
                (params.outputCommitments ?? []).map((c) => BigInt(c)),
                nullifiers,
                params.withdrawnValue ?? 0n,
            ],
        ),
        blockNumber: numberToHex(params.blockNumber),
        transactionHash: pad("0xbeef") as Hex,
        logIndex: "0x0",
    };
}

/** Local copy of the Keystore auth event (SDK constant not runtime-exported). */
const AUTH_POLICY_SET_EVENT =
    "event AuthPolicySet(address indexed _account, uint256 _nullifyingKeyHash, uint256 _authDigest)";

/**
 * Mint the on-chain registration of the account behind `host.keystore`: an
 * `AuthPolicySet` log for `account` (the plugin's `ownerAddress` — registration
 * is `msg.sender`-bound, and the SDK's gap scan reads the digest for the owner)
 * carrying the REAL index-0 auth digest. With this log on the mock chain (plus
 * `chainWithLogs`'s nonzero `eth_call` for `isKeystoreRegistered`), the
 * fresh-device gap scan legitimately resolves rotation index 0.
 */
export async function mintRegistrationLog(
    host: Host,
    account: Address,
    blockNumber = 1n,
): Promise<{ log: RawLog; signerAddress: Address }> {
    const { keystoreManager, signerAddress } = await deriveKeystoreManager({
        keystore: host.keystore,
    });
    const cryptoService = new CryptoService();
    const hashService = await PoseidonHashService.create();
    const noteComputation = new NoteComputationService({ hashService, cryptoService });
    const authDigest = noteComputation.computeAuthDigest(
        keystoreManager.getPrivateRevocableKey(),
    );

    const log: RawLog = {
        address: SEPOLIA.keystoreAddress as Hex,
        topics: [toEventSelector(AUTH_POLICY_SET_EVENT), pad(account)],
        data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [1n, BigInt(authDigest)],
        ),
        blockNumber: numberToHex(blockNumber),
        transactionHash: pad("0x4e91") as Hex,
        logIndex: "0x2",
    };

    return { log, signerAddress: signerAddress as Address };
}

/** Local copy of the Keystore merkle-leaf event (SDK constant not runtime-exported). */
const LEAF_INSERTED_EVENT =
    "event LeafInserted(uint256 _newLeaf, uint256 _root, uint256 _leafIndex)";

/** Local copy of the PoolVault batch-leaf event (SDK constant not runtime-exported). */
const LEAVES_INSERTED_EVENT =
    "event LeavesInserted(uint256[] _newLeaves, uint256 _root, uint256 _startIndex)";

/**
 * Pinned protocol commitment leaf tag — mirrors the runtime-recomputed value in
 * `canonical-vectors.test.ts` (T067); the SDK constant is not runtime-exported (C8).
 */
const COMMITMENT_LEAF_TAG =
    3791694183000795315792098099581407680958131641292811872617553086713867485913n;

/**
 * Mint the PoolVault state-tree insertion for the given commitments: one
 * `LeavesInserted` log whose leaves are the domain-tagged timestamped leaves
 * `Poseidon(COMMITMENT_LEAF_TAG, commitment, timestamp)` — exactly what
 * `buildTransactWitness` recomputes per input note, so the SDK's local state-tree
 * merkle proofs resolve. `timestamp` must match the note's `createdAtBlock`
 * (discovery stores `getCommitmentTimestamp`'s answer — `chainWithLogs` returns 1).
 */
export async function mintStateLeavesLog(
    commitments: Hash[],
    options: { timestamp?: bigint; blockNumber?: bigint } = {},
): Promise<{ log: RawLog; leaves: Hex[] }> {
    const hashService = await PoseidonHashService.create();
    const timestamp = `0x${(options.timestamp ?? 1n).toString(16)}` as Hex;
    const tag = `0x${COMMITMENT_LEAF_TAG.toString(16)}` as Hex;
    const leaves = commitments.map((c) => hashService.hash([tag, c, timestamp]));

    const log: RawLog = {
        address: SEPOLIA.poolAddress as Hex,
        topics: [toEventSelector(LEAVES_INSERTED_EVENT)],
        data: encodeAbiParameters(
            [{ type: "uint256[]" }, { type: "uint256" }, { type: "uint256" }],
            [leaves.map((l) => BigInt(l)), 0n, 0n],
        ),
        blockNumber: numberToHex(options.blockNumber ?? 1n),
        transactionHash: pad("0x57a7e") as Hex,
        logIndex: "0x4",
    };

    return { log, leaves };
}

/**
 * Mint the keystore merkle leaf of the account behind `host.keystore`: a
 * `LeafInserted` log carrying `Poseidon(ownerAddress, Poseidon(privNullifyingKey),
 * authDigest)` — the exact leaf `buildRagequitWitness` recomputes, so the SDK's
 * local keystore-tree merkle proof resolves against this single-leaf tree.
 */
export async function mintKeystoreLeafLog(
    host: Host,
    ownerAddress: Address,
    blockNumber = 1n,
): Promise<{ log: RawLog; leaf: Hex }> {
    const { keystoreManager } = await deriveKeystoreManager({ keystore: host.keystore });
    const cryptoService = new CryptoService();
    const hashService = await PoseidonHashService.create();
    const noteComputation = new NoteComputationService({ hashService, cryptoService });

    const authDigest = noteComputation.computeAuthDigest(
        keystoreManager.getPrivateRevocableKey(),
    );
    const nullKeyHash = hashService.hash([keystoreManager.getPrivateNullifyingKey()]);
    const leaf = hashService.hash([ownerAddress, nullKeyHash, authDigest]);

    const log: RawLog = {
        address: SEPOLIA.keystoreAddress as Hex,
        topics: [toEventSelector(LEAF_INSERTED_EVENT)],
        data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [BigInt(leaf), 0n, 0n],
        ),
        blockNumber: numberToHex(blockNumber),
        transactionHash: pad("0x1eaf") as Hex,
        logIndex: "0x3",
    };

    return { log, leaf };
}
