import fc from 'fast-check';
import { getAddress, keccak256 } from 'viem';
import type { Address, Attempt, AttemptRequest, BlockHeader, CancelRequest, Hex, PaymentOrder, ProofPlace } from '../../src/index';
import { ACCOUNT, ACTION, METHOD_ECDSA, METHOD_OTHER, METHOD_PASSKEY, TOKEN, ZERO } from './doubles';
import { payloadOf } from './encodings';

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

/** Arbitrary bytes up to the given length. */
export const bytes = (maxLength: number): fc.Arbitrary<Hex> => fc.uint8Array({ maxLength }).map(toHex);

/** An arbitrary 32-byte word. */
export const word32: fc.Arbitrary<Hex> = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(toHex);

/** An arbitrary nonzero address, checksummed. */
export const address: fc.Arbitrary<Address> = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .filter((raw) => raw.some((byte) => byte !== 0))
  .map((raw) => getAddress(toHex(raw)));

/** An arbitrary unsigned integer of the given width. */
export const uint = (bits: number): fc.Arbitrary<bigint> => fc.bigInt({ min: 0n, max: 2n ** BigInt(bits) - 1n });

/** Two distinct nonzero keys. */
export const handover = fc
  .tuple(address, address)
  .filter(([left, right]) => left.toLowerCase() !== right.toLowerCase())
  .map(([newAuthority, removedAuthority]) => ({ newAuthority, removedAuthority }));

/** An order over an ERC-20, the native token or another address, any amount, a fixed or open payee. */
export const order: fc.Arbitrary<PaymentOrder> = fc.record({
  token: fc.oneof(fc.constant(ZERO), fc.constant(TOKEN), address),
  amount: fc.oneof(fc.constant(0n), uint(256)),
  payee: fc.oneof(fc.constant(ZERO), address),
});

/** Strictly increasing proof places. */
export const proofs: fc.Arbitrary<ProofPlace[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: 64 }), { minLength: 1, maxLength: 5 })
  .chain((places) =>
    fc.tuple(
      ...[...places].sort((a, b) => a - b).map((place) =>
        fc.record({
          place: fc.constant(place),
          method: fc.constantFrom(METHOD_ECDSA, METHOD_PASSKEY, METHOD_OTHER),
          config: bytes(40),
          salt: word32,
          proof: bytes(80),
        }),
      ),
    ),
  );

/** An opening request bound to the doubles' pair, its payload a decodable handover. */
export const attemptRequest: fc.Arbitrary<AttemptRequest> = fc.record({
  account: fc.constant(ACCOUNT),
  action: fc.constant(ACTION),
  attemptId: uint(64),
  setupNonce: uint(64),
  setupBody: bytes(96),
  payload: handover.map(({ newAuthority, removedAuthority }) => payloadOf(newAuthority, removedAuthority)),
  order,
  validUntil: fc.integer({ min: 0, max: 2 ** 48 - 1 }),
  proofs,
});

/** A cancel request bound to the doubles' pair. */
export const cancelRequest: fc.Arbitrary<CancelRequest> = fc.record({
  account: fc.constant(ACCOUNT),
  action: fc.constant(ACTION),
  attemptId: uint(64),
  setupNonce: uint(64),
  setupBody: bytes(96),
  validUntil: fc.integer({ min: 0, max: 2 ** 48 - 1 }),
  proofs,
});

/** An arbitrary pinned header. */
export const header: fc.Arbitrary<BlockHeader> = fc.record({
  number: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  timestamp: fc.integer({ min: 0, max: 2 ** 40 }),
  hash: word32,
});

/** An arbitrary stored attempt in any state. */
export const attempt: fc.Arbitrary<Attempt> = fc.record({
  attemptId: uint(64),
  setupNonce: uint(64),
  consumableAfter: fc.integer({ min: 0, max: 2 ** 48 - 1 }),
  state: fc.constantFrom('None' as const, 'Waiting' as const, 'Cancelled' as const, 'Consumed' as const),
  payloadHash: word32,
  order,
  usedMethods: fc.uniqueArray(fc.constantFrom(METHOD_ECDSA, METHOD_PASSKEY, METHOD_OTHER), { maxLength: 3 }),
  ignoresPause: fc.boolean(),
});

/** A waiting attempt over the payload of a handover, with the order given. */
export const waitingOver = (payload: Hex, base: Attempt): Attempt => ({ ...base, state: 'Waiting', payloadHash: keccak256(payload) });
