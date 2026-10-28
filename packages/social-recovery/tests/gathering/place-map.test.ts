import { encodeAbiParameters, getAddress, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { placeMap, seed, type Configuration, type GatheringPlace, type Hex, type SetupBody } from '../../src/index';
import {
  ACCOUNT,
  approvalGathering,
  cancellationGathering,
  credentialOf,
  DEFAULT_SALT_TEST_ABI,
  encodeBody,
  METHOD,
  OTHER_METHOD,
  TOKEN,
} from './support';

const LOWER_METHOD = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const EXPLICIT_SALT: Hex = `0x${'5a'.repeat(32)}`;

/** The default salt by viem's encoder: keccak256(abi.encode(account, place)). */
const defaultSaltOf = (place: number): Hex =>
  keccak256(encodeAbiParameters(DEFAULT_SALT_TEST_ABI, [ACCOUNT, BigInt(place)]));

/** A configuration of two clauses: place 0 with an explicit salt and a label, places 1 and 2 with default salts. */
const CONFIGURATION: Configuration = {
  wait: 172_800,
  ignoresPause: false,
  clauses: [
    { threshold: 1, credentials: [{ method: METHOD, config: '0x0a', salt: EXPLICIT_SALT, label: 'Ana' }] },
    {
      threshold: 1,
      credentials: [
        { method: LOWER_METHOD as `0x${string}`, config: '0x0b' },
        { method: OTHER_METHOD, config: '0x0c', label: 'Bo' },
      ],
    },
  ],
};

const BODY: SetupBody = {
  wait: 172_800,
  ignoresPause: false,
  clauses: [
    { threshold: 1, credentials: [credentialOf(METHOD, '0x0a', EXPLICIT_SALT)] },
    {
      threshold: 1,
      credentials: [credentialOf(getAddress(LOWER_METHOD), '0x0b', defaultSaltOf(1)), credentialOf(OTHER_METHOD, '0x0c', defaultSaltOf(2))],
    },
  ],
};

const STANDINGS = [
  { standing: 'not-stopped', stoppable: false, credentialHoldsCode: false },
  { standing: 'stopped', stoppable: true, credentialHoldsCode: true },
  { standing: 'not-stopped', stoppable: true, credentialHoldsCode: false },
] as const;

describe('placeMap', () => {
  it('numbers every credential by its flat index in body order and carries what each place needs', () => {
    expect(placeMap(BODY, CONFIGURATION, STANDINGS, ACCOUNT)).toStrictEqual([
      { place: 0, method: METHOD, config: '0x0a', salt: EXPLICIT_SALT, label: 'Ana', ...STANDINGS[0] },
      { place: 1, method: getAddress(LOWER_METHOD), config: '0x0b', salt: defaultSaltOf(1), ...STANDINGS[1] },
      { place: 2, method: OTHER_METHOD, config: '0x0c', salt: defaultSaltOf(2), label: 'Bo', ...STANDINGS[2] },
    ]);
  });

  it('gives no label key to a place the integrator did not label', () => {
    expect(placeMap(BODY, CONFIGURATION, STANDINGS, ACCOUNT)[1]).not.toHaveProperty('label');
  });

  it('refuses a configuration whose credential hash differs from the body\'s', () => {
    const swapped = { ...CONFIGURATION, clauses: [CONFIGURATION.clauses[0]!, { ...CONFIGURATION.clauses[1]!, credentials: [...CONFIGURATION.clauses[1]!.credentials].reverse() }] };

    expect(() => placeMap(BODY, swapped, STANDINGS, ACCOUNT)).toThrow();
  });

  it('refuses a default salt taken for another account', () => {
    expect(() => placeMap(BODY, CONFIGURATION, STANDINGS, TOKEN)).toThrow();
  });

  it('refuses a configuration with a clause missing or a credential missing', () => {
    expect(() => placeMap(BODY, { ...CONFIGURATION, clauses: [CONFIGURATION.clauses[0]!] }, STANDINGS, ACCOUNT)).toThrow();
    expect(() =>
      placeMap(BODY, { ...CONFIGURATION, clauses: [CONFIGURATION.clauses[0]!, { threshold: 1, credentials: [CONFIGURATION.clauses[1]!.credentials[0]!] }] }, STANDINGS, ACCOUNT),
    ).toThrow();
  });

  it('refuses standings that miss a place', () => {
    expect(() => placeMap(BODY, CONFIGURATION, STANDINGS.slice(0, 2), ACCOUNT)).toThrow();
  });

  it('maps a body with no clauses to an empty map', () => {
    expect(placeMap({ wait: 0, ignoresPause: true, clauses: [] }, { wait: 0, ignoresPause: true, clauses: [] }, [], ACCOUNT)).toStrictEqual([]);
  });
});

describe('seed', () => {
  const places: GatheringPlace[] = placeMap(BODY, CONFIGURATION, STANDINGS, ACCOUNT);
  const body = encodeBody(BODY.clauses, BODY.wait, BODY.ignoresPause);

  it('starts an approval record with no replies at this build\'s version', () => {
    const { purpose, request } = approvalGathering(places, body);
    const record = seed({ purpose, request }, places);

    expect(record).toStrictEqual({ kind: 'gathering', version: 1, purpose, request, places, replies: [] });
  });

  it('starts a cancellation record carrying consumableAfter and no payload or order', () => {
    const { purpose, request } = cancellationGathering(places, body, 1_799_999_999);
    const record = seed({ purpose, request }, places);

    expect(record).toStrictEqual({ kind: 'gathering', version: 1, purpose, request, places, replies: [] });
    expect(record.request).not.toHaveProperty('payload');
  });

  it('checksums the addresses of the request block', () => {
    const { purpose, request } = approvalGathering(places, body);
    const lower = {
      ...request,
      manager: LOWER_METHOD as Hex,
      account: LOWER_METHOD.toUpperCase().replace('0X', '0x') as Hex,
      action: LOWER_METHOD as Hex,
      order: { ...request.order, token: LOWER_METHOD as Hex, payee: LOWER_METHOD as Hex },
    };
    const checksummed = getAddress(LOWER_METHOD);

    expect(seed({ purpose, request: lower }, places).request).toStrictEqual({
      ...request,
      manager: checksummed,
      account: checksummed,
      action: checksummed,
      order: { ...request.order, token: checksummed, payee: checksummed },
    });
  });

  it('refuses a place map that does not number the body\'s credentials', () => {
    const { purpose, request } = approvalGathering(places, body);

    expect(() => seed({ purpose, request }, places.slice(1))).toThrow();
    expect(() => seed({ purpose, request }, [places[1]!, places[0]!, places[2]!])).toThrow();
  });
});
