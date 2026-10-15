import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { digestFor } from '../../src/gathering/edge';
import { fileReply, requests, walletMethod, type Hex, type Reply } from '../../src/index';
import { anyBytes, TIMEOUT } from '../formats/arbitraries';
import { addressWord, KEY_ONE, SIGNER_ONE, signDigest } from '../method-ecdsa/fixtures';
import { gatheringArb, METHODS, runAsync, SIGNING_RUNS } from './arbitraries';
import { orchestratorOver, recordingMethod } from './doubles';

describe('a reply the orchestrator builds files into the gathering its request came from', () => {
  it('for every place, with a method answering arbitrary proof bytes', async () => {
    await runAsync(
      fc.asyncProperty(gatheringArb, anyBytes, async (record, proof: Hex) => {
        const { method } = recordingMethod('none', { replyFrom: async () => proof });
        const orchestrator = orchestratorOver(METHODS.map((address) => [address, method] as const));
        let gathering = record;

        for (const request of requests(record)) {
          const reply = (await orchestrator.replyFrom(request, {}, undefined)) as Reply;
          const filed = fileReply(gathering, reply);

          expect(filed.outcome).toBe('filed');
          gathering = filed.gathering;

          const kept = gathering.replies.find((entry) => entry.place === request.place);

          expect(kept?.digest).toBe(digestFor(record, request.place));
          expect(kept?.proof).toBe(proof);
        }

        expect(gathering.replies).toHaveLength(record.places.length);
      }),
    );
  }, TIMEOUT);

  it('for every place, with the wallet method and a real signing key', async () => {
    await runAsync(
      fc.asyncProperty(gatheringArb, async (record) => {
        const places = record.places.map((entry) => ({ ...entry, config: addressWord(SIGNER_ONE), credentialHoldsCode: false }));
        const signed = { ...record, places };
        const orchestrator = orchestratorOver(METHODS.map((address) => [address, walletMethod()] as const), ['none']);

        for (const request of requests(signed)) {
          const signature = await signDigest(digestFor(signed, request.place), KEY_ONE);
          const reply = (await orchestrator.replyFrom(request, orchestrator.signingInput(request), { signature })) as Reply;

          expect(fileReply(signed, reply).outcome).toBe('filed');
          expect(await orchestrator.verify(request, request.place, reply.proof)).toBe('satisfied');
        }
      }),
      SIGNING_RUNS,
    );
  }, TIMEOUT);
});
