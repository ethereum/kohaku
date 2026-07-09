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
    type Hash,
    type Hex,
    NoteComputationService,
    PoseidonHashService,
} from "@privacy-pools-v2/sdk";
import { encodeAbiParameters, numberToHex, pad, toEventSelector } from "viem";
import { deriveKeystoreManager } from "../../../src/v2/account/derivation";

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
        address: pad("0x0e01", { size: 20 }) as Hex,
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

/**
 * RPC handlers for a chain holding the given note logs: `eth_getLogs` serves
 * them (the RPC adapter's decode filters by requested ABI), and `eth_call`
 * returns a nonzero word so `getCommitmentTimestamp` is authoritative —
 * discovery refuses to persist a note without an on-chain timestamp.
 */
export function chainWithLogs(logs: RawLog[]): Record<string, (params: unknown[]) => unknown> {
    return {
        eth_getLogs: () => logs,
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
        address: pad("0x0e02", { size: 20 }) as Hex,
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
        address: pad("0x0e02", { size: 20 }) as Hex,
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
