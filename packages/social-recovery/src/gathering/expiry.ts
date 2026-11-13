import { assertDependency, assertObject, sameAddress } from '../formats/guards';
import type { Address, Gathering, IRecoveryMethod, Moment, ProofPlace, Reply, ValidationError, ValidationResult, ValidationWarning } from '../interfaces';
import type { MethodRegistry } from '../types';
import type { FiledPlace } from '../types/gathering';
import { filedPlaces, windowFactsOf } from './edge';

/** The registered implementation serving the method, if any. */
function implementationOf(methods: MethodRegistry, method: Address): IRecoveryMethod | undefined {
  for (const key of methods.keys()) {
    if (sameAddress(key, method)) return methods.get(key);
  }

  return undefined;
}

/**
 * The reply's expiry from the implementation's codec, undefined where the codec declares no `proofExpiry`, a decode or the call throws, or it answers
 * no bigint; `TypeError` on a codec that is not an object or that declares a `proofExpiry` without it and both decodes being functions.
 */
function expiryOf(implementation: IRecoveryMethod, reply: Reply): bigint | undefined {
  const { codec } = implementation;
  const name = `methods.get(${reply.method}).codec`;

  assertObject(codec, name);

  if (codec.proofExpiry === undefined) return undefined;

  assertDependency(codec, ['decodeConfig', 'decodeProof', 'proofExpiry'], name);

  try {
    codec.decodeConfig(reply.config);
    codec.decodeProof(reply.proof);

    const expiresAt: unknown = codec.proofExpiry(reply.config, reply.proof);

    return typeof expiresAt === 'bigint' ? expiresAt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Each filed place's proof expiry, in seconds, by place, from the codec of the implementation registered for its reply's method; a place is left out
 * where none is registered or its codec answers no expiry, since the gathering does not judge proofs.
 */
export function proofExpiries(record: Gathering, methods: MethodRegistry): ReadonlyMap<number, bigint> {
  const expiries = new Map<number, bigint>();

  for (const [place, { reply }] of filedPlaces(record)) {
    const implementation = implementationOf(methods, reply.method);
    const expiresAt = implementation === undefined ? undefined : expiryOf(implementation, reply);

    if (expiresAt !== undefined) expiries.set(place, expiresAt);
  }

  return expiries;
}

/**
 * `proof.expired` for each place whose expiry `now` has reached, and `proof.expiring` for each place whose expiry lies after `now` and at or before
 * `validUntil`, each in place order. A proof dated after `now` fails on chain as well, and no finding names it.
 */
export function expiryFindings(expiries: ReadonlyMap<number, bigint>, validUntil: number, now: Moment): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const moment = BigInt(now);
  const deadline = BigInt(validUntil);

  for (const place of [...expiries.keys()].sort((left, right) => left - right)) {
    const expiresAt = expiries.get(place) as bigint;

    if (moment >= expiresAt) {
      errors.push({ code: 'proof.expired', subject: 'request', values: { place, expiresAt, moment: now } });
    } else if (expiresAt <= deadline) {
      warnings.push({ code: 'proof.expiring', subject: 'request', values: { place, expiresAt, validUntil } });
    }
  }

  return { errors, warnings };
}

/** The expiry findings of every filed place at `now`, against the record's `validUntil`. */
export function filedExpiryFindings(record: Gathering, methods: MethodRegistry, now: Moment): ValidationResult {
  return expiryFindings(proofExpiries(record, methods), windowFactsOf(record).validUntil, now);
}

/** The `proof.expired` findings of the places a completion chose, in place order; no other place's codec is asked. */
export function expiredChoices(record: Gathering, methods: MethodRegistry, proofs: readonly ProofPlace[], now: Moment): readonly ValidationError[] {
  const filed = filedPlaces(record);
  const chosen = new Map<number, bigint>();

  for (const { place } of proofs) {
    const { reply } = filed.get(place) as FiledPlace;
    const implementation = implementationOf(methods, reply.method);
    const expiresAt = implementation === undefined ? undefined : expiryOf(implementation, reply);

    if (expiresAt !== undefined) chosen.set(place, expiresAt);
  }

  return expiryFindings(chosen, windowFactsOf(record).validUntil, now).errors;
}
