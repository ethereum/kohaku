import { getAddress } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  deserializeConfiguration,
  openBackup,
  sealBackup,
  serializeConfiguration,
  type BackupAuthenticated,
  type Configuration,
  type Hex,
} from '../../src/index';
import { referenceSeal, referenceSerialize, toHex } from './reference';
import {
  AUTHENTICATED,
  METHOD_WALLET,
  METHOD_WALLET_BAD_CHECKSUM,
  MIXED_RULE,
  NONCE,
  oneCredentialRule,
  PASSWORD,
  SALT_A,
  WALLET_CONFIG_WORD,
} from './samples';

const TIMEOUT = 60_000;
const upper = (hex: Hex): Hex => `0x${hex.slice(2).toUpperCase()}`;
/** The three spellings the address rule accepts for one address. */
const spellings = (checksummed: Hex): readonly Hex[] => [checksummed.toLowerCase() as Hex, upper(checksummed), checksummed];
/** The EIP-55 spelling of `0xabab…ab`, a mixed-case account with a correct checksum. */
const ACCOUNT: Hex = '0xABaBaBaBABabABabAbAbABAbABabababaBaBABaB';
const ACCOUNT_BAD_CHECKSUM: Hex = '0xaBaBaBaBABabABabAbAbABAbABabababaBaBABaB';
/** The EIP-55 spelling of `0xcdcd…cd`. */
const ACTION: Hex = '0xCdCDCdCdcdcdcdCdcDcDCdcDcDCdCdcdCdcDCDcD';
const ACTION_BAD_CHECKSUM: Hex = '0xcdCDCdCdcdcdcdCdcDcDCdcDcDCdCdcdCdcDCDcD';
const METHOD_WALLET_RULE_PATH = 'configuration.clauses[0].credentials[0].method';

const walletRule = (method: Hex): Configuration =>
  oneCredentialRule({ method, config: upper(WALLET_CONFIG_WORD), salt: upper(SALT_A) });
const authenticatedWith = (account: Hex, action: Hex): BackupAuthenticated => ({ ...AUTHENTICATED, account, action });
const seal = (configuration: Configuration, authenticated = AUTHENTICATED): Promise<Hex> =>
  sealBackup(configuration, PASSWORD, NONCE, BACKUP_PADDING_SIZE, authenticated);

/** The error `attempt` rejects with; fails the test when it resolves. */
async function failure(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return error;
  }

  throw new Error('expected the attempt to fail');
}

describe('the checksums the samples rely on', () => {
  it('spells each sample checksum as the EIP-55 rule does, and each bad one differs from it only in case', () => {
    const pairs: ReadonlyArray<readonly [Hex, Hex]> = [
      [METHOD_WALLET, METHOD_WALLET_BAD_CHECKSUM],
      [ACCOUNT, ACCOUNT_BAD_CHECKSUM],
      [ACTION, ACTION_BAD_CHECKSUM],
    ];

    for (const [good, bad] of pairs) {
      expect(getAddress(good)).toBe(good);
      expect(getAddress(bad)).not.toBe(bad);
      expect(bad.toLowerCase()).toBe(good.toLowerCase());
    }
  });
});

