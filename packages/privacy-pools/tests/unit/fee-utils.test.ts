import { describe, expect, it } from 'vitest';

import { deductFeeBPS, grossForNet, sizeExactRelayerWithdrawal } from '../../src/utils/fee.utils';

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

describe('sizeExactRelayerWithdrawal', () => {
  const base = {
    requestedNet: 1_000_000n,
    baseFeeBPS: 50n,      // 0.5% fixed relayer margin
    gasMoney: 2_000n,     // fixed gas cost, in token units
    gasBumpBPS: 0n,
    maxRelayFeeBPS: 1_000n,
  };

  it('sizes the gross so the recipient nets exactly the requested output', () => {
    const { grossAmount, feeBPS } = sizeExactRelayerWithdrawal(base);

    expect(deductFeeBPS(grossAmount, feeBPS).net).toBe(base.requestedNet);
    expect(grossAmount).toBeGreaterThan(base.requestedNet);
  });

  it('embeds base + gas, so the fee exceeds the base rate but stays modest', () => {
    const { feeBPS } = sizeExactRelayerWithdrawal(base);

    // gas of 2000 on a ~1.0025e6 gross is ~20 bps on top of the 50 bps base.
    expect(feeBPS).toBeGreaterThan(base.baseFeeBPS);
    expect(feeBPS).toBeLessThan(base.baseFeeBPS + 30n);
  });

  it('bumps only the gas component, not the base rate', () => {
    const { feeBPS: plain } = sizeExactRelayerWithdrawal(base);
    const { feeBPS: bumped } = sizeExactRelayerWithdrawal({ ...base, gasBumpBPS: 5_000n }); // +50% gas

    const plainGas = plain - base.baseFeeBPS;
    const bumpedGas = bumped - base.baseFeeBPS;

    // The gas portion grows ~50%; a whole-fee bump would have grown by 50% of `plain`.
    expect(bumpedGas).toBeGreaterThan(plainGas);
    expect(bumped).toBeLessThan(base.baseFeeBPS + (plain * 15n) / 10n); // < base + 1.5*plain
    expect(deductFeeBPS(sizeExactRelayerWithdrawal({ ...base, gasBumpBPS: 5_000n }).grossAmount, bumped).net)
      .toBe(base.requestedNet);
  });

  it('treats zero/negative gas money as no gas component', () => {
    const { feeBPS } = sizeExactRelayerWithdrawal({ ...base, gasMoney: 0n });

    expect(feeBPS).toBe(base.baseFeeBPS);
  });

  it('throws when the required fee exceeds maxRelayFeeBPS', () => {
    expect(() => sizeExactRelayerWithdrawal({ ...base, maxRelayFeeBPS: 60n })).toThrow(/exceeds maxRelayFeeBPS/);
  });

  it('rejects a base fee of 100% or more', () => {
    expect(() => sizeExactRelayerWithdrawal({ ...base, baseFeeBPS: 10_000n })).toThrow();
  });
});
