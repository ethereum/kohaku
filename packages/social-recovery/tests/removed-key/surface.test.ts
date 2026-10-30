import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../../src/index';
import type {
  Address,
  DeploymentDescriptor,
  IActionCodec,
  IEventManager,
  IProvider,
  IRecoveryActionInteractor,
  ISignerRecovery,
  PinnedBlock,
  RawTransaction,
  RemovedKey,
  RemovedKeyInputs,
} from '../../src/index';
import * as removedKeyFolder from '../../src/removed-key/index';
import { PACKAGE_ROOT } from '../helpers/source';

describe('the removed-key surface', () => {
  it('the core entry exports inferRemovedKey as a function', () => {
    expect(typeof core.inferRemovedKey).toBe('function');
  });

  it('the folder\'s index exports the function only', () => {
    expect(Object.keys(removedKeyFolder)).toEqual(['inferRemovedKey']);
    expect(removedKeyFolder.inferRemovedKey).toBe(core.inferRemovedKey);
  });

  it('REMOVED_KEY_UNNAMED is the three values in order', () => {
    expect(core.REMOVED_KEY_UNNAMED).toEqual(['no-source', 'not-a-key', 'unread']);
  });

  it('inferRemovedKey has the ruled signature', () => {
    expectTypeOf(core.inferRemovedKey).parameters.toEqualTypeOf<[inputs: RemovedKeyInputs, block: PinnedBlock]>();
    expectTypeOf(core.inferRemovedKey).returns.toEqualTypeOf<Promise<RemovedKey>>();
  });

  it('RemovedKeyInputs carries exactly the ruled members', () => {
    expectTypeOf<RemovedKeyInputs>().toEqualTypeOf<{
      readonly events: Pick<IEventManager, 'accountFilter' | 'fetch'>;
      readonly action: Pick<IRecoveryActionInteractor, 'isAuthority'>;
      readonly codec: IActionCodec;
      readonly provider: Pick<IProvider, 'transaction'>;
      readonly signerRecovery?: ISignerRecovery;
      readonly supplied?: Address;
      readonly descriptor: DeploymentDescriptor;
      readonly account: Address;
      readonly actionAddress: Address;
    }>();
  });

  it('ISignerRecovery and RawTransaction reach the core entry as types', () => {
    expectTypeOf<ISignerRecovery['recoverSigner']>().returns.toEqualTypeOf<Promise<Address | undefined>>();
    expectTypeOf<RawTransaction['to']>().toEqualTypeOf<Address | null>();
    expect('ISignerRecovery' in core).toBe(false);
    expect('RawTransaction' in core).toBe(false);
  });

  it('the built core entry exports inferRemovedKey and the three unnamed values', async () => {
    const built = (await import(join(PACKAGE_ROOT, 'dist', 'index.js'))) as Record<string, unknown>;

    expect(typeof built['inferRemovedKey']).toBe('function');
    expect(built['REMOVED_KEY_UNNAMED']).toEqual(['no-source', 'not-a-key', 'unread']);
  });

  it('IProvider has six members', () => {
    expectTypeOf<keyof IProvider>().toEqualTypeOf<'chainId' | 'call' | 'logs' | 'block' | 'code' | 'transaction'>();
  });
});
