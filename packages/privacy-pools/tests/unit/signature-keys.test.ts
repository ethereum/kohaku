import { keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { SignatureSecretManager, type PPSigner } from '../../src/account/signature-keys';
import { createMockHost } from '../utils/mock-host';

const ENTRYPOINT = 0x34a2068192b1297f2a7f85d7d8cde66f8f0921cbn;
const CHAIN_ID = 11155111n;

const makeManager = () => SignatureSecretManager({ host: createMockHost(), accountIndex: 0 });

describe('SignatureSecretManager', () => {
  it('pins the EIP-712 domain salt to keccak256("privacypools")', () => {
    expect(keccak256(stringToHex('privacypools'))).toBe(
      '0xb6894604fd8d2640438ce98c9942ba07efb283528908c5d676845afe2a2edee2',
    );
  });

  // Known-answer vector. Pins the full derivation (HD path -> EIP-712 envelope ->
  // RFC-6979 signature -> tagged keccak/trunc31 -> poseidon) to fixed outputs for
  // the test mnemonic at account 0. If any of those inputs silently change
  // (concatenation order, trunc width, salt, domain, path), these values move and
  // every previously-derived note becomes unrecoverable — so this must stay green.
  it('matches the known-answer vector for the test mnemonic (account 0)', async () => {
    const m = makeManager();
    const base = { entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 0 };

    expect(await m.getDepositSecrets(base)).toEqual({
      nullifier: 79187742434600478394708012678223111747318812937440310089890643671062028158n,
      salt: 355137781971518834209971558923619123690054102741066378631960578414092705249n,
      precommitment: 9682061522539847992030542906227424428717656679108288622953328621290101424482n,
      nullifierHash: 17457538810094556447769473280452095080643703271673546451221632463904426704503n,
    });

    expect(await m.getSecrets({ ...base, withdrawIndex: 1 })).toEqual({
      nullifier: 430569006679998547317052511108972011000747861852088111660287613197867860823n,
      salt: 263263324931655405853738581002991841419047763258419229975096372416118815464n,
      precommitment: 1355548511706123565208634524997641601436194317169622269669688469991018324252n,
      nullifierHash: 12129769459415284144393512486170280948271049385098284646753879780963558712777n,
    });

    expect(await m.deriveEphemeralSigner({ ...base, withdrawIndex: 0 })).toBe(
      '0x008cd1de1e854d5a1036e3e0f13407284f5331cd1d574923e0505144f563d5dd',
    );
  });

  it('derives a full Secret with a precommitment inside the BN254 field', async () => {
    const s = await makeManager().getDepositSecrets({ entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 0 });

    const BN254 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

    for (const v of [s.nullifier, s.salt, s.precommitment, s.nullifierHash]) {
      expect(v).toBeGreaterThan(0n);
      expect(v).toBeLessThan(BN254);
    }
    // nullifier and salt come from independent domain tags off one signature
    expect(s.nullifier).not.toBe(s.salt);
  });

  it('is deterministic for the same (chainId, entrypoint, depositIndex)', async () => {
    const params = { entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 2 };
    const a = await makeManager().getDepositSecrets(params);
    const b = await makeManager().getDepositSecrets(params);

    expect(b).toEqual(a);
  });

  it('yields distinct notes per deposit index, chain, entrypoint, and withdraw index', async () => {
    const m = makeManager();
    const base = { entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 0 };

    const original = await m.getDepositSecrets(base);
    const byDeposit = await m.getDepositSecrets({ ...base, depositIndex: 1 });
    const byChain = await m.getDepositSecrets({ ...base, chainId: 1n });
    const byEntrypoint = await m.getDepositSecrets({ ...base, entrypointAddress: ENTRYPOINT + 1n });
    const byWithdraw = await m.getSecrets({ ...base, withdrawIndex: 1 });

    const keys = [original, byDeposit, byChain, byEntrypoint, byWithdraw].map((s) => s.precommitment);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('getSecrets at withdrawIndex 0 equals getDepositSecrets (shared secretIndex 0)', async () => {
    const m = makeManager();
    const base = { entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 5 };

    const deposit = await m.getDepositSecrets(base);
    const withdraw0 = await m.getSecrets({ ...base, withdrawIndex: 0 });

    expect(withdraw0).toEqual(deposit);
  });

  it('caches the signature per message across derivations and ephemeral-signer calls', async () => {
    const inner = new (await import('../../src/account/signature-keys')).KeystoreNoteSigner(createMockHost().keystore, 0);
    let calls = 0;
    const counting: PPSigner = {
      signNote: (msg) => {
        calls++;

        return inner.signNote(msg);
      },
    };
    const m = SignatureSecretManager({ host: createMockHost(), accountIndex: 0, signer: counting });
    const params = { entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 7 };

    await m.getDepositSecrets(params);
    await m.getSecrets({ ...params, withdrawIndex: 0 }); // same message as deposit (secretIndex 0)
    await m.deriveEphemeralSigner({ ...params, withdrawIndex: 0 }); // same message again

    expect(calls).toBe(1);

    await m.getSecrets({ ...params, withdrawIndex: 1 }); // distinct message -> one more sign

    expect(calls).toBe(2);
  });

  it('does not cache a failed signature (stays retryable)', async () => {
    let attempt = 0;
    const flaky: PPSigner = {
      signNote: async () => {
        attempt++;

        if (attempt === 1) throw new Error('signer rejected');

        // valid 65-byte sig: r ‖ s ‖ v, with v = 0x1b (27) so parseSignature accepts it
        return `0x${'11'.repeat(64)}1b` as `0x${string}`;
      },
    };
    const m = SignatureSecretManager({ host: createMockHost(), accountIndex: 0, signer: flaky });
    const params = { entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 0 };

    await expect(m.getDepositSecrets(params)).rejects.toThrow('signer rejected');
    await expect(m.getDepositSecrets(params)).resolves.toBeDefined();
    expect(attempt).toBe(2);
  });

  describe('deriveEphemeralSigner', () => {
    it('derives a valid, deterministic secp256k1 key disjoint per withdraw index', async () => {
      const m = makeManager();
      const base = { entrypointAddress: ENTRYPOINT, chainId: CHAIN_ID, depositIndex: 0, withdrawIndex: 0 };

      const key = await m.deriveEphemeralSigner(base);

      expect(key).toMatch(/^0x[0-9a-f]{64}$/);
      expect(() => privateKeyToAccount(key)).not.toThrow();
      expect(await m.deriveEphemeralSigner(base)).toBe(key);
      expect(await m.deriveEphemeralSigner({ ...base, withdrawIndex: 1 })).not.toBe(key);
    });
  });
});
