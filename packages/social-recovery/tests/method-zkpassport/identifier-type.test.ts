import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../../src';
import { METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE } from '../../src/constants';
import type { EnrollInput, Input } from '../../src/interfaces';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { ZkPassportRequestArgs } from '../../src/types';
import { PACKAGE_ROOT } from '../helpers/source';
import { makeCtx, PARAMS, stackDouble, word } from './fixtures';

/** The installed `@zkpassport/sdk` 0.17.1 folder, through the package's link. */
const PEER = realpathSync(join(PACKAGE_ROOT, 'node_modules', '@zkpassport', 'sdk'));

/** A built file of the installed peer or of its own `@zkpassport/utils`, read as text, never run. */
const peerText = (...path: string[]): string => readFileSync(join(PEER, ...path), 'utf8');

const open = async (record: EnrollInput | Input): Promise<unknown> => (record['openRequest'] as () => Promise<unknown>)();

const requestArgsOf = (calls: readonly { readonly kind: string; readonly args?: unknown }[]): unknown =>
  calls.find((call) => call.kind === 'request')?.args;

describe('every request asks for the non-salted identifier type', () => {
  it('the constant is the number 0, typed as that literal, and the request arguments carry its type', () => {
    expect(METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE).toBe(0);
    expectTypeOf(METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE).toEqualTypeOf<0>();
    expectTypeOf<ZkPassportRequestArgs['uniqueIdentifierType']>().toEqualTypeOf<0>();
  });

  it('the core entry exports the constant', () => {
    expect((core as { readonly [name: string]: unknown })['METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE']).toBe(0);
  });

  it.each([false, true])('dev mode %s: the enrollment and the approval request both send the constant', async (devMode) => {
    const enrolling = stackDouble();
    const approving = stackDouble();

    await open(zkPassportMethod({ stack: enrolling.stack, devMode }).enrollInput(PARAMS));
    await open(zkPassportMethod({ stack: approving.stack, devMode }).signingInput(makeCtx(word(1)), PARAMS));

    for (const calls of [enrolling.calls, approving.calls]) {
      expect(requestArgsOf(calls)).toMatchObject({ uniqueIdentifierType: METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE });
    }
  });

  it('params cannot ask for another type: an extra member is not passed on', async () => {
    const double = stackDouble();

    await open(zkPassportMethod({ stack: double.stack }).enrollInput({ ...PARAMS, uniqueIdentifierType: 1 }));

    expect(requestArgsOf(double.calls)).toMatchObject({ uniqueIdentifierType: 0 });
  });
});

describe('the installed peer reads the type as the method sends it', () => {
  it('the peer\'s own @zkpassport/utils numbers NON_SALTED as the constant', () => {
    const utils = peerText('..', 'utils', 'dist', 'esm', 'types', 'index.js');
    const numbered = /\w\[\w\.NON_SALTED=(\d+)\]="NON_SALTED"/.exec(utils);

    expect(JSON.parse(readFileSync(join(PEER, '..', 'utils', 'package.json'), 'utf8'))).toMatchObject({ version: '0.38.0' });
    expect(Number(numbered?.[1])).toBe(METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE);
  });

  it('the peer keeps the requested type as given where no OPRF key is set', () => {
    const rule = /async request\(\{[^}]*uniqueIdentifierType:(\w+),oprfKeyId:(\w+)[^}]*\}\)[\s\S]*?uniqueIdentifierType:\2\?NullifierType\.SALTED:\1[,}]/;

    expect(peerText('dist', 'esm', 'index.js')).toMatch(rule);
  });

  it('the peer\'s request URL carries &nt= only for a set type, so 0 is sent and an absent type is not', () => {
    const rule = /(\w+)=this\.topicToLocalConfig\[\w+\]\.uniqueIdentifierType,[\s\S]*?return \1!=null&&\(\w+\+=`&nt=\$\{\1\}`\)/;

    expect(peerText('dist', 'esm', 'index.js')).toMatch(rule);
  });
});

describe('the identifier type\'s changeset', () => {
  const text = (): string => readFileSync(join(PACKAGE_ROOT, '..', '..', '.changeset', 'zkpassport-identifier-type.md'), 'utf8');

  it('is a patch of the package naming the constant, and never names the factory', () => {
    expect(text()).toMatch(/['"]@kohaku-eth\/social-recovery['"]\s*:\s*patch/);
    expect(text()).toContain('METHOD_ZKPASSPORT_REQUESTED_IDENTIFIER_TYPE');
    expect(text()).not.toContain('zkPassportMethod');
  });
});
