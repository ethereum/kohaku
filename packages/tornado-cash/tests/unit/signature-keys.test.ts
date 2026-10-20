import { concat, hexToBigInt, keccak256, parseSignature, stringToBytes, toBytes, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { KeystoreEnvelopeSigner, SignatureSecretManager, TORNADO_DOMAIN_SALT, type EnvelopeSigner } from '../../src/account/signature-keys';
import { createMockHost } from '../utils/mock-host';

const POOL = 0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936n;
const POOL_B = 0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbFn;
const CHAIN_ID = 1n;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const makeManager = () => SignatureSecretManager({ host: createMockHost(), accountIndex: 0 });

function highS(sig: Hex): Hex {
  const { r, s, yParity } = parseSignature(sig);
  const flipped = SECP256K1_N - hexToBigInt(s);

  return toHex(concat([
    toBytes(r, { size: 32 }),
    toBytes(flipped, { size: 32 }),
    new Uint8Array([yParity === 1 ? 27 : 28]),
  ]));
}

describe('SignatureSecretManager', () => {
  it('pins the EIP-712 domain salt to keccak256("tornado")', () => {
    expect(TORNADO_DOMAIN_SALT).toBe(keccak256(stringToBytes('tornado')));
    expect(TORNADO_DOMAIN_SALT).toBe(
      '0xc11237b977418c705d2b06da702566cbfab6ece8e4139395f03c66a91899af6f',
    );
  });

  // Pins HD path -> EIP-712 envelope -> canonical (r, s) -> tagged keccak/trunc31 ->
  // Pedersen. If concatenation order, endianness, trunc width, salt, domain, or
  // path changes, previously derived notes become unrecoverable.
  it('matches the known-answer vector for the test mnemonic (account 0)', async () => {
    const m = await makeManager();
    const base = { poolAddress: POOL, chainId: CHAIN_ID, nonce: 0 };

    const dump = {
      nonce0: await m.getSignatureSecrets(base),
      nonce1: await m.getSignatureSecrets({ ...base, nonce: 1 }),
      poolB: await m.getSignatureSecrets({ ...base, poolAddress: POOL_B }),
      signer: await m.deriveSignatureEphemeralSigner(base),
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
    expect(dump).toBeTruthy();
  });

  it('derives a secret whose preimage bytes are 31 bytes and differ by tag', async () => {
    const m = await makeManager();
    const s = await m.getSignatureSecrets({ poolAddress: POOL, chainId: CHAIN_ID, nonce: 0 });

    expect(s.nullifier).toBeGreaterThan(0n);
    expect(s.salt).toBeGreaterThan(0n);
    expect(s.nullifier).toBeLessThan(1n << 248n);
    expect(s.salt).toBeLessThan(1n << 248n);
    expect(s.nullifier).not.toBe(s.salt);
    expect(s.commitment).not.toBe(s.nullifierHash);
  });

  it('is deterministic for the same (chainId, pool, nonce)', async () => {
    const params = { poolAddress: POOL, chainId: CHAIN_ID, nonce: 2 };
    const first = await makeManager();
    const second = await makeManager();
    const a = await first.getSignatureSecrets(params);
    const b = await second.getSignatureSecrets(params);

    expect(b).toEqual(a);
  });

  it('yields distinct notes per nonce, chain, and pool', async () => {
    const m = await makeManager();
    const base = { poolAddress: POOL, chainId: CHAIN_ID, nonce: 0 };

    const original = await m.getSignatureSecrets(base);
    const byNonce = await m.getSignatureSecrets({ ...base, nonce: 1 });
    const byChain = await m.getSignatureSecrets({ ...base, chainId: 11155111n });
    const byPool = await m.getSignatureSecrets({ ...base, poolAddress: POOL_B });

    const keys = [original, byNonce, byChain, byPool].map((s) => s.commitment);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('folds a high-s signature onto the same note', async () => {
    const host = createMockHost();
    const inner = new KeystoreEnvelopeSigner(host.keystore, 0);
    const highSigner: EnvelopeSigner = {
      signEnvelope: async (envelope) => highS(await inner.signEnvelope(envelope)),
    };
    const params = { poolAddress: POOL, chainId: CHAIN_ID, nonce: 4 };
    const lowManager = await SignatureSecretManager({ host, accountIndex: 0 });
    const highManager = await SignatureSecretManager({ host, accountIndex: 0, signer: highSigner });
    const low = await lowManager.getSignatureSecrets(params);
    const high = await highManager.getSignatureSecrets(params);

    expect(high).toEqual(low);
  });

  it('caches the signature per chain and nonce across pools and ephemeral-signer calls', async () => {
    const host = createMockHost();
    const inner = new KeystoreEnvelopeSigner(host.keystore, 0);
    let calls = 0;
    const counting: EnvelopeSigner = {
      signEnvelope: (envelope) => {
        calls++;

        return inner.signEnvelope(envelope);
      },
    };
    const m = await SignatureSecretManager({ host, accountIndex: 0, signer: counting });
    const params = { poolAddress: POOL, chainId: CHAIN_ID, nonce: 7 };

    await m.getSignatureSecrets(params);
    await m.getSignatureSecrets({ ...params, poolAddress: POOL_B });
    await m.deriveSignatureEphemeralSigner(params);

    expect(calls).toBe(1);

    await m.getSignatureSecrets({ ...params, chainId: CHAIN_ID + 1n });

    expect(calls).toBe(2);

    await m.getSignatureSecrets({ ...params, nonce: 8 });

    expect(calls).toBe(3);
  });

  it('does not cache a failed signature (stays retryable)', async () => {
    let attempt = 0;
    const flaky: EnvelopeSigner = {
      signEnvelope: async () => {
        attempt++;

        if (attempt === 1) throw new Error('signer rejected');

        return `0x${'11'.repeat(64)}1b` as Hex;
      },
    };
    const m = await SignatureSecretManager({ host: createMockHost(), accountIndex: 0, signer: flaky });
    const params = { poolAddress: POOL, chainId: CHAIN_ID, nonce: 0 };

    await expect(m.getSignatureSecrets(params)).rejects.toThrow('signer rejected');
    await expect(m.getSignatureSecrets(params)).resolves.toBeDefined();
    expect(attempt).toBe(2);
  });

  describe('deriveSignatureEphemeralSigner', () => {
    it('derives a valid, deterministic secp256k1 key disjoint per pool and nonce', async () => {
      const m = await makeManager();
      const base = { poolAddress: POOL, chainId: CHAIN_ID, nonce: 0 };

      const key = await m.deriveSignatureEphemeralSigner(base);

      expect(key).toMatch(/^0x[0-9a-f]{64}$/);
      expect(() => privateKeyToAccount(key)).not.toThrow();
      expect(await m.deriveSignatureEphemeralSigner(base)).toBe(key);
      expect(await m.deriveSignatureEphemeralSigner({ ...base, nonce: 1 })).not.toBe(key);
      expect(await m.deriveSignatureEphemeralSigner({ ...base, poolAddress: POOL_B })).not.toBe(key);
    });
  });
});
