import ts from 'typescript';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type { EnrollFailure, EnrollInput, Hex, IRecoveryMethod } from '../../src/index';
import { compileProbes, PROBE_IMPORT_FROM } from '../helpers/probe';
import {
  constituentOfKind,
  exportedType,
  kindsOf,
  loadRecords,
  propertyNames,
  type RecordContext,
} from '../helpers/records';

const GUARDIAN = '0x00000000000000000000000000000000000000a1';

let context: RecordContext;

beforeAll(() => {
  context = loadRecords();
});

/** A wallet method's two enrollment calls, stateless, written against the interface's own types. */
const walletEnrollment: Pick<IRecoveryMethod, 'enrollInput' | 'configFrom'> = {
  enrollInput: (params) => ({ kind: 'nothing-to-perform', address: params['address'] }),
  configFrom: async (input, material) => {
    const refused: EnrollFailure = { kind: 'reply-failure', cause: 'material-rejected' };

    if (input.kind !== 'nothing-to-perform' || material !== undefined) return refused;

    const address: unknown = input['address'];

    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return refused;

    const config: Hex = `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;

    return config;
  },
};

describe('the two-call wallet enrollment', () => {
  const header = `import type { EnrollInput, IRecoveryMethod } from '${PROBE_IMPORT_FROM}';\n`;

  let probes: Map<string, string[]>;

  beforeAll(() => {
    probes = compileProbes({
      'enroll-with-address': `${header}export const input: EnrollInput = { kind: 'nothing-to-perform', address: '${GUARDIAN}' };\n`,
      'enroll-bare': `${header}export const input: EnrollInput = { kind: 'nothing-to-perform' };\n`,
      'enroll-ceremony': `${header}export const input: EnrollInput = { kind: 'ceremony', challenge: '0x01', rpId: 'example.org' };\n`,
      'enroll-read-address': `${header}export function addressOf(input: EnrollInput): unknown {
  if (input.kind === 'nothing-to-perform') return input['address'];

  return undefined;
}
`,
      'enroll-address-is-unknown': `${header}export function addressOf(input: EnrollInput): string {
  if (input.kind === 'nothing-to-perform') return input['address'];

  return '';
}
`,
      'enroll-narrowing-keeps-kind': `${header}export function kindOf(input: EnrollInput): 'nothing-to-perform' | 'ceremony' {
  if (input.kind === 'nothing-to-perform') {
    const nothing: 'nothing-to-perform' = input.kind;

    return nothing;
  }

  const ceremony: 'ceremony' = input.kind;

  return ceremony;
}
`,
      'enroll-no-kind': `${header}export const input: EnrollInput = { address: '${GUARDIAN}' };\n`,
      'enroll-other-kind': `${header}export const input: EnrollInput = { kind: 'something-else', address: '${GUARDIAN}' };\n`,
      'enroll-flow': `${header}export async function enroll(wallet: IRecoveryMethod): Promise<unknown> {
  const input = wallet.enrollInput({ address: '${GUARDIAN}' });

  if (input.kind !== 'nothing-to-perform') return undefined;

  return wallet.configFrom(input, undefined);
}
`,
    });
  });

  const errorsOf = (name: string): string[] => {
    const errors = probes.get(name);

    if (errors === undefined) throw new Error(`no probe ${name}`);

    return errors;
  };

  it('a nothing-to-perform input carrying the address is an EnrollInput', () => {
    expectTypeOf<{ kind: 'nothing-to-perform'; address: `0x${string}` }>().toExtend<EnrollInput>();
    expect(errorsOf('enroll-with-address')).toEqual([]);
  });

  it('after narrowing on kind the address reads back, typed unknown, so configFrom must check it', () => {
    const input: EnrollInput = { kind: 'nothing-to-perform', address: GUARDIAN };

    if (input.kind === 'nothing-to-perform') expectTypeOf(input['address']).toEqualTypeOf<unknown>();

    expect(errorsOf('enroll-read-address')).toEqual([]);
    expect(errorsOf('enroll-address-is-unknown').join('\n')).toMatch(/TS2322: Type 'unknown' is not assignable to type 'string'/);
  });

  it('a bare nothing-to-perform input is still an EnrollInput: the distinction survives', () => {
    expectTypeOf<{ kind: 'nothing-to-perform' }>().toExtend<EnrollInput>();
    expect(errorsOf('enroll-bare')).toEqual([]);
    expect(errorsOf('enroll-narrowing-keeps-kind')).toEqual([]);
  });

  it('an input with no kind, or a kind outside the two, is not an EnrollInput', () => {
    expect(errorsOf('enroll-no-kind')).not.toEqual([]);
    expect(errorsOf('enroll-other-kind')).not.toEqual([]);
  });

  it('the union is exactly the two kinds, the ceremony branch unchanged: kind and the method\'s own data', () => {
    const type = exportedType(context, 'EnrollInput');

    expect(kindsOf(context.checker, type)).toEqual(['ceremony', 'nothing-to-perform']);

    for (const kind of ['ceremony', 'nothing-to-perform']) {
      const branch = constituentOfKind(context.checker, type, kind);
      const indexes = context.checker.getIndexInfosOfType(branch);

      expect(propertyNames(context.checker, branch), kind).toEqual(['kind']);
      expect(indexes, kind).toHaveLength(1);
      expect(indexes[0]?.keyType.flags, kind).toBe(ts.TypeFlags.String);
      expect(indexes[0]?.type.flags, kind).toBe(ts.TypeFlags.Unknown);
    }

    expectTypeOf<{ kind: 'ceremony'; challenge: Hex }>().toExtend<EnrollInput>();
    expect(errorsOf('enroll-ceremony')).toEqual([]);
  });

  it('the two calls compose on the interface: enrollInput feeds configFrom with no material', () => {
    expect(errorsOf('enroll-flow')).toEqual([]);
  });

  it('run through a stateless wallet stub, the flow yields the address as config, or EnrollFailure when malformed', async () => {
    const input = walletEnrollment.enrollInput({ address: GUARDIAN });

    expect(input.kind).toBe('nothing-to-perform');
    await expect(walletEnrollment.configFrom(input, undefined)).resolves.toBe(`0x${'0'.repeat(62)}a1`);

    const malformed = walletEnrollment.enrollInput({ address: '0x1234' });

    await expect(walletEnrollment.configFrom(malformed, undefined)).resolves.toEqual({
      kind: 'reply-failure',
      cause: 'material-rejected',
    });
  });
});
