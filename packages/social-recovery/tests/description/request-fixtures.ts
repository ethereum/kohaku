import { decodeAbiParameters, encodeAbiParameters, keccak256 } from 'viem';
import type {
  ActionCodecRegistry,
  Address,
  ApproverRequest,
  Ctx,
  DeviceFacts,
  Handover,
  Hex,
  IActionCodec,
  IRecoveryMethod,
  MethodRegistry,
} from '../../src/index';
import { readVector, type VectorRow } from '../kat/read-vector';

export const MANAGER: Address = '0x8000000000000000000000000000000000000001';
export const ZERO: Address = '0x0000000000000000000000000000000000000000';

const HANDOVER_LAYOUT = [{ type: 'address' }, { type: 'address' }] as const;

const encodePair = (handover: Handover): Hex =>
  encodeAbiParameters(HANDOVER_LAYOUT, [handover.newAuthority, handover.removedAuthority ?? ZERO]);

/** An honest codec for the two-address layout: decode refuses anything but exactly two words. */
export const strictCodec = (actions: readonly Address[]): IActionCodec => ({
  actions,
  encode: encodePair,
  decode(payload: Hex): Handover {
    if (payload.length !== 2 + 128) throw new Error('not two words');

    const [newAuthority, removedAuthority] = decodeAbiParameters(HANDOVER_LAYOUT, payload);

    return { newAuthority, removedAuthority };
  },
});

/** A codec that decodes any long-enough payload, ignoring trailing bytes, so only the re-encoding can catch it. */
export const lenientCodec = (actions: readonly Address[]): IActionCodec => ({
  actions,
  encode: encodePair,
  decode(payload: Hex): Handover {
    const [newAuthority, removedAuthority] = decodeAbiParameters(HANDOVER_LAYOUT, payload);

    return { newAuthority, removedAuthority };
  },
});

/** A codec whose decode names honest keys while its encode reproduces other bytes. */
export const lyingCodec = (actions: readonly Address[], shown: Handover): IActionCodec => ({
  actions,
  encode: () => encodePair({ newAuthority: shown.newAuthority, removedAuthority: ZERO }),
  decode: () => shown,
});

/** A codec registry over the given codecs, keyed by every action each serves. */
export const codecRegistry = (...codecs: readonly IActionCodec[]): ActionCodecRegistry =>
  new Map(codecs.flatMap((codec) => codec.actions.map((action) => [action, codec] as const)));

/** A method implementation that answers `describe` with fixed facts and records every ctx it was handed. */
export function describingMethod(facts: DeviceFacts): { readonly method: IRecoveryMethod; readonly seen: Ctx[] } {
  const seen: Ctx[] = [];
  const refuse = (): never => {
    throw new Error('only describe is expected');
  };
  const method: IRecoveryMethod = {
    modules: () => [],
    enrollInput: refuse,
    configFrom: refuse,
    signingInput: refuse,
    replyFrom: refuse,
    verify: refuse,
    codec: { encodeConfig: refuse, decodeConfig: refuse, encodeProof: refuse, decodeProof: refuse },
    deviceBinding: 'none',
    describe(ctx: Ctx): DeviceFacts {
      seen.push(ctx);

      return facts;
    },
    vector: [],
  };

  return { method, seen };
}

export const methodRegistry = (entries: readonly (readonly [Address, IRecoveryMethod])[]): MethodRegistry => new Map(entries);

const text = (row: VectorRow, key: string): string => {
  const value = row.input[key];

  if (typeof value !== 'string') throw new Error(`row lacks ${key}`);

  return value;
};

type RowProof = { readonly place: string; readonly method: Address; readonly config: Hex; readonly salt: Hex };

const firstProof = (row: VectorRow): RowProof => {
  const proofs = row.input['proofs'] as readonly RowProof[] | undefined;
  const proof = proofs?.[0];

  if (proof === undefined) throw new Error('row has no proof');

  return proof;
};

/** The members an approver request copies from a blessed request row, for its first proof's place. */
function members(row: VectorRow) {
  const proof = firstProof(row);

  return {
    kind: 'recovery-proof-request' as const,
    version: 1,
    chainId: '11155111',
    manager: MANAGER,
    digestVersion: '1',
    account: text(row, 'account') as Address,
    action: text(row, 'action') as Address,
    attemptId: text(row, 'attemptId'),
    setupNonce: text(row, 'setupNonce'),
    setupBodyHash: keccak256(text(row, 'setupBody') as Hex),
    validUntil: text(row, 'validUntil'),
    place: Number(proof.place),
    method: proof.method,
    config: proof.config,
    salt: proof.salt,
    credentialHoldsCode: false,
  };
}

/** The blessed opening request row as the approval request of its first place. */
export function approvalFromVector(): ApproverRequest {
  const row = readVector('attempt-request.json').vectors[0];

  if (row === undefined) throw new Error('attempt-request has no row');

  const order = row.input['order'] as { token: Address; amount: string; payee: Address };

  return { ...members(row), purpose: 'approval', payload: text(row, 'payload') as Hex, order };
}

/** The blessed cancellation row as the cancellation request of its first place. */
export function cancellationFromVector(): ApproverRequest {
  const row = readVector('cancel-request.json').vectors[0];

  if (row === undefined) throw new Error('cancel-request has no row');

  return { ...members(row), purpose: 'cancellation' };
}

/** The blessed two-address handover rows: the canonical pair and the same bytes with one trailing byte. */
export function handoverRows(): { readonly canonical: Hex; readonly pair: Handover; readonly trailing: Hex } {
  const rows = readVector('ambire-handover.json').vectors;
  const normal = rows.find((row) => row['id'] === 'normal');
  const trailing = rows.find((row) => row['id'] === 'trailing-byte');

  if (normal === undefined || trailing === undefined) throw new Error('ambire-handover lacks its rows');

  const expected = normal.expected as { encoded: Hex };

  return {
    canonical: expected.encoded,
    pair: { newAuthority: text(normal, 'newAuthority') as Address, removedAuthority: text(normal, 'removedAuthority') as Address },
    trailing: text(trailing, 'encoded') as Hex,
  };
}
