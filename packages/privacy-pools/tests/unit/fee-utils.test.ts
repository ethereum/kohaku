import { describe, expect, it } from 'vitest';

import { deductFeeBPS, grossForNet, minAcceptableNet } from '../../src/utils/fee.utils';

describe('deductFeeBPS', () => {
  it('charges feeBPS / 10000 of the amount', () => {
    expect(deductFeeBPS(1_000_000n, 100n)).toEqual({ fee: 10_000n, net: 990_000n });
  });

  it('floors the fee like the Entrypoint does', () => {
    expect(deductFeeBPS(999n, 100n)).toEqual({ fee: 9n, net: 990n });
  });

  it('returns no fee for 0 bps', () => {
    expect(deductFeeBPS(123n, 0n)).toEqual({ fee: 0n, net: 123n });
  });
});

describe('grossForNet', () => {
  it('returns the net unchanged for 0 bps', () => {
    expect(grossForNet(1_000n, 0n)).toBe(1_000n);
  });

  it('finds a gross that nets at least the requested output', () => {
    const gross = grossForNet(990_000n, 100n);

    expect(deductFeeBPS(gross, 100n).net).toBeGreaterThanOrEqual(990_000n);
  });

  it('is the minimal such gross (one less falls short)', () => {
    const gross = grossForNet(990_000n, 100n);

    expect(deductFeeBPS(gross - 1n, 100n).net).toBeLessThan(990_000n);
  });

  it('round-trips deductFeeBPS across a range of nets and fees', () => {
    for (const net of [1n, 7n, 999n, 1_000_000n, 123_456_789n]) {
      for (const bps of [1n, 25n, 100n, 250n, 9_999n]) {
        const gross = grossForNet(net, bps);

        expect(deductFeeBPS(gross, bps).net).toBeGreaterThanOrEqual(net);
        expect(deductFeeBPS(gross - 1n, bps).net).toBeLessThan(net);
      }
    }
  });

  it('returns 0 for a non-positive net', () => {
    expect(grossForNet(0n, 100n)).toBe(0n);
  });

  it('rejects a fee of 100% or more', () => {
    expect(() => grossForNet(1_000n, 10_000n)).toThrow();
  });
});

describe('minAcceptableNet', () => {
  it('allows no shortfall at 0 bps', () => {
    expect(minAcceptableNet(1_000_000n, 0n)).toBe(1_000_000n);
  });

  it('subtracts the slippage allowance', () => {
    expect(minAcceptableNet(1_000_000n, 50n)).toBe(995_000n);
  });
});
