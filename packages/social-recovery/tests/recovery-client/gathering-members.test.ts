import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { count, fileReply, KitRefusalError, order, requests, type AttemptRequest, type CancelRequest, type Gathering, type Hex, type Reply } from '../../src/index';
import { PINNED_AT, replyFor, VALID_UNTIL } from '../gathering/support';
import { approvalWith, cancellationWith, expectedMembers, loweredMembers, loweredProof, proofOfReply } from './completion-fixtures';
import { ACCOUNT, ACTION, CLIENT_CONFIGURATION, errorCodes, HEADER, rejectionOf, rig } from './doubles';

const NOW = PINNED_AT;

const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }

  throw new Error('expected a throw');
};

describe('the gathering members pass through to the pure module', () => {
  it('getApproverRequests answers what requests answers, reading nothing', () => {
    const { client, seen } = rig();
    const record = approvalWith([1]);

    expect(client.getApproverRequests(record)).toEqual(requests(record));
    expect(seen).toEqual([]);
  });

  it('addApproverReply answers what fileReply answers, leaving the record unchanged and reading nothing', () => {
    const { client, seen } = rig();
    const record = approvalWith([1]);
    const before = structuredClone(record);
    const reply = replyFor(record, 2);

    expect(client.addApproverReply(record, reply)).toEqual(fileReply(record, reply));
    expect(record).toEqual(before);
    expect(seen).toEqual([]);
  });

  it.each<[string, (reply: Reply) => Reply]>([
    ['an unknown place', (reply) => ({ ...reply, place: 99 })],
    ['another account', (reply) => ({ ...reply, account: '0x9999999999999999999999999999999999999999' })],
    ['a wrong digest', (reply) => ({ ...reply, digest: `0x${'01'.repeat(32)}` })],
    ['an unread version', (reply) => ({ ...reply, version: 99 })],
  ])('addApproverReply returns a refusal for %s and never throws', (_name, change) => {
    const { client } = rig();
    const record = approvalWith([]);
    const reply = change(replyFor(record, 1));
    const result = client.addApproverReply(record, reply);

    expect(result.outcome).toBe('refused');
    expect(result).toEqual(fileReply(record, reply));
  });

  it.each([NOW, VALID_UNTIL + 1, NOW + 5_000])('assess at %s answers count under the configured request window', (now) => {
    const { client, seen } = rig();
    const record = cancellationWith([1, 2]);

    expect(client.assess(record, now)).toEqual(count(record, now, CLIENT_CONFIGURATION.requestWindow));
    expect(seen).toEqual([]);
  });
});

