/**
 * PLACEHOLDERS. Every type in this file stands in for a value record of
 * design/offchain/sdk.md, and task PT-071 replaces this file with the
 * chapter's records. No field is invented here: each name below is a brand
 * that nothing but the placeholder of the same name satisfies, so the
 * interfaces compile against the names alone.
 */
declare const placeholder: unique symbol;

/** The one brand every placeholder carries; `Args` keeps a generic record's arguments. */
export type Placeholder<Name extends string, Args extends readonly unknown[] = []> = {
  readonly [placeholder]: { readonly name: Name; readonly args: Args };
};

// Chain values (D-200, D-203, D-208)
export type Address = Placeholder<'Address'>;
export type Hex = Placeholder<'Hex'>;
export type BlockTag = Placeholder<'BlockTag'>;
export type BlockHeader = Placeholder<'BlockHeader'>;
export type BlockRange = Placeholder<'BlockRange'>;
export type FilterSpec = Placeholder<'FilterSpec'>;
export type RawLog = Placeholder<'RawLog'>;
export type Moment = Placeholder<'Moment'>;

// Contract interactor (D-202)
export type PrepareOptions = Placeholder<'PrepareOptions'>;
export type PreparedCall = Placeholder<'PreparedCall'>;
export type PreparedBatch = Placeholder<'PreparedBatch'>;
export type SetupDraft = Placeholder<'SetupDraft'>;
export type SetupConfirmation = Placeholder<'SetupConfirmation'>;
export type SetupState = Placeholder<'SetupState'>;
export type RecoveryState = Placeholder<'RecoveryState'>;
export type Attempt = Placeholder<'Attempt'>;
export type ActionState = Placeholder<'ActionState'>;
export type Domain = Placeholder<'Domain'>;
export type Configuration = Placeholder<'Configuration'>;
export type ConfigurationSource = Placeholder<'ConfigurationSource'>;
export type Handover = Placeholder<'Handover'>;
export type PaymentOrder = Placeholder<'PaymentOrder'>;
export type ValidityWindow = Placeholder<'ValidityWindow'>;
export type ModuleInfo = Placeholder<'ModuleInfo'>;
export type ActionInfo = Placeholder<'ActionInfo'>;
export type Parties = Placeholder<'Parties'>;
export type ReadResult<Answer> = Placeholder<'ReadResult', [Answer]>;

// Event reader and notification (D-203)
export type AccountFilterOptions = Placeholder<'AccountFilterOptions'>;
export type Notification = Placeholder<'Notification'>;

// Formatter (D-204)
export type AttemptRequest = Placeholder<'AttemptRequest'>;
export type CancelRequest = Placeholder<'CancelRequest'>;
export type Fields = Placeholder<'Fields'>;

// Utilities (D-205)
export type ValidationResult = Placeholder<'ValidationResult'>;
export type SetupDescription = Placeholder<'SetupDescription'>;
export type RequestDescription = Placeholder<'RequestDescription'>;
export type StatusDescription = Placeholder<'StatusDescription'>;
export type RestoreCause = Placeholder<'RestoreCause'>;
export type ErrorAbi = Placeholder<'ErrorAbi'>;

// Methods orchestrator (D-206)
export type Ctx = Placeholder<'Ctx'>;
export type Params = Placeholder<'Params'>;
export type Material = Placeholder<'Material'>;
export type Input = Placeholder<'Input'>;
export type EnrollInput = Placeholder<'EnrollInput'>;
export type EnrollFailure = Placeholder<'EnrollFailure'>;
export type ReplyFailure = Placeholder<'ReplyFailure'>;
export type Verdict = Placeholder<'Verdict'>;
export type DeviceBinding = Placeholder<'DeviceBinding'>;
export type DeviceFacts = Placeholder<'DeviceFacts'>;

// Recovery proof gathering (D-207)
export type Request = Placeholder<'Request'>;
export type Reply = Placeholder<'Reply'>;
export type Gathering = Placeholder<'Gathering'>;
export type AddResult = Placeholder<'AddResult'>;
export type Assessment = Placeholder<'Assessment'>;
export type Selection = Placeholder<'Selection'>;

// Factories (D-208)
export type DeploymentDescriptor = Placeholder<'DeploymentDescriptor'>;
export type ClientConfiguration = Placeholder<'ClientConfiguration'>;
