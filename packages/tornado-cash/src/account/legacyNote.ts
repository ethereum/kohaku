import { bytesToNumberLE, hexToBytes } from "@noble/curves/utils.js";

import { Commitment, Nullifier, NullifierHash } from "../interfaces/types.interface";
import { pedersenHash } from "../utils/proof.util";

/**
 * Original Tornado Cash note format:
 *   tornado-${currency}-${denomination}-${chainId}-0x${preimageHex}
 * `preimageHex` decodes to the same 62-byte preimage our own `SecretManager`
 * builds (31 LE bytes of nullifier, followed by 31 LE bytes of salt) — see
 * `deriveSecrets` in `./keys.ts`.
 */
const NOTE_REGEX = /^tornado-([a-zA-Z0-9]+)-([0-9.]+)-(\d+)-0x([0-9a-fA-F]+)$/;

export interface ParsedLegacyNote {
  currency: string;
  denomination: string;
  chainId: bigint;
  nullifier: Nullifier;
  salt: bigint;
  commitment: Commitment;
  nullifierHash: NullifierHash;
}

export function parseLegacyNote(note: string): ParsedLegacyNote {
  const match = NOTE_REGEX.exec(note.trim());

  if (!match) {
    throw new Error(`Invalid tornado cash note: ${note}`);
  }

  const [, currency, denomination, chainId, preimageHex] = match as unknown as [string, string, string, string, string];
  const preimageBytes = hexToBytes(preimageHex);

  if (preimageBytes.length !== 62) {
    throw new Error(`Invalid tornado cash note preimage length: ${note}`);
  }

  const nullifierBytes = preimageBytes.subarray(0, 31);
  const saltBytes = preimageBytes.subarray(31, 62);

  return {
    currency,
    denomination,
    chainId: BigInt(chainId),
    nullifier: bytesToNumberLE(nullifierBytes) as Nullifier,
    salt: bytesToNumberLE(saltBytes),
    commitment: pedersenHash(preimageBytes) as Commitment,
    nullifierHash: pedersenHash(nullifierBytes) as NullifierHash,
  };
}
