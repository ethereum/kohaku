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
} from "@0xbow-io/privacy-pools-v2-sdk";
import { encodeAbiParameters, numberToHex, pad, toEventSelector } from "viem";
import { deriveKeystoreManager } from "../../../src/v2/account/derivation";

// The SDK resolves contract addresses from DEPLOYMENTS[chainId] when the tests'
// params omit `deployment` — minted logs must carry the SAME addresses or the
// mock chain's address filter (below) would hide them from discovery.
const SEPOLIA = DEPLOYMENTS[11155111]!;

/** Local copy of the PoolVault Note event (the SDK's constant is not runtime-exported). */
const NOTE_EVENT = "event Note(bytes32 indexed hint, bytes data)";

/** A raw eth_getLogs entry, as the mock provider serves it. */
export type RawLog = {
    address: Hex;
    topics: [Hex, ...Hex[]];
    data: Hex;
    blockNumber: Hex;
    transactionHash: Hex;
    logIndex: Hex;
};

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

    return {
        log,
        commitment,
        label,
        labelHash: noteComputation.computeLabelHash(label),
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
    return {
        eth_getLogs: (params: unknown[]) =>
            logs.filter((log) => matchesFilter(log, (params[0] ?? {}) as LogFilter)),
        eth_call: () => pad("0x01"),
    };
}

/** Local copy of the Keystore auth event (SDK constant not runtime-exported). */
const AUTH_POLICY_SET_EVENT =
    "event AuthPolicySet(address indexed _account, uint256 _nullifyingKeyHash, uint256 _authDigest)";

/**
 * Mint the on-chain registration of the account behind `host.keystore`: an
 * `AuthPolicySet` log carrying the REAL index-0 auth digest for the derivation
 * signer address. With this log on the mock chain (plus `chainWithLogs`'s
 * nonzero `eth_call` for `isKeystoreRegistered`), the fresh-device gap scan
 * legitimately resolves rotation index 0.
 */
export async function mintRegistrationLog(
    host: Host,
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
        topics: [toEventSelector(AUTH_POLICY_SET_EVENT), pad(signerAddress)],
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
