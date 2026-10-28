import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Address, ApproverRequest, Hex } from '../../src/index';
import { readVector } from '../kat/read-vector';
import { approval, callsTo, cancellation, ctxOf, orchestratorOver, recordingMethod, REQUEST_METHOD } from './doubles';
import { expectedDigest, hashOf } from './expected';

type DigestRow = {
  readonly input: {
    readonly domain: { readonly version: string; readonly chainId: number; readonly verifyingContract: Address };
    readonly message: Record<string, unknown> & { readonly place: string };
  };
  readonly expected: { readonly digest: Hex };
};

const normalRow = (file: string): DigestRow => {
  const row = readVector(file).vectors.find((entry) => entry['id'] === 'normal');

  if (row === undefined) throw new Error(`${file} has no normal row`);

  return row as unknown as DigestRow;
};

/** A request whose members are the blessed digest row's domain and message, one credential of no consequence. */
function requestFromRow(row: DigestRow, purpose: 'approval' | 'cancellation'): ApproverRequest {
  const { domain, message } = row.input;
  const shared = {
    kind: 'recovery-proof-request',
    version: 1,
    chainId: String(domain.chainId),
    manager: domain.verifyingContract,
    digestVersion: domain.version,
    account: message['account'],
    action: message['action'],
    attemptId: message['attemptId'],
    setupNonce: message['setupNonce'],
    setupBodyHash: message['setupBodyHash'],
    validUntil: message['validUntil'],
    place: Number(message.place),
    method: REQUEST_METHOD,
    config: '0x1234',
    salt: `0x${'5a'.repeat(32)}`,
    credentialHoldsCode: false,
  };

  if (purpose === 'cancellation') return { ...shared, purpose } as ApproverRequest;

  return { ...shared, purpose, payload: message['payload'], order: message['order'] } as ApproverRequest;
}

describe('the ctx the orchestrator hands a method is built from the request alone', () => {
  it('reaches signingInput, replyFrom, verify and describe with the request\'s place, digest and typed data', async () => {
    for (const request of [approval(), cancellation()]) {
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);

      orchestrator.signingInput(request);
      await orchestrator.replyFrom(request, {}, undefined);
      await orchestrator.verify(request, request.place, '0x01');
      orchestrator.describeRequest(request);

      for (const member of ['signingInput', 'replyFrom', 'verify', 'describe']) {
        const ctx = ctxOf(calls, member);

        expect(ctx.place).toBe(request.place);
        expect(ctx.digest).toBe(expectedDigest(request));
        expect(ctx.typedData.primaryType).toBe(request.purpose === 'approval' ? 'Approval' : 'Cancellation');
        expect(ctx.typedData.domain).toStrictEqual({
          name: 'PolicyManager',
          version: request.digestVersion,
          chainId: Number(request.chainId),
          verifyingContract: getAddress(request.manager),
        });
        expect(hashOf(ctx.typedData)).toBe(ctx.digest);
      }
    }
  });

  it('replays the blessed approval and cancellation digest rows', () => {
    for (const [file, purpose] of [['approval-digest.json', 'approval'], ['cancellation-digest.json', 'cancellation']] as const) {
      const row = normalRow(file);
      const { method, calls } = recordingMethod();

      orchestratorOver([[REQUEST_METHOD, method]]).signingInput(requestFromRow(row, purpose));

      expect(ctxOf(calls, 'signingInput').digest).toBe(row.expected.digest);
    }
  });

  it('hands a frozen copy of the request, never the caller\'s object', () => {
    const request = approval();
    const { method, calls } = recordingMethod();

    orchestratorOver([[REQUEST_METHOD, method]]).signingInput(request);

    const seen = ctxOf(calls, 'signingInput').request;

    expect(seen).not.toBe(request);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(seen).toStrictEqual(request);
  });

  it('keeps a member the caller changes after signingInput out of the copy the method holds', () => {
    const request = { ...approval() } as { -readonly [K in keyof ApproverRequest]: ApproverRequest[K] };
    const { method, calls } = recordingMethod();

    orchestratorOver([[REQUEST_METHOD, method]]).signingInput(request as ApproverRequest);
    request.config = '0xdead';
    request.place = 3;

    const seen = ctxOf(calls, 'signingInput');

    expect(seen.request.config).toBe('0x1234');
    expect(seen.request.place).toBe(seen.place);
  });

  it('reads each member once, so a getter cannot answer the digest one value and the method another', () => {
    const base = approval();
    let reads = 0;
    const request = { ...base } as Record<string, unknown>;

    Object.defineProperty(request, 'attemptId', {
      enumerable: true,
      get: () => {
        reads += 1;

        return reads === 1 ? base.attemptId : '424242';
      },
    });

    const { method, calls } = recordingMethod();

    orchestratorOver([[REQUEST_METHOD, method]]).signingInput(request as unknown as ApproverRequest);

    const ctx = ctxOf(calls, 'signingInput');

    expect(String(ctx.typedData.message.attemptId)).toBe(ctx.request.attemptId);
    expect(ctx.digest).toBe(expectedDigest(ctx.request));
  });

  it('drops members the caller added that no request carries', () => {
    const request = { ...approval(), label: 'Ana', secret: { key: 1 } } as unknown as ApproverRequest;
    const { method, calls } = recordingMethod();

    orchestratorOver([[REQUEST_METHOD, method]]).signingInput(request);

    const seen = ctxOf(calls, 'signingInput').request as unknown as Record<string, unknown>;

    expect(seen).not.toHaveProperty('label');
    expect(seen).not.toHaveProperty('secret');
  });

  it('checksums the addresses and lower-cases the hex of the copy it hands the method', () => {
    const base = approval();
    const request = approval({
      manager: '0xabcdef0123456789abcdef0123456789abcdef01',
      config: '0xABCD',
      salt: base.salt.toUpperCase().replace('0X', '0x'),
    });
    const { method, calls } = recordingMethod();

    orchestratorOver([[REQUEST_METHOD, method]]).signingInput(request);

    const seen = ctxOf(calls, 'signingInput').request;

    expect(seen.manager).toBe(getAddress('0xabcdef0123456789abcdef0123456789abcdef01'));
    expect(seen.config).toBe('0xabcd');
    expect(seen.salt).toBe(base.salt.toLowerCase());
  });

  it('calls no other method member than the one asked', async () => {
    const request = approval();
    const { method, calls } = recordingMethod();
    const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);

    orchestrator.signingInput(request);
    await orchestrator.replyFrom(request, {}, undefined);

    expect(calls.map((call) => call.member)).toStrictEqual(['signingInput', 'replyFrom']);
    expect(callsTo(calls, 'modules')).toHaveLength(0);
  });
});
