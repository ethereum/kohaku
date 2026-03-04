import { describe, it, expect } from 'vitest';
import { createPrivacyPoolsAccount } from '../../src';
import { MAINNET_CONFIG } from '../../src/config';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const MOCK_ERC20 = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC

describe('Privacy Pools Shield', () => {
  it('should create account with mnemonic', () => {
    const account = createPrivacyPoolsAccount({
      credential: {
        type: 'mnemonic',
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0,
      },
      network: MAINNET_CONFIG,
    });

    expect(account).toBeDefined();
    expect(account.network).toEqual(MAINNET_CONFIG);
    expect(account._internal.keys.commitmentKey).toBeInstanceOf(Uint8Array);
    expect(account._internal.keys.nullifierKey).toBeInstanceOf(Uint8Array);
    expect(account._internal.keys.signer).toBeDefined();
  });

  it('should generate shield tx for native token', () => {
    const account = createPrivacyPoolsAccount({
      credential: {
        type: 'mnemonic',
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0,
      },
      network: MAINNET_CONFIG,
    });

    const value = 1000000000000000000n; // 1 ETH
    const { commitment, tx } = account.shield(NATIVE_TOKEN, value);

    // Check commitment
    expect(commitment).toBeDefined();
    expect(commitment.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(commitment.value).toBe(value);
    expect(commitment.spent).toBe(false);
    expect(commitment.randomness).toBeInstanceOf(Uint8Array);

    // Check tx
    expect(tx).toBeDefined();
    expect(tx.to).toBe(MAINNET_CONFIG.ENTRYPOINT_ADDRESS);
    expect(tx.value).toBe(value);
    expect(tx.data).toMatch(/^0x/);
  });

  it('should generate shield tx for ERC20 token', () => {
    const account = createPrivacyPoolsAccount({
      credential: {
        type: 'mnemonic',
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0,
      },
      network: MAINNET_CONFIG,
    });

    const value = 1000000n; // 1 USDC (6 decimals)
    const { commitment, tx } = account.shield(MOCK_ERC20, value);

    // Check commitment
    expect(commitment).toBeDefined();
    expect(commitment.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(commitment.token.toLowerCase()).toBe(MOCK_ERC20.toLowerCase());
    expect(commitment.value).toBe(value);
    expect(commitment.spent).toBe(false);

    // Check tx - ERC20 should not have value
    expect(tx).toBeDefined();
    expect(tx.to).toBe(MAINNET_CONFIG.ENTRYPOINT_ADDRESS);
    expect(tx.value).toBe(0n);
    expect(tx.data).toMatch(/^0x/);
  });

  it('should generate unique commitments for same inputs', () => {
    const account = createPrivacyPoolsAccount({
      credential: {
        type: 'mnemonic',
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0,
      },
      network: MAINNET_CONFIG,
    });

    const value = 1000000000000000000n;
    const { commitment: c1 } = account.shield(NATIVE_TOKEN, value);
    const { commitment: c2 } = account.shield(NATIVE_TOKEN, value);

    // Commitments should be different due to random blinding factor
    expect(c1.hash).not.toBe(c2.hash);
  });

  it('should track commitments after adding', () => {
    const account = createPrivacyPoolsAccount({
      credential: {
        type: 'mnemonic',
        mnemonic: TEST_MNEMONIC,
        accountIndex: 0,
      },
      network: MAINNET_CONFIG,
    });

    const { commitment } = account.shield(NATIVE_TOKEN, 1000000000000000000n);

    expect(account.getCommitments()).toHaveLength(0);

    account.addCommitment(commitment);

    expect(account.getCommitments()).toHaveLength(1);
    expect(account.getCommitments()[0]).toEqual(commitment);
  });
});
