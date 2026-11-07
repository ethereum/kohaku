import { describe, expect, it, vi } from 'vitest';

import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { storeStateManager } from '../../src/state/state-manager';
import { buildDepositPayload } from '../../src/state/selectors/deposits.selector';
import type { StoreFactoryParams } from '../../src/state/state-manager';
import type { IDataService } from '../../src/data/interfaces/data.service.interface';
import { createMockHost } from '../utils/mock-host';

const CHAIN = 11155111n;
const ENTRYPOINT = 0x34a2068192b1297f2a7f85d7d8cde66f8f0921cbn;
const ETH = 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen;
const AMOUNT = 100000000000000000n;

function setup() {
  const derive = vi.fn(async ({ depositIndex }: {
    depositIndex: number;
  }) => ({
    nullifier: 1n,
    salt: 2n,
    precommitment: BigInt(1000 + depositIndex),
    nullifierHash: 3n,
  }));

  const manager = storeStateManager({
    entrypoint: {
      address: ENTRYPOINT,
      deploymentBlock: 8587019n,
    },
    dataService: {
      getChainId: async () => CHAIN,
    },
    secretManager: {
      getDepositSecrets: derive,
    },
    aspService: {},
    relayerClient: {},
    relayersList: new Map(),
    proverFactory: () => {
      throw new Error('Proof generation not expected');
    },
  } as unknown as StoreFactoryParams);

  return { manager, derive };
}

describe('explicit Privacy Pools deposit-index selection', () => {
  it('preserves automatic index 0', async () => {
    const { manager, derive } = setup();

    const tx = await manager.getDepositPayload({
      asset: ETH,
      amount: AMOUNT,
    });

    expect(derive).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: CHAIN,
        entrypointAddress: ENTRYPOINT,
        depositIndex: 0,
      }),
    );

    expect(tx).toEqual(
      buildDepositPayload(1000n, ETH, AMOUNT, ENTRYPOINT),
    );
  });

  it('uses explicit sparse index 17', async () => {
    const { manager, derive } = setup();

    const tx = await manager.getDepositPayload({
      asset: ETH,
      amount: AMOUNT,
      depositIndex: 17,
    });

    expect(derive).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: CHAIN,
        entrypointAddress: ENTRYPOINT,
        depositIndex: 17,
      }),
    );

    expect(tx).toEqual(
      buildDepositPayload(1017n, ETH, AMOUNT, ENTRYPOINT),
    );
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid deposit index %s before derivation',
    async (index) => {
      const { manager, derive } = setup();

      await expect(manager.getDepositPayload({
        asset: ETH,
        amount: AMOUNT,
        depositIndex: index,
      })).rejects.toThrow('Invalid deposit index');

      expect(derive).not.toHaveBeenCalled();
    },
  );

  it('prepareShield forwards an explicit index to the state manager', async () => {
    const stateManager = {
      sync: vi.fn(async () => {}),
      getDepositPayload: vi.fn(async () => ({})),
    };
    const plugin = new PrivacyPoolsV1Protocol(createMockHost(), {
      entrypoint: { address: ENTRYPOINT, deploymentBlock: 8587019n },
      dataService: {} as IDataService,
      stateManager: () => stateManager as unknown as IStateManager,
    });
    const contract = '0x0000000000000000000000000000000000000001';

    await plugin.prepareShield({ asset: { __type: 'erc20', contract }, amount: AMOUNT }, { depositIndex: 17 });

    expect(stateManager.getDepositPayload).toHaveBeenCalledWith({
      asset: BigInt(contract),
      amount: AMOUNT,
      depositIndex: 17,
    });
  });
});
