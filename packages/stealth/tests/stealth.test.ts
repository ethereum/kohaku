import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import {
  ANNOUNCEMENT_TOPIC,
  checkStealthAddress,
  computeStealthKey,
  decodeAnnouncement,
  encodeAnnounce,
  encodeMetaAddress,
  encodeRegisterKeys,
  encodeStealthMetaAddressOf,
  generateStealthAddress,
  nativeTransferMetadata,
  parseMetaAddress,
  selector,
} from '../src/index.ts';

const keyPair = (byte: string) => {
  const priv = hexToBytes(byte.repeat(32));
  return { priv, pub: `0x${bytesToHex(secp256k1.getPublicKey(priv, true))}` as const };
};
const addressOf = (uncompressed: Uint8Array) => `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(12))}`;
const spend = keyPair('a1');
const view = keyPair('b2');
const meta = encodeMetaAddress({ spendingPublicKey: spend.pub, viewingPublicKey: view.pub });

describe('ERC-5564 scheme 1', () => {
  it('known vector: P_spend + s_h*G gives the ScopeLift worked example address', () => {
    const P = secp256k1.Point.fromHex('023be430d8668638a68ff14b443d0751feb962baac1ef8b19f7689b98ab7372672')
      .add(secp256k1.Point.BASE.multiply(0xc17d8e71241c4fefb2a5c06f3080e359ec67ce42f3123736d6381ce5af956076n));
    expect(addressOf(P.toBytes(false))).toBe('0xf236126f35184de906a7cdeb00432a682f8352f4');
  });

  it('parses and re-encodes st: meta-addresses', () => {
    expect(meta.startsWith('st:eth:0x')).toBe(true);
    expect(parseMetaAddress(meta)).toEqual({ spendingPublicKey: spend.pub, viewingPublicKey: view.pub });
    expect(() => parseMetaAddress('st:eth:0x1234')).toThrow();
  });

  it('sender and recipient agree; the computed key controls the stealth address', () => {
    for (let i = 0; i < 10; i++) {
      const g = generateStealthAddress(meta);
      const found = checkStealthAddress({ viewingPrivateKey: view.priv, spendingPublicKey: spend.pub, ...g });
      expect(found).toBe(g.stealthAddress);
      const k = computeStealthKey({ spendingPrivateKey: spend.priv, viewingPrivateKey: view.priv, ephemeralPublicKey: g.ephemeralPublicKey });
      expect(addressOf(secp256k1.getPublicKey(k, false))).toBe(g.stealthAddress.toLowerCase());
    }
  });

  it('does not match another recipient', () => {
    const other = keyPair('c3');
    const g = generateStealthAddress(meta);
    expect(checkStealthAddress({ viewingPrivateKey: other.priv, spendingPublicKey: spend.pub, ...g })).toBeNull();
  });

  it('selectors match the deployed contracts', () => {
    expect(selector('announce(uint256,address,bytes,bytes)')).toBe('0x4d1f9583');
    expect(encodeRegisterKeys(meta).slice(0, 10)).toBe(selector('registerKeys(uint256,bytes)'));
    expect(encodeStealthMetaAddressOf('0x' + '11'.repeat(20))).toHaveLength(2 + 8 + 128);
  });

  it('announce calldata round trips into an Announcement log', () => {
    const g = generateStealthAddress(meta, hexToBytes('d4'.repeat(32)));
    const md = nativeTransferMetadata(g.viewTag, 10n ** 16n);
    const cd = encodeAnnounce({ stealthAddress: g.stealthAddress, ephemeralPublicKey: g.ephemeralPublicKey, metadata: md }).slice(10);
    const w = (i: number) => cd.slice(i * 64, i * 64 + 64);
    // event data = abi.encode(bytes, bytes): offsets shift by the two indexed words
    const data = '0x' + (BigInt('0x' + w(2)) - 64n).toString(16).padStart(64, '0') + (BigInt('0x' + w(3)) - 64n).toString(16).padStart(64, '0') + cd.slice(256);
    const a = decodeAnnouncement({ topics: [ANNOUNCEMENT_TOPIC, '0x' + w(0), '0x' + w(1), '0x' + '0'.repeat(64)], data });
    expect(a).not.toBeNull();
    expect(a!.schemeId).toBe(1);
    expect(a!.viewTag).toBe(g.viewTag);
    expect(a!.ephemeralPublicKey).toBe(g.ephemeralPublicKey);
    expect(checkStealthAddress({ viewingPrivateKey: view.priv, spendingPublicKey: spend.pub, ephemeralPublicKey: a!.ephemeralPublicKey, viewTag: a!.viewTag, stealthAddress: a!.stealthAddress })).toBe(g.stealthAddress);
  });

  it('ignores unrelated logs', () => {
    expect(decodeAnnouncement({ topics: ['0x' + '00'.repeat(32)], data: '0x' })).toBeNull();
  });
});
