import type { IEventManager } from './event-manager';
import type {
  Configuration,
  ConfigurationSource,
  PreparedBatch,
  PreparedCall,
  PrepareOptions,
  SetupConfirmation,
  SetupDescription,
  SetupDraft,
  SetupState,
  ValidationResult,
} from './records';

/**
 * The entry a holder's integrator builds while the holder still holds their key,
 * bound to one chain, one deployment, one account and one action (D-201, D-202).
 * `SetupClient` is the shipped implementation.
 */
export interface ISetupClient {
  /** Errors and warnings over the draft; never throws on a finding. */
  validateSetup(draft: SetupDraft): Promise<ValidationResult>;
  describeSetup(draft: SetupDraft): Promise<SetupDescription>;
  /** One call on an armed account, an atomic batch of two otherwise; throws when it refuses. */
  prepareCommitSetup(
    draft: SetupDraft,
    password?: string,
    options?: PrepareOptions,
  ): Promise<PreparedCall | PreparedBatch>;
  /** Throws when it refuses. */
  prepareClearSetup(options?: PrepareOptions): Promise<PreparedCall | PreparedBatch>;
  /** The optional confirmation read after the transaction lands; throws when it refuses. */
  confirmSetup(draft: SetupDraft, prepared: PreparedCall | PreparedBatch): Promise<SetupConfirmation>;
  setupState(): Promise<SetupState>;
  /** The configuration restore; the thrown value carries the restore cause. */
  getSetup(source: ConfigurationSource): Promise<Configuration>;
  /** The event manager shared with the recovery client. */
  readonly events: IEventManager;
}
