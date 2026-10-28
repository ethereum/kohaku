/** The refusal message where no descriptor ships for the chain the builder was given or derived. */
export const BUILDER_UNKNOWN_CHAIN_MESSAGE = 'no deployment descriptor ships for this chain; pass a descriptor';

/** The refusal message where the chain's shipped descriptor still carries the zero address as its manager. */
export const BUILDER_NO_PUBLIC_DEPLOYMENT_MESSAGE = 'no public deployment ships for this chain; pass a descriptor';

/** The refusal message where the provider answers another chain id than the descriptor names. */
export const BUILDER_CHAIN_MISMATCH_MESSAGE = 'the provider is connected to another chain than the descriptor names';

/** The refusal message where the manager reverted or answered `eip712Domain()` with bytes that do not decode. */
export const BUILDER_NO_DOMAIN_MESSAGE = 'the manager address answered no EIP-712 domain';

/** The refusal message where the manager's domain names another chain than the descriptor and the provider. */
export const BUILDER_DOMAIN_CHAIN_MESSAGE = "the manager's EIP-712 domain names another chain than the descriptor";

/** The refusal message where the manager's domain names another verifying contract than the descriptor's manager. */
export const BUILDER_VERIFYING_CONTRACT_MESSAGE = "the manager's EIP-712 domain names another verifying contract than the descriptor's manager";

/** The refusal message where the domain's `fields` bitmap is not name, version, chain id and verifying contract alone. */
export const BUILDER_DOMAIN_FIELDS_MESSAGE = "the manager's EIP-712 domain carries other members than this build derives digests under";

/** The refusal message where the domain's version is not the digest version of the descriptor or of this build. */
export const BUILDER_DIGEST_VERSION_MESSAGE = "the manager's digest version is not the one this build derives digests under";

/** The refusal message where the domain's name is not the policy manager's. */
export const BUILDER_DOMAIN_NAME_MESSAGE = "the manager's EIP-712 domain name is not PolicyManager";

/** The refusal message where the manager is not one this build's setup body encoder is keyed to. */
export const BUILDER_BODY_ENCODER_MESSAGE = "the manager is not one this build's setup body encoder is keyed to";

/** The refusal message where a manager reading handed to the builder was taken on another chain or for another manager. */
export const BUILDER_READING_MISMATCH_MESSAGE = 'the manager reading was taken on another chain or for another manager';

/** The refusal message of the disarming write on an action part handed out for a deployment version this build does not serve. */
export const BUILDER_VERSION_ESCAPED_MESSAGE = 'this action part prepares nothing: the deployment answers a version this build does not serve';

/** The misuse message of a `with*` call on a builder that has built. */
export const BUILDER_FROZEN_MESSAGE = 'the builder has built; its parts can no longer change';

/** The misuse message of a `with*` call while a build is still running; the parts can change again if that build fails. */
export const BUILDER_PENDING_MESSAGE = 'the builder is still building; its parts can change again only if that build fails';

/** The misuse message of a client build on a builder given no provider and no account. */
export const BUILDER_APPROVER_MESSAGE = 'this builder has no provider or account; it builds the methods orchestrator alone';

/** The misuse message of a builder input carrying a provider without an account, or an account without a provider. */
export const BUILDER_HOLDER_INPUTS_MESSAGE = 'inputs need both a provider and an account, or neither';

/** The misuse message of a builder input that names no chain at all. */
export const BUILDER_NO_CHAIN_MESSAGE = 'inputs without a provider need a descriptor or a chainId';

/** The misuse message of an orchestrator build on a builder that cannot yet tell which chain's descriptor to read. */
export const BUILDER_UNRESOLVED_CHAIN_MESSAGE = 'pass a descriptor or a chainId, or build a client first, before building the methods orchestrator';

/** The range message where the descriptor and the chain id the inputs name disagree. */
export const BUILDER_CHAIN_ID_MISMATCH_MESSAGE = 'descriptor.chainId differs from chainId';

/** The misuse message where two registered method implementations claim one module address. */
export const BUILDER_MODULE_CLAIMED_MESSAGE = 'two registered method implementations claim the module';

/** The misuse message where two registered action codecs serve one action address. */
export const BUILDER_ACTION_CLAIMED_MESSAGE = 'two registered action codecs serve the action';
