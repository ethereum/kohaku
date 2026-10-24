export * from './v1';
// Main factory
export { TornadoCashProtocol } from './plugin/base';
export { SecretManager } from './account/keys';
export { SignatureSecretManager, KeystoreEnvelopeSigner } from './account/signature-keys';

// Types
export type { SecretManagerParams, ISecretManager, LegacySecretManager } from './account/keys';
export type { SignatureSecretManagerParams, EnvelopeSigner, NoteEnvelope } from './account/signature-keys';
export type { Commitment, Nullifier } from './account/types';

// Proving artifacts
export { TORNADO_CIRCUIT_SHA256, TORNADO_PROVING_KEY_SHA256, TornadoArtifactsIntegrityError } from './utils/artifacts-integrity';

// Configs
export { TornadoCashConfigs, E_ADDRESS, TornadoPaymasterConfigs, ExtendedEthPools, extendedEthPoolSet } from './config.js';
