import { describe, expect, it } from 'vitest';

import { deductFeeBPS } from '../../src/utils/fee.utils';

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
