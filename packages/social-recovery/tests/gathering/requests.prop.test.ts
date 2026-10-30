import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { requests, type GatheringPlace, type Hex } from '../../src/index';
import { run, TIMEOUT } from '../formats/arbitraries';
import { approvalGathering, cancellationGathering, encodeBody, placeEntry } from './support';

const tagged = (tag: number, bytes: Uint8Array): Hex => `0x${tag.toString(16).padStart(2, '0')}${'ee'.repeat(4)}${Buffer.from(bytes).toString('hex')}`;

/** Up to eight places, each with its own config and salt, tagged by place so no two collide. */
const placesArb = fc
  .array(fc.record({ config: fc.uint8Array({ maxLength: 40 }), salt: fc.uint8Array({ minLength: 27, maxLength: 27 }), code: fc.boolean() }), {
    maxLength: 8,
  })
  .map((rows): GatheringPlace[] =>
    rows.map((row, place) => placeEntry(place, { config: tagged(place, row.config), salt: tagged(place, row.salt), credentialHoldsCode: row.code })),
  );

describe('requests', () => {
  it('each request carries its own place\'s credential and never another place\'s config or salt', () => {
    run(
      fc.property(placesArb, fc.boolean(), (places, approval) => {
        const body = encodeBody([{ threshold: 1, credentials: places.map((_p, i) => `0x${i.toString(16).padStart(64, '0')}` as Hex) }]);
        const record = approval ? approvalGathering(places, body) : cancellationGathering(places, body);
        const out = requests(record);

        expect(out.map((r) => r.place)).toStrictEqual(places.map((p) => p.place));

        for (const request of out) {
          const own = places[request.place]!;
          const text = JSON.stringify(request);

          expect([request.method, request.config, request.salt, request.credentialHoldsCode]).toStrictEqual([
            own.method,
            own.config,
            own.salt,
            own.credentialHoldsCode,
          ]);

          for (const other of places.filter((p) => p.place !== request.place)) {
            expect(text).not.toContain(other.config.slice(2));
            expect(text).not.toContain(other.salt.slice(2));
          }

          expect(text).not.toContain('label');
        }
      }),
    );
  }, TIMEOUT);
});
