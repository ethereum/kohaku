import { unwrapResult } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import { ISecretManager, Secret } from '../../src/account/keys';
import { IDepositEvent, IPool } from '../../src/data/interfaces/events.interface';
import { Commitment, Nullifier, NullifierHash } from '../../src/interfaces/types.interface';
import { derivedUserSecretsSelector, signatureUserSecretsSelector } from '../../src/state/selectors/slices.selectors';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { addSignatureSecret } from '../../src/state/slices/signatureSecretsSlice';
import { storeFactory } from '../../src/state/store';
import { discoverUserEventsThunk, SIGNATURE_GAP_LIMIT } from '../../src/state/thunks/discoverUserEventsThunk';
import { DepositStrategy, getDepositPayloadThunk } from '../../src/state/thunks/getDepositPayloadThunk';

const POOL_A = 11n;
const POOL_B = 22n;

const sigCommitment = (nonce: number, pool: bigint) => (BigInt(nonce) + 1n) * 1_000n + pool;
const hdCommitment = (index: number, pool: bigint) => 1_000_000n + BigInt(index) * 1_000n + pool;

function asSecret(commitment: bigint): Secret {
  return {
    nullifier: 1n as Nullifier,
    salt: 2n,
    commitment: commitment as Commitment,
    nullifierHash: 3n as NullifierHash,
  };
}

function manager(): ISecretManager {
  return {
    getSignatureSecrets: async ({ nonce, poolAddress }) => asSecret(sigCommitment(nonce, poolAddress)),
    getLegacyDepositSecrets: async ({ depositIndex, poolAddress }) => asSecret(hdCommitment(depositIndex, poolAddress)),
    deriveSignatureEphemeralSigner: async () => `0x${'11'.repeat(32)}`,
    deriveEphemeralSigner: async () => `0x${'22'.repeat(32)}`,
    deriveDelegatorSigner: async () => `0x${'33'.repeat(32)}`,
    deriveLegacyEphemeralSigner: async () => `0x${'44'.repeat(32)}`,
  };
}

function pool(address: bigint): IPool {
  return {
    address,
    asset: 0n,
    isERC20: false,
    protocolFeePercentage: 0,
    denomination: 10n ** 18n,
    registeredBlock: 0n,
    state: 1,
    rootHistorySize: 100,
  };
}

function deposit(poolAddress: bigint, commitment: bigint): IDepositEvent {
  return {
    pool: poolAddress,
    commitment: commitment as Commitment,
    leafIndex: 0,
    timestamp: 0n,
    blockNumber: 1n,
    transactionHash: 1n,
  };
}

async function discover(commitments: { pool: bigint; commitment: bigint }[]) {
  const store = storeFactory({
    protocolConfig: {
      chainId: 1n,
      ensSubdomainKey: 'eth',
      instanceRegistry: { address: 1n, deploymentBlock: 0n },
      relayerRegistry: { address: 2n, deploymentBlock: 0n },
      aggregator: { address: 3n },
    },
    logLevel: 'off',
  });

  store.dispatch(registerPools([pool(POOL_A), pool(POOL_B)]));
  store.dispatch(registerDeposits(commitments.map(({ pool: poolAddress, commitment }) => deposit(poolAddress, commitment))));
  unwrapResult(await store.dispatch(discoverUserEventsThunk({ secretManager: manager() })));

  const state = store.getState();

  return {
    signature: signatureUserSecretsSelector(state),
    hd: derivedUserSecretsSelector(state),
  };
}

describe('discoverUserEventsThunk', () => {
  it('uses a gap limit of 20', () => {
    expect(SIGNATURE_GAP_LIMIT).toBe(20);
  });

  it('finds a note 20 nonces after the last hit and stops before the 21st miss', async () => {
    const found = await discover([
      { pool: POOL_A, commitment: sigCommitment(0, POOL_A) },
      { pool: POOL_A, commitment: sigCommitment(20, POOL_A) },
    ]);

    expect(found.signature.get(POOL_A)?.map((record) => record.nonce)).toEqual([0, 20]);
    expect(found.signature.has(POOL_B)).toBe(false);
  });

  it('does not find a note 21 nonces after the last hit', async () => {
    const found = await discover([
      { pool: POOL_A, commitment: sigCommitment(0, POOL_A) },
      { pool: POOL_A, commitment: sigCommitment(21, POOL_A) },
    ]);

    expect(found.signature.get(POOL_A)?.map((record) => record.nonce)).toEqual([0]);
  });

  it('resets the gap when a later nonce hits a different pool', async () => {
    const found = await discover([
      { pool: POOL_A, commitment: sigCommitment(0, POOL_A) },
      { pool: POOL_B, commitment: sigCommitment(15, POOL_B) },
      { pool: POOL_A, commitment: sigCommitment(30, POOL_A) },
    ]);

    expect(found.signature.get(POOL_A)?.map((record) => record.nonce)).toEqual([0, 30]);
    expect(found.signature.get(POOL_B)?.map((record) => record.nonce)).toEqual([15]);
  });

  it('finds contiguous HD notes on their own cursor and stops at the first miss', async () => {
    const found = await discover([
      { pool: POOL_A, commitment: hdCommitment(0, POOL_A) },
      { pool: POOL_A, commitment: hdCommitment(1, POOL_A) },
      { pool: POOL_A, commitment: hdCommitment(3, POOL_A) },
      { pool: POOL_B, commitment: sigCommitment(0, POOL_B) },
    ]);

    expect(found.hd.get(POOL_A)?.map((record) => record.depositIndex)).toEqual([0, 1]);
    expect(found.hd.has(POOL_B)).toBe(false);
    expect(found.signature.get(POOL_B)?.map((record) => record.nonce)).toEqual([0]);
    expect(found.signature.has(POOL_A)).toBe(false);
  });
});

describe('getDepositPayloadThunk nonce allocation', () => {
  it('continues from one past the highest nonce on any pool', async () => {
    const store = storeFactory({
      protocolConfig: {
        chainId: 1n,
        ensSubdomainKey: 'eth',
        instanceRegistry: { address: 1n, deploymentBlock: 0n },
        relayerRegistry: { address: 2n, deploymentBlock: 0n },
        aggregator: { address: 3n },
      },
      logLevel: 'off',
    });
    const denomination = 10n ** 18n;

    store.dispatch(registerPools([pool(POOL_A), pool(POOL_B)]));
    store.dispatch(addSignatureSecret({
      poolAddress: POOL_B,
      record: { ...asSecret(1n), nonce: 4 },
    }));

    const nonces: number[] = [];
    const secretManager = manager();

    secretManager.getSignatureSecrets = async ({ nonce, poolAddress }) => {
      nonces.push(nonce);

      return asSecret(sigCommitment(nonce, poolAddress));
    };

    unwrapResult(await store.dispatch(getDepositPayloadThunk({
      secretManager,
      asset: 0n,
      amount: denomination * 2n,
      strategy: DepositStrategy.MaxAnonimitySet,
      // POOL_A and POOL_B are not mainnet instances, so allow them explicitly.
      instances: [POOL_A, POOL_B].map((address) => ({ address, asset: 0n, symbol: 'ETH', decimals: 18, denomination })),
    })));

    expect(nonces).toEqual([5, 6]);
  });
});
