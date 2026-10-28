import type { AmbireRecoveryAction, PinnedBlock } from '../../src/index';
import { boolWord, CANDIDATE, KEY, SELECTORS, stringReturn, ZERO_WORD } from './fixtures';
import type { CallAnswer } from './provider-double';

/** How one member of the part is called with an optional block, and whether it is a prepare. */
export type BlockMember = {
  readonly name: string;
  readonly prepare: boolean;
  readonly invoke: (part: AmbireRecoveryAction, block?: PinnedBlock) => Promise<unknown>;
};

/** Every read and prepare of the action part, each taking the block as its last argument. */
export const BLOCK_MEMBERS: readonly BlockMember[] = [
  { name: 'supportsAccount', prepare: false, invoke: (part, block) => part.supportsAccount(block) },
  { name: 'isAuthority', prepare: false, invoke: (part, block) => part.isAuthority(KEY, block) },
  { name: 'isAuthorized', prepare: false, invoke: (part, block) => part.isAuthorized(block) },
  { name: 'holdsAnyPrivilege', prepare: false, invoke: (part, block) => part.holdsAnyPrivilege(CANDIDATE, block) },
  { name: 'actionInfo', prepare: false, invoke: (part, block) => part.actionInfo(block) },
  { name: 'armingCall', prepare: true, invoke: (part, block) => part.armingCall(block) },
  { name: 'disarmingCall', prepare: true, invoke: (part, block) => part.disarmingCall(block) },
  { name: 'prepareSetAddrPrivilege', prepare: true, invoke: (part, block) => part.prepareSetAddrPrivilege(ZERO_WORD, block) },
];

/** Answers for every selector the part's reads call. */
export const ALL_ANSWERS: Readonly<Record<string, CallAnswer>> = {
  [SELECTORS.supportsAccount]: { returns: boolWord(true) },
  [SELECTORS.isAuthority]: { returns: boolWord(true) },
  [SELECTORS.isAuthorized]: { returns: boolWord(false) },
  [SELECTORS.holdsAnyPrivilege]: { returns: boolWord(false) },
  [SELECTORS.supportsInterface]: { returns: boolWord(true) },
  [SELECTORS.name]: { returns: stringReturn('Ambire recovery action') },
  [SELECTORS.version]: { returns: stringReturn('1.0.0') },
};
