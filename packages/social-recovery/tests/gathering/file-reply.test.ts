import { describe, expect, it } from 'vitest';
import { ADD_REFUSAL_CAUSES, fileReply, type AddResult, type Gathering, type Reply } from '../../src/index';
import {
  ACCOUNT,
  approvalGathering,
  cancellationGathering,
  deepFreeze,
  digestOf,
  OTHER_METHOD,
  replyFor,
  vectorExpected,
} from './support';

const APPROVAL_DIGEST = vectorExpected('approval-digest.json', 'normal')['digest'];
const CANCELLATION_DIGEST = vectorExpected('cancellation-digest.json', 'normal')['digest'];

/** Files a reply and fails the test unless it was filed. */
function filed(record: Gathering, reply: Reply) {
  const result = fileReply(record, reply);

  if (result.outcome !== 'filed') throw new Error(`refused: ${result.reason.cause}`);

  return result;
}

/** The refusal cause of a filing, or undefined when it was filed. */
const causeOf = (result: AddResult) => (result.outcome === 'refused' ? result.reason.cause : undefined);

describe('fileReply against the blessed digest rows', () => {
  it('the blessed members digest place 0 to the blessed approval and cancellation digests', () => {
    expect(digestOf(approvalGathering(), 0)).toBe(APPROVAL_DIGEST);
    expect(digestOf(cancellationGathering(), 0)).toBe(CANCELLATION_DIGEST);
  });

  it('files an approval reply carrying the blessed approval digest', () => {
    const result = filed(approvalGathering(), replyFor(approvalGathering(), 0, { digest: APPROVAL_DIGEST as `0x${string}` }));

    expect(result.gathering.replies).toHaveLength(1);
    expect(result.gathering.replies[0]?.digest).toBe(APPROVAL_DIGEST);
    expect(result.displaced).toBeUndefined();
  });

  it('files a cancellation reply carrying the blessed cancellation digest', () => {
    const record = cancellationGathering();
    const result = filed(record, replyFor(record, 0, { digest: CANCELLATION_DIGEST as `0x${string}` }));

    expect(result.gathering.replies.map((r) => r.digest)).toStrictEqual([CANCELLATION_DIGEST]);
  });

  it.each([
    ['the cancellation digest on an approval', () => approvalGathering(), CANCELLATION_DIGEST],
    ['the approval digest on a cancellation', () => cancellationGathering(), APPROVAL_DIGEST],
    ['the blessed digest at place 1', () => approvalGathering(), APPROVAL_DIGEST, 1],
    ['the blessed digest with its last nibble changed', () => approvalGathering(), `${(APPROVAL_DIGEST as string).slice(0, -1)}0`],
    ['the zero digest', () => approvalGathering(), `0x${'00'.repeat(32)}`],
    ['a short digest', () => approvalGathering(), '0x17498ba2'],
  ] as [string, () => Gathering, string, number?][])('refuses %s as digest-mismatch', (_label, make, digest, place = 0) => {
    const record = make();

    expect(causeOf(fileReply(record, replyFor(record, place, { digest: digest as `0x${string}` })))).toBe('digest-mismatch');
  });
});

describe('fileReply digest coverage', () => {
  it.each([
    ['the window', { validUntil: '1800000001' }],
    ['the setup nonce', { setupNonce: '8' }],
    ['the payload', { payload: '0xabcdee' }],
    ['the order amount', { order: { token: '0x4444444444444444444444444444444444444444', amount: '1', payee: '0x5555555555555555555555555555555555555555' } }],
    ['the body', { setupBody: '0x00' }],
    ['the digest version', { digestVersion: '2' }],
  ] as [string, Record<string, unknown>][])('a reply signed over another %s is refused as digest-mismatch', (_label, change) => {
    const record = approvalGathering();
    const foreign = { ...record, request: { ...record.request, ...change } } as Gathering;

    expect(causeOf(fileReply(record, replyFor(foreign, 0)))).toBe('digest-mismatch');
  });
});

describe('fileReply under the record\'s digest version', () => {
  const v1 = approvalGathering();
  const v2 = { ...v1, request: { ...v1.request, digestVersion: '2' } };

  it('the two versions digest the same place differently', () => {
    expect(digestOf(v2, 0)).not.toBe(digestOf(v1, 0));
  });

  it('a gathering at digest version 2 refuses a reply made under version 1 as digest-mismatch', () => {
    expect(causeOf(fileReply(v2, replyFor(v1, 0)))).toBe('digest-mismatch');
  });

  it('a gathering at digest version 2 files a reply made under version 2', () => {
    const reply = replyFor(v2, 0);

    expect(filed(v2, reply).gathering.replies).toStrictEqual([reply]);
  });
});

