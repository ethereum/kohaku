export * from './v1';
export * from './v2';
// Main factory
export { PrivacyPoolsV1Protocol } from './plugin/base';
export { SecretManager } from './account/keys';

// Types
export type { SecretManagerParams, ISecretManager } from './account/keys';
export type { Commitment, Nullifier } from './account/types';

// Configs
export { PrivacyPoolsV1_0xBow, E_ADDRESS } from './config.js';
