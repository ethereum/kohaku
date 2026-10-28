import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seed, type GatheringMembers } from '../../src/index';
import { chain, configuration, GUARDIANS, guardianOf, indexOf, lowered, METHODS, worldOf } from './arbitraries';
import { ACCOUNT, callsTo, CLIENT_CONFIGURATION, HANDOVER, METHOD_ECDSA, ORDER, referenceBody, referenceEncodeBody, rig, runAsync, TIMEOUT } from './doubles';

describe('the init record over arbitrary configurations and readings', () => {
  it(
    'passes seed, matches the body, and maps every reading to its place',
    async () => {
      await runAsync(
        fc.asyncProperty(configuration, chain, fc.boolean(), async (config, facts, cancelling) => {
          const built = rig(worldOf(config, facts, cancelling), { ...CLIENT_CONFIGURATION, cancelWindow: 2 ** 30 });
          const record = cancelling
            ? await built.client.initCancelGathering(config, { window: facts.window })
            : await built.client.initRecoveryGathering(config, HANDOVER, ORDER, { window: facts.window });
          const flat = config.clauses.flatMap((clause) => clause.credentials);

          expect(seed({ purpose: record.purpose, request: record.request } as GatheringMembers, record.places)).toEqual(record);
          expect(record.request.setupBody.toLowerCase()).toBe(referenceEncodeBody(referenceBody(config, ACCOUNT)).toLowerCase());
          expect(BigInt(record.request.validUntil) - BigInt(record.request.block.timestamp)).toBe(BigInt(facts.window));
          expect(record.places).toHaveLength(flat.length);

          record.places.forEach((entry, index) => {
            const method = indexOf(METHODS, entry.method);

            expect(entry.label).toBe(flat[index]?.label);
            expect(entry.standing === 'stopped').toBe(facts.paused[method] === true);
            expect(entry.stoppable).toBe(facts.holders[method] === true);
            expect(entry.credentialHoldsCode).toBe(method === 0 && facts.code[indexOf(GUARDIANS, guardianOf(entry.config))] === true);
          });

          const distinctMethods = new Set(lowered(flat.map((one) => one.method)));
          const distinctGuardians = new Set(flat.filter((one) => one.method === METHOD_ECDSA).map((one) => guardianOf(one.config).toLowerCase()));

          expect(new Set(lowered(callsTo(built.seen, 'manager', 'paused').map((one) => one.args[0])))).toEqual(distinctMethods);
          expect(callsTo(built.seen, 'manager', 'paused')).toHaveLength(distinctMethods.size);
          expect(callsTo(built.seen, 'manager', 'trustedParties')).toHaveLength(distinctMethods.size);
          expect(new Set(lowered(callsTo(built.seen, 'provider', 'code').map((one) => one.args[0])))).toEqual(distinctGuardians);
          expect(callsTo(built.seen, 'provider', 'code')).toHaveLength(distinctGuardians.size);
        }),
      );
    },
    TIMEOUT,
  );
});
