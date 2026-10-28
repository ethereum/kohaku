import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  configurationBody,
  configurationCommitment,
  decodeSetupBody,
  encodeSetupBody,
  type Configuration,
  type SetupDraft,
} from '../../src/index';
import { anyAddress, anyBytes, bytesN, referenceBody, referenceConfigurationCommitment, run, TIMEOUT } from './support';

const credential = fc.record(
  { method: anyAddress, config: anyBytes(48), salt: bytesN(32), label: fc.string({ maxLength: 8 }) },
  { requiredKeys: ['method', 'config'] },
);

const configuration: fc.Arbitrary<Configuration> = fc.record({
  clauses: fc.array(fc.record({ threshold: fc.integer({ min: 0, max: 255 }), credentials: fc.array(credential, { maxLength: 4 }) }), {
    maxLength: 4,
  }),
  wait: fc.integer({ min: 0, max: 2 ** 48 - 1 }),
  ignoresPause: fc.boolean(),
});

const nonce = fc.bigInt({ min: 0n, max: (1n << 64n) - 1n });

describe('configuration body and commitment over arbitrary configurations', () => {
  it('the commitment equals the independent recomputation', () => {
    run(fc.property(configuration, anyAddress, anyAddress, nonce, (config, account, action, setupNonce) => {
      expect(configurationCommitment(config, account, action, setupNonce)).toBe(
        referenceConfigurationCommitment(config, account, action, setupNonce),
      );
    }));
  }, TIMEOUT);

  it('the body equals the independent recomputation', () => {
    run(fc.property(configuration, anyAddress, (config, account) => {
      expect(configurationBody(config, account)).toEqual(referenceBody(config, account));
    }));
  }, TIMEOUT);

  it('a draft gives the same body and commitment as its configuration', () => {
    const privacy = fc.record({ publicMetadata: anyBytes(16), backup: fc.constantFrom('encrypted', 'clear', 'empty' as const) });

    run(fc.property(configuration, privacy, anyAddress, anyAddress, nonce, (config, draftPrivacy, account, action, setupNonce) => {
      const draft: SetupDraft = { ...config, privacy: draftPrivacy };

      expect(configurationBody(draft, account)).toEqual(configurationBody(config, account));
      expect(configurationCommitment(draft, account, action, setupNonce)).toBe(configurationCommitment(config, account, action, setupNonce));
    }));
  }, TIMEOUT);

  it('the body round-trips through the body codec', () => {
    run(fc.property(configuration, anyAddress, (config, account) => {
      const body = configurationBody(config, account);

      expect(decodeSetupBody(encodeSetupBody(body))).toEqual(body);
    }));
  }, TIMEOUT);
});

describe('configurationBody over dense arrays', () => {
  it('never throws for a dense configuration and keeps one credential hash per flat place', () => {
    run(fc.property(configuration, anyAddress, (config, account) => {
      const body = configurationBody(config, account);
      const places = config.clauses.reduce((count, clause) => count + clause.credentials.length, 0);

      expect(body.clauses.reduce((count, clause) => count + clause.credentials.length, 0)).toBe(places);
    }));
  }, TIMEOUT);
});
