import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  creationPrivileges,
  decodeAttemptRequest,
  decodeCancelRequest,
  decodePaymentOrder,
  decodeProofPlace,
  defaultSalt,
  encodeAttemptRequest,
  encodeCancelRequest,
  encodePaymentOrder,
  encodeProofPlace,
  kitBinding,
  kitSlot,
  type Address,
  type Hex,
} from '../../src/index';
import {
  attemptOf,
  blessed,
  cancelOf,
  decodedAttempt,
  decodedCancel,
  decodedOrder,
  decodedProof,
  fixture,
  orderOf,
  proofOf,
  ROW_KEY,
  rowOf,
  type Row,
  type RowFile,
} from './request-rows';
import {
  buildCreationCode,
  builderCreationCode,
  create2ByHand,
  create2Viem,
  fixturePrivileges,
  kitBindingPreimage,
  kitSlotPreimage,
  oracleAttempt,
  oracleCancel,
  oracleOrder,
  oracleProofPlace,
  oracleSaltHand,
  oracleSaltViem,
  privilegeSlot,
} from './request-support';
import { keccakLocal } from './support';

const str = (value: unknown): string => value as string;

type Replayer = (row: Row) => void;

const REPLAYERS: Record<string, Replayer> = {
  'attempt-request-v1': ({ input, expected }) => {
    const request = attemptOf(input);

    expect(oracleAttempt(request)).toBe(expected['calldata']);
    expect(encodeAttemptRequest(request)).toBe(expected['calldata']);
    expect(decodeAttemptRequest(str(expected['calldata']) as Hex)).toStrictEqual(decodedAttempt(request));
  },
  'cancel-request-v1': ({ input, expected }) => {
    const request = cancelOf(input);

    expect(oracleCancel(request)).toBe(expected['calldata']);
    expect(encodeCancelRequest(request)).toBe(expected['calldata']);
    expect(decodeCancelRequest(str(expected['calldata']) as Hex)).toStrictEqual(decodedCancel(request));
  },
  'proof-place-v1': ({ input, expected }) => {
    const proof = proofOf(input);

    expect(oracleProofPlace(proof)).toBe(expected['encoded']);
    expect(encodeProofPlace(proof)).toBe(expected['encoded']);
    expect(decodeProofPlace(str(expected['encoded']) as Hex)).toStrictEqual(decodedProof(proof));
  },
  'payment-order-v1': ({ input, expected }) => {
    const order = orderOf(input);

    expect(oracleOrder(order)).toBe(expected['encoded']);
    expect(encodePaymentOrder(order)).toBe(expected['encoded']);
    expect(decodePaymentOrder(str(expected['encoded']) as Hex)).toStrictEqual(decodedOrder(order));
  },
  'ambire-kit-slot-v1': ({ input, expected }) => {
    const action = str(input['action']) as Address;

    expect(kitSlotPreimage(action)).toBe(expected['slotPreimage']);
    expect(keccakLocal(str(expected['slotPreimage']))).toBe(expected['slotHash']);
    expect(`0x${str(expected['slotHash']).slice(-40)}`).toBe(expected['slot']);
    expect(kitSlot(action)).toBe(getAddress(str(expected['slot'])));
    expect(kitBindingPreimage(action)).toBe(expected['bindingPreimage']);
    expect(keccakLocal(str(expected['bindingPreimage']))).toBe(expected['binding']);
    expect(kitBinding(action)).toBe(expected['binding']);
  },
  'default-salt-v1': ({ input, expected }) => {
    const account = str(input['account']) as Address;
    const place = Number(str(input['place']));

    expect(keccakLocal(str(expected['preimage']))).toBe(expected['salt']);
    expect(oracleSaltViem(account, place)).toBe(expected['salt']);
    expect(oracleSaltHand(account, place)).toBe(expected['salt']);
    expect(defaultSalt(account, place)).toBe(expected['salt']);
  },
  'ambire-creation-privileges-v1': ({ input, expected }) => {
    const factory = str(input['factory']) as Address;
    const bytecode = str(input['bytecode']) as Hex;
    const salt = str(input['salt']) as Hex;
    const privileges = input['privileges'] as { addr: Address; valueBytes: Hex }[];

    expect(keccakLocal(bytecode)).toBe(expected['bytecodeHash']);

    if (expected['refused'] !== undefined) {
      const implementation = str(input['implementation']) as Address;
      const entries = privileges.map((p) => ({ addr: p.addr, valueBytes: p.valueBytes.slice(2) }));

      expect(bytecode).toBe(builderCreationCode(implementation, entries));
      expect(bytecode).not.toBe(buildCreationCode(implementation, entries));
      expect(() => creationPrivileges(factory, bytecode, salt)).toThrow(new RangeError(str(expected['refused'])));

      return;
    }

    const record = fixturePrivileges(expected);

    expect(create2Viem(factory, salt, bytecode)).toBe(record.account);
    expect(create2ByHand(factory, salt, bytecode)).toBe(record.account);
    expect(record.entries.map((entry) => entry.slot)).toStrictEqual(privileges.map((p) => privilegeSlot(p.addr)));
    expect(creationPrivileges(factory, bytecode, salt)).toStrictEqual(record);
  },
};

