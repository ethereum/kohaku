import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import { POLICY_MANAGER_WRITES_ABI, type Address, type Hex, type PreparedCall, type SetupDraft } from '../../src/index';
import { readVector, type VectorRow } from '../kat/read-vector';
import {
  ACCOUNT,
  ACTION,
  ARMING_DATA,
  build,
  COMMITTED,
  KIT_BINDING,
  KIT_SLOT,
  referenceBodyBytes,
  referenceCommitmentOf,
  referenceCredential,
  standingState,
} from './doubles';

const row = (file: string, name: string): VectorRow => {
  const found = readVector(file).vectors.find((vector) => vector['id'] === name);

  if (found === undefined) throw new Error(`${file} has no row ${name}`);

  return found;
};

const field = (value: unknown, name: string): unknown => (value as Record<string, unknown>)[name];

describe('the setup client against the copied vectors', () => {
  it('arms with the kit slot and binding of ambire-kit-slot.json row normal', () => {
    const vector = row('ambire-kit-slot.json', 'normal');

    expect(field(vector.input, 'action')).toBe(ACTION);
    expect(field(vector.expected, 'slot')).toBe(KIT_SLOT);
    expect(field(vector.expected, 'binding')).toBe(KIT_BINDING);
    expect(ARMING_DATA.slice(34, 74)).toBe(KIT_SLOT.slice(2));
    expect(ARMING_DATA.slice(74)).toBe(KIT_BINDING.slice(2));
  });

  it.each(['normal', 'zero-length-body'])('recomputes setup-commitment.json row %s with the reference the tests use', (name) => {
    const vector = row('setup-commitment.json', name);
    const { account, action, nonce, setupBody } = vector.input as Record<string, string>;

    expect(referenceCommitmentOf(account as Address, action as Address, BigInt(nonce ?? '0'), setupBody as Hex)).toBe(
      field(vector.expected, 'commitment'),
    );
  });

  it.each(['two-clauses', 'empty-clauses', 'maximum-widths'])('encodes setup-body.json row %s with the reference the tests use', (name) => {
    const vector = row('setup-body.json', name);
    const input = vector.input as { wait: string; ignoresPause: boolean; clauses: { threshold: number; credentials: Hex[] }[] };

    expect(referenceBodyBytes(Number(input.wait), input.ignoresPause, input.clauses)).toBe(field(vector.expected, 'encoded'));
  });

  it.each(['normal', 'zero-and-empty'])(
    'commits a one-credential draft carrying credential-commitment.json row %s to that credential hash',
    async (name) => {
      const vector = row('credential-commitment.json', name);
      const { method, config, salt } = vector.input as { method: Address; config: Hex; salt: Hex };
      const expected = field(vector.expected, 'commitment') as Hex;

      expect(referenceCredential(method, config, salt)).toBe(expected);

      const draft: SetupDraft = {
        wait: 172_800,
        ignoresPause: false,
        clauses: [{ threshold: 1, credentials: [{ method, config, salt }] }],
        privacy: { publicMetadata: '0x', backup: 'empty' },
      };
      const { client } = build({ world: { authorized: true, state: standingState(COMMITTED, 6n, 10) } });
      const prepared = (await client.prepareCommitSetup(draft, undefined, { simulate: false })) as PreparedCall;
      const decoded = decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data: prepared.data });
      const body = referenceBodyBytes(172_800, false, [{ threshold: 1, credentials: [expected] }]);

      expect(decoded.args?.[1]).toBe(referenceCommitmentOf(ACCOUNT, ACTION, 7n, body));
    },
  );
});
