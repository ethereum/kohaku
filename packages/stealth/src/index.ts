/**
 * ERC-5564 stealth addresses, scheme 1 (secp256k1 with view tags), and ERC-6538 registry helpers.
 *
 * A stealth address hides one thing: that the receiving address belongs to the recipient.
 * The sender, the amount and the timing stay public.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-5564 and https://eips.ethereum.org/EIPS/eip-6538
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export type Hex = `0x${string}`;

/** Scheme id 1: secp256k1 with view tags. */
export const SCHEME_ID = 1;
/** Canonical CREATE2 singletons, same address on every chain where deployed. */
export const ANNOUNCER: Hex = '0x55649E01B5Df198D18D95b5cc5051630cfD45564';
export const REGISTRY: Hex = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538';
/** keccak256("Announcement(uint256,address,address,bytes,bytes)") */
export const ANNOUNCEMENT_TOPIC: Hex = '0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7';

const Point = secp256k1.Point;
const N = Point.CURVE().n;

const strip = (h: string): string => h.replace(/^0x/i, '');
const toHex = (b: Uint8Array): Hex => `0x${bytesToHex(b)}`;
const pad32 = (h: string): string => strip(h).toLowerCase().padStart(64, '0');
const bytesToBigInt = (b: Uint8Array): bigint => BigInt(toHex(b));

export function selector(signature: string): Hex {
  return toHex(keccak_256(utf8ToBytes(signature)).slice(0, 4));
}

export function checksumAddress(address: string): Hex {
  const hex = strip(address).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(hex)));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? hex[i]!.toUpperCase() : hex[i]!;
  return out as Hex;
}

function pointToAddress(p: InstanceType<typeof Point>): Hex {
  const raw = p.toBytes(false);
  return checksumAddress(bytesToHex(keccak_256(raw.slice(1)).slice(12)));
}

export type StealthMetaAddress = { spendingPublicKey: Hex; viewingPublicKey: Hex };

/** Accepts `st:<chain>:0x<spend><view>` or a bare 66-byte hex string (two compressed keys). */
export function parseMetaAddress(value: string): StealthMetaAddress {
  const raw = strip(String(value).trim().replace(/^st:[a-z0-9]+:/i, ''));
  if (!/^[0-9a-fA-F]{132}$/.test(raw)) throw new Error('stealth meta-address must be two compressed secp256k1 public keys (66 bytes)');
  const spendingPublicKey = `0x${raw.slice(0, 66).toLowerCase()}` as Hex;
  const viewingPublicKey = `0x${raw.slice(66).toLowerCase()}` as Hex;
  Point.fromHex(strip(spendingPublicKey));
  Point.fromHex(strip(viewingPublicKey));
  return { spendingPublicKey, viewingPublicKey };
}

export function encodeMetaAddress(m: StealthMetaAddress, chainShortName: string = "eth"): string {
  return `st:${chainShortName}:0x${strip(m.spendingPublicKey)}${strip(m.viewingPublicKey)}`.toLowerCase();
}

function sharedSecretHash(privateKey: Uint8Array, publicKey: Hex): Uint8Array {
  return keccak_256(secp256k1.getSharedSecret(privateKey, hexToBytes(strip(publicKey)), true));
}

export type GeneratedStealthAddress = { stealthAddress: Hex; ephemeralPublicKey: Hex; viewTag: number };

/** Sender: derive a one-time address from a meta-address. Pass `ephemeralPrivateKey` only for tests. */
export function generateStealthAddress(metaAddress: string, ephemeralPrivateKey?: Uint8Array): GeneratedStealthAddress {
  const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(metaAddress);
  const pE = ephemeralPrivateKey ?? secp256k1.utils.randomSecretKey();
  const sh = sharedSecretHash(pE, viewingPublicKey);
  const P = Point.fromHex(strip(spendingPublicKey)).add(Point.BASE.multiply(bytesToBigInt(sh) % N));
  return { stealthAddress: pointToAddress(P), ephemeralPublicKey: toHex(secp256k1.getPublicKey(pE, true)), viewTag: sh[0]! };
}

/**
 * Recipient: check one announcement with the viewing private key only.
 * Returns the stealth address on a match, otherwise null. The view tag skips about 255 of 256 non-matches early.
 */
