/**
 * DEVNET SIDE — protocol-event minting.
 *
 * When the demo wallet "mines" a deposit or registration, the devnet must put
 * the same events on its chain that the real Sepolia contracts would emit, or
 * the plugin's sync would discover nothing. Producing those events requires
 * protocol internals (Poseidon commitments, AEAD note payloads, auth digests),
 * so THIS file imports `@0xbow-io/privacy-pools-v2-sdk` directly — it stands in for the
 * deployed contracts, not for wallet code. The wallet side never does this.
 *
 * Adapted from the plugin's integration fixtures
 * (`packages/privacy-pools/tests/v2/utils/mock-chain.ts`).
 */
import type { Keystore } from "@kohaku-eth/plugins";
import {
    APP_IDENTIFIER,
    type Address,
    CryptoService,
    type Hash,
    type Hex,
    KeystoreManager,
    NoteComputationService,
    PoseidonHashService,
} from "@0xbow-io/privacy-pools-v2-sdk";
import { encodeAbiParameters, keccak256, numberToHex, pad, toBytes, toEventSelector, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { DevnetChain } from "./chain";

// Event ABIs of the PoolVault / Keystore contracts (local copies — the SDK's
// constants are not runtime-exported).
const NOTE_EVENT = "event Note(bytes32 indexed hint, bytes data)";
const AUTH_POLICY_SET_EVENT =
    "event AuthPolicySet(address indexed _account, uint256 _nullifyingKeyHash, uint256 _authDigest)";
const LEAF_INSERTED_EVENT =
    "event LeafInserted(uint256 _newLeaf, uint256 _root, uint256 _leafIndex)";
const LEAVES_INSERTED_EVENT =
    "event LeavesInserted(uint256[] _newLeaves, uint256 _root, uint256 _startIndex)";

/** Domain tag of the pool state tree's timestamped commitment leaves. */
const COMMITMENT_LEAF_TAG =
    3791694183000795315792098099581407680958131641292811872617553086713867485913n;

/** Contract addresses the devnet's mock entrypoint reports. */
export const DEVNET_POOL_VAULT = pad("0x0e01", { size: 20 }) as Hex;
export const DEVNET_KEYSTORE_EVENTS = pad("0x0e02", { size: 20 }) as Hex;

/**
 * Chain reads answer `1` for every non-keystore `eth_call` (see DevnetChain),
 * so discovery records timestamp 1 for every note — the state-tree leaves must
 * be minted with the same timestamp for the transact witness to resolve.
 */
const NOTE_TIMESTAMP = 1n;

const SECRET_DERIVATION_PURPOSE =
    "This signature is used to deterministically derive application-specific secrets " +
    "from your master seed. It is not a transaction and will not cost any gas.";

/**
 * Re-derive the account's protocol keys the same way the plugin does (sign the
 * canonical EIP-712 `SecretDerivation` payload with the key at the PPv2 signer
 * path). The devnet needs the viewing key to encrypt mintable notes and the
 * revocable/nullifying keys to emit a genuine registration.
 */
export async function deriveDevnetAccount(keystore: Keystore): Promise<{
    keystoreManager: KeystoreManager;
    signerAddress: Address;
}> {
    const signerPrivateKey = await keystore.deriveAt("m/28784'/2'/0'");
    const account = privateKeyToAccount(signerPrivateKey);
    const addressHash = keccak256(toBytes(account.address));

    const signature = await account.signTypedData({
        domain: {
            name: "Standardized Secret Derivation",
            version: "1",
            verifyingContract: "0x0000000000000000000000000000000000000000",
            salt: keccak256(toHex(APP_IDENTIFIER)),
        },
        types: {
            SecretDerivation: [
                { name: "purpose", type: "string" },
                { name: "addressHash", type: "bytes32" },
            ],
        },
        primaryType: "SecretDerivation",
        message: { purpose: SECRET_DERIVATION_PURPOSE, addressHash },
    });

    const keystoreManager = KeystoreManager.fromSignature(
        { signature, signerAddress: account.address, addressHash, revocableKeyIndex: "0x0" },
        { cryptoService: new CryptoService() },
    );

    return { keystoreManager, signerAddress: account.address as Address };
}

/** Shared protocol services, built once. */
async function protocolServices() {
    const cryptoService = new CryptoService();
    const hashService = await PoseidonHashService.create();
    const noteComputation = new NoteComputationService({ hashService, cryptoService });

    return { cryptoService, hashService, noteComputation };
}

export type MintedNote = {
    commitment: Hash;
    label: Hash;
    /** The key the ASP tracks the label under (`computeLabelHash(label)`). */
    labelHash: Hash;
};

/**
 * Emit what a mined deposit produces on-chain: the encrypted `Note` event
 * (addressed to the depositor's viewing key, so discovery genuinely decrypts
 * it) and the pool state-tree `LeavesInserted` event for its timestamped
 * commitment leaf (which later transact witnesses prove against).
 */
export async function mintDeposit(params: {
    chain: DevnetChain;
    keystore: Keystore;
    ownerAddress: Address;
    tokenId: Address;
    value: bigint;
    /** Position of this deposit's leaf in the pool state tree (must be a running index). */
    stateLeafIndex: bigint;
    minedAt: { txHash: `0x${string}`; blockNumber: bigint };
}): Promise<MintedNote> {
    const { cryptoService, hashService, noteComputation } = await protocolServices();
    const { keystoreManager } = await deriveDevnetAccount(params.keystore);
    const viewingPubKey = keystoreManager.getViewingKeyPair().publicKey;

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

    params.chain.appendLog(
        {
            address: DEVNET_POOL_VAULT,
            topics: [toEventSelector(NOTE_EVENT), noteData.hint],
            data: encodeAbiParameters([{ type: "bytes" }], [noteData.data]),
        },
        params.minedAt,
    );

    const tag = `0x${COMMITMENT_LEAF_TAG.toString(16)}` as Hex;
    const timestamp = `0x${NOTE_TIMESTAMP.toString(16)}` as Hex;
    const leaf = hashService.hash([tag, commitment, timestamp]);

    if (process.env["DEVNET_TRACE"]) {
        console.error(`[devnet] state leaf ${leaf} (commitment ${commitment}, ts ${timestamp})`);
    }

    params.chain.appendLog(
        {
            address: DEVNET_POOL_VAULT,
            topics: [toEventSelector(LEAVES_INSERTED_EVENT)],
            data: encodeAbiParameters(
                [{ type: "uint256[]" }, { type: "uint256" }, { type: "uint256" }],
                // The SDK rebuilds the state tree by `_startIndex`, so each
                // insertion must carry its true running position.
                [[BigInt(leaf)], 0n, params.stateLeafIndex],
            ),
        },
        params.minedAt,
    );

    return {
        commitment,
        label,
        labelHash: noteComputation.computeLabelHash(label),
    };
}

/**
 * Emit what a mined `setAuthPolicy` produces: the `AuthPolicySet` event with
 * the account's REAL index-0 auth digest (so a fresh device's gap scan
 * legitimately resolves rotation index 0) and the keystore merkle-tree
 * `LeafInserted` event (which ragequit/transact witnesses prove against).
 */
export async function mintRegistration(params: {
    chain: DevnetChain;
    keystore: Keystore;
    ownerAddress: Address;
    minedAt: { txHash: `0x${string}`; blockNumber: bigint };
}): Promise<void> {
    const { hashService, noteComputation } = await protocolServices();
    const { keystoreManager, signerAddress } = await deriveDevnetAccount(params.keystore);

    const authDigest = noteComputation.computeAuthDigest(
        keystoreManager.getPrivateRevocableKey(),
    );

    params.chain.appendLog(
        {
            address: DEVNET_KEYSTORE_EVENTS,
            topics: [toEventSelector(AUTH_POLICY_SET_EVENT), pad(signerAddress)],
            data: encodeAbiParameters(
                [{ type: "uint256" }, { type: "uint256" }],
                [1n, BigInt(authDigest)],
            ),
        },
        params.minedAt,
    );

    const nullifyingKeyHash = hashService.hash([keystoreManager.getPrivateNullifyingKey()]);
    const leaf = hashService.hash([params.ownerAddress, nullifyingKeyHash, authDigest]);

    if (process.env["DEVNET_TRACE"]) {
        console.error(`[devnet] keystore leaf ${leaf}`);
    }

    params.chain.appendLog(
        {
            address: DEVNET_KEYSTORE_EVENTS,
            topics: [toEventSelector(LEAF_INSERTED_EVENT)],
            data: encodeAbiParameters(
                [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
                [BigInt(leaf), 0n, 0n],
            ),
        },
        params.minedAt,
    );

    params.chain.keystoreRegistered = true;
}
