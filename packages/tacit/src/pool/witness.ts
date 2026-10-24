import { keccak_256 } from "@noble/hashes/sha3.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { concatBytes, toBig, unhex, word } from "../crypto/bytes";
import { mulB8 } from "../crypto/field";
import { checkValue, leafOf, npkOf, nullifierOf, sign } from "../crypto/keys";
import { L_BJJ, P_FR, VALUE_LIMIT } from "../crypto/params";
import { poseidon } from "../crypto/poseidon";
import { rootAfterInsert, rootFromPath, TREE_DEPTH, type IncTree } from "./tree";

/** An owned note being spent, or a zero-value filler with fresh random keys for an unused slot. */
export type SpendInput = { v: bigint; rho: bigint; nk: bigint; sk: bigint; index: number } | { dummy: true };

/** A note to create, or null for an unused output (a transaction with no outputs inserts nothing). */
export type OutputNote = { v: bigint; npk: bigint; rho: bigint } | null;

export type Witness = {
  /** The circuit input, every number a decimal string. */
  input: Record<string, unknown>;
  /** The eleven public signals, in the order the verifier takes them. */
  publicSignals: string[];
  newRoot: bigint;
  nf: [bigint, bigint];
  outLeaf: [bigint, bigint];
};

const address = (value: string): Uint8Array => {
  const bytes = unhex(value);

  if (bytes.length !== 20) throw new Error("tacit: address must be 20 bytes");

  return word(toBig(bytes));
};

const keccakField = (...parts: Uint8Array[]): bigint => toBig(keccak_256(concatBytes(...parts))) % P_FR;

/** The proof's `asset` input: `keccak256(abi.encode(chainId, pool, token)) mod p`, the zero token for ETH. */
export const poolAsset = (args: { chainId: number | bigint; pool: string; token?: string }): bigint =>
  keccakField(word(args.chainId), address(args.pool), address(args.token ?? "0x0000000000000000000000000000000000000000"));

export type ExtData = {
  chainId: number | bigint;
  pool: string;
  recipient: string;
  extAmount: bigint;
  relayer: string;
  fee: bigint;
  memo0: Uint8Array;
  memo1: Uint8Array;
};

/** The hash the pool recomputes over everything a proof does not cover: recipient, amounts, relayer and memos. */
export function extDataHash(data: ExtData): bigint {
  if (data.extAmount <= -VALUE_LIMIT || data.extAmount >= VALUE_LIMIT) throw new Error("tacit: extAmount out of range");

  if (data.fee < 0n || data.fee >= VALUE_LIMIT) throw new Error("tacit: fee out of range");

  return keccakField(
    word(data.chainId),
    address(data.pool),
    address(data.recipient),
    word(data.extAmount),
    address(data.relayer),
    word(data.fee),
    keccak_256(data.memo0),
    keccak_256(data.memo1),
  );
}

export const publicAmount = (extAmount: bigint, fee: bigint): bigint => (((extAmount - fee) % P_FR) + P_FR) % P_FR;

const randomBig = (size: number, random: (size: number) => Uint8Array): bigint => toBig(random(size));

const stringify = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(stringify);

  if (typeof x === "bigint" || typeof x === "number") return BigInt(x).toString();

  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, stringify(value)]));

  return x;
};

/**
 * The witness for one `transact`: two inputs (real or filler), two outputs, and the value crossing the pool
 * boundary (`extAmount` > 0 in, < 0 out). Membership is proven against `tree`, and the outputs are inserted at its
 * current size, so the proof is good only while the pool still has that head.
 */
export function buildWitness(args: {
  asset: bigint;
  tree: IncTree;
  inputs: [SpendInput, SpendInput];
  outputs: [OutputNote, OutputNote];
  extAmount: bigint;
  fee: bigint;
  extDataHash: bigint;
  random?: (size: number) => Uint8Array;
}): Witness {
  const { asset, tree, extAmount, fee } = args;
  const random = args.random ?? randomBytes;

  if (tree.size % 2) throw new Error("tacit: pool size must be even");

  const pa = publicAmount(extAmount, fee);

  const ins = args.inputs.map((x) => {
    if ("dummy" in x) {
      const sk = 1n + (randomBig(64, random) % (L_BJJ - 1n));
      const nk = 1n + (randomBig(64, random) % (L_BJJ - 1n));
      const rho = randomBig(64, random) % P_FR;
      const index = Number(randomBig(4, random));
      const leaf = leafOf(asset, 0n, npkOf(mulB8(sk), mulB8(nk)), rho);

      return { v: 0n, rho, nk, sk, index, path: Array<bigint>(TREE_DEPTH).fill(0n), nf: nullifierOf(nk, leaf, index) };
    }

    const leaf = leafOf(asset, x.v, npkOf(mulB8(x.sk), mulB8(x.nk)), x.rho);
    const path = tree.path(x.index);

    if (rootFromPath(leaf, x.index, path) !== tree.root) throw new Error("tacit: input is not the leaf at its index");

    return { ...x, path, nf: nullifierOf(x.nk, leaf, x.index) };
  });

  const outs = args.outputs.map((o) =>
    o ? { v: checkValue(o.v, "output value"), npk: o.npk, rho: o.rho, leaf: leafOf(asset, o.v, o.npk, o.rho) } : { v: 0n, npk: 0n, rho: 0n, leaf: 0n },
  );

  const sumIn = ins.reduce((sum, x) => sum + x.v, 0n) + extAmount - fee;
  const sumOut = outs.reduce((sum, o) => sum + o.v, 0n);

  if (sumIn !== sumOut) throw new Error("tacit: value not conserved");

  if (ins[0]!.nf === ins[1]!.nf) throw new Error("tacit: duplicate nullifier");

  const nf: [bigint, bigint] = [ins[0]!.nf, ins[1]!.nf];
  const outLeaf: [bigint, bigint] = [outs[0]!.leaf, outs[1]!.leaf];
  const message = poseidon([asset, ...nf, ...outLeaf, pa, args.extDataHash]);
  const sigs = ins.map((x) => sign(x.sk, message));
  const insPath = tree.insertionPath();
  const newRoot = rootAfterInsert(outLeaf, tree.size, insPath);

  const input = {
    root: tree.root,
    oldRoot: tree.root,
    newRoot,
    startIndex: BigInt(tree.size),
    publicAmount: pa,
    extDataHash: args.extDataHash,
    asset,
    nf,
    outLeaf,
    inV: ins.map((x) => x.v),
    inRho: ins.map((x) => x.rho),
    inNk: ins.map((x) => x.nk),
    inAk: ins.map((x) => mulB8(x.sk)),
    inIndex: ins.map((x) => BigInt(x.index)),
    inPath: ins.map((x) => x.path),
    sigR8: sigs.map((s) => s.R8),
    sigS: sigs.map((s) => s.S),
    outV: outs.map((o) => o.v),
    outNpk: outs.map((o) => o.npk),
    outRho: outs.map((o) => o.rho),
    insPath,
  };

  return {
    input: stringify(input) as Record<string, unknown>,
    publicSignals: [tree.root, tree.root, newRoot, BigInt(tree.size), pa, args.extDataHash, asset, ...nf, ...outLeaf].map(String),
    newRoot,
    nf,
    outLeaf,
  };
}