describe('a credential method accepts all-lower, all-upper and EIP-55 spellings and refuses a wrong checksum', () => {
  it('serializes the three accepted spellings to identical bytes, the reference serialization', () => {
    const serialized = spellings(METHOD_WALLET).map((method) => serializeConfiguration(walletRule(method)));

    expect(new Set(serialized).size).toBe(1);
    expect(serialized[0]).toBe(toHex(referenceSerialize(walletRule(METHOD_WALLET))));
  });

  it('seals the three accepted spellings to identical payloads', async () => {
    const payloads = await Promise.all(spellings(METHOD_WALLET).map((method) => seal(walletRule(method))));

    expect(new Set(payloads).size).toBe(1);
    expect(payloads[0]).toBe(referenceSeal(walletRule(METHOD_WALLET), PASSWORD, NONCE, BACKUP_PADDING_SIZE, AUTHENTICATED));
  }, TIMEOUT);

  it('refuses a mixed-case method whose checksum fails, from serializeConfiguration and sealBackup, before any key derivation', async () => {
    const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    const message = `${METHOD_WALLET_RULE_PATH} must be a 20-byte address`;

    expect(() => serializeConfiguration(walletRule(METHOD_WALLET_BAD_CHECKSUM))).toThrow(TypeError);
    expect(() => serializeConfiguration(walletRule(METHOD_WALLET_BAD_CHECKSUM))).toThrow(message);

    const error = await failure(seal(walletRule(METHOD_WALLET_BAD_CHECKSUM)));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(message);
    expect(derive).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('an opened method comes back EIP-55 checksummed, configs and salts lower-case', () => {
  it.for(spellings(METHOD_WALLET).map((method) => [method] as const))(
    'deserializes a configuration sealed with %s to the checksummed method',
    ([method]) => {
      const [credential] = deserializeConfiguration(serializeConfiguration(walletRule(method))).clauses[0]?.credentials ?? [];

      expect(credential).toEqual({ method: METHOD_WALLET, config: WALLET_CONFIG_WORD, salt: SALT_A });
    },
  );

  it('opens every method of the mixed rule in its checksummed spelling', async () => {
    const opened = await openBackup(await seal(MIXED_RULE), PASSWORD, AUTHENTICATED);

    expect(opened.clauses.flatMap((clause) => clause.credentials.map((credential) => credential.method))).toEqual([
      '0xE1E1E1e1E1E1e1e1E1E1E1e1e1e1E1E1E1E1e1e1',
      '0xe2E2E2e2e2e2E2E2E2E2e2E2e2E2E2e2e2e2E2e2',
      '0xe3e3E3E3E3E3E3e3E3E3e3E3E3E3e3e3E3E3e3E3',
      '0xE4E4e4e4E4E4e4E4E4e4e4e4E4e4E4E4e4E4E4e4',
    ]);
  }, TIMEOUT);

  it('opens an all-upper sealed rule with the checksummed method and lower-case config and salt', async () => {
    const opened = await openBackup(await seal(walletRule(upper(METHOD_WALLET))), PASSWORD, AUTHENTICATED);

    expect(opened).toEqual(oneCredentialRule({ method: METHOD_WALLET, config: WALLET_CONFIG_WORD, salt: SALT_A }));
  }, TIMEOUT);
});

describe('the authenticated account and action follow the same address rule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seals identical payloads under the three accepted spellings of account and action, and opens under any of them', async () => {
    const sets = spellings(ACCOUNT).map((account, index) => authenticatedWith(account, spellings(ACTION)[index] as Hex));
    const payloads = await Promise.all(sets.map((authenticated) => seal(MIXED_RULE, authenticated)));
    const [payload] = payloads;

    expect(new Set(payloads).size).toBe(1);
    expect(payload).toBe(referenceSeal(MIXED_RULE, PASSWORD, NONCE, BACKUP_PADDING_SIZE, authenticatedWith(ACCOUNT, ACTION)));
    await expect(openBackup(payload as Hex, PASSWORD, authenticatedWith(ACCOUNT, upper(ACTION)))).resolves.toBeDefined();
  }, TIMEOUT);

  it.for([
    ['account', authenticatedWith(ACCOUNT_BAD_CHECKSUM, ACTION)],
    ['action', authenticatedWith(ACCOUNT, ACTION_BAD_CHECKSUM)],
  ] as const)('refuses a wrong-checksum %s as a TypeError from sealBackup and openBackup, before any key derivation', async ([field, authenticated]) => {
    const derive = vi.spyOn(globalThis.crypto.subtle, 'deriveKey');
    const message = `authenticated.${field} must be a 20-byte address`;
    const sealError = await failure(seal(MIXED_RULE, authenticated));
    const openError = await failure(openBackup(`0x${'00'.repeat(12 + BACKUP_PADDING_SIZE + 16)}`, PASSWORD, authenticated));

    for (const error of [sealError, openError]) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toBe(message);
    }

    expect(derive).not.toHaveBeenCalled();
  });
});
