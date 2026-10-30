import { FORMATS_ZERO_ADDRESS, RECOVERY_CLIENT_NO_CODE, RECOVERY_CLIENT_UNANSWERED_READ_MESSAGE } from '../constants';
import { assertBool, assertBytes, assertObject, lowerHex, normalizeAddress, sameAddress } from '../formats/guards';
import { decodeSigner, isGuardianAddress } from '../method-ecdsa/codec';
import type { Address, Configuration, Credential, PinnedBlock, ReadResult } from '../interfaces';
import type { PlaceStanding } from '../types';
import type { MethodStop, RecoveryClientParts } from '../types/recovery-client';

/** The read's answer, rejecting where it went unanswered since no standing may be guessed. */
function answerOf<Answer>(result: ReadResult<Answer>, read: string, method: Address): Answer {
  assertObject(result, `${read}(${method})`);

  if (!result.answered) throw new Error(`${RECOVERY_CLIENT_UNANSWERED_READ_MESSAGE}: ${read}(${method})`);

  return result.value;
}

/** Whether one method answers stopped at the block, rejecting where the read went unanswered or its answer is not a boolean. */
export async function pausedAt(parts: RecoveryClientParts, method: Address, block: PinnedBlock): Promise<boolean> {
  const read = await parts.policyManager.paused(method, block);
  const paused: unknown = answerOf(read, 'paused', method);

  assertBool(paused, `paused(${method})`);

  return paused;
}

/** One rule method's stop: stopped where `paused` answers `true`, stoppable where its pause holder is nonzero. */
async function methodStop(parts: RecoveryClientParts, method: Address, block: PinnedBlock): Promise<MethodStop> {
  const [paused, partiesRead] = await Promise.all([pausedAt(parts, method, block), parts.policyManager.trustedParties(method, block)]);
  const parties = answerOf(partiesRead, 'trustedParties', method);

  assertObject(parties, `trustedParties(${method})`);

  const pauseHolder = normalizeAddress(parties.pauseHolder, `trustedParties(${method}).pauseHolder`);

  return { standing: paused ? 'stopped' : 'not-stopped', stoppable: !sameAddress(pauseHolder, FORMATS_ZERO_ADDRESS) };
}

/** Each distinct rule method's stop, the methods read in parallel; a stop answer that is not a boolean rejects. */
async function methodStops(
  parts: RecoveryClientParts,
  methods: readonly Address[],
  block: PinnedBlock,
): Promise<Map<Address, MethodStop>> {
  const stops = await Promise.all(methods.map((method) => methodStop(parts, method, block)));

  return new Map(methods.map((method, index) => [method, stops[index] as MethodStop]));
}

/** The guardian address a wallet config holds, refusing a config that is not one nonzero address word with a `TypeError`. */
function guardianOf(config: Credential['config'], place: number): Address {
  let guardian: Address | undefined;

  try {
    guardian = decodeSigner(config);
  } catch {
    guardian = undefined;
  }

  if (guardian === undefined || !isGuardianAddress(guardian)) {
    throw new TypeError(`place ${place} config must be one nonzero address word for the wallet method`);
  }

  return guardian;
}

/** Whether one guardian address holds code at the block. */
async function holdsCode(parts: RecoveryClientParts, guardian: Address, block: PinnedBlock): Promise<boolean> {
  const code: unknown = await parts.provider.code(guardian, block.number);

  assertBytes(code, `code(${guardian})`);

  return lowerHex(code) !== RECOVERY_CLIENT_NO_CODE;
}

/** Whether each guardian address holds code at the block, one read per distinct address, the addresses read in parallel. */
async function guardianCode(parts: RecoveryClientParts, guardians: readonly Address[], block: PinnedBlock): Promise<Map<Address, boolean>> {
  const distinct = [...new Set(guardians)];
  const holds = await Promise.all(distinct.map((guardian) => holdsCode(parts, guardian, block)));

  return new Map(distinct.map((guardian, index) => [guardian, holds[index] === true]));
}

/**
 * Each place's standing in body order: its method's stop and pause holder, and for a wallet place whether its guardian
 * address holds code; every other method's place holds none. Every read is pinned to `block`.
 * A wallet place whose config is not one nonzero address word throws a `TypeError` before any stop or code is read.
 */
export async function placeStandings(
  parts: RecoveryClientParts,
  configuration: Configuration,
  block: PinnedBlock,
): Promise<PlaceStanding[]> {
  const credentials = configuration.clauses.flatMap((clause) => clause.credentials);
  const methods = credentials.map((credential, place) => normalizeAddress(credential.method, `place ${place} method`));
  const guardians = methods.map((method, place) =>
    sameAddress(method, parts.walletMethod) ? guardianOf((credentials[place] as Credential).config, place) : undefined,
  );
  const stops = await methodStops(parts, [...new Set(methods)], block);
  const code = await guardianCode(parts, guardians.filter((guardian) => guardian !== undefined), block);

  return methods.map((method, place) => {
    const guardian = guardians[place];

    return { ...(stops.get(method) as MethodStop), credentialHoldsCode: guardian === undefined ? false : code.get(guardian) === true };
  });
}