describe('complete', () => {
  it('builds the attempt request from the approval record, its proofs the preferred satisfying replies', () => {
    const { client, seen } = rig();
    const record = approvalWith([2, 0, 3]);
    const before = structuredClone(record);
    const request = client.complete(record, undefined, NOW) as AttemptRequest;

    expect(loweredMembers(request)).toEqual(expectedMembers(record));
    expect(typeof request.attemptId).toBe('bigint');
    expect(typeof request.validUntil).toBe('number');
    expect(typeof request.order.amount).toBe('bigint');

    const places = request.proofs.map((proof) => proof.place);

    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(new Set(places).size).toBe(places.length);

    for (const proof of request.proofs) {
      const reply = record.replies.find((one) => one.place === proof.place);

      expect(reply).toBeDefined();
      expect(loweredProof(proof)).toEqual(proofOfReply(reply as Reply));
    }

    expect(record).toEqual(before);
    expect(seen).toEqual([]);
  });

  it('builds the cancel request from the cancellation record, with no payload and no order', () => {
    const record = cancellationWith([3, 0, 1]);
    const request = rig().client.complete(record, undefined, NOW) as CancelRequest;

    expect(loweredMembers(request)).toEqual(expectedMembers(record));
    expect(request.proofs.map((proof) => proof.place)).toEqual([0, 1, 3]);
    expect('payload' in request).toBe(false);
    expect('order' in request).toBe(false);
  });

  it('honours a satisfying selection as given, leaving the other filed places out', () => {
    const record = approvalWith([0, 1, 2, 3]);
    const request = rig().client.complete(record, [3, 0, 1], NOW);

    expect(request.proofs.map((proof) => proof.place)).toEqual([0, 1, 3]);
  });

  it('refuses a passed window with a KitRefusalError carrying request.expired', () => {
    const thrown = thrownBy(() => rig().client.complete(approvalWith([0]), undefined, VALID_UNTIL + 1));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toContain('request.expired');
    expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
  });

  it('refuses an unsatisfied rule with a KitRefusalError carrying request.rule-unsatisfied', () => {
    const thrown = thrownBy(() => rig().client.complete(approvalWith([1]), undefined, NOW));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toContain('request.rule-unsatisfied');
  });

  it('refuses an empty record as an unsatisfied rule', () => {
    const thrown = thrownBy(() => rig().client.complete(cancellationWith([]), undefined, NOW));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toContain('request.rule-unsatisfied');
  });

  it('refuses a selection naming an unfilled place with a RangeError', () => {
    const thrown = thrownBy(() => rig().client.complete(approvalWith([0, 1]), [0, 2], NOW));

    expect(thrown).toBeInstanceOf(RangeError);
  });

  it('refuses a filled selection that does not satisfy the rule', () => {
    const thrown = thrownBy(() => rig().client.complete(approvalWith([0, 1, 2]), [1], NOW));

    expect(thrown).toBeInstanceOf(Error);
  });

  it('works under the version escape', () => {
    const { client } = rig(undefined, CLIENT_CONFIGURATION, { escaped: true });

    expect(client.complete(approvalWith([0, 1, 2]), undefined, NOW).proofs).toHaveLength(3);
    expect(client.getApproverRequests(approvalWith([]))).toHaveLength(4);
  });

  it('answers synchronously', () => {
    expect(rig().client.complete(approvalWith([0, 1, 2]), undefined, NOW)).not.toBeInstanceOf(Promise);
  });
});

describe('complete: the proofs are the merged ordering\'s', () => {
  it.each<[string, () => ReturnType<typeof approvalWith>, readonly number[] | undefined]>([
    ['an approval, preferred set', () => approvalWith([2, 0, 3]), undefined],
    ['an approval, a selection out of order', () => approvalWith([0, 1, 2, 3]), [3, 0, 1]],
    ['a cancellation, preferred set', () => cancellationWith([3, 1, 0]), undefined],
  ])('%s: exactly what order gives, methods checksummed', (_name, record, selection) => {
    const request = rig().client.complete(record(), selection, NOW);

    expect(request.proofs).toEqual(order(record(), selection, NOW));

    for (const proof of request.proofs) expect(proof.method).toBe(getAddress(proof.method));
  });
});

describe('complete judges the rule, not the record\'s shape: a malformed member is refused at the prepare', () => {
  it.each([
    ['not hex', 'not-hex'],
    ['an odd hex length', '0xabc'],
    ['a number', 7],
  ] as [string, unknown][])('a hand-edited payload (%s) completes, and prepareStartAttempt refuses it with a TypeError before any provider call', async (_name, payload) => {
    const filed = approvalWith([0, 1, 2]);
    const edited = { ...filed, request: { ...filed.request, account: ACCOUNT, action: ACTION, payload: payload as Hex } } as Gathering;
    const built = rig();
    const request = built.client.complete(edited, undefined, NOW) as AttemptRequest;

    expect(request.payload).toBe(payload);
    expect(request.proofs).toEqual(order(edited, undefined, NOW));
    expect(built.seen).toEqual([]);

    const thrown = await rejectionOf(built.client.prepareStartAttempt(request, HEADER.timestamp));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });
});
