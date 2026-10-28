import { FORMATS_DECIMAL_PATTERN, FORMATS_SAFE_INTEGER_BITS } from '../constants';
import {
  NAMED_BLOCK_TAGS,
  type Address,
  type BlockTags,
  type ClientConfiguration,
  type CreationRecord,
  type DeploymentDescriptor,
  type RequestWindowBounds,
} from '../interfaces';
import {
  assertBool,
  assertBytes,
  assertBytes32,
  assertObject,
  assertUintBigint,
  assertUintNumber,
  lowerHex,
  normalizeAddress,
  normalizeAddresses,
} from './guards';

/** Refuses anything but a non-negative safe integer. */
const assertSafeUint = (value: unknown, name: string): void => assertUintNumber(value, FORMATS_SAFE_INTEGER_BITS, name);

/** Refuses a tag that is not one of the named block tags. */
function assertNamedTag(value: unknown, name: string): void {
  if (!(NAMED_BLOCK_TAGS as readonly unknown[]).includes(value)) throw new TypeError(`${name} must be one of ${NAMED_BLOCK_TAGS.join(', ')}`);
}

/**
 * The deployment descriptor checked member by member, as a new record with every address checksummed.
 * A malformed member throws a `TypeError` or `RangeError`; the caller's record is left as given.
 */
export function checkedDescriptor(value: unknown, name: string): DeploymentDescriptor {
  assertObject(value, name);

  const descriptor = value as DeploymentDescriptor;

  assertSafeUint(descriptor.chainId, `${name}.chainId`);
  assertSafeUint(descriptor.deployedAt, `${name}.deployedAt`);

  if (typeof descriptor.digestVersion !== 'string' || !FORMATS_DECIMAL_PATTERN.test(descriptor.digestVersion)) {
    throw new TypeError(`${name}.digestVersion must be a non-empty decimal string`);
  }

  assertUintBigint(BigInt(descriptor.digestVersion), FORMATS_SAFE_INTEGER_BITS, `${name}.digestVersion`);

  if (typeof descriptor.managerVersion !== 'string') throw new TypeError(`${name}.managerVersion must be a string`);

  return {
    chainId: descriptor.chainId,
    manager: normalizeAddress(descriptor.manager, `${name}.manager`),
    methodEcdsa: normalizeAddress(descriptor.methodEcdsa, `${name}.methodEcdsa`),
    methodPasskey: normalizeAddress(descriptor.methodPasskey, `${name}.methodPasskey`),
    methodAadhaar: normalizeAddress(descriptor.methodAadhaar, `${name}.methodAadhaar`),
    methodZkpassport: normalizeAddress(descriptor.methodZkpassport, `${name}.methodZkpassport`),
    action: normalizeAddress(descriptor.action, `${name}.action`),
    servedImplementation: normalizeAddress(descriptor.servedImplementation, `${name}.servedImplementation`),
    deployedAt: descriptor.deployedAt,
    digestVersion: descriptor.digestVersion,
    managerVersion: descriptor.managerVersion,
    shippedMethods: normalizeAddresses(descriptor.shippedMethods, `${name}.shippedMethods`),
    auditedActions: normalizeAddresses(descriptor.auditedActions, `${name}.auditedActions`),
  };
}

/** The request window's bounds, checked as non-negative safe integers. */
function checkedRequestWindow(value: unknown, name: string): RequestWindowBounds {
  assertObject(value, name);

  const bounds = value as RequestWindowBounds;

  assertSafeUint(bounds.default, `${name}.default`);
  assertSafeUint(bounds.floor, `${name}.floor`);

  return { default: bounds.default, floor: bounds.floor };
}

/** The read and watch tags, each checked as a named block tag. */
function checkedBlockTags(value: unknown, name: string): BlockTags {
  assertObject(value, name);

  const tags = value as BlockTags;

  assertNamedTag(tags.read, `${name}.read`);
  assertNamedTag(tags.watch, `${name}.watch`);

  return { read: tags.read, watch: tags.watch };
}

/** The creation record, its factory checksummed and its bytecode and salt lower-cased. */
function checkedCreation(value: unknown, name: string): CreationRecord {
  assertObject(value, name);

  const creation = value as CreationRecord;
  const factory = normalizeAddress(creation.factory, `${name}.factory`);

  assertBytes(creation.bytecode, `${name}.bytecode`);
  assertBytes32(creation.salt, `${name}.salt`);
  assertSafeUint(creation.block, `${name}.block`);

  return { factory, bytecode: lowerHex(creation.bytecode), salt: lowerHex(creation.salt), block: creation.block };
}

/** The candidate keys checksummed, refusing two entries that name one address. */
function checkedCandidateKeys(value: unknown, name: string): Address[] {
  const keys = normalizeAddresses(value, name);

  if (new Set(keys).size !== keys.length) throw new TypeError(`${name} names one address more than once`);

  return keys;
}

/**
 * The client configuration checked member by member, as a new record with every address checksummed and every hex lower-cased.
 * A malformed member, or a candidate key named twice, throws a `TypeError` or `RangeError`; the caller's record is left as given.
 */
export function checkedConfiguration(value: unknown, name: string): ClientConfiguration {
  assertObject(value, name);

  const configuration = value as ClientConfiguration;

  assertSafeUint(configuration.defaultWait, `${name}.defaultWait`);
  assertSafeUint(configuration.shortWait, `${name}.shortWait`);
  assertSafeUint(configuration.maxWait, `${name}.maxWait`);
  assertSafeUint(configuration.cancelWindow, `${name}.cancelWindow`);
  assertSafeUint(configuration.ruleCostBound, `${name}.ruleCostBound`);
  assertSafeUint(configuration.logChunkSize, `${name}.logChunkSize`);

  if (configuration.logChunkSize < 1) throw new RangeError(`${name}.logChunkSize must be at least one block`);

  assertBool(configuration.simulate, `${name}.simulate`);

  const { creation, accountImplementation } = configuration;

  return {
    defaultWait: configuration.defaultWait,
    shortWait: configuration.shortWait,
    maxWait: configuration.maxWait,
    requestWindow: checkedRequestWindow(configuration.requestWindow, `${name}.requestWindow`),
    cancelWindow: configuration.cancelWindow,
    ruleCostBound: configuration.ruleCostBound,
    ...(creation === undefined ? {} : { creation: checkedCreation(creation, `${name}.creation`) }),
    ...(accountImplementation === undefined
      ? {}
      : { accountImplementation: normalizeAddress(accountImplementation, `${name}.accountImplementation`) }),
    candidateKeys: checkedCandidateKeys(configuration.candidateKeys, `${name}.candidateKeys`),
    blockTags: checkedBlockTags(configuration.blockTags, `${name}.blockTags`),
    logChunkSize: configuration.logChunkSize,
    tokens: normalizeAddresses(configuration.tokens, `${name}.tokens`),
    simulate: configuration.simulate,
  };
}
