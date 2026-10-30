import { beforeAll, describe, expect, it } from 'vitest';
import {
  submissionFindings,
  validateRequest,
  validateSetup,
  windowFindings,
  type AttemptRequest,
  type Hex,
  serializeConfiguration,
  type RequestValidationContext,
} from '../../src/index';
import { getAddress } from 'viem';
import { serializedConfigurationSize } from '../../src/encryption/serialize';
import { referenceSize } from '../encryption/reference';
import { loadRecords, type RecordContext } from '../helpers/records';
import { oracleBody, oracleCommitment } from '../formats/support';
import {
  ACCOUNT,
  ACTION,
  BODY,
  CONFIGURATION,
  DRAFT,
  ECDSA,
  OPENING,
  PASSKEY,
  REQUEST_CONTEXT,
  SALT,
  SETUP_CONTEXT,
  STATE,
  T,
  findingsOf,
  methodReads,
  withClauses,
} from './fixtures';

const proofAt = (place: number) => ({ ...OPENING.proofs[0]!, place });

const errorCodes = (request: AttemptRequest, context: RequestValidationContext = REQUEST_CONTEXT): string[] =>
  validateRequest(request, context).errors.map((finding) => finding.code);

describe('request.expired from the pinned block', () => {
  it('raises request.expired when the block is one second past validUntil though the moment lags, naming both clocks', () => {
    const facts = { validUntil: T + 100, blockTimestamp: T + 101 };

    expect(submissionFindings(facts, T + 50).errors).toEqual([
      { code: 'request.expired', subject: 'request', values: { validUntil: T + 100, moment: T + 50, blockTimestamp: T + 101 } },
    ]);
    expect(windowFindings(facts, T + 50, CONFIGURATION.requestWindow).errors.map((finding) => finding.code)).toEqual(['request.expired']);
  });

  it('still raises request.expired when the moment alone is past validUntil', () => {
    expect(submissionFindings({ validUntil: T + 100, blockTimestamp: T + 90 }, T + 101).errors).toEqual([
      { code: 'request.expired', subject: 'request', values: { validUntil: T + 100, moment: T + 101, blockTimestamp: T + 90 } },
    ]);
  });

  it('does not raise request.expired with the block and the moment both exactly at validUntil', () => {
    expect(submissionFindings({ validUntil: T + 100, blockTimestamp: T + 100 }, T + 100).errors).toEqual([]);
  });

  it('validateRequest raises it from a block past the window with the caller still inside it', () => {
    const context = { ...REQUEST_CONTEXT, block: { ...REQUEST_CONTEXT.block, timestamp: T + 86_401 }, moment: T + 86_000 };

    expect(findingsOf(validateRequest(OPENING, context), 'request.expired')).toEqual([
      { code: 'request.expired', subject: 'request', values: { validUntil: T + 86_400, moment: T + 86_000, blockTimestamp: T + 86_401 } },
    ]);
  });
});

describe('proof.place-out-of-range', () => {
  it('raises one error per proof past the three-credential body, the rule count unaffected', () => {
    const result = validateRequest({ ...OPENING, proofs: [proofAt(0), proofAt(1), proofAt(5)] }, REQUEST_CONTEXT);

    expect(result.errors).toEqual([{ code: 'proof.place-out-of-range', subject: 'request', values: { place: 5, count: 3 } }]);
  });

  it('counts nothing for an out-of-range place toward the rule', () => {
    expect(validateRequest({ ...OPENING, proofs: [proofAt(0), proofAt(3)] }, REQUEST_CONTEXT).errors).toEqual([
      { code: 'proof.place-out-of-range', subject: 'request', values: { place: 3, count: 3 } },
      { code: 'request.rule-unsatisfied', subject: 'request', values: { clause: 0, threshold: 2, filled: 1 } },
    ]);
  });

  it('does not raise it for the last place in range', () => {
    expect(errorCodes({ ...OPENING, proofs: [proofAt(0), proofAt(2)] })).toEqual([]);
  });

  it('judges every place as out of range over an empty rule', () => {
    const setupBody = oracleBody({ ...BODY, clauses: [] });
    const context = { ...REQUEST_CONTEXT, state: { ...STATE, setupCommitment: oracleCommitment(ACCOUNT, ACTION, 3n, setupBody) } };

    expect(findingsOf(validateRequest({ ...OPENING, setupBody }, context), 'proof.place-out-of-range').map((finding) => finding.values)).toEqual([
      { place: 0, count: 0 },
      { place: 1, count: 0 },
    ]);
  });

  it('is not judged when the body does not decode', () => {
    expect(errorCodes({ ...OPENING, setupBody: '0x1234', proofs: [proofAt(9)] })).toEqual(['request.body-mismatch']);
  });
});