function replay(name: string, file: RowFile, isBlessed: boolean): void {
  describe(name, () => {
    it('names a known format, carries rows and is marked as it should be', () => {
      expect(Object.keys(REPLAYERS)).toContain(file.format);
      expect(file.vectors.length).toBeGreaterThan(0);
      expect(file.blessed === false).toBe(!isBlessed);

      if (!isBlessed) expect(file.source).toBe('tester-authored boundary rows');
    });

    it.each(file.vectors.map((row) => [row[ROW_KEY], row] as const))('row %s replays both ways', (_key, row) => {
      REPLAYERS[file.format]?.(row);
    });
  });
}

const BLESSED_ROWS: Record<string, readonly string[]> = {
  'attempt-request.json': ['sorted-proofs'],
  'cancel-request.json': ['one-proof'],
  'proof-place.json': ['normal', 'empty-dynamic-members'],
  'payment-order.json': ['erc20', 'native-zero-open'],
  'ambire-kit-slot.json': ['normal'],
};

const FIXTURES = [
  'attempt-request-boundaries.json',
  'cancel-request-boundaries.json',
  'proof-place-boundaries.json',
  'payment-order-boundaries.json',
  'default-salt-boundaries.json',
  'ambire-creation-privileges-boundaries.json',
];

describe('blessed request vectors (copies under tests/kat/vectors)', () => {
  for (const [name, keys] of Object.entries(BLESSED_ROWS)) {
    const file = blessed(name);

    it(`${name} carries every named row`, () => {
      for (const key of keys) expect(rowOf(file, key)[ROW_KEY]).toBe(key);
    });

    replay(name, file, true);
  }
});

describe('tester-authored request fixtures (tests/formats/fixtures, blessed: false)', () => {
  for (const name of FIXTURES) replay(name, fixture(name), false);

  it('the attempt fixture with its proofs reversed gives the blessed calldata', () => {
    const reversed = rowOf(fixture('attempt-request-boundaries.json'), 'proofs-reversed');
    const sorted = rowOf(blessed('attempt-request.json'), 'sorted-proofs');

    expect(reversed.expected['calldata']).toBe(sorted.expected['calldata']);
  });

  it('the creation fixture refuses the builder\'s trimmed push and accepts the same implementation padded', () => {
    const file = fixture('ambire-creation-privileges-boundaries.json');
    const trimmed = rowOf(file, 'builder-trimmed-implementation');
    const padded = rowOf(file, 'padded-leading-zero-implementation');

    expect(trimmed.input['implementation']).toBe(padded.input['implementation']);
    expect(trimmed.expected['refused']).toBe('bytecode does not push the implementation at byte 86 as exactly 20 bytes');
    expect(padded.expected['account']).toBe('0x94317914b57f10a23d854e04ACd7E5adbDcb6338');
  });
});
