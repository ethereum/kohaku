/**
 * T067 KAT: the runtime hash machinery reproduces the protocol's pinned
 * cross-component constants (`reference/protocol-constants.md`). The SDK's
 * exported constants are not runtime-usable (export bug, C8), so the tags are
 * RECOMPUTED from their pinned derivation — `Poseidon(BigInt(utf8(s)))` — and
 * compared against the ledger's pinned field elements. A mismatch here means a
 * different protocol, not a style bug.
 */
import {
    CryptoService,
    type Hex,
    NoteComputationService,
    PoseidonHashService,
} from "@0xbow-io/privacy-pools-v2-sdk";
import { numberToHex, stringToHex } from "viem";
import { describe, expect, it } from "vitest";

// Pinned in reference/protocol-constants.md §1 (MUST-pins, byte-identical
// across circuit ⇄ contract ⇄ SDK).
const COMMITMENT_LEAF_TAG =
    3791694183000795315792098099581407680958131641292811872617553086713867485913n;
const NULLIFIER_LEAF_TAG =
    1480564842420020354887207755615370381236762558448265256256653429412951563031n;

const OWNER = "0x00000000000000000000000000000000000000aa";
const TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

describe("canonical vectors (T067 KAT)", () => {
    it("recomputes the pinned domain leaf tags from their source strings", async () => {
        const hashService = await PoseidonHashService.create();

        const tagOf = (s: string): bigint =>
            BigInt(hashService.hash([numberToHex(BigInt(stringToHex(s)), { size: 32 })]));

        expect(tagOf("privacy_pools_note")).toBe(COMMITMENT_LEAF_TAG);
        expect(tagOf("privacy_pools_nullifier")).toBe(NULLIFIER_LEAF_TAG);
    });

    it("commitment chain composes: Poseidon(precommitment, label) == computeFullCommitment", async () => {
        const hashService = await PoseidonHashService.create();
        const cryptoService = new CryptoService();
        const noteComputation = new NoteComputationService({ hashService, cryptoService });

        const noteSecret = cryptoService.generateSecret();
        const depositSecret = cryptoService.generateSecret();
        const value = numberToHex(1000n, { size: 32 }) as Hex;

        const noteAddressHash = noteComputation.computeNoteAddressHash(OWNER, noteSecret);
        const precommitment = noteComputation.computePrecommitment(noteAddressHash, TOKEN, value);
        const label = noteComputation.computeLabel(precommitment, depositSecret);

        const composed = hashService.hash([precommitment, label]);
        const full = noteComputation.computeFullCommitment({
            noteAddressHash,
            tokenId: TOKEN,
            value,
            label,
        });

        expect(BigInt(full)).toBe(BigInt(composed));
    });

    it("hash chain is deterministic (same inputs → same commitment)", async () => {
        const hashService = await PoseidonHashService.create();
        const cryptoService = new CryptoService();
        const noteComputation = new NoteComputationService({ hashService, cryptoService });

        const fixedSecret = numberToHex(42n, { size: 32 }) as Hex;
        const a = noteComputation.computeNoteAddressHash(OWNER, fixedSecret);
        const b = noteComputation.computeNoteAddressHash(OWNER, fixedSecret);

        expect(a).toBe(b);
    });
});
