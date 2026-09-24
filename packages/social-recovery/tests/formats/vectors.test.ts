import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  approvalDigest,
  approvalTypedData,
  cancellationDigest,
  cancellationTypedData,
  credentialHash,
  decodeSetupBody,
  DIGEST_VERSION,
  encodeSetupBody,
  setupBodyHash,
  setupCommitment,
  type ApprovalMembers,
  type CancellationMembers,
  type SetupBody,
} from '../../src/index';
import { readVector } from '../kat/read-vector';
import { keccakLocal, type Hex } from './support';

/** The row key, read as a string because the root lint forbids `id` as an identifier. */
const ROW_KEY = 'id';

type Row = Record<typeof ROW_KEY, string> & { input: Record<string, unknown>; expected: Record<string, unknown> };
type VectorFile = { format: string; derivation: string; blessed?: boolean; vectors: Row[] };
type Loaded = { file: VectorFile; source: string };

function loadBlessed(name: string): Loaded {
  return { file: readVector(name) as unknown as VectorFile, source: `tests/kat/vectors/${name}` };
}

function loadFixture(name: string): Loaded {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

  return { file: JSON.parse(readFileSync(path, 'utf8')) as VectorFile, source: `tests/formats/fixtures/${name}` };
}

const str = (value: unknown): string => value as string;

type Domain = { name: string; version: string; chainId: number; verifyingContract: Hex };
type Order = { token: Hex; amount: string; payee: Hex };

function membersOf(input: Record<string, unknown>): { members: ApprovalMembers; place: number; domain: Domain } {
  const domain = input['domain'] as Domain;
  const message = input['message'] as Record<string, unknown>;
  const order = message['order'] as Order | undefined;
  const base: CancellationMembers = {
    chainId: domain.chainId,
    manager: domain.verifyingContract,
    account: str(message['account']) as Hex,
    action: str(message['action']) as Hex,
    attemptId: BigInt(str(message['attemptId'])),
    setupNonce: BigInt(str(message['setupNonce'])),
    setupBodyHash: str(message['setupBodyHash']) as Hex,
    validUntil: Number(str(message['validUntil'])),
  };
  const members: ApprovalMembers = {
    ...base,
    payload: (message['payload'] ?? '0x') as Hex,
    order: order
      ? { token: order.token, amount: BigInt(order.amount), payee: order.payee }
      : { token: '0x0000000000000000000000000000000000000000', amount: 0n, payee: '0x0000000000000000000000000000000000000000' },
  };

  return { members, place: Number(str(message['place'])), domain };
}

type Replayer = (row: Row) => void;

const REPLAYERS: Record<string, Replayer> = {
  'credential-commitment-v1': ({ input, expected }) => {
    expect(keccakLocal(str(expected['preimage']))).toBe(expected['commitment']);
    expect(credentialHash(str(input['method']) as Hex, str(input['config']) as Hex, str(input['salt']) as Hex)).toBe(
      expected['commitment'],
    );
  },
  'setup-body-v1': ({ input, expected }) => {
    const body: SetupBody = {
      wait: Number(str(input['wait'])),
      ignoresPause: input['ignoresPause'] as boolean,
      clauses: input['clauses'] as SetupBody['clauses'],
    };

    expect(encodeSetupBody(body)).toBe(expected['encoded']);
    expect(decodeSetupBody(str(expected['encoded']) as Hex)).toEqual(body);
  },
  'setup-commitment-v1': ({ input, expected }) => {
    expect(keccakLocal(str(expected['preimage']))).toBe(expected['commitment']);
    expect(
      setupCommitment(
        str(input['account']) as Hex,
        str(input['action']) as Hex,
        BigInt(str(input['nonce'])),
        str(input['setupBody']) as Hex,
      ),
    ).toBe(expected['commitment']);
  },
  'approval-digest-v1': ({ input, expected }) => {
    const { members, place, domain } = membersOf(input);
    const typed = approvalTypedData(members, place);

    expect(domain.name).toBe('PolicyManager');
    expect(domain.version).toBe(DIGEST_VERSION);
    expect(typed.domain).toStrictEqual(domain);
    expect(typed.primaryType).toBe('Approval');
    expect(approvalDigest(members, place)).toBe(expected['digest']);
  },
  'cancellation-digest-v1': ({ input, expected }) => {
    const { members, place, domain } = membersOf(input);
    const typed = cancellationTypedData(members, place);

    expect(Object.keys(input['message'] as object)).not.toContain('payload');
    expect(domain.version).toBe(DIGEST_VERSION);
    expect(typed.domain).toStrictEqual(domain);
    expect(typed.primaryType).toBe('Cancellation');
    expect(cancellationDigest(members, place)).toBe(expected['digest']);
  },
};

const BLESSED = [
  'credential-commitment.json',
  'setup-body.json',
  'setup-commitment.json',
  'approval-digest.json',
  'cancellation-digest.json',
];

const FIXTURES = [
  'credential-commitment-boundaries.json',
  'setup-body-boundaries.json',
  'setup-commitment-boundaries.json',
  'approval-digest-boundaries.json',
  'cancellation-digest-boundaries.json',
];

function replay(title: string, loaded: Loaded, blessed: boolean): void {
  describe(`${title} (${loaded.source})`, () => {
    const { file } = loaded;

    it('names a known format and carries at least one row (no vacuous match)', () => {
      expect(Object.keys(REPLAYERS)).toContain(file.format);
      expect(file.vectors.length).toBeGreaterThan(0);
      expect(file.blessed === false).toBe(!blessed);
    });

    it.each(file.vectors.map((row) => [row[ROW_KEY], row] as const))('row %s', (_rowId, row) => {
      const replayer = REPLAYERS[file.format];

      expect(replayer).toBeDefined();
      replayer?.(row);
    });
  });
}

describe('blessed vectors (copies under tests/kat/vectors)', () => {
  for (const name of BLESSED) replay(name, loadBlessed(name), true);

  const body = loadBlessed('setup-body.json').file;
  const commitment = loadBlessed('setup-commitment.json').file;
  const approval = loadBlessed('approval-digest.json').file;

  it('one body is hashed on both sides: commitment row and digest member', () => {
    const encoded = str(body.vectors.find((row) => row[ROW_KEY] === 'two-clauses')?.expected['encoded']) as Hex;
    const committed = commitment.vectors.find((row) => row[ROW_KEY] === 'normal')?.input['setupBody'];
    const message = approval.vectors[0]?.input['message'] as Record<string, unknown>;

    expect(committed).toBe(encoded);
    expect(setupBodyHash(encoded)).toBe(message['setupBodyHash']);
  });
});

describe('tester-authored vectors (tests/formats/fixtures, blessed: false)', () => {
  for (const name of FIXTURES) replay(name, loadFixture(name), false);
});
