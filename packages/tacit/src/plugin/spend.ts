import { type TacitChainConfig } from "../config";
import { type Recipient } from "../crypto/address";
import { hex, type Hex } from "../crypto/bytes";
import { toTx, type TransactTx } from "../pool/abi";
import { sealNote } from "../pool/memo";
import { type IncTree } from "../pool/tree";
import { buildWitness, extDataHash, type OutputNote, type SpendInput } from "../pool/witness";
import { type TacitProver } from "../prover/snarkjs";
import { type OwnedNote } from "../sync/absorb";

export const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

/** A note to create: `value` for `to`. */
export type Payee = { to: Recipient; value: bigint };

/**
 * Up to two unspent notes that cover `need`: the smallest single note that does, else the first pair that does,
 * trying the largest note first. null when no two notes do.
 */
export function selectNotes(notes: OwnedNote[], need: bigint): OwnedNote[] | null {
  const sorted = [...notes].sort((a, b) => (BigInt(a.v) < BigInt(b.v) ? -1 : 1));
  const one = sorted.find((note) => BigInt(note.v) >= need);

  if (one) return [one];

  for (let i = sorted.length - 1; i > 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      if (BigInt(sorted[i]!.v) + BigInt(sorted[j]!.v) >= need) return [sorted[i]!, sorted[j]!];
    }
  }

  return null;
}

export const total = (notes: OwnedNote[]): bigint => notes.reduce((sum, note) => sum + BigInt(note.v), 0n);

/**
 * Builds and proves one `transact`: spends `ins` (an unused slot gets a random zero-value filler), creates
 * `outs`, and moves `extAmount` across the pool boundary (positive in, negative out to `recipient`). The proof
 * binds the relayer and fee along with the recipient, amount and memos.
 */
export async function proveSpend(
  args: { config: TacitChainConfig; asset: bigint; prover: TacitProver },
  spend: {
    tree: IncTree;
    ins: OwnedNote[];
    outs: [Payee | null, Payee | null];
    extAmount: bigint;
    recipient: Hex;
    relayer: Hex;
    fee: bigint;
  },
): Promise<TransactTx> {
  const sealed = spend.outs.map((out) => (out ? sealNote(out.to, out.value, args.asset) : null));
  const memo0 = sealed[0]?.memo ?? new Uint8Array();
  const memo1 = sealed[1]?.memo ?? new Uint8Array();
  const real: SpendInput[] = spend.ins.map((n) => ({ v: BigInt(n.v), rho: BigInt(n.rho), nk: n.nk, sk: n.sk, index: n.index }));
  const inputs = [real[0] ?? { dummy: true }, real[1] ?? { dummy: true }] as [SpendInput, SpendInput];
  const outputs = sealed.map((s) => (s ? { v: s.value, npk: s.npk, rho: s.rho } : null)) as [OutputNote, OutputNote];

  const witness = buildWitness({
    asset: args.asset,
    tree: spend.tree,
    inputs,
    outputs,
    extAmount: spend.extAmount,
    fee: spend.fee,
    extDataHash: extDataHash({
      chainId: args.config.chainId,
      pool: args.config.pool,
      recipient: spend.recipient,
      extAmount: spend.extAmount,
      relayer: spend.relayer,
      fee: spend.fee,
      memo0,
      memo1,
    }),
  });
  const { proof, publicSignals } = await args.prover.prove(witness.input);

  // Whatever proves it, the proof must be for the statement that was built.
  if (publicSignals.length !== witness.publicSignals.length || publicSignals.some((x, i) => BigInt(x) !== BigInt(witness.publicSignals[i]!))) {
    throw new Error("tacit: the prover's public signals are not the ones of this spend");
  }

  return toTx(proof, publicSignals, {
    recipient: spend.recipient,
    extAmount: spend.extAmount.toString(),
    relayer: spend.relayer,
    fee: spend.fee.toString(),
    memo0: hex(memo0),
    memo1: hex(memo1),
  });
}
