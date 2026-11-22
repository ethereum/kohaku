import type { Hex } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const domain = encoder.encode("kohaku-railgun-checkpoint-v1");

function bytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Invalid hex in Railgun checkpoint envelope");
  const result = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < result.length; i++) result[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return result;
}

function hex(value: BufferSource): Hex {
  const data = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return `0x${Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export interface CheckpointCipher {
  encrypt(checkpointJson: string): Promise<string>;
  decrypt(envelopeJson: string): Promise<string>;
}

/** Authenticated storage envelope; the low-level worker API leaves storage policy to its caller. */
export async function createCheckpointCipher(viewingKey: Hex, scope: string): Promise<CheckpointCipher> {
  const rawViewingKey = bytes(viewingKey);
  if (rawViewingKey.byteLength !== 32) throw new Error("Railgun viewing key must be 32 bytes");
  const input = await crypto.subtle.importKey("raw", rawViewingKey, "HKDF", false, ["deriveKey"]);
  const aad = encoder.encode(scope);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: domain, info: aad },
    input,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return {
    async encrypt(checkpointJson) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
        key,
        encoder.encode(checkpointJson),
      );
      return JSON.stringify({ version: 1, nonce: hex(nonce), ciphertext: hex(ciphertext) });
    },
    async decrypt(envelopeJson) {
      let envelope: unknown;
      try { envelope = JSON.parse(envelopeJson); }
      catch { throw new Error("Invalid Railgun checkpoint envelope"); }
      if (!envelope || typeof envelope !== "object" ||
          (envelope as { version?: unknown }).version !== 1 ||
          typeof (envelope as { nonce?: unknown }).nonce !== "string" ||
          typeof (envelope as { ciphertext?: unknown }).ciphertext !== "string") {
        throw new Error("Unsupported Railgun checkpoint envelope; plaintext checkpoints are not accepted");
      }
      const nonce = bytes((envelope as { nonce: string }).nonce);
      const ciphertext = bytes((envelope as { ciphertext: string }).ciphertext);
      if (nonce.byteLength !== 12 || ciphertext.byteLength < 16) {
        throw new Error("Invalid Railgun checkpoint envelope");
      }
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
          key,
          ciphertext,
        );
        return decoder.decode(plaintext);
      } catch (cause) {
        throw new Error("Railgun checkpoint authentication failed", { cause });
      }
    },
  };
}
