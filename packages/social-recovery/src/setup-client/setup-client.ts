import { assertBool } from '../formats/guards';
import type {
  Address,
  ClientConfiguration,
  Configuration,
  ConfigurationSource,
  DeploymentDescriptor,
  IActionCodec,
  IEventManager,
  IPolicyManagerInteractor,
  IProvider,
  ISetupClient,
  ISignerRecovery,
  PreparedBatch,
  PreparedCall,
  PrepareOptions,
  SetupConfirmation,
  SetupDescription,
  SetupDraft,
  SetupState,
  ValidationResult,
} from '../interfaces';
import type { MethodRegistry } from '../types/event-manager';
import type { SetupClientParts, SetupClientRecoveryAction } from '../types/setup-client';
import { assertPreparesServed, checkedParts } from './check';
import { prepareClear } from './clear';
import { prepareCommit } from './commit';
import { confirmAt } from './confirm';
import { checkedDraft } from './draft';
import { descriptionAt, validationAt } from './judgments';
import { pinRead } from './reads';
import { restoreAt, stateAt } from './state';

/**
 * The setup client over parts its caller built, bound to one account and one action; it constructs nothing.
 * Every member reads the read tag's block once and pins every part call it makes to that block.
 * With `versionEscaped` set, the client still reads and describes but refuses both prepares.
 * `codec` and `signerRecovery` are passed to the inference that names the key a handover would remove.
 */
export class SetupClient implements ISetupClient {
  readonly events: IEventManager;
  private readonly parts: SetupClientParts;
  private readonly versionEscaped: boolean;

  /**
   * Throws a `TypeError` or `RangeError` on a malformed input, or where the codec does not serve the action.
   * The descriptor's origin is `descriptorOriginOf(descriptor)`: `kit` only for a chain's shipped descriptor.
   */
  constructor(
    provider: IProvider,
    descriptor: DeploymentDescriptor,
    account: Address,
    action: Address,
    configuration: ClientConfiguration,
    policyManager: IPolicyManagerInteractor,
    recoveryAction: SetupClientRecoveryAction,
    events: IEventManager,
    methods: MethodRegistry,
    codec: IActionCodec,
    signerRecovery?: ISignerRecovery,
    versionEscaped = false,
  ) {
    assertBool(versionEscaped, 'versionEscaped');
    this.parts = checkedParts({
      provider,
      descriptor,
      account,
      action,
      configuration,
      policyManager,
      recoveryAction,
      events,
      methods,
      codec,
      signerRecovery,
    });
    this.events = events;
    this.versionEscaped = versionEscaped;
  }

  async validateSetup(draft: SetupDraft): Promise<ValidationResult> {
    const credentials = checkedDraft(draft);

    return await validationAt(this.parts, draft, credentials, await pinRead(this.parts));
  }

  async describeSetup(draft: SetupDraft): Promise<SetupDescription> {
    const credentials = checkedDraft(draft);

    return await descriptionAt(this.parts, draft, credentials, await pinRead(this.parts));
  }

  async prepareCommitSetup(draft: SetupDraft, password?: string, options?: PrepareOptions): Promise<PreparedCall | PreparedBatch> {
    assertPreparesServed(this.versionEscaped);

    return await prepareCommit(this.parts, draft, password, options);
  }

  async prepareClearSetup(options?: PrepareOptions): Promise<PreparedCall | PreparedBatch> {
    assertPreparesServed(this.versionEscaped);

    return await prepareClear(this.parts, options);
  }

  async confirmSetup(draft: SetupDraft, prepared: PreparedCall | PreparedBatch): Promise<SetupConfirmation> {
    return await confirmAt(this.parts, draft, prepared);
  }

  async setupState(): Promise<SetupState> {
    return await stateAt(this.parts);
  }

  async getSetup(source: ConfigurationSource): Promise<Configuration> {
    return await restoreAt(this.parts, source);
  }
}
