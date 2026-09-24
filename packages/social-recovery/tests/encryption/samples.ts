import type { BackupAuthenticated, Clause, Configuration, Credential, Hex } from '../../src/index';
import { BACKUP_PAYLOAD_VERSION } from '../../src/index';

export const WALLET_CONFIG_ADDRESS: Hex = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
/** The config in the blessed `method-ecdsa-config.json` vector. */
export const WALLET_CONFIG_WORD: Hex = '0x0000000000000000000000007e5f4552091a69125d5dfcb7b8c2659029395bdf';
/** The config in the blessed `method-passkey-config.json` vector. */
export const PASSKEY_CONFIG: Hex =
  '0x7cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc4766997807775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d11f4228a6a013a3f630b909758979b417fe85c904352c0bb7ca7fa5bcfe8f91c4';
export const ZKPASSPORT_CONFIG_WORD: Hex = '0x000000000000000000000000000000000000000000000000000000000000007b';
/** The config in the blessed `method-zkpassport-config.json` vector. */
export const ZKPASSPORT_CONFIG_BLESSED: Hex =
  '0x000000000000000000000000000000000000000000000000000000000000007b000000140000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000015180000000000000000000000000000000000000000000000000000000000000000f7265636f7665722e6578616d706c65000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000146d6173742d736f6369616c2d7265636f76657279000000000000000000000000';
export const AADHAAR_CONFIG_WORD: Hex = '0x0000000000000000000000000000000000000000000000000000000000000016';
/** The config in the blessed `method-aadhaar-config.json` vector. */
export const AADHAAR_CONFIG_BLESSED: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000004d';

export const METHOD_WALLET: Hex = '0xE1E1e1E1e1e1E1e1e1E1e1E1E1e1e1E1e1E1e1E1';
export const METHOD_PASSKEY: Hex = '0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2';
export const METHOD_ZKPASSPORT: Hex = '0xe3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3';
export const METHOD_AADHAAR: Hex = '0xe4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4';

export const SALT_A: Hex = '0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5';
export const SALT_B: Hex = '0x00000000000000000000000000000000000000000000000000000000000000ff';

export const PASSWORD = 'correct horse battery staple';
export const NONCE: Hex = '0x000102030405060708090a0b';

export const AUTHENTICATED: BackupAuthenticated = {
  account: '0x1111111111111111111111111111111111111111',
  action: '0x2222222222222222222222222222222222222222',
  setupCommitment: '0x3b1e189bc6ddd62d50aa6528425d62fbe67d7c8f450aa5bdb69ad3ae05b96579',
  nonce: 7n,
  payloadVersion: BACKUP_PAYLOAD_VERSION,
};

export const oneCredentialRule = (credential: Credential, wait = 86_400): Configuration => ({
  clauses: [{ threshold: 1, credentials: [credential] }],
  wait,
  ignoresPause: false,
});

/** `count` passkey credentials in one clause, each with a supplied salt where `salted`. */
export function passkeyRule(count: number, salted: boolean): Configuration {
  const credentials: Credential[] = Array.from({ length: count }, (_, index) => ({
    method: METHOD_PASSKEY,
    config: PASSKEY_CONFIG,
    ...(salted ? { salt: `0x${index.toString(16).padStart(64, '0')}` as Hex } : {}),
  }));

  return { clauses: [{ threshold: Math.min(count, 255), credentials }], wait: 3_600, ignoresPause: true };
}

/**
 * `count` one-credential clauses of a salted passkey at the largest wait, the worst case
 * BACKUP_PADDING_SIZE is sized for; `lastConfigExtra` widens the last config by that many bytes.
 */
export function passkeyClausesRule(count: number, lastConfigExtra = 0): Configuration {
  const clauses: Clause[] = Array.from({ length: count }, (_, index) => ({
    threshold: 1,
    credentials: [
      {
        method: METHOD_PASSKEY,
        config: index === count - 1 ? (`${PASSKEY_CONFIG}${'ab'.repeat(lastConfigExtra)}` as Hex) : PASSKEY_CONFIG,
        salt: `0x${index.toString(16).padStart(64, '0')}` as Hex,
      },
    ],
  }));

  return { clauses, wait: 2 ** 48 - 1, ignoresPause: true };
}

/** Every shipped method in one rule, in two clauses, with supplied salts on some. */
export const MIXED_RULE: Configuration = {
  clauses: [
    {
      threshold: 2,
      credentials: [
        { method: METHOD_WALLET, config: WALLET_CONFIG_WORD, label: 'Alice' },
        { method: METHOD_PASSKEY, config: PASSKEY_CONFIG, salt: SALT_A },
        { method: METHOD_ZKPASSPORT, config: ZKPASSPORT_CONFIG_BLESSED },
      ],
    },
    { threshold: 1, credentials: [{ method: METHOD_AADHAAR, config: AADHAAR_CONFIG_BLESSED, salt: SALT_B, label: 'Bob' }] },
  ],
  wait: 2 ** 48 - 1,
  ignoresPause: true,
};

/**
 * What an opened configuration is expected to be: the backup payload carries no
 * label, so opening drops it; a supplied salt is kept and none is added; hex
 * comes back lowercase.
 */
export function expectedOpened(configuration: Configuration): Configuration {
  const clauses: Clause[] = configuration.clauses.map((clause) => ({
    threshold: clause.threshold,
    credentials: clause.credentials.map((credential) => ({
      method: credential.method.toLowerCase() as Hex,
      config: credential.config.toLowerCase() as Hex,
      ...(credential.salt === undefined ? {} : { salt: credential.salt.toLowerCase() as Hex }),
    })),
  }));

  return { clauses, wait: configuration.wait, ignoresPause: configuration.ignoresPause };
}

/** Flips every bit of the byte at `position` of a hex payload. */
export function flipByte(payload: Hex, position: number, mask = 0xff): Hex {
  const bytes = Buffer.from(payload.slice(2), 'hex');
  const current = bytes[position];

  if (current === undefined) throw new Error(`position ${position} outside ${bytes.length}`);

  bytes[position] = current ^ mask;

  return `0x${bytes.toString('hex')}`;
}

export const byteLength = (hex: Hex): number => (hex.length - 2) / 2;
