import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fileReply,
  MethodsOrchestrator,
  requests,
  walletMethod,
  type ApproverRequest,
  type Gathering,
  type Reply,
} from '../../src/index';
import { approvalGathering, cancellationGathering, placeEntry } from '../gathering/support';
import { listSourceFiles, SRC_ROOT } from '../helpers/source';
import { KEY_ONE, SIGNER_ONE, addressWord, signDigest } from '../method-ecdsa/fixtures';
import { approval, callsTo, codecsFor, ctxOf, orchestratorOver, recordingMethod, REQUEST_METHOD } from './doubles';
import { expectedDigest } from './expected';

const ORCHESTRATOR_ROOT = join(SRC_ROOT, 'methods-orchestrator');

const CHAIN_MODULES = ['policy-manager', 'event-manager', 'recovery-client', 'setup-client', 'removed-key'];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the orchestrator reads no chain', () => {
  it('imports no chain-reading module and no provider interface', () => {
    const files = listSourceFiles(ORCHESTRATOR_ROOT);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');

      for (const source of imports) {
        for (const banned of CHAIN_MODULES) expect(source, file).not.toContain(banned);
      }

      expect(text, file).not.toMatch(/IProvider|eip712Domain|hashApproval|hashCancel|\bfetch\(/);
    }
  });

  it('answers every member with fetch stubbed to throw, leaving the request and both registries untouched', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('no network');
    });

    const request = approval();
    const before = structuredClone(request);
    const { method } = recordingMethod();
    const methods = new Map([[REQUEST_METHOD, method]]);
    const codecs = codecsFor(request.action);
    const methodsBefore = [...methods.entries()];
    const codecsBefore = [...codecs.entries()];
    const orchestrator = new MethodsOrchestrator(methods, codecs, ['none']);

    orchestrator.describeRequest(request);
    orchestrator.signingInput(request);
    await orchestrator.replyFrom(request, {}, undefined);
    await orchestrator.verify(request, request.place, '0x01');
    orchestrator.enrollInput(REQUEST_METHOD, {});
    await orchestrator.configFrom(REQUEST_METHOD, { kind: 'nothing-to-perform' }, undefined);

    expect(request).toStrictEqual(before);
    expect([...methods.entries()]).toStrictEqual(methodsBefore);
    expect([...codecs.entries()]).toStrictEqual(codecsBefore);
  });
});

describe('a request naming a foreign domain is served, and its proof verifies nowhere honest', () => {
  const honestGathering = (): Gathering =>
    approvalGathering([placeEntry(0, { method: REQUEST_METHOD, config: addressWord(SIGNER_ONE), credentialHoldsCode: false })]);

  const foreignCases: readonly [string, Record<string, unknown>][] = [
    ['another chain id', { chainId: '10' }],
    ['another manager', { manager: '0x6666666666666666666666666666666666666667' }],
    ['digest version 2', { digestVersion: '2' }],
  ];

  for (const [name, change] of foreignCases) {
    it(`${name}: typed data under that domain, another digest, rejected by the honest verify and refused by fileReply`, async () => {
      const honest = requests(honestGathering())[0]!;
      const foreign = { ...honest, ...change } as ApproverRequest;
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);

      orchestrator.signingInput(foreign);

      const ctx = ctxOf(calls, 'signingInput');

      expect(ctx.digest).toBe(expectedDigest(foreign));
      expect(ctx.digest).not.toBe(expectedDigest(honest));
      expect(ctx.typedData.domain.version).toBe(foreign.digestVersion);
      expect(ctx.typedData.domain.chainId).toBe(Number(foreign.chainId));

      const wallet = orchestratorOver([[REQUEST_METHOD, walletMethod()]]);
      const signature = await signDigest(ctx.digest, KEY_ONE);
      const reply = (await wallet.replyFrom(foreign, wallet.signingInput(foreign), { signature })) as Reply;

      expect(reply.kind).toBe('recovery-proof-reply');
      expect(await wallet.verify(foreign, foreign.place, reply.proof)).toBe('satisfied');
      expect(await wallet.verify(honest, honest.place, reply.proof)).toBe('rejected');

      const filed = fileReply(honestGathering(), reply);

      expect(filed.outcome).toBe('refused');
      expect(['digest-mismatch', 'binding-mismatch']).toContain(filed.outcome === 'refused' ? filed.reason.cause : 'filed');
    });
  }

  it('the honest request\'s reply files into the same gathering', async () => {
    const gathering = honestGathering();
    const honest = requests(gathering)[0]!;
    const wallet = orchestratorOver([[REQUEST_METHOD, walletMethod()]]);
    const { method, calls } = recordingMethod();

    orchestratorOver([[REQUEST_METHOD, method]]).signingInput(honest);

    const signature = await signDigest(ctxOf(calls, 'signingInput').digest, KEY_ONE);
    const reply = (await wallet.replyFrom(honest, wallet.signingInput(honest), { signature })) as Reply;

    expect(fileReply(gathering, reply).outcome).toBe('filed');
    expect(callsTo(calls, 'replyFrom')).toHaveLength(0);
  });

  it('a cancellation gathering\'s requests carry the cancellation digest for every place', () => {
    const gathering = cancellationGathering([0, 1, 2].map((place) => placeEntry(place, { method: REQUEST_METHOD })));

    for (const request of requests(gathering)) {
      const { method, calls } = recordingMethod();

      orchestratorOver([[REQUEST_METHOD, method]]).signingInput(request);

      expect(ctxOf(calls, 'signingInput').digest).toBe(expectedDigest(request));
      expect(ctxOf(calls, 'signingInput').typedData.primaryType).toBe('Cancellation');
    }
  });
});
