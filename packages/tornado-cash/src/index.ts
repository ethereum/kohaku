export * from './v1';
// Main factory
export { TornadoCashProtocol } from './plugin/base';
export { SecretManager } from './account/keys';
export { SignatureSecretManager, KeystoreEnvelopeSigner } from './account/signature-keys';

// Types
export type { SecretManagerParams, ISecretManager, LegacySecretManager } from './account/keys';
export type { SignatureSecretManagerParams, EnvelopeSigner, NoteEnvelope } from './account/signature-keys';
export type { Commitment, Nullifier } from './account/types';

// Configs
export { TornadoCashConfigs, E_ADDRESS, TornadoPaymasterConfigs, ExtendedEthPools, extendedEthPoolSet } from './config.js';
export { TornadoInstances } from './instances';
export type { ITornadoInstance } from './instances';
