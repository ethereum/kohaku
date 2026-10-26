// bech32m without BIP-173's 90-character cap: a pool address carries 97 bytes.
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;

  for (const value of values) {
    const top = chk >>> 25;

    chk = ((chk & 0x1ffffff) << 5) ^ value;

    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= GENERATOR[i]!;
    }
  }

  return chk >>> 0;
}

const expandHrp = (hrp: string): number[] => [
  ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
  0,
  ...[...hrp].map((c) => c.charCodeAt(0) & 31),
];

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] {
  const out: number[] = [];
  const max = (1 << to) - 1;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < data.length; i++) {
    acc = (acc << from) | data[i]!;
    bits += from;

    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }

    acc &= (1 << bits) - 1;
  }

  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || (acc << (to - bits)) & max) {
    throw new Error("tacit: address padding");
  }

  return out;
}

export function bech32mEncode(hrp: string, bytes: Uint8Array): string {
  const words = convertBits(bytes, 8, 5, true);
  const check = polymod([...expandHrp(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ BECH32M;
  const tail = Array.from({ length: 6 }, (_, i) => (check >>> (5 * (5 - i))) & 31);

  return `${hrp}1${[...words, ...tail].map((w) => CHARSET[w]).join("")}`;
}

export function bech32mDecode(text: string): { hrp: string; bytes: Uint8Array } {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) throw new Error("tacit: mixed-case address");

  const s = text.toLowerCase();
  const pos = s.lastIndexOf("1");

  if (pos < 1 || pos + 7 > s.length) throw new Error("tacit: malformed address");

  const hrp = s.slice(0, pos);
  const data = [...s.slice(pos + 1)].map((c) => {
    const index = CHARSET.indexOf(c);

    if (index < 0) throw new Error("tacit: bad address character");

    return index;
  });

  if (polymod([...expandHrp(hrp), ...data]) !== BECH32M) throw new Error("tacit: address checksum");

  return { hrp, bytes: Uint8Array.from(convertBits(data.slice(0, -6), 5, 8, false)) };
}
