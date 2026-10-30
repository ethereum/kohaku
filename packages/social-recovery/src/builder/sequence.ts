import {
  BODY_ENCODER_KEY,
  BUILDER_BODY_ENCODER_MESSAGE,
  BUILDER_CHAIN_MISMATCH_MESSAGE,
  BUILDER_DIGEST_VERSION_MESSAGE,
  BUILDER_DOMAIN_CHAIN_MESSAGE,
  BUILDER_DOMAIN_FIELDS,
  BUILDER_DOMAIN_FIELDS_MESSAGE,
  BUILDER_DOMAIN_NAME_MESSAGE,
  BUILDER_READING_MISMATCH_MESSAGE,
  BUILDER_VERIFYING_CONTRACT_MESSAGE,
  DIGEST_VERSION,
  FORMATS_DIGEST_DOMAIN_NAME,
} from '../constants';
import { KitRefusalError } from '../client-core/refusal';
import { sameAddress } from '../formats/guards';
import type { Address, DeploymentDescriptor, Domain } from '../interfaces';
import type { BuilderEscapedCheck, ManagerReading, SequenceInputs } from '../types/builder';
import { resolvedDescriptor } from './inputs';
import { frozenReading, readDomain, readVersion } from './reading';

/** Refuses a domain naming another chain or another verifying contract than the descriptor, whatever the escape. */
function assertDomainBound(domain: Domain, descriptor: DeploymentDescriptor): void {
  if (domain.chainId !== descriptor.chainId) throw new KitRefusalError(BUILDER_DOMAIN_CHAIN_MESSAGE);

  if (!sameAddress(domain.verifyingContract, descriptor.manager)) throw new KitRefusalError(BUILDER_VERIFYING_CONTRACT_MESSAGE);
}

/**
 * The escapable checks the domain fails, in the order they run. Without the escape the first failure refuses with its
 * `KitRefusalError`; with it every failure is returned. While the body encoder key lists no manager, its check passes.
 */
export function escapedChecks(
  domain: Domain,
  descriptor: DeploymentDescriptor,
  versionEscape: boolean,
  encoderKey: readonly Address[] = BODY_ENCODER_KEY,
): BuilderEscapedCheck[] {
  const failures: [BuilderEscapedCheck, string][] = [];

  if (domain.fields.toLowerCase() !== BUILDER_DOMAIN_FIELDS) failures.push(['fields', BUILDER_DOMAIN_FIELDS_MESSAGE]);

  if (domain.version !== descriptor.digestVersion || domain.version !== DIGEST_VERSION) {
    failures.push(['digest-version', BUILDER_DIGEST_VERSION_MESSAGE]);
  }

  if (domain.name !== FORMATS_DIGEST_DOMAIN_NAME) failures.push(['domain-name', BUILDER_DOMAIN_NAME_MESSAGE]);

  if (encoderKey.length > 0 && !encoderKey.some((manager) => sameAddress(manager, descriptor.manager))) {
    failures.push(['body-encoder', BUILDER_BODY_ENCODER_MESSAGE]);
  }

  const [first] = failures;

  if (first !== undefined && !versionEscape) throw new KitRefusalError(first[1]);

  return failures.map(([check]) => check);
}

/** The chain id the inputs name, else the provider's answer, read once so it also serves the chain check. */
async function namedChain(inputs: SequenceInputs): Promise<{ chainId: number; answered: number | undefined }> {
  if (inputs.chainId !== undefined) return { chainId: inputs.chainId, answered: undefined };

  const answered = await inputs.provider.chainId();

  return { chainId: answered, answered };
}

/**
 * The construction checks, in order: the descriptor resolved, the provider's chain, the manager's domain and its bound
 * members, then the escapable checks and `version()` beside them. Each refusal is a `KitRefusalError`; a transport failure
 * propagates as itself. A handed-over reading of the same chain and manager stands in for both manager reads.
 */
export async function constructionChecks(
  inputs: SequenceInputs,
  encoderKey: readonly Address[] = BODY_ENCODER_KEY,
): Promise<{ descriptor: DeploymentDescriptor; reading: ManagerReading }> {
  const { provider, readTag, reading: handed } = inputs;
  const named = await namedChain(inputs);
  const descriptor = resolvedDescriptor(inputs.descriptor, named.chainId);
  const providerChain = named.answered ?? (await provider.chainId());

  if (providerChain !== descriptor.chainId) throw new KitRefusalError(BUILDER_CHAIN_MISMATCH_MESSAGE);

  if (handed !== undefined && (handed.chainId !== descriptor.chainId || !sameAddress(handed.manager, descriptor.manager))) {
    throw new KitRefusalError(BUILDER_READING_MISMATCH_MESSAGE);
  }

  const domain = handed?.domain ?? (await readDomain(provider, descriptor.manager, readTag));

  assertDomainBound(domain, descriptor);

  const escaped = escapedChecks(domain, descriptor, inputs.versionEscape, encoderKey);
  const version = handed?.version ?? (await readVersion(provider, descriptor.manager, readTag));

  return {
    descriptor,
    reading: frozenReading({
      chainId: descriptor.chainId,
      manager: descriptor.manager,
      domain,
      version,
      escaped,
      versionMismatch: version !== descriptor.managerVersion,
    }),
  };
}
