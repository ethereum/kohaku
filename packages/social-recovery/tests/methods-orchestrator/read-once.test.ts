import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { GATHERING_REPLY_KIND, KitRefusalError, type ApproverRequest } from '../../src/index';
import { handoverRows } from '../description/request-fixtures';
import { approval, callsTo, codecsFor, ctxOf, orchestratorOver, recordingMethod, rejectionOf, REQUEST_METHOD, thrownBy, ZERO } from './doubles';
import { expectedDigest } from './expected';
import { flipping, OTHER_HANDOVER } from './flipping';

const UNSUPPORTED = { kind: 'reply-failure', cause: 'request-unsupported' } as const;

const { canonical, pair } = handoverRows();

/** A request member whose first read is unread by this build and every later read is the readable value. */
const unreadFirst: readonly [string, string, unknown, unknown][] = [
  ['a purpose read as handover, then approval', 'purpose', 'handover', 'approval'],
  ['a version read as 2, then 1', 'version', 2, 1],
  ['a kind read as a reply, then a request', 'kind', 'recovery-proof-reply', 'recovery-proof-request'],
];

/** A request member whose first read is readable and every later read is unread by this build. */
const readFirst: readonly [string, string, unknown, unknown][] = [
  ['a purpose read as approval, then handover', 'purpose', 'approval', 'handover'],
  ['a version read as 1, then 2', 'version', 1, 2],
  ['a kind read as a request, then a reply', 'kind', 'recovery-proof-request', 'recovery-proof-reply'],
];

describe('replyFrom reads the kind, version and purpose of a request once', () => {
  for (const [name, member, first, later] of unreadFirst) {
    it(`${name}: request-unsupported, and no method is called`, async () => {
      const { method, calls } = recordingMethod();
      const settled = await orchestratorOver([[REQUEST_METHOD, method]]).replyFrom(flipping(approval(), member, first, later), {}, undefined);

      expect(settled).toStrictEqual(UNSUPPORTED);
      expect(calls).toHaveLength(0);
    });
  }

  for (const [name, member, first, later] of readFirst) {
    it(`${name}: never a throw; the first read decides and the reply is the approval's`, async () => {
      const { method, calls } = recordingMethod();
      const request = flipping(approval(), member, first, later);
      let settled: unknown;
      const error = await rejectionOf(async () => {
        settled = await orchestratorOver([[REQUEST_METHOD, method]]).replyFrom(request, {}, undefined);
      });

      expect(error).toBeUndefined();
      expect(settled).toMatchObject({ kind: GATHERING_REPLY_KIND, purpose: 'approval', digest: expectedDigest(approval()) });
      expect(callsTo(calls, 'replyFrom')).toHaveLength(1);
    });
  }

  for (const [name, member, first, later] of unreadFirst) {
    it(`${name}: signingInput, verify and describeRequest still throw TypeError and call nothing`, async () => {
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
      const errors = [
        thrownBy(() => orchestrator.signingInput(flipping(approval(), member, first, later))),
        await rejectionOf(() => orchestrator.verify(flipping(approval(), member, first, later), 0, '0x01')),
        thrownBy(() => orchestrator.describeRequest(flipping(approval(), member, first, later))),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(TypeError);
        expect(error).not.toBeInstanceOf(KitRefusalError);
      }

      expect(calls).toHaveLength(0);
    });
  }
});

describe('replyFrom checks the input before it reads the request', () => {
  const unread: readonly [string, ApproverRequest][] = [
    ['version 2', approval({ version: 2 })],
    ['an unknown purpose', approval({ purpose: 'handover' })],
    ['another kind', approval({ kind: 'recovery-proof-reply' })],
  ];

  for (const [name, request] of unread) {
    for (const input of [null, undefined, 'input', 7]) {
      it(`${name} with input ${String(input)}: TypeError naming the input, and no method is called`, async () => {
        const { method, calls } = recordingMethod();
        const error = await rejectionOf(() => orchestratorOver([[REQUEST_METHOD, method]]).replyFrom(request, input as never, undefined));

        expect(error).toBeInstanceOf(TypeError);
        expect((error as Error).message).toContain('input');
        expect(calls).toHaveLength(0);
      });
    }

    it(`${name} with an object input: request-unsupported`, async () => {
      expect(await orchestratorOver([]).replyFrom(request, {}, undefined)).toStrictEqual(UNSUPPORTED);
    });
  }

  it('a readable request with a null input throws the same TypeError', async () => {
    const { method, calls } = recordingMethod();
    const error = await rejectionOf(() => orchestratorOver([[REQUEST_METHOD, method]]).replyFrom(approval(), null as never, undefined));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('input');
    expect(calls).toHaveLength(0);
  });
});

describe('the orchestrator\'s describeRequest describes the copy it checked', () => {
  const codecs = codecsFor(approval().action);

  it('a payload that changes after its first read: the handover shown decodes the bytes the digest signed', () => {
    const { method, calls } = recordingMethod();
    const request = flipping(approval({ payload: canonical }), 'payload', canonical, OTHER_HANDOVER);
    const description = orchestratorOver([[REQUEST_METHOD, method]], undefined, codecs).describeRequest(request);

    expect(description.handover).toEqual({
      decoded: true,
      newAuthority: getAddress(pair.newAuthority),
      removedAuthority: getAddress(pair.removedAuthority ?? ZERO),
    });

    const ctx = ctxOf(calls, 'describe');

    expect((ctx.request as { payload?: string }).payload).toBe(canonical.toLowerCase());
    expect(ctx.digest).toBe(expectedDigest(approval({ payload: canonical })));
  });

  it('a purpose that changes after its first read: the description follows the first read, never a throw', () => {
    const { method } = recordingMethod();
    const orchestrator = orchestratorOver([[REQUEST_METHOD, method]], undefined, codecs);
    const approving = orchestrator.describeRequest(flipping(approval({ payload: canonical }), 'purpose', 'approval', 'cancellation'));
    const cancelling = orchestrator.describeRequest(flipping(approval({ payload: canonical }), 'purpose', 'cancellation', 'approval'));

    expect(approving.purpose).toBe('approval');
    expect(approving.handover).toMatchObject({ decoded: true });
    expect(cancelling.purpose).toBe('cancellation');
    expect('handover' in cancelling).toBe(false);
  });
});
