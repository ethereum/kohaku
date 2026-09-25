import { createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import type { BackupAuthenticated, Configuration, Hex } from '../../src/index';

export const KDF_ITERATIONS = 600_000;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const WORD = 32;

export const toBytes = (hex: string): Buffer => {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new Error(`not byte hex: ${hex.slice(0, 20)}`);

  return Buffer.from(hex.slice(2), 'hex');
};

export const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

const uintBytes = (value: bigint, size: number): Buffer => {
  const out = Buffer.alloc(size);
  let rest = value;

  for (let index = size - 1; index >= 0; index -= 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }

  if (rest !== 0n) throw new Error(`${value} does not fit ${size} bytes`);

  return out;
};

const leftPadWord = (bytes: Buffer): Buffer => Buffer.concat([Buffer.alloc(WORD - bytes.length), bytes]);

/** abi.encode(address, address, bytes32, uint64, uint256) of the five authenticated values, as documented. */
export function referenceAssociatedData(authenticated: BackupAuthenticated): Buffer {
  return Buffer.concat([
    leftPadWord(toBytes(authenticated.account)),
    leftPadWord(toBytes(authenticated.action)),
    toBytes(authenticated.setupCommitment),
    uintBytes(authenticated.nonce, WORD),
    uintBytes(BigInt(authenticated.payloadVersion), WORD),
  ]);
}

/** The documented serialization: big-endian, self-delimiting, no label, salt behind a flag. */
export function referenceSerialize(configuration: Configuration): Buffer {
  const parts: Buffer[] = [
    uintBytes(BigInt(configuration.wait), 6),
    Buffer.from([configuration.ignoresPause ? 1 : 0]),
    uintBytes(BigInt(configuration.clauses.length), 2),
  ];

  for (const clause of configuration.clauses) {
    parts.push(Buffer.from([clause.threshold]), uintBytes(BigInt(clause.credentials.length), 2));

    for (const credential of clause.credentials) {
      const config = toBytes(credential.config);

      parts.push(toBytes(credential.method), uintBytes(BigInt(config.length), 2), config);
      parts.push(credential.salt === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), toBytes(credential.salt)]));
    }
  }

  return Buffer.concat(parts);
}

/** The documented size of a serialization, from the widths alone. */
export function referenceSize(configuration: Configuration): number {
  return configuration.clauses.reduce(
    (total, clause) =>
      clause.credentials.reduce(
        (sum, credential) => sum + 20 + 2 + (credential.config.length - 2) / 2 + 1 + (credential.salt === undefined ? 0 : 32),
        total + 3,
      ),
    9,
  );
}

export const referenceKey = (password: string, associatedData: Buffer): Buffer =>
  pbkdf2Sync(Buffer.from(password, 'utf8'), associatedData, KDF_ITERATIONS, 32, 'sha256');

/** nonce ‖ AES-256-GCM(key, nonce, AD, plaintext) ‖ tag, as documented. */
export function referenceSealRaw(key: Buffer, nonce: Buffer, associatedData: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });

  cipher.setAAD(associatedData);

  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** Opens a payload per the documented layout; throws when the tag does not verify. */
export function referenceOpenRaw(key: Buffer, payload: Buffer, associatedData: Buffer): Buffer {
  const nonce = payload.subarray(0, NONCE_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });

  decipher.setAAD(associatedData);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(payload.subarray(NONCE_BYTES, payload.length - TAG_BYTES)), decipher.final()]);
}

/** Pads the reference serialization with zeros to `paddingSize`. */
export function referencePlaintext(configuration: Configuration, paddingSize: number): Buffer {
  const serialized = referenceSerialize(configuration);

  if (serialized.length > paddingSize) throw new Error('too wide for the reference');

  return Buffer.concat([serialized, Buffer.alloc(paddingSize - serialized.length)]);
}

/** Seals with node:crypto alone and no function from src, so a match checks the documented layout rather than the code against itself. */
export function referenceSeal(
  configuration: Configuration,
  password: string,
  nonce: Hex,
  paddingSize: number,
  authenticated: BackupAuthenticated,
): Hex {
  const associatedData = referenceAssociatedData(authenticated);

  return toHex(
    referenceSealRaw(referenceKey(password, associatedData), toBytes(nonce), associatedData, referencePlaintext(configuration, paddingSize)),
  );
}
