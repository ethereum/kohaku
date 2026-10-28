import { keccak256 } from 'viem';
import type { Address, Attempt, AttemptRequest, CancelRequest, Hex, PaymentOrder, ProofPlace } from '../../src/index';
import { readVector } from '../kat/read-vector';
import { ACCOUNT, ACTION, attemptIn, KEY_NEW, KEY_OLD, METHOD_ECDSA, METHOD_PASSKEY, ORDER, type Seen } from './doubles';
import { payloadOf } from './encodings';

type RawProof = { place: string; method: Address; config: Hex; salt: Hex; proof: Hex };

/** One vector row's input and its expected calldata. */
const row = (file: string, key: string): { input: Record<string, unknown>; calldata: Hex } => {
  const found = readVector(file).vectors.find((entry) => entry['id'] === key || entry.name === key);

  if (found === undefined) throw new Error(`${file} has no row ${key}`);

  return { input: found.input, calldata: (found.expected as { calldata: Hex }).calldata };
};

const proofsOf = (raw: readonly RawProof[]): ProofPlace[] => raw.map((proof) => ({ ...proof, place: Number(proof.place) }));

/** The blessed attempt request row, as given, and its calldata. */
export function attemptVector(): { request: AttemptRequest; calldata: Hex } {
  const { input, calldata } = row('attempt-request.json', 'sorted-proofs');
  const order = input['order'] as { token: Address; amount: string; payee: Address };

  return {
    calldata,
    request: {
      account: input['account'] as Address,
      action: input['action'] as Address,
      attemptId: BigInt(input['attemptId'] as string),
      setupNonce: BigInt(input['setupNonce'] as string),
      setupBody: input['setupBody'] as Hex,
      payload: input['payload'] as Hex,
      order: { token: order.token, amount: BigInt(order.amount), payee: order.payee },
      validUntil: Number(input['validUntil']),
      proofs: proofsOf(input['proofs'] as RawProof[]),
    },
  };
}

/** The blessed cancel request row, as given, and its calldata. */
export function cancelVector(): { request: CancelRequest; calldata: Hex } {
  const { input, calldata } = row('cancel-request.json', 'one-proof');

  return {
    calldata,
    request: {
      account: input['account'] as Address,
      action: input['action'] as Address,
      attemptId: BigInt(input['attemptId'] as string),
      setupNonce: BigInt(input['setupNonce'] as string),
      setupBody: input['setupBody'] as Hex,
      validUntil: Number(input['validUntil']),
      proofs: proofsOf(input['proofs'] as RawProof[]),
    },
  };
}

/** The handover payload the happy-path execute and opening carry. */
export const PAYLOAD = payloadOf(KEY_NEW, KEY_OLD);

/** The blessed attempt request moved onto the doubles' bound pair, with a payload the codec decodes. */
export const boundAttempt = (): AttemptRequest => ({ ...attemptVector().request, account: ACCOUNT, action: ACTION, payload: PAYLOAD });

/** The blessed cancel request moved onto the doubles' bound pair. */
export const boundCancel = (): CancelRequest => ({ ...cancelVector().request, account: ACCOUNT, action: ACTION });

/** A waiting attempt over `PAYLOAD`, the order and the used methods given. */
export const liveAttempt = (order: PaymentOrder = ORDER, usedMethods: readonly Address[] = [METHOD_ECDSA, METHOD_PASSKEY], ignoresPause = false): Attempt => ({
  ...attemptIn('Waiting', 4n),
  payloadHash: keccak256(PAYLOAD),
  order,
  usedMethods,
  ignoresPause,
});

/** The `part.member` names a log holds, in order. */
export const membersOf = (seen: readonly Seen[]): string[] => seen.map((one) => `${one.part}.${one.member}`);

/** The members no submission prepare may call: every validation read. */
export const VALIDATION_READS = [
  'manager.stateOf',
  'manager.paused',
  'manager.trustedParties',
  'manager.hashApproval',
  'manager.hashCancel',
  'manager.eip712Domain',
  'action.isAuthority',
  'action.holdsAnyPrivilege',
  'events.fetch',
  'provider.code',
  'provider.logs',
  'provider.transaction',
];
