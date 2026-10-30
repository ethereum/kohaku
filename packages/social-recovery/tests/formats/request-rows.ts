import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAddress } from 'viem';
import type { Address, AttemptRequest, CancelRequest, Hex, PaymentOrder, ProofPlace } from '../../src/index';
import { readVector } from '../kat/read-vector';

/** The row key, read as a string because the root lint forbids `id` as an identifier. */
export const ROW_KEY = 'id';

export type Row = Record<typeof ROW_KEY, string> & { input: Record<string, unknown>; expected: Record<string, unknown> };
export type RowFile = { format: string; derivation: string; blessed?: boolean; source?: string; vectors: Row[] };

/** Reads a blessed copy through the shared reader. */
export const blessed = (name: string): RowFile => readVector(name) as unknown as RowFile;

/** Reads a tester-authored fixture beside these tests. */
export const fixture = (name: string): RowFile =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')) as RowFile;

/** One row of a file by its key; a missing row throws so a replay cannot pass vacuously. */
export const rowOf = (file: RowFile, key: string): Row => {
  const row = file.vectors.find((candidate) => candidate[ROW_KEY] === key);

  if (row === undefined) throw new Error(`row ${key} missing from ${file.format}`);

  return row;
};

const str = (value: unknown): string => value as string;

export const proofOf = (raw: Record<string, unknown>): ProofPlace => ({
  place: Number(str(raw['place'])),
  method: str(raw['method']) as Address,
  config: str(raw['config']) as Hex,
  salt: str(raw['salt']) as Hex,
  proof: str(raw['proof']) as Hex,
});

export const orderOf = (raw: Record<string, unknown>): PaymentOrder => ({
  token: str(raw['token']) as Address,
  amount: BigInt(str(raw['amount'])),
  payee: str(raw['payee']) as Address,
});

const proofsOf = (input: Record<string, unknown>): ProofPlace[] =>
  (input['proofs'] as Record<string, unknown>[]).map(proofOf);

export const attemptOf = (input: Record<string, unknown>): AttemptRequest => ({
  account: str(input['account']) as Address,
  action: str(input['action']) as Address,
  attemptId: BigInt(str(input['attemptId'])),
  setupNonce: BigInt(str(input['setupNonce'])),
  setupBody: str(input['setupBody']) as Hex,
  payload: str(input['payload']) as Hex,
  order: orderOf(input['order'] as Record<string, unknown>),
  validUntil: Number(str(input['validUntil'])),
  proofs: proofsOf(input),
});

export const cancelOf = (input: Record<string, unknown>): CancelRequest => ({
  account: str(input['account']) as Address,
  action: str(input['action']) as Address,
  attemptId: BigInt(str(input['attemptId'])),
  setupNonce: BigInt(str(input['setupNonce'])),
  setupBody: str(input['setupBody']) as Hex,
  validUntil: Number(str(input['validUntil'])),
  proofs: proofsOf(input),
});

/** A proof place as a decoder must return it: the method checksummed. */
export const decodedProof = (p: ProofPlace): ProofPlace => ({ ...p, method: getAddress(p.method) });

/** An order as a decoder must return it: both addresses checksummed. */
export const decodedOrder = (o: PaymentOrder): PaymentOrder => ({ ...o, token: getAddress(o.token), payee: getAddress(o.payee) });

const sortedDecoded = (proofs: readonly ProofPlace[]): ProofPlace[] =>
  [...proofs].sort((a, b) => a.place - b.place).map(decodedProof);

/** An attempt as the decoder must return it: addresses checksummed, proofs sorted by place. */
export const decodedAttempt = (r: AttemptRequest): AttemptRequest => ({
  ...r,
  account: getAddress(r.account),
  action: getAddress(r.action),
  order: decodedOrder(r.order),
  proofs: sortedDecoded(r.proofs),
});

/** A cancellation as the decoder must return it: addresses checksummed, proofs sorted by place. */
export const decodedCancel = (r: CancelRequest): CancelRequest => ({
  ...r,
  account: getAddress(r.account),
  action: getAddress(r.action),
  proofs: sortedDecoded(r.proofs),
});
