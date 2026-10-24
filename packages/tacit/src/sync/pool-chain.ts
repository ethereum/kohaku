import { type EthereumProvider } from "@kohaku-eth/provider";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import { type Hex } from "../crypto/bytes";
import { POOL_ABI } from "../pool/abi";
import { type IncTree } from "../pool/tree";

/** The pool's own record of how many leaves its tree had when `root` was its head. It reverts for a root it never held. */
export async function poolSize(provider: EthereumProvider, pool: Hex, root: bigint): Promise<bigint> {
  const data = encodeFunctionData({ abi: POOL_ABI, functionName: "rootSize", args: [`0x${root.toString(16).padStart(64, "0")}`] });
  const result = await provider.call({ to: pool, input: data });

  if (!result) throw new Error("tacit: the pool did not answer rootSize");

  return decodeFunctionResult({ abi: POOL_ABI, functionName: "rootSize", data: result });
}

/** The pool's current head: its root and leaf count. */
export async function poolHead(provider: EthereumProvider, pool: Hex): Promise<{ root: bigint; size: bigint }> {
  const result = await provider.call({ to: pool, input: encodeFunctionData({ abi: POOL_ABI, functionName: "head" }) });

  if (!result) throw new Error("tacit: the pool did not answer head");

  const [root, size] = decodeFunctionResult({ abi: POOL_ABI, functionName: "head", data: result });

  return { root: BigInt(root), size };
}

/**
 * Whether `tree` reaches the pool's head: leaves missing from the history leave it short. A node that answers `head`
 * from a block behind the logs is not a gap.
 */
export async function reachesHead(provider: EthereumProvider, pool: Hex, tree: IncTree): Promise<boolean> {
  const head = await poolHead(provider, pool);

  return head.size < BigInt(tree.size) || (head.size === BigInt(tree.size) && head.root === tree.root);
}

/** The leaves a batch added must be ones the pool has held, at exactly that count. */
export async function checkBatch(provider: EthereumProvider, pool: Hex, next: IncTree, before: IncTree): Promise<void> {
  if (next.size !== before.size && (await poolSize(provider, pool, next.root)) !== BigInt(next.size)) {
    throw new Error("tacit: the history read does not match the pool");
  }
}
