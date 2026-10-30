import { describe, expect, it } from 'vitest';
import { DESCRIPTION_UNREAD_PURPOSE_MESSAGE, DESCRIPTION_UNREAD_REQUEST_MESSAGE, KitRefusalError, type ApproverRequest } from '../../src/index';
import { approval, cancellation, orchestratorOver, recordingMethod, rejectionOf, REQUEST_METHOD, thrownBy } from './doubles';

const unreadCases: readonly [string, ApproverRequest][] = [
  ['another kind', approval({ kind: 'recovery-proof-reply' })],
  ['version 2', approval({ version: 2 })],
  ['version as the string 1', approval({ version: '1' })],
  ['no kind', approval({ kind: undefined })],
  ['an unknown purpose', approval({ purpose: 'handover' })],
  ['a cancellation with no purpose', cancellation({ purpose: undefined })],
];

describe('a request of a kind, version or purpose this build does not read', () => {
  for (const [name, request] of unreadCases) {
    it(`${name}: replyFrom answers request-unsupported and calls nothing`, async () => {
      const { method, calls } = recordingMethod();

      expect(await orchestratorOver([[REQUEST_METHOD, method]]).replyFrom(request, {}, undefined)).toStrictEqual({
        kind: 'reply-failure',
        cause: 'request-unsupported',
      });
      expect(calls).toHaveLength(0);
    });

    it(`${name}: signingInput, verify and describeRequest throw TypeError and call nothing`, async () => {
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
      const signing = thrownBy(() => orchestrator.signingInput(request));
      const verdict = await rejectionOf(() => orchestrator.verify(request, 0, '0x01'));
      const described = thrownBy(() => orchestrator.describeRequest(request));

      for (const error of [signing, verdict, described]) {
        expect(error).toBeInstanceOf(TypeError);
        expect(error).not.toBeInstanceOf(KitRefusalError);
      }

      expect(calls).toHaveLength(0);
    });
  }

  it('describeRequest keeps the description module\'s own messages', () => {
    const orchestrator = orchestratorOver([]);

    expect(() => orchestrator.describeRequest(approval({ version: 2 }))).toThrow(DESCRIPTION_UNREAD_REQUEST_MESSAGE);
    expect(() => orchestrator.describeRequest(approval({ purpose: 'handover' }))).toThrow(DESCRIPTION_UNREAD_PURPOSE_MESSAGE);
  });

  it('an unread request is refused before the method lookup: unserved and unread answers request-unsupported', async () => {
    expect(await orchestratorOver([]).replyFrom(approval({ version: 2 }), {}, undefined)).toStrictEqual({
      kind: 'reply-failure',
      cause: 'request-unsupported',
    });
  });

  for (const request of [undefined, null, 'request', 7]) {
    it(`a request that is not an object (${String(request)}) throws TypeError from every request-taking member`, async () => {
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
      const given = request as unknown as ApproverRequest;

      expect(thrownBy(() => orchestrator.signingInput(given))).toBeInstanceOf(TypeError);
      expect(thrownBy(() => orchestrator.describeRequest(given))).toBeInstanceOf(TypeError);
      expect(await rejectionOf(() => orchestrator.replyFrom(given, {}, undefined))).toBeInstanceOf(TypeError);
      expect(await rejectionOf(() => orchestrator.verify(given, 0, '0x01'))).toBeInstanceOf(TypeError);
      expect(calls).toHaveLength(0);
    });
  }
});

describe('a foreign digest version is not an unread request', () => {
  for (const digestVersion of ['2', '0', '9007199254740991']) {
    it(`digestVersion ${digestVersion} is served`, async () => {
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
      const request = approval({ digestVersion });

      orchestrator.signingInput(request);

      expect(await orchestrator.replyFrom(request, {}, undefined)).toMatchObject({ kind: 'recovery-proof-reply' });
      expect(calls.map((call) => call.member)).toStrictEqual(['signingInput', 'replyFrom']);
    });
  }
});
