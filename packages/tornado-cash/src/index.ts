export * from './v1';
// Main factory
export { TornadoCashProtocol } from './plugin/base';
export { SecretManager } from './account/keys';
export { SignatureSecretManager, KeystoreEnvelopeSigner } from './account/signature-keys';

// Types
export type { SecretManagerParams, ISecretManager, LegacySecretManager } from './account/keys';
export type { SignatureSecretManagerParams, EnvelopeSigner, NoteEnvelope } from './account/signature-keys';
export type { Commitment, Nullifier } from './account/types';

// Paymaster
export { DEFAULT_PAYMASTER_MAX_FEE_BPS } from './paymaster/fee-caps';

// Configs
export { TornadoCashConfigs, E_ADDRESS, TornadoPaymasterConfigs, ExtendedEthPools, extendedEthPoolSet } from './config.js';
