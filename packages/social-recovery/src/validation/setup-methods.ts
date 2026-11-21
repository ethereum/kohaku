import { VALIDATION_CONFIG_FAULTS } from '../constants';
import { assertArray, assertBool, assertDependency, assertObject, byteLength, normalizeAddress } from '../formats/guards';
import type { Address, Hex, IMethodCodec, SetupDraft } from '../interfaces';
import type { Findings, MethodReads, PlacedCredential, SetupValidationContext } from '../types/validation';
import { addError, addWarning, methodTable, normalizeAddresses } from './common';

const [LAYOUT_FAULT, BOUND_FAULT] = VALIDATION_CONFIG_FAULTS;

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

/** Per credential, the config its method's codec cannot decode or whose values its bounds refuse, and the adoption, declaration and stop warnings its method's reads reach. */
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

    if (reads.codec !== undefined) configFindings(reads.codec, { place, module, config }, findings);

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

/** Refuses, on every reads entry, a present codec without a `decodeConfig` function or with an `outOfBounds` that is not one. */
function assertCodecs(methods: readonly MethodReads[]): void {
  methods.forEach((reads, index) => {
    if (reads.codec === undefined) return;

    assertDependency(reads.codec, ['decodeConfig'], `context.methods[${index}].codec`);

    if (reads.codec.outOfBounds !== undefined) assertDependency(reads.codec, ['outOfBounds'], `context.methods[${index}].codec`);
  });
}

/** At most one `credential.config-malformed` for the place: a layout the codec cannot decode, else the fields its bounds refuse. */
function configFindings(
  codec: Pick<IMethodCodec, 'decodeConfig' | 'outOfBounds'>,
  { place, module, config }: { readonly place: number; readonly module: Address; readonly config: Hex },
  findings: Findings,
): void {
  const bytes = byteLength(config);

  if (!decodes(codec, config)) {
    addError(findings, 'credential.config-malformed', 'credential', { place, module, bytes, reason: LAYOUT_FAULT });

    return;
  }

  const fields = refusedFields(codec, config);

  if (fields !== undefined) {
    addError(findings, 'credential.config-malformed', 'credential', { place, module, bytes, reason: BOUND_FAULT, fields });
  }
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

/**
 * The fields a bound finding names, undefined where the codec declares no bounds or every one holds;
 * `[]` where it throws or answers anything but an array of strings, since it then vouches for nothing.
 */
function refusedFields(codec: Pick<IMethodCodec, 'outOfBounds'>, config: Hex): string[] | undefined {
  if (codec.outOfBounds === undefined) return undefined;

  try {
    const answer: unknown = codec.outOfBounds(config);

    if (!Array.isArray(answer)) return [];

    const fields: unknown[] = Array.from(answer);

    if (!fields.every((field) => typeof field === 'string')) return [];

    return fields.length === 0 ? undefined : (fields as string[]);
  } catch {
    return [];
  }
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