describe('fileReply refusals, one at a time', () => {
  const record = deepFreeze(approvalGathering());
  const good = deepFreeze(replyFor(record, 2));

  it('files the reply every refusal row starts from', () => {
    expect(filed(record, good).gathering.replies).toStrictEqual([good]);
  });

  const ROWS: [string, Partial<Reply> | Record<string, unknown>, (typeof ADD_REFUSAL_CAUSES)[number]][] = [
    ['another kind', { kind: 'recovery-proof-request' }, 'kind-or-version-unread'],
    ['another version', { version: 2 }, 'kind-or-version-unread'],
    ['version zero', { version: 0 }, 'kind-or-version-unread'],
    ['another chain id', { chainId: '2' }, 'binding-mismatch'],
    ['another manager', { manager: '0x6666666666666666666666666666666666666667' }, 'binding-mismatch'],
    ['another account', { account: '0x1111111111111111111111111111111111111112' }, 'binding-mismatch'],
    ['another action', { action: '0x2222222222222222222222222222222222222223' }, 'binding-mismatch'],
    ['another attempt id', { attemptId: '10' }, 'binding-mismatch'],
    ['another purpose', { purpose: 'cancellation' }, 'binding-mismatch'],
    ['another digest', { digest: `0x${'ab'.repeat(32)}` }, 'digest-mismatch'],
    ['a place past the map', { place: 4, digest: digestOf(record, 4) }, 'place-unknown'],
    ['another method', { method: OTHER_METHOD }, 'credential-mismatch'],
    ['another config', { config: '0xa3' }, 'credential-mismatch'],
    ['a config one byte longer', { config: '0x00a200' }, 'credential-mismatch'],
    ['another place\'s config', { config: '0x00a1' }, 'credential-mismatch'],
    ['another salt', { salt: `0x${'00'.repeat(31)}04` }, 'credential-mismatch'],
  ];

  it.each(ROWS)('%s is refused and the record comes back unchanged', (_label, change, cause) => {
    const snapshot = structuredClone(record);
    const result = fileReply(record, { ...good, ...change } as Reply);

    expect(result.outcome).toBe('refused');
    expect(causeOf(result)).toBe(cause);

    if (result.outcome === 'refused') expect(result.reason.kind).toBe('add-refusal');

    expect(result.gathering).toStrictEqual(snapshot);
    expect(record).toStrictEqual(snapshot);
  });

  it('the rows reach every refusal cause and no other', () => {
    expect([...new Set(ROWS.map((r) => r[2]))].sort()).toStrictEqual([...ADD_REFUSAL_CAUSES].sort());
  });

  it('a place unknown to the map is refused even when its digest is the one that place would carry', () => {
    expect(causeOf(fileReply(record, replyFor(record, 7)))).toBe('place-unknown');
  });

  it('refuses a gathering-shaped reply of a stranger to another account, never throwing', () => {
    const stranger = approvalGathering();
    const foreign = { ...stranger, request: { ...stranger.request, account: ACCOUNT.replace('1111', '9999') } } as Gathering;

    expect(() => fileReply(record, replyFor(foreign, 0))).not.toThrow();
    expect(causeOf(fileReply(record, replyFor(foreign, 0)))).toBe('binding-mismatch');
  });
});

describe('fileReply on a malformed proof or digest', () => {
  const record = approvalGathering();

  it.each([
    ['an undefined proof', { proof: undefined }],
    ['an odd-length proof', { proof: '0xabc' }],
    ['a proof without its prefix', { proof: 'deadbeef' }],
    ['a proof that is a number', { proof: 42 }],
    ['an undefined digest', { digest: undefined }],
    ['an odd-length digest', { digest: '0xabc' }],
    ['a digest that is not hex', { digest: '0xzz' }],
  ] as [string, Record<string, unknown>][])('throws a TypeError on %s rather than refusing', (_label, change) => {
    expect(() => fileReply(record, { ...replyFor(record, 0), ...change } as Reply)).toThrow(TypeError);
  });

  it('files an empty proof, which is hex of whole bytes', () => {
    expect(fileReply(record, replyFor(record, 0, { proof: '0x' })).outcome).toBe('filed');
  });
});

describe('fileReply replacement', () => {
  it('a second reply at one place replaces the first in place and names it as displaced', () => {
    const record = approvalGathering();
    const first = replyFor(record, 1, { proof: '0x01' });
    const other = replyFor(record, 3);
    const second = replyFor(record, 1, { proof: '0x02' });
    const afterFirst = filed(record, first);
    const afterOther = filed(afterFirst.gathering, other);
    const replaced = filed(afterOther.gathering, second);

    expect(afterFirst.displaced).toBeUndefined();
    expect(afterOther.displaced).toBeUndefined();
    expect(replaced.displaced).toStrictEqual(first);
    expect(replaced.gathering.replies).toStrictEqual([second, other]);
  });

  it('refiling the same reply names it as displaced and leaves one reply at the place', () => {
    const record = approvalGathering();
    const reply = replyFor(record, 0);
    const once = filed(record, reply);
    const twice = filed(once.gathering, reply);

    expect(twice.displaced).toStrictEqual(reply);
    expect(twice.gathering).toStrictEqual(once.gathering);
  });

  it('files a reply whose proof is garbage, since filing judges no proof', () => {
    const record = approvalGathering();

    expect(filed(record, replyFor(record, 0, { proof: '0x' })).gathering.replies).toHaveLength(1);
  });

  it('appends replies in filing order', () => {
    let record: Gathering = approvalGathering();

    for (const place of [3, 0, 2]) record = filed(record, replyFor(record, place)).gathering;

    expect(record.replies.map((r) => r.place)).toStrictEqual([3, 0, 2]);
  });
});
