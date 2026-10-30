import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { digestFor } from '../../src/gathering/edge';
import { fileReply, requests, type ApproverRequest, type Reply } from '../../src/index';
import { address, safeInt, TIMEOUT } from '../formats/arbitraries';
import { gatheringArb, METHODS, runAsync } from './arbitraries';
import { ctxOf, orchestratorOver, recordingMethod } from './doubles';

const change = fc.oneof(
  safeInt(1, Number.MAX_SAFE_INTEGER).map((chainId) => ({ member: 'chainId' as const, value: String(chainId) })),
  address.map((manager) => ({ member: 'manager' as const, value: manager })),
  safeInt(0, Number.MAX_SAFE_INTEGER).map((version) => ({ member: 'digestVersion' as const, value: String(version) })),
);

const sameValue = (member: 'chainId' | 'manager' | 'digestVersion', left: string, right: string): boolean =>
  member === 'manager' ? left.toLowerCase() === right.toLowerCase() : BigInt(left) === BigInt(right);

describe('a request naming a foreign domain', () => {
  it('gets another digest, and its reply is refused by the honest gathering', async () => {
    await runAsync(
      fc.asyncProperty(gatheringArb, change, fc.nat(), async (record, { member, value }, pick) => {
        const all = requests(record);
        const honest = all[pick % all.length]!;

        fc.pre(!sameValue(member, honest[member], value));

        const foreign = { ...honest, [member]: value } as ApproverRequest;
        const { method, calls } = recordingMethod();
        const orchestrator = orchestratorOver(METHODS.map((entry) => [entry, method] as const));

        orchestrator.signingInput(foreign);

        expect(ctxOf(calls, 'signingInput').digest).not.toBe(digestFor(record, honest.place));

        const reply = (await orchestrator.replyFrom(foreign, {}, undefined)) as Reply;
        const filed = fileReply(record, reply);

        expect(filed.outcome).toBe('refused');
      }),
    );
  }, TIMEOUT);
});
