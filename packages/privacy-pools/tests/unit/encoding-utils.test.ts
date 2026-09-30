import { describe, expect, it } from 'vitest';

import { decodeRelayData, encodeRelayData } from '../../src/utils/encoding.utils';

describe('encodeRelayData / decodeRelayData', () => {
  it('round-trips a relay data tuple', () => {
    const relayData = {
      recipient: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
      feeRecipient: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
      relayFeeBps: 115n,
    } as const;

    const decoded = decodeRelayData(encodeRelayData(relayData));

    // Addresses compared numerically to sidestep checksum casing.
    expect(BigInt(decoded.recipient)).toBe(BigInt(relayData.recipient));
    expect(BigInt(decoded.feeRecipient)).toBe(BigInt(relayData.feeRecipient));
    expect(decoded.relayFeeBps).toBe(relayData.relayFeeBps);
  });
});
