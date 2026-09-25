import { describe, expect, it } from 'vitest';
import { REPLY_FAILURE_CAUSES, walletMethod, type Hex, type Material } from '../../src/index';
import { CURVE_ORDER, ctxFor, highSTwin, rawRecovery, signaturesByParity, signDigest, splitSignature } from './fixtures';

const method = walletMethod();

const HALF_ORDER = CURVE_ORDER / 2n;

const reply = (signature: unknown, ctx = ctxFor()): Promise<Hex | { kind: string; cause: string }> =>
  method.replyFrom(ctx, method.signingInput(ctx), { signature });

describe('signingInput(ctx)', () => {
  it.each(['approval', 'cancellation'] as const)('returns the %s typed data the ctx carries, as it is', (purpose) => {
    const ctx = ctxFor({ purpose });

    expect(method.signingInput(ctx)).toStrictEqual(ctx.typedData);
  });

  it('ignores optional params, the wallet method has none', () => {
    const ctx = ctxFor();

    expect(method.signingInput(ctx, { anything: 1 })).toStrictEqual(ctx.typedData);
  });
});

describe('replyFrom normalization', () => {
  it('leaves a low-s signature with v = 27 or 28 unchanged', async () => {
    const { v27, v28 } = await signaturesByParity();

    expect(await reply(v27.signature, v27.ctx)).toBe(v27.signature);
    expect(await reply(v28.signature, v28.ctx)).toBe(v28.signature);
  });

  it('lowers a high s to n - s with the other recovery byte, and the result verifies', async () => {
    const { v27, v28 } = await signaturesByParity();

    for (const { signature, ctx } of [v27, v28]) {
      const high = highSTwin(signature);

      expect(splitSignature(high).s > HALF_ORDER).toBe(true);

      const lowered = await reply(high, ctx);

      expect(lowered).toBe(signature);
      expect(await method.verify(ctx, lowered as Hex)).toBe('satisfied');
    }
  });

  it('maps a recovery byte of 0 to 27 and of 1 to 28', async () => {
    const { v27, v28 } = await signaturesByParity();

    expect(splitSignature(rawRecovery(v27.signature)).v).toBe(0);
    expect(await reply(rawRecovery(v27.signature), v27.ctx)).toBe(v27.signature);
    expect(splitSignature(rawRecovery(v28.signature)).v).toBe(1);
    expect(await reply(rawRecovery(v28.signature), v28.ctx)).toBe(v28.signature);
  });

  it('does both at once: a high s with a raw 0/1 recovery byte', async () => {
    const { v27, v28 } = await signaturesByParity();

    for (const { signature, ctx } of [v27, v28]) {
      const lowered = await reply(highSTwin(signature, true), ctx);

      expect(lowered).toBe(signature);
      expect(await method.verify(ctx, lowered as Hex)).toBe('satisfied');
    }
  });

  it('returns upper-case hex as the same bytes', async () => {
    const ctx = ctxFor();
    const signature = await signDigest(ctx.digest);
    const result = await reply(`0x${signature.slice(2).toUpperCase()}`, ctx);

    expect(typeof result === 'string' ? result.toLowerCase() : result).toBe(signature);
  });

  it.each([
    ['2 bytes', '0xbeef'],
    ['64 bytes', `0x${'ff'.repeat(64)}`],
    ['66 bytes', `0x${'ff'.repeat(66)}`],
    ['300 bytes', `0x${'a5'.repeat(300)}`],
  ])('passes %s an ERC-1271 wallet returned through as returned', async (_label, bytes) => {
    const result = await reply(bytes);

    expect(typeof result === 'string' ? result.toLowerCase() : result).toBe(bytes);
  });
});

describe('malformed material is a typed ReplyFailure, never a throw', () => {
  const malformed: readonly (readonly [string, Material])[] = [
    ['empty bytes (the row\'s own case)', { signature: '0x' }],
    ['odd-length hex', { signature: '0x123' }],
    ['non-hex characters', { signature: '0xzz' }],
    ['no 0x prefix', { signature: 'abcd' }],
    ['a number', { signature: 27 }],
    ['a byte array rather than hex', { signature: new Uint8Array(65) }],
    ['null', { signature: null }],
    ['no signature member', {}],
    ['a misnamed member', { sig: '0x1234' }],
    ['no material at all', undefined],
  ];

  it.each(malformed)('%s', async (_label, material) => {
    const ctx = ctxFor();
    const call = method.replyFrom(ctx, method.signingInput(ctx), material);

    await expect(call).resolves.toBeDefined();

    const result = await call;

    expect(typeof result).toBe('object');
    expect(result).toMatchObject({ kind: 'reply-failure' });
    expect(REPLY_FAILURE_CAUSES).toContain((result as { cause: string }).cause);
    // The material was the wrong shape for this method.
    expect((result as { cause: string }).cause).toBe('material-rejected');
  });
});
