import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { SecretManager } from '../../src/account/keys';
import { createMockHost } from '../utils/mock-host';

const ENTRYPOINT = 0x34a2068192b1297f2a7f85d7d8cde66f8f0921cbn;
const CHAIN_ID = 11155111n;

const makeManager = () => SecretManager({ host: createMockHost(), accountIndex: 0 });

describe('SecretManager.deriveEphemeralSigner', () => {
  it('derives a valid 32-byte secp256k1 private key', async () => {
    const key = await makeManager().deriveEphemeralSigner({
      chainId: CHAIN_ID,
      entrypointAddress: ENTRYPOINT,
      depositIndex: 0,
      withdrawIndex: 0,
    });

    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => privateKeyToAccount(key)).not.toThrow();
  });

  it('is deterministic for the same (chainId, entrypoint, depositIndex, withdrawIndex)', async () => {
    const params = { chainId: CHAIN_ID, entrypointAddress: ENTRYPOINT, depositIndex: 3, withdrawIndex: 1 };
    const a = await makeManager().deriveEphemeralSigner(params);
    const b = await makeManager().deriveEphemeralSigner(params);

    expect(a).toBe(b);
  });

  it('yields distinct keys per deposit index and per chain', async () => {
    const manager = makeManager();
    const base = { chainId: CHAIN_ID, entrypointAddress: ENTRYPOINT, depositIndex: 0, withdrawIndex: 0 };

    const byDeposit = await manager.deriveEphemeralSigner({ ...base, depositIndex: 1 });
    const byChain = await manager.deriveEphemeralSigner({ ...base, chainId: 1n });
    const original = await manager.deriveEphemeralSigner(base);

    expect(byDeposit).not.toBe(original);
    expect(byChain).not.toBe(original);
  });

  it('yields a distinct key per withdraw index (partial withdrawals reuse a deposit)', async () => {
    const manager = makeManager();
    const base = { chainId: CHAIN_ID, entrypointAddress: ENTRYPOINT, depositIndex: 2, withdrawIndex: 0 };

    const firstWithdrawal = await manager.deriveEphemeralSigner(base);
    const secondWithdrawal = await manager.deriveEphemeralSigner({ ...base, withdrawIndex: 1 });

    expect(secondWithdrawal).not.toBe(firstWithdrawal);
  });
});
