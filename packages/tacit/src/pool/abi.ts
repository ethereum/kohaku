import { decodeEventLog, encodeFunctionData, getAbiItem, parseAbi, toEventSelector } from "viem";
import { type Hex, unhex } from "../crypto/bytes";

export const POOL_ABI = parseAbi([
  "function transact(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[11] publicInputs, address recipient, int256 extAmount, address relayer, uint256 fee, bytes memo0, bytes memo1) payable",
  "function rootSize(bytes32 root) view returns (uint256)",
  "function head() view returns (bytes32, uint256)",
  "event Transact(bytes32 indexed nf0, bytes32 indexed nf1, bytes32 outLeaf0, bytes32 outLeaf1, uint256 firstIndex, bytes32 newRoot, address recipient, int256 extAmount, address relayer, uint256 fee, bytes memo0, bytes memo1)",
]);

/** The `Transact` event's topic 0. */
export const TRANSACT_TOPIC: Hex = toEventSelector(getAbiItem({ abi: POOL_ABI, name: "Transact" }));

/** The arguments of `transact`, as the relayer takes them: integers as decimal strings, bytes as hex. */
export type TransactTx = {
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
  publicInputs: string[];
  recipient: Hex;
  extAmount: string;
  relayer: Hex;
  fee: string;
  memo0: Hex;
  memo1: Hex;
};

/** The eleven public signals the verifier takes. */
type PublicInputs = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

/** A snarkjs Groth16 proof. */
export type Groth16Proof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

/** The transaction for a proof: `pi_b` goes in with each pair swapped, the way the verifier reads it. */
export function toTx(
  proof: Groth16Proof,
  publicSignals: string[],
  rest: Pick<TransactTx, "recipient" | "extAmount" | "relayer" | "fee" | "memo0" | "memo1">,
): TransactTx {
  const [b0, b1] = [proof.pi_b[0]!, proof.pi_b[1]!];

  return {
    pA: [String(proof.pi_a[0]), String(proof.pi_a[1])],
    pB: [[String(b0[1]), String(b0[0])], [String(b1[1]), String(b1[0])]],
    pC: [String(proof.pi_c[0]), String(proof.pi_c[1])],
    publicInputs: publicSignals.map(String),
    ...rest,
  };
}

export function encodeTransact(tx: TransactTx): Hex {
  return encodeFunctionData({
    abi: POOL_ABI,
    functionName: "transact",
    args: [
      tx.pA.map(BigInt) as [bigint, bigint],
      tx.pB.map((pair) => pair.map(BigInt)) as [[bigint, bigint], [bigint, bigint]],
      tx.pC.map(BigInt) as [bigint, bigint],
      tx.publicInputs.map(BigInt) as unknown as PublicInputs,
      tx.recipient,
      BigInt(tx.extAmount),
      tx.relayer,
      BigInt(tx.fee),
      tx.memo0,
      tx.memo1,
    ],
  });
}

export type TransactEvent = {
  nf: [bigint, bigint];
  outLeaf: [bigint, bigint];
  firstIndex: number;
  memo: [Uint8Array, Uint8Array];
  block: number;
};

export function decodeTransact(log: { topics: readonly string[]; data: string; blockNumber: bigint | number }): TransactEvent {
  const { args } = decodeEventLog({
    abi: POOL_ABI,
    eventName: "Transact",
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data as Hex,
  });

  return {
    nf: [BigInt(args.nf0), BigInt(args.nf1)],
    outLeaf: [BigInt(args.outLeaf0), BigInt(args.outLeaf1)],
    firstIndex: Number(args.firstIndex),
    memo: [unhex(args.memo0), unhex(args.memo1)],
    block: Number(log.blockNumber),
  };
}
