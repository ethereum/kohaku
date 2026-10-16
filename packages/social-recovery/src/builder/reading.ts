import { encodeFunctionData } from 'viem';
import {
  BUILDER_DOMAIN_EXTENSION_BITS,
  BUILDER_ESCAPED_CHECKS,
  BUILDER_NO_DOMAIN_MESSAGE,
  FORMATS_SAFE_INTEGER_BITS,
  POLICY_MANAGER_EIP712_DOMAIN_ABI,
  POLICY_MANAGER_READ_FROM,
  POLICY_MANAGER_VERSION_ABI,
} from '../constants';
import { KitRefusalError } from '../client-core/refusal';
import { assertArray, assertBool, assertBytes, assertBytes32, assertObject, assertUintBigint, assertUintNumber, lowerHex, normalizeAddress } from '../formats/guards';
import { isProviderRevert, type Address, type Domain, type Hex, type IProvider, type NamedBlockTag } from '../interfaces';
import { decodeReturn } from '../policy-manager/chain';
import { domainFrom } from '../policy-manager/records';
import type { BuilderEscapedCheck, ManagerReading } from '../types/builder';

/** One view call to the manager at the read tag; a revert answers nothing, any other rejection propagates as itself. */
async function viewCall(provider: IProvider, manager: Address, data: Hex, tag: NamedBlockTag): Promise<unknown> {
  try {
    return await provider.call(manager, data, POLICY_MANAGER_READ_FROM, tag);
  } catch (thrown) {
    if (isProviderRevert(thrown)) return undefined;

    throw thrown;
  }
}

/** The manager's EIP-712 domain, refused with a `KitRefusalError` where the manager reverts or answers bytes that do not decode. */
export async function readDomain(provider: IProvider, manager: Address, tag: NamedBlockTag): Promise<Domain> {
  const returned = await viewCall(provider, manager, encodeFunctionData({ abi: POLICY_MANAGER_EIP712_DOMAIN_ABI }), tag);

  try {
    return domainFrom(returned);
  } catch {
    throw new KitRefusalError(BUILDER_NO_DOMAIN_MESSAGE);
  }
}

/** The manager's `version()` answer, or an empty string where it reverts or answers bytes that do not decode. */
export async function readVersion(provider: IProvider, manager: Address, tag: NamedBlockTag): Promise<string> {
  const returned = await viewCall(provider, manager, encodeFunctionData({ abi: POLICY_MANAGER_VERSION_ABI }), tag);

  try {
    return decodeReturn(POLICY_MANAGER_VERSION_ABI[0].outputs, returned, 'version')[0];
  } catch {
    return '';
  }
}

/** A domain checked member by member, as a new record with its hex lower-cased and its verifying contract checksummed. */
function checkedDomain(value: unknown, name: string): Domain {
  assertObject(value, name);

  const domain = value as Domain;

  assertBytes(domain.fields, `${name}.fields`);

  if (typeof domain.name !== 'string') throw new TypeError(`${name}.name must be a string`);

  if (typeof domain.version !== 'string') throw new TypeError(`${name}.version must be a string`);

  assertUintNumber(domain.chainId, FORMATS_SAFE_INTEGER_BITS, `${name}.chainId`);
  assertBytes32(domain.salt, `${name}.salt`);
  assertArray(domain.extensions, `${name}.extensions`);
  domain.extensions.forEach((extension, index) => assertUintBigint(extension, BUILDER_DOMAIN_EXTENSION_BITS, `${name}.extensions[${index}]`));

  return {
    fields: lowerHex(domain.fields),
    name: domain.name,
    version: domain.version,
    chainId: domain.chainId,
    verifyingContract: normalizeAddress(domain.verifyingContract, `${name}.verifyingContract`),
    salt: lowerHex(domain.salt),
    extensions: [...domain.extensions],
  };
}

/** The checks a reading lists as escaped, refusing a value that is not one of them. */
function checkedEscaped(value: unknown, name: string): BuilderEscapedCheck[] {
  assertArray(value, name);

  return value.map((entry, index) => {
    if (!(BUILDER_ESCAPED_CHECKS as readonly unknown[]).includes(entry)) {
      throw new TypeError(`${name}[${index}] must be one of ${BUILDER_ESCAPED_CHECKS.join(', ')}`);
    }

    return entry as BuilderEscapedCheck;
  });
}

/** A reading frozen through every nested record and list, so no holder of it can change what another builder judges. */
export function frozenReading(reading: ManagerReading): ManagerReading {
  const domain = Object.freeze({ ...reading.domain, extensions: Object.freeze([...reading.domain.extensions]) });

  return Object.freeze({ ...reading, domain, escaped: Object.freeze([...reading.escaped]) });
}

/** Another builder's reading checked member by member, refused with a `TypeError` or `RangeError` where malformed, frozen. */
export function checkedReading(value: unknown): ManagerReading {
  assertObject(value, 'reading');

  const reading = value as ManagerReading;

  assertUintNumber(reading.chainId, FORMATS_SAFE_INTEGER_BITS, 'reading.chainId');

  if (typeof reading.version !== 'string') throw new TypeError('reading.version must be a string');

  assertBool(reading.versionMismatch, 'reading.versionMismatch');

  return frozenReading({
    chainId: reading.chainId,
    manager: normalizeAddress(reading.manager, 'reading.manager'),
    domain: checkedDomain(reading.domain, 'reading.domain'),
    version: reading.version,
    escaped: checkedEscaped(reading.escaped, 'reading.escaped'),
    versionMismatch: reading.versionMismatch,
  });
}
