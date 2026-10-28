import { assertArray, assertBool, assertDependency, assertObject, byteLength, normalizeAddress } from '../formats/guards';
import type { Address, Hex, IMethodCodec, SetupDraft } from '../interfaces';
import type { Findings, MethodReads, PlacedCredential, SetupValidationContext } from '../types/validation';
import { addError, addWarning, methodTable, normalizeAddresses } from './common';

/** The method reads by checksummed module address, refusing a malformed or repeated entry and a named method left unread. */
export function readsByMethod(methods: readonly MethodReads[], credentials: readonly PlacedCredential[]): Map<Address, MethodReads> {
  assertArray(methods, 'context.methods');

  const table = methodTable(
    Array.from(methods, (reads, index): [Address, MethodReads] => {
      assertObject(reads, `context.methods[${index}]`);
      assertObject(reads.moduleInfo, `context.methods[${index}].moduleInfo`);
      assertObject(reads.trustedParties, `context.methods[${index}].trustedParties`);
      assertObject(reads.paused, `context.methods[${index}].paused`);
      assertBool(reads.implemented, `context.methods[${index}].implemented`);

      return [normalizeAddress(reads.module, `context.methods[${index}].module`), reads];
    }),
    'context.methods',
  );

  for (const { method } of credentials) {
    if (!table.has(method)) throw new TypeError(`context.methods holds no reads for ${method}`);
  }

  return table;
}

/** Per credential, the config its method's codec cannot decode and the adoption, declaration and stop warnings its method's reads reach. */
export function methodFindings(
  draft: SetupDraft,
  credentials: readonly PlacedCredential[],
  context: SetupValidationContext,
  findings: Findings,
): void {
  const table = readsByMethod(context.methods, credentials);
  const shippedMethods = normalizeAddresses(context.descriptor.shippedMethods, 'context.descriptor.shippedMethods');

  assertCodecs(context.methods);

  for (const { place, method: module, config } of credentials) {
    const reads = table.get(module) as MethodReads;

    if (reads.codec !== undefined && !decodes(reads.codec, config)) {
      addError(findings, 'credential.config-malformed', 'credential', { place, module, bytes: byteLength(config) });
    }

    if (!shippedMethods.includes(module)) {
      addWarning(findings, 'method.unshipped', 'credential', {
        place,
        module,
        probeAnswered: reads.moduleInfo.answered,
        probePassed: reads.moduleInfo.answered && reads.moduleInfo.value.supportsInterface,
        implemented: reads.implemented,
        shippedMethods,
        descriptorOrigin: context.descriptorOrigin,
      });
    }

    if (!reads.trustedParties.answered) {
      addWarning(findings, 'method.no-declaration', 'credential', { place, module, parties: 'unknown' });
    }

    if (reads.paused.answered && reads.paused.value) {
      addWarning(findings, 'method.stopped', 'credential', { place, module, paused: true, ignoresPause: draft.ignoresPause });
    }
  }

  secondaryFindings(draft, credentials, table, findings);
}

/** Refuses, on every reads entry, a present codec without a `decodeConfig` function. */
function assertCodecs(methods: readonly MethodReads[]): void {
  methods.forEach((reads, index) => {
    if (reads.codec !== undefined) assertDependency(reads.codec, ['decodeConfig'], `context.methods[${index}].codec`);
  });
}

/** Whether the codec decodes the config; any throw is a layout the module would refuse at every proof. */
function decodes(codec: Pick<IMethodCodec, 'decodeConfig'>, config: Hex): boolean {
  try {
    codec.decodeConfig(config);
  } catch {
    return false;
  }

  return true;
}

/** `clause.secondary-only` where the clause's secondary-tier credentials alone meet its nonzero threshold. */
function secondaryFindings(
  draft: SetupDraft,
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodReads>,
  findings: Findings,
): void {
  draft.clauses.forEach(({ threshold }, clause) => {
    const secondary = credentials.filter(
      (credential) => credential.clause === clause && table.get(credential.method)?.tier === 'secondary',
    );

    if (threshold === 0 || secondary.length < threshold) return;

    addWarning(findings, 'clause.secondary-only', 'clause', {
      clause,
      methods: [...new Set(secondary.map((credential) => credential.method))],
      threshold,
      forgeable: secondary.length,
    });
  });
}
