import { describe, expect, it, vi } from 'vitest';
import { KeystorePathNotAllowedError, type Host, type Keystore } from '@kohaku-eth/plugins';
import { E_ADDRESS, TornadoCashConfigs } from '../../src/config';
import { TornadoCashProtocol } from '../../src/plugin/base';

const DELEGATION_PATH = "m/44'/60'/0'/0/50";
const RECIPIENT = '0x0000000000000000000000000000000000000003';

const { remote } = vi.hoisted(() => ({ remote: {
  init: vi.fn(async () => {}), sync: vi.fn(async () => {}),
  getWithdrawalPayloads: vi.fn(async (): Promise<unknown[]> => []),
} }));

vi.mock('#worker-loader', () => ({ loadStateManagerWorker: () => ({ remote, onError: () => {} }) }));

const eth = { asset: { contract: E_ADDRESS as `0x${string}`, __type: 'erc20' as const }, amount: 10n ** 17n };

function setup() {
  const keystore = { deriveAt: async (path: string) => `0x${path.length.toString(16).padStart(64, '0')}` } as Keystore;
  const host = { provider: {}, keystore, storage: {}, network: { fetch } } as unknown as Host;
  let scoped!: Keystore;
  const protocol = new TornadoCashProtocol(host, {
    protocolConfig: TornadoCashConfigs[1],
    secretManagerFactory: async ({ host: { keystore } }) => {
      scoped = keystore;

      return {} as never;
    },
  });

  // Stands in for the worker: derives the delegator while preparing, as the thunk does.
  remote.getWithdrawalPayloads.mockReset();
  remote.getWithdrawalPayloads.mockImplementation(async () => [{ delegatorKey: await scoped.deriveAt(DELEGATION_PATH) }]);

  const unshield = () => protocol.prepareUnshield(eth, RECIPIENT, {
    mode: 'paymaster',
    delegation: { mode: 'deterministic', path: DELEGATION_PATH },
  });

  return { unshield, derive: () => scoped.deriveAt(DELEGATION_PATH) };
}

describe('TornadoCashProtocol delegation.path grant', () => {
  it('allows the delegation.path while the unshield is prepared, and drops it after', async () => {
    const { unshield, derive } = setup();

    const operation = await unshield();

    expect(operation.withdrawals[0]).toHaveProperty('delegatorKey');
    await expect(derive()).rejects.toThrow(KeystorePathNotAllowedError);
  });

  it('drops the delegation.path when preparing the unshield fails', async () => {
    const { unshield, derive } = setup();

    remote.getWithdrawalPayloads.mockRejectedValueOnce(new Error('paymaster down'));

    await expect(unshield()).rejects.toThrow('paymaster down');
    await expect(derive()).rejects.toThrow(KeystorePathNotAllowedError);
  });

  it('keeps the delegation.path while another unshield on it is still preparing', async () => {
    const { unshield, derive } = setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    // The first preparation derives only after the second one has settled.
    remote.getWithdrawalPayloads.mockImplementationOnce(async () => {
      await held;

      return [{ delegatorKey: await derive() }];
    });

    const first = unshield();

    await unshield();
    release();

    expect((await first).withdrawals[0]).toHaveProperty('delegatorKey');
    await expect(derive()).rejects.toThrow(KeystorePathNotAllowedError);
  });
});