export function checkStealthAddress(args: { viewingPrivateKey: Uint8Array; spendingPublicKey: Hex; ephemeralPublicKey: Hex; viewTag: number; stealthAddress: string }): Hex | null {
  let sh: Uint8Array;
  try {
    sh = sharedSecretHash(args.viewingPrivateKey, args.ephemeralPublicKey);
  } catch {
    return null;
  }
  if (sh[0] !== args.viewTag) return null;
  const addr = pointToAddress(Point.fromHex(strip(args.spendingPublicKey)).add(Point.BASE.multiply(bytesToBigInt(sh) % N)));
  return addr.toLowerCase() === args.stealthAddress.toLowerCase() ? addr : null;
}

/** Recipient: private key of a matched stealth address, p_stealth = p_spend + s_h mod n. */
export function computeStealthKey(args: { spendingPrivateKey: Uint8Array; viewingPrivateKey: Uint8Array; ephemeralPublicKey: Hex }): Uint8Array {
  const sh = sharedSecretHash(args.viewingPrivateKey, args.ephemeralPublicKey);
  const k = (bytesToBigInt(args.spendingPrivateKey) + bytesToBigInt(sh)) % N;
  return hexToBytes(k.toString(16).padStart(64, '0'));
}

export type Announcement = { schemeId: number; stealthAddress: Hex; caller: Hex; ephemeralPublicKey: Hex; metadata: Hex; viewTag: number };

/** Decode an Announcer log. Returns null for other events or malformed data. */
export function decodeAnnouncement(log: { topics: readonly string[]; data: string }): Announcement | null {
  if (log.topics.length < 4 || log.topics[0]!.toLowerCase() !== ANNOUNCEMENT_TOPIC) return null;
  const d = strip(log.data);
  const readBytes = (wordIndex: number): string => {
    const at = parseInt(d.slice(wordIndex * 64, wordIndex * 64 + 64), 16) * 2;
    const len = parseInt(d.slice(at, at + 64), 16);
    if (!Number.isFinite(len) || at + 64 + len * 2 > d.length) throw new Error('bad bytes');
    return d.slice(at + 64, at + 64 + len * 2);
  };
  try {
    const e = readBytes(0);
    const m = readBytes(1);
    if (m.length < 2) return null;
    return {
      schemeId: Number(BigInt(log.topics[1]!)),
      stealthAddress: checksumAddress(log.topics[2]!.slice(-40)),
      caller: checksumAddress(log.topics[3]!.slice(-40)),
      ephemeralPublicKey: `0x${e}`,
      metadata: `0x${m}`,
      viewTag: parseInt(m.slice(0, 2), 16),
    };
  } catch {
    return null;
  }
}

function encodeBytes(hex: string): string {
  const h = strip(hex);
  return (h.length / 2).toString(16).padStart(64, '0') + h.padEnd(Math.ceil(h.length / 64) * 64, '0');
}

/** Metadata for a native ETH transfer as recommended by ERC-5564: view tag, 0xeeeeeeee, 0xEeee...EEeE, amount. */
export function nativeTransferMetadata(viewTag: number, amountWei: bigint): Hex {
  return `0x${viewTag.toString(16).padStart(2, '0')}eeeeeeee${'ee'.repeat(20)}${pad32(amountWei.toString(16))}`;
}

/** Calldata for Announcer.announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata). */
export function encodeAnnounce(a: { stealthAddress: string; ephemeralPublicKey: string; metadata: string; schemeId?: number }): Hex {
  const e = encodeBytes(a.ephemeralPublicKey);
  const m = encodeBytes(a.metadata);
  const head = pad32((a.schemeId ?? SCHEME_ID).toString(16)) + pad32(a.stealthAddress) + pad32((128).toString(16)) + pad32((128 + e.length / 2).toString(16));
  return `${selector('announce(uint256,address,bytes,bytes)')}${head}${e}${m}` as Hex;
}

/** Calldata for ERC6538Registry.registerKeys(uint256 schemeId, bytes stealthMetaAddress). */
export function encodeRegisterKeys(metaAddress: string, schemeId: number = SCHEME_ID): Hex {
  const m = parseMetaAddress(metaAddress);
  const body = strip(m.spendingPublicKey) + strip(m.viewingPublicKey);
  return `${selector('registerKeys(uint256,bytes)')}${pad32(schemeId.toString(16))}${pad32('40')}${encodeBytes(body)}` as Hex;
}

/** Calldata for ERC6538Registry.stealthMetaAddressOf(address registrant, uint256 schemeId). */
export function encodeStealthMetaAddressOf(registrant: string, schemeId: number = SCHEME_ID): Hex {
  return `${selector('stealthMetaAddressOf(address,uint256)')}${pad32(registrant)}${pad32(schemeId.toString(16))}` as Hex;
}
