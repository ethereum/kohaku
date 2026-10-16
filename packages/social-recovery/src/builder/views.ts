import { BUILDER_VERSION_ESCAPED_MESSAGE } from '../constants';
import { KitRefusalError } from '../client-core/refusal';
import type { Address, IMethodModuleReads, IRecoveryActionInteractor, PinnedBlock, PreparedCall } from '../interfaces';
import type { RecoveryActionPart } from '../types/builder';

/** The disarming write of a part handed out under an escaped build: it refuses, since this build serves no prepare there. */
const refusedDisarming = (): Promise<PreparedCall> => Promise.reject(new KitRefusalError(BUILDER_VERSION_ESCAPED_MESSAGE));

/**
 * The action part as its reads and disarming write alone, frozen, so its arming write never leaves the builder.
 * Under an escaped build the disarming write refuses with a `KitRefusalError` while every read delegates.
 */
export function actionView(part: RecoveryActionPart, escaped: boolean): IRecoveryActionInteractor {
  return Object.freeze({
    supportsAccount: (block?: PinnedBlock) => part.supportsAccount(block),
    isAuthority: (key: Address, block?: PinnedBlock) => part.isAuthority(key, block),
    isAuthorized: (block?: PinnedBlock) => part.isAuthorized(block),
    holdsAnyPrivilege: (candidate: Address, block?: PinnedBlock) =>
      part.holdsAnyPrivilege(candidate, block),
    actionInfo: (block?: PinnedBlock) => part.actionInfo(block),
    disarmingCall: escaped ? refusedDisarming : (block?: PinnedBlock) => part.disarmingCall(block),
  });
}

/** The manager part as its three module reads alone, frozen, so none of its prepares leaves the builder. */
export function moduleReadsView(manager: IMethodModuleReads): IMethodModuleReads {
  return Object.freeze({
    moduleInfo: (module: Address, block?: PinnedBlock) => manager.moduleInfo(module, block),
    paused: (module: Address, block?: PinnedBlock) => manager.paused(module, block),
    trustedParties: (module: Address, block?: PinnedBlock) => manager.trustedParties(module, block),
  });
}
