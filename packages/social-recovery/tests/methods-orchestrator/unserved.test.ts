import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError } from '../../src/index';
import {
  approval,
  BROKEN_CHECKSUM,
  callsTo,
  isArgumentError,
  LETTERED_METHOD,
  orchestratorOver,
  OTHER_METHOD,
  recordingMethod,
  REQUEST_METHOD,
  thrownBy,
  rejectionOf,
} from './doubles';

describe('a request naming a method no registered implementation serves', () => {
  const setup = () => {
    const { method, calls } = recordingMethod();

    return { orchestrator: orchestratorOver([[OTHER_METHOD, method]]), calls };
  };

  it('signingInput throws KitRefusalError and calls no implementation', () => {
    const { orchestrator, calls } = setup();

    expect(thrownBy(() => orchestrator.signingInput(approval()))).toBeInstanceOf(KitRefusalError);
    expect(calls).toHaveLength(0);
  });

  it('enrollInput throws KitRefusalError and calls no implementation', () => {
    const { orchestrator, calls } = setup();

    expect(thrownBy(() => orchestrator.enrollInput(REQUEST_METHOD, {}))).toBeInstanceOf(KitRefusalError);
    expect(calls).toHaveLength(0);
  });

  it('replyFrom answers method-unsupported', async () => {
    const { orchestrator, calls } = setup();

    expect(await orchestrator.replyFrom(approval(), {}, undefined)).toStrictEqual({ kind: 'reply-failure', cause: 'method-unsupported' });
    expect(calls).toHaveLength(0);
  });

  it('configFrom answers the same failure', async () => {
    const { orchestrator, calls } = setup();

    expect(await orchestrator.configFrom(REQUEST_METHOD, { kind: 'nothing-to-perform' }, undefined)).toStrictEqual({
      kind: 'reply-failure',
      cause: 'method-unsupported',
    });
    expect(calls).toHaveLength(0);
  });

  it('verify throws KitRefusalError', async () => {
    const { orchestrator, calls } = setup();
    const request = approval();

    expect(await rejectionOf(() => orchestrator.verify(request, request.place, '0x01'))).toBeInstanceOf(KitRefusalError);
    expect(calls).toHaveLength(0);
  });

  it('describeRequest reports no implementation', () => {
    const { orchestrator } = setup();

    expect(orchestrator.describeRequest(approval()).device).toBe('no-implementation');
  });

  it('an empty method registry serves nothing and refuses the same way', async () => {
    const orchestrator = orchestratorOver([]);

    expect(thrownBy(() => orchestrator.signingInput(approval()))).toBeInstanceOf(KitRefusalError);
    expect(await orchestrator.replyFrom(approval(), {}, undefined)).toStrictEqual({ kind: 'reply-failure', cause: 'method-unsupported' });
  });
});

describe('the method registry is matched under any accepted spelling of the address', () => {
  const spellings = [LETTERED_METHOD.toLowerCase(), `0x${LETTERED_METHOD.slice(2).toUpperCase()}`, getAddress(LETTERED_METHOD)];

  for (const key of spellings) {
    for (const asked of spellings) {
      it(`registered as ${key}, asked as ${asked}`, async () => {
        const { method, calls } = recordingMethod();
        const orchestrator = orchestratorOver([[key as `0x${string}`, method]]);
        const request = approval({ method: asked });

        orchestrator.signingInput(request);
        orchestrator.enrollInput(asked as `0x${string}`, {});
        await orchestrator.replyFrom(request, {}, undefined);
        await orchestrator.configFrom(asked as `0x${string}`, { kind: 'nothing-to-perform' }, undefined);
        await orchestrator.verify(request, request.place, '0x01');

        expect(calls.map((call) => call.member)).toStrictEqual(['signingInput', 'enrollInput', 'replyFrom', 'configFrom', 'verify']);
      });
    }
  }

  it('a mixed-case method address whose checksum fails is a malformed argument, never a lookup', async () => {
    const broken = BROKEN_CHECKSUM;
    const { method, calls } = recordingMethod();
    const orchestrator = orchestratorOver([[LETTERED_METHOD, method]]);

    expect(getAddress(LETTERED_METHOD)).not.toBe(broken);
    expect(isArgumentError(thrownBy(() => orchestrator.signingInput(approval({ method: broken }))))).toBe(true);
    expect(isArgumentError(thrownBy(() => orchestrator.enrollInput(broken, {})))).toBe(true);
    expect(isArgumentError(await rejectionOf(() => orchestrator.replyFrom(approval({ method: broken }), {}, undefined)))).toBe(true);
    expect(isArgumentError(await rejectionOf(() => orchestrator.configFrom(broken, { kind: 'nothing-to-perform' }, undefined)))).toBe(true);
    expect(callsTo(calls, 'signingInput')).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
