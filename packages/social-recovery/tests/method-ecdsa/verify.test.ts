import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { VERDICTS, walletMethod, type Hex } from '../../src/index';
import {
  addressWord,
  ctxFor,
  digestOf,
  highSTwin,
  KEY_ONE,
  KEY_TWO,
  rawRecovery,
  SIGNER_ONE,
  SIGNER_TWO,
  signDigest,
  signPersonal,
  typedDataFor,
} from './fixtures';

const method = walletMethod();

const FLAGS = [false, true] as const;

const onMismatch = (holdsCode: boolean): string => (holdsCode ? 'not-judged' : 'rejected');

describe('a signature over the digest', () => {
  it('the ctx digest is the EIP-712 hash of the ctx typed data (fixture sanity)', () => {
    const ctx = ctxFor();

    expect(ctx.digest).toBe(digestOf(typedDataFor()));
  });

  it.each(FLAGS)('verifies as satisfied (credentialHoldsCode %s)', async (holdsCode) => {
    const ctx = ctxFor({ credentialHoldsCode: holdsCode });

    expect(await method.verify(ctx, await signDigest(ctx.digest))).toBe('satisfied');
  });

  it('a wallet signing the ctx typed data with eth_signTypedData produces a satisfied proof', async () => {
    const ctx = ctxFor();
    const signature = await privateKeyToAccount(KEY_ONE).signTypedData(
      ctx.typedData as unknown as Parameters<ReturnType<typeof privateKeyToAccount>['signTypedData']>[0],
    );

    expect(await method.verify(ctx, signature)).toBe('satisfied');
  });

  it('a cancellation place verifies the same way', async () => {
    const ctx = ctxFor({ purpose: 'cancellation' });

    expect(await method.verify(ctx, await signDigest(ctx.digest))).toBe('satisfied');
  });

  it('upper-case hex of the same signature is still satisfied', async () => {
    const ctx = ctxFor();
    const signature = await signDigest(ctx.digest);

    expect(await method.verify(ctx, `0x${signature.slice(2).toUpperCase()}` as Hex)).toBe('satisfied');
  });
});

describe('the same key signing anything but the digest', () => {
  it.each(FLAGS)('a personal-message signature over the digest bytes: credentialHoldsCode %s', async (holdsCode) => {
    const ctx = ctxFor({ credentialHoldsCode: holdsCode });

    expect(await method.verify(ctx, await signPersonal(ctx.digest))).toBe(onMismatch(holdsCode));
  });

  it.each(FLAGS)('a signature over another place\'s digest: credentialHoldsCode %s', async (holdsCode) => {
    const ctx = ctxFor({ credentialHoldsCode: holdsCode });
    const other = ctxFor({ place: 3 });

    expect(await method.verify(ctx, await signDigest(other.digest))).toBe(onMismatch(holdsCode));
  });

  it.each(FLAGS)('an approval signature presented for the cancellation: credentialHoldsCode %s', async (holdsCode) => {
    const cancel = ctxFor({ purpose: 'cancellation', credentialHoldsCode: holdsCode });
    const approval = ctxFor();

    expect(await method.verify(cancel, await signDigest(approval.digest))).toBe(onMismatch(holdsCode));
  });
});

describe('a config that is not the signer', () => {
  it.each(FLAGS)('another key signing: credentialHoldsCode %s', async (holdsCode) => {
    const ctx = ctxFor({ credentialHoldsCode: holdsCode });

    expect(await method.verify(ctx, await signDigest(ctx.digest, KEY_TWO))).toBe(onMismatch(holdsCode));
  });

  it.each(FLAGS)('the config names another guardian: credentialHoldsCode %s', async (holdsCode) => {
    const ctx = ctxFor({ guardian: SIGNER_TWO, credentialHoldsCode: holdsCode });

    expect(await method.verify(ctx, await signDigest(ctx.digest))).toBe(onMismatch(holdsCode));
  });

  it.each(FLAGS)('bytes an ERC-1271 wallet might check (not 65 long): credentialHoldsCode %s', async (holdsCode) => {
    const ctx = ctxFor({ credentialHoldsCode: holdsCode });

    expect(await method.verify(ctx, '0xbeef')).toBe(onMismatch(holdsCode));
    expect(await method.verify(ctx, `0x${'ab'.repeat(120)}`)).toBe(onMismatch(holdsCode));
  });

  it.each(FLAGS)('an empty proof: credentialHoldsCode %s', async (holdsCode) => {
    const ctx = ctxFor({ credentialHoldsCode: holdsCode });

    expect(await method.verify(ctx, '0x')).toBe(onMismatch(holdsCode));
  });
});

