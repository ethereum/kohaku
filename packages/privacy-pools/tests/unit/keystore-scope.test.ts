import { KeystorePathNotAllowedError } from '@kohaku-eth/plugins';
import { describe, expect, it, vi } from 'vitest';

import { ISecretManager, SecretManager, SecretManagerParams } from '../../src/account/keys';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import { IPaymasterWithdrawapOperationParams, IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { createMockHost } from '../utils/mock-host';

const MAIN_WALLET_PATH = "m/44'/60'/0'/0/0";
const DELEGATION_PATH = "m/44'/60'/0'/0/50";
const ASSET = { __type: 'erc20', contract: '0x00000000000000000000000000000000000000aa' } as const;
const RECIPIENT = '0x00000000000000000000000000000000000000bb';

function setup() {
  const host = createMockHost();
  let params!: SecretManagerParams;
  let manager!: ISecretManager;

  // Stands in for the paymaster thunk: derives the delegator the way it does.
  const stateManager = {
    sync: vi.fn(async () => {}),
    getPaymasterWithdrawalPayloads: vi.fn(async ({ delegation }: IPaymasterWithdrawapOperationParams) => [
      { delegatorKey: await manager.deriveDelegatorSigner({ path: (delegation as { path: string }).path }) },
    ]),
  };

  const pools = new PrivacyPoolsV1Protocol(host, {
    entrypoint: { address: 1n, deploymentBlock: 0n },
    secretManager: (p) => {
      params = p;
      manager = SecretManager(p);

      return manager;
    },
    stateManager: () => stateManager as unknown as IStateManager,
  });

  return { host, pools, params, manager };
}

describe('PrivacyPoolsV1Protocol keystore scope', () => {
  it('gives the secret manager only the m/28784\'/1\' subtree', async () => {
    const { host, params, manager } = setup();

    expect(await params.host.keystore.deriveAt("m/28784'/1'/0'")).toBe(await host.keystore.deriveAt("m/28784'/1'/0'"));
    await expect(params.host.keystore.deriveAt(MAIN_WALLET_PATH)).rejects.toThrow(KeystorePathNotAllowedError);
    await expect(params.host.keystore.deriveAt("m/29795'/1'/0'")).rejects.toThrow(KeystorePathNotAllowedError);
    await expect(manager.deriveDelegatorSigner({ path: DELEGATION_PATH })).rejects.toThrow(KeystorePathNotAllowedError);
  });

  it('allows exactly the delegation.path passed to a paymaster unshield', async () => {
    const { host, pools, manager } = setup();

    const operation = await pools.prepareUnshield({ asset: ASSET, amount: 1n }, RECIPIENT, {
      mode: 'paymaster',
      delegation: { mode: 'deterministic', path: DELEGATION_PATH },
    });

    expect(operation).toMatchObject({ withdrawal: { delegatorKey: await host.keystore.deriveAt(DELEGATION_PATH) } });
    await expect(manager.deriveDelegatorSigner({ path: MAIN_WALLET_PATH })).rejects.toThrow(KeystorePathNotAllowedError);
  });
});
