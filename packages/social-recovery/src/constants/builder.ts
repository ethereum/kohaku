import type { BlockTags, ClientConfiguration, DeploymentDescriptor, Hex, RequestWindowBounds } from '../interfaces/records';
import type { BuilderEscapedCheck } from '../types/builder';
import { FORMATS_ZERO_ADDRESS } from './formats';

/** The default wait a setup screen proposes: 48 hours, in seconds. */
export const BUILDER_DEFAULT_WAIT = 172800;

/** The wait below which a setup screen warns: 48 hours, in seconds. */
export const BUILDER_SHORT_WAIT = 172800;

/** The largest wait the SDK accepts: 30 days, in seconds. */
export const BUILDER_MAX_WAIT = 2592000;

/** A request window of 24 hours by default, warning below 1 hour, in seconds. */
export const BUILDER_REQUEST_WINDOW: RequestWindowBounds = Object.freeze({ default: 86400, floor: 3600 });

/** The cancel gathering's own duration: 12 hours, in seconds. */
export const BUILDER_CANCEL_WINDOW = 43200;

/** The rule cost beyond which the SDK refuses, in gas. */
export const BUILDER_RULE_COST_BOUND = 10000000;

/** Reads pin at the latest block and watches at the finalized one. */
export const BUILDER_BLOCK_TAGS: BlockTags = Object.freeze({ read: 'latest', watch: 'finalized' });

/** The block width the event manager chunks its log reads into, the range most paid RPC plans accept in one `eth_getLogs`. */
export const BUILDER_DEFAULT_LOG_CHUNK_SIZE = 10000;

/** The configuration a client gets where the integrator overrides nothing; a partial configuration is merged over it member by member. */
export const BUILDER_DEFAULT_CONFIGURATION: ClientConfiguration = Object.freeze({
  defaultWait: BUILDER_DEFAULT_WAIT,
  shortWait: BUILDER_SHORT_WAIT,
  maxWait: BUILDER_MAX_WAIT,
  requestWindow: BUILDER_REQUEST_WINDOW,
  cancelWindow: BUILDER_CANCEL_WINDOW,
  ruleCostBound: BUILDER_RULE_COST_BOUND,
  candidateKeys: Object.freeze([]),
  blockTags: BUILDER_BLOCK_TAGS,
  logChunkSize: BUILDER_DEFAULT_LOG_CHUNK_SIZE,
  tokens: Object.freeze([]),
  simulate: true,
});

/** A shipped descriptor for one chain whose deployment is not public: every address zero, so no build reads from it. */
const unpublishedDescriptor = (chainId: number): DeploymentDescriptor =>
  Object.freeze({
    chainId,
    manager: FORMATS_ZERO_ADDRESS,
    methodEcdsa: FORMATS_ZERO_ADDRESS,
    methodPasskey: FORMATS_ZERO_ADDRESS,
    methodAadhaar: FORMATS_ZERO_ADDRESS,
    methodZkpassport: FORMATS_ZERO_ADDRESS,
    action: FORMATS_ZERO_ADDRESS,
    servedImplementation: FORMATS_ZERO_ADDRESS,
    deployedAt: 0,
    digestVersion: '1',
    managerVersion: '1.0.0',
    shippedMethods: Object.freeze([]),
    auditedActions: Object.freeze([]),
  });

/** The Sepolia deployment the kit ships; its addresses stay zero until the deployment is public. */
export const BUILDER_SEPOLIA_DESCRIPTOR: DeploymentDescriptor = unpublishedDescriptor(11155111);

/** The Ethereum mainnet deployment the kit ships; its addresses stay zero until the deployment lands. */
export const BUILDER_MAINNET_DESCRIPTOR: DeploymentDescriptor = unpublishedDescriptor(1);

/** The shipped descriptors by chain id, the one a builder resolves when it is given a chain and no descriptor. */
export const BUILDER_DEFAULT_DESCRIPTORS: Readonly<Record<number, DeploymentDescriptor>> = Object.freeze({
  [BUILDER_SEPOLIA_DESCRIPTOR.chainId]: BUILDER_SEPOLIA_DESCRIPTOR,
  [BUILDER_MAINNET_DESCRIPTOR.chainId]: BUILDER_MAINNET_DESCRIPTOR,
});

/** The domain's `fields` bitmap a manager must answer: name, version, chain id and verifying contract, nothing else. */
export const BUILDER_DOMAIN_FIELDS: Hex = '0x0f';

/** The width of each `extensions` entry of an EIP-712 domain, in bits. */
export const BUILDER_DOMAIN_EXTENSION_BITS = 256;

/** Every construction check the version escape can downgrade, in the order the checks run. */
export const BUILDER_ESCAPED_CHECKS: readonly BuilderEscapedCheck[] = Object.freeze(['fields', 'digest-version', 'domain-name', 'body-encoder']);

/** The members a policy manager instance must carry as functions, its interactor and module reads alike. */
export const BUILDER_POLICY_MANAGER_MEMBERS: readonly string[] = Object.freeze([
  'prepareCommitSetup',
  'prepareClearSetup',
  'prepareCancelByOwner',
  'prepareStartAttempt',
  'prepareCancelByProofs',
  'prepareCancelByVeto',
  'stateOf',
  'hashApproval',
  'hashCancel',
  'eip712Domain',
  'name',
  'version',
  'supportsInterface',
  'moduleInfo',
  'paused',
  'trustedParties',
]);

/** The members an event manager instance must carry as functions. */
export const BUILDER_EVENT_MANAGER_MEMBERS: readonly string[] = Object.freeze([
  'accountFilter',
  'methodFilter',
  'privilegeFilter',
  'fetch',
  'decodeLog',
]);

/** The members a recovery action part must carry as functions, its reads, its disarming write and its arming write. */
export const BUILDER_RECOVERY_ACTION_MEMBERS: readonly string[] = Object.freeze([
  'supportsAccount',
  'isAuthority',
  'isAuthorized',
  'holdsAnyPrivilege',
  'actionInfo',
  'disarmingCall',
  'armingCall',
]);

/** The members a provider must carry as functions. */
export const BUILDER_PROVIDER_MEMBERS: readonly string[] = Object.freeze(['chainId', 'call', 'logs', 'block', 'code', 'transaction']);

/** The members a signer recovery must carry as functions. */
export const BUILDER_SIGNER_RECOVERY_MEMBERS: readonly string[] = Object.freeze(['recoverSigner']);

/** The members an event manager arguments record may carry. */
export const BUILDER_EVENT_MANAGER_OPTIONS: readonly string[] = Object.freeze(['logChunkSize']);

/** The members an action codec arguments record may carry. */
export const BUILDER_CODEC_OPTIONS: readonly string[] = Object.freeze(['actions']);

/** The members a holder's builder inputs may carry. */
export const BUILDER_HOLDER_INPUT_MEMBERS: readonly string[] = Object.freeze(['provider', 'account', 'descriptor', 'chainId', 'configuration', 'deviceBindings']);

/** The members an approver's builder inputs may carry. */
export const BUILDER_APPROVER_INPUT_MEMBERS: readonly string[] = Object.freeze(['descriptor', 'chainId', 'deviceBindings']);
