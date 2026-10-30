import { describeSetup as describeDraft } from '../description';
import { distinctMethods } from '../description/setup-methods';
import type { Address, PinnedBlock, RemovedKey, SetupDescription, SetupDraft, ValidationResult } from '../interfaces';
import { inferRemovedKey } from '../removed-key';
import type { PinnedHeader } from '../types/client-core';
import type { CandidateKeyAuthority } from '../types/description';
import type { SetupClientParts } from '../types/setup-client';
import type { PlacedCredential } from '../types/validation';
import { validateSetup as validateDraft } from '../validation';
import { checkedDraftRecord } from './draft';
import { accountWideEvents, holdsCode, judgmentReads } from './reads';

/** Every finding the draft reaches against the reads made at the pinned block; no gas cost is known, so the rule's cost goes unjudged. */
export async function validationAt(
  parts: SetupClientParts,
  draft: SetupDraft,
  credentials: readonly PlacedCredential[],
  pinned: PinnedHeader,
): Promise<ValidationResult> {
  const [reads, managerEvents] = await Promise.all([
    judgmentReads(parts, distinctMethods(credentials), pinned.block),
    accountWideEvents(parts, pinned.block),
  ]);

  return validateDraft(draft, {
    account: parts.account,
    descriptor: parts.descriptor,
    descriptorOrigin: parts.descriptorOrigin,
    configuration: parts.configuration,
    block: pinned.header,
    methods: reads.methods,
    action: reads.action,
    managerEvents,
    costs: [],
  });
}

/** The action's `isAuthority` answer for each candidate key, every answer false without asking where the account holds no code. */
async function candidateKeys(parts: SetupClientParts, deployed: boolean, block: PinnedBlock): Promise<CandidateKeyAuthority[]> {
  return await Promise.all(
    parts.configuration.candidateKeys.map(async (key) => ({
      key,
      isAuthority: deployed ? await parts.recoveryAction.isAuthority(key, block) : false,
    })),
  );
}

/** The key a handover would remove, inferred with no supplied address; its authority reads answer false where the account holds no code. */
async function removedKey(parts: SetupClientParts, deployed: boolean, block: PinnedBlock): Promise<RemovedKey> {
  const isAuthority = (key: Address, at?: PinnedBlock): Promise<boolean> =>
    deployed ? parts.recoveryAction.isAuthority(key, at) : Promise.resolve(false);

  return await inferRemovedKey(
    {
      events: parts.events,
      action: { isAuthority },
      codec: parts.codec,
      provider: parts.provider,
      ...(parts.signerRecovery === undefined ? {} : { signerRecovery: parts.signerRecovery }),
      descriptor: parts.descriptor,
      account: parts.account,
      actionAddress: parts.action,
    },
    block,
  );
}

/** The disclosure of the draft against the reads made at the pinned block. */
export async function descriptionAt(
  parts: SetupClientParts,
  draft: SetupDraft,
  credentials: readonly PlacedCredential[],
  pinned: PinnedHeader,
): Promise<SetupDescription> {
  const { block } = pinned;
  const [reads, [keys, removed]] = await Promise.all([
    judgmentReads(parts, distinctMethods(credentials), block),
    holdsCode(parts, block).then((deployed) =>
      Promise.all([candidateKeys(parts, deployed, block), removedKey(parts, deployed, block)]),
    ),
  ]);

  return describeDraft(checkedDraftRecord(draft, credentials), {
    descriptor: parts.descriptor,
    configuration: parts.configuration,
    methods: reads.methods,
    action: reads.action,
    candidateKeys: keys,
    removedKey: removed,
  });
}