describe('malformed contexts and proofs', () => {
  it('throws a TypeError for one module read twice in the setup context, under either spelling', () => {
    const twice = { ...SETUP_CONTEXT, methods: [...SETUP_CONTEXT.methods, methodReads(ECDSA, 'primary')] };
    const lower: Hex = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const spelled = {
      ...SETUP_CONTEXT,
      methods: [...SETUP_CONTEXT.methods, methodReads(lower, 'primary'), methodReads(getAddress(lower), 'primary')],
    };

    expect(() => validateSetup(DRAFT, twice)).toThrow(TypeError);
    expect(() => validateSetup(DRAFT, spelled)).toThrow(TypeError);
  });

  it('throws a TypeError for one method priced twice in the cost table', () => {
    const costs = [{ method: ECDSA, gas: 1 }, { method: PASSKEY, gas: 1 }, { method: ECDSA, gas: 2 }];

    expect(() => validateSetup(DRAFT, { ...SETUP_CONTEXT, costs })).toThrow(TypeError);
    expect(() => validateSetup(DRAFT, { ...SETUP_CONTEXT, costs: costs.slice(0, 2) })).not.toThrow();
  });

  it('throws a TypeError for one method whose pause was read twice', () => {
    const paused = [...REQUEST_CONTEXT.paused, { method: ECDSA, paused: { answered: true as const, value: true } }];

    expect(() => validateRequest(OPENING, { ...REQUEST_CONTEXT, paused })).toThrow(TypeError);
  });

  it('throws a TypeError for a proof with no salt or a 31-byte salt, and accepts a 32-byte one', () => {
    const saltless = { ...OPENING.proofs[0]!, salt: undefined };
    const short = { ...OPENING.proofs[0]!, salt: `0x${'a5'.repeat(31)}` as Hex };

    expect(() => validateRequest({ ...OPENING, proofs: [saltless as never, OPENING.proofs[1]!] }, REQUEST_CONTEXT)).toThrow(TypeError);
    expect(() => validateRequest({ ...OPENING, proofs: [short, OPENING.proofs[1]!] }, REQUEST_CONTEXT)).toThrow(TypeError);
    expect(() => validateRequest({ ...OPENING, proofs: [{ ...short, salt: SALT }, OPENING.proofs[1]!] }, REQUEST_CONTEXT)).not.toThrow();
  });
});

describe('the backup size measurement', () => {
  const wide = (n: number): Hex => `0x${n.toString(16).padStart(192, '0')}`;
  const widest = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ threshold: 1, credentials: [{ method: PASSKEY, config: wide(n + 1), salt: SALT }] }));

  it('equals the serializer\'s byte length and the documented size on mixed fixtures', () => {
    const configurations = [
      { wait: 172_800, ignoresPause: false, clauses: DRAFT.clauses },
      { wait: 0, ignoresPause: true, clauses: [] },
      { wait: 1, ignoresPause: false, clauses: [...widest(3), { threshold: 0, credentials: [{ method: ECDSA, config: '0x' as Hex }] }] },
      { wait: 1, ignoresPause: false, clauses: widest(16) },
    ];

    for (const configuration of configurations) {
      const length = (serializeConfiguration(configuration).length - 2) / 2;

      expect(serializedConfigurationSize(configuration)).toBe(length);
      expect(serializedConfigurationSize(configuration)).toBe(referenceSize(configuration));
    }
  });

  it('measures a config past the uint16 length field rather than refusing it', () => {
    const configuration = { wait: 0, ignoresPause: false, clauses: [{ threshold: 1, credentials: [{ method: PASSKEY, config: `0x${'01'.repeat(65_536)}` as Hex }] }] };

    expect(serializedConfigurationSize(configuration)).toBe(9 + 3 + 23 + 65_536);
  });

  it('keeps the backup.too-wide boundary between sixteen and seventeen widest credentials', () => {
    expect(findingsOf(validateSetup(withClauses(widest(16)), SETUP_CONTEXT), 'backup.too-wide')).toEqual([]);
    expect(findingsOf(validateSetup(withClauses(widest(17)), SETUP_CONTEXT), 'backup.too-wide').map((finding) => finding.values)).toEqual([
      { plaintextSize: 2_627, paddingSize: 2_473 },
    ]);
  });
});

describe('the validation surface', () => {
  let context: RecordContext;

  beforeAll(() => {
    context = loadRecords();
  });

  it('keeps CheckedRequest and PlacedCredential off the core entry, beside the two public context records', () => {
    expect(context.entry.has('CheckedRequest')).toBe(false);
    expect(context.entry.has('PlacedCredential')).toBe(false);
    expect(context.entry.has('SetupValidationContext')).toBe(true);
    expect(context.entry.has('RequestValidationContext')).toBe(true);
  }, 60_000);

  it('exports the shared rule counter', async () => {
    const entry = await import('../../src/index');

    expect([typeof entry.clausePlaces, typeof entry.filledPerClause, typeof entry.satisfies]).toEqual(['function', 'function', 'function']);
  });
});