describe('the shapes the module\'s library refuses are never satisfied', () => {
  it('the high-s twin of a valid signature is not satisfied for a key guardian', async () => {
    const ctx = ctxFor();
    const high = highSTwin(await signDigest(ctx.digest));

    expect(await method.verify(ctx, high)).toBe('rejected');
  });

  it('a recovery byte of 0 or 1 is not satisfied for a key guardian', async () => {
    const ctx = ctxFor();

    expect(await method.verify(ctx, rawRecovery(await signDigest(ctx.digest)))).toBe('rejected');
  });

  it('r = 0 or s = 0 is not satisfied', async () => {
    const ctx = ctxFor();

    expect(await method.verify(ctx, `0x${'00'.repeat(32)}${'11'.repeat(32)}1b`)).toBe('rejected');
    expect(await method.verify(ctx, `0x${'11'.repeat(32)}${'00'.repeat(32)}1b`)).toBe('rejected');
  });

  it.each(FLAGS)('the zero-address config is never satisfied: credentialHoldsCode %s', async (holdsCode) => {
    const ctx = ctxFor({ guardian: '0x0000000000000000000000000000000000000000', credentialHoldsCode: holdsCode });
    const verdict = await method.verify(ctx, `0x${'ff'.repeat(65)}`);

    expect(verdict).not.toBe('satisfied');

    if (!holdsCode) expect(verdict).toBe('rejected');
  });
});

describe('undecodable config or non-hex proof: rejected whatever the flag', () => {
  const badConfigs: readonly (readonly [string, Hex])[] = [
    ['one byte', '0x12'],
    ['the bare 20-byte address', SIGNER_ONE],
    ['dirty padding', `0x01${addressWord(SIGNER_ONE).slice(4)}`],
    ['a trailing byte', `${addressWord(SIGNER_ONE)}00`],
    ['not hex', `0x${'zz'.repeat(32)}`],
  ];

  for (const holdsCode of FLAGS) {
    it.each(badConfigs)(`config %s, credentialHoldsCode ${String(holdsCode)}`, async (_label, config) => {
      const ctx = ctxFor({ config, credentialHoldsCode: holdsCode });

      expect(await method.verify(ctx, await signDigest(ctx.digest))).toBe('rejected');
    });

    it.each([
      ['odd-length hex', '0x123'],
      ['non-hex characters', '0xzz'],
      ['no 0x prefix', 'abcd'],
      ['a valid signature missing its prefix', 'SIGNATURE'],
    ])(`proof %s, credentialHoldsCode ${String(holdsCode)}`, async (_label, raw) => {
      const ctx = ctxFor({ credentialHoldsCode: holdsCode });
      const proof = raw === 'SIGNATURE' ? (await signDigest(ctx.digest)).slice(2) : raw;

      expect(await method.verify(ctx, proof as Hex)).toBe('rejected');
    });
  }
});

describe('verify answers, never throws', () => {
  it('resolves to one of the three verdicts for garbage input', async () => {
    const inputs: readonly Hex[] = [`0x${'ff'.repeat(65)}`, `0x${'00'.repeat(65)}`, `0x${'ff'.repeat(64)}1c`];

    for (const holdsCode of FLAGS) {
      for (const proof of inputs) {
        const verdict = await method.verify(ctxFor({ credentialHoldsCode: holdsCode }), proof);

        expect(VERDICTS).toContain(verdict);
        expect(verdict).not.toBe('satisfied');
      }
    }
  });
});
