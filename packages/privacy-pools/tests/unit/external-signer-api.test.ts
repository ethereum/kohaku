import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import type { ISecretManager } from '../../src/account/keys';
import type { IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { createMockHost } from '../utils/mock-host';

const ASSET = { __type: 'erc20', contract: '0x00000000000000000000000000000000000000aa' } as const;
const RECIPIENT = '0x00000000000000000000000000000000000000bb';
const account = privateKeyToAccount(`0x${'09'.repeat(32)}`);
function setup() {
  const host = createMockHost();
  const derive = vi.spyOn(host.keystore, 'deriveAt').mockRejectedValue(new Error('Delegator key must stay on the host'));
  const signer = { address: account.address, signAuthorization: vi.fn(account.signAuthorization), signTypedData: vi.fn(account.signTypedData) };
  const manager = {
    sync: vi.fn(async () => {}),
    getUnshieldEstimate: vi.fn(async () => ({ mode: 'paymaster', fee: 10n })),
    getPaymasterWithdrawalPayloads: vi.fn(async () => [{ mode: 'paymaster', fee: 10n }]),
  };
  const protocol = new PrivacyPoolsV1Protocol(host, {
    entrypoint: { address: 1n, deploymentBlock: 0n },
    secretManager: () => ({}) as ISecretManager,
    stateManager: () => manager as unknown as IStateManager,
  });
  return { protocol, manager, signer, derive };
}
describe('public external unshield API', () => {
  it('passes host callbacks directly to the state manager with batch and refund options', async () => {
    const { protocol, manager, signer, derive } = setup();
    await protocol.prepareUnshield({ asset: ASSET, amount: 100n }, RECIPIENT, {
      mode: 'paymaster', delegation: { mode: 'external', signer }, batch: true, refundRecipient: account.address,
    });
    expect(manager.getPaymasterWithdrawalPayloads).toHaveBeenCalledWith(expect.objectContaining({
      amount: 100n, recipient: BigInt(RECIPIENT), delegation: { mode: 'external', signer }, batch: true, refundRecipient: BigInt(account.address),
    }));
    expect(derive).not.toHaveBeenCalled();
  });
  it('preserves external signing through exact-output preparation', async () => {
    const { protocol, manager, signer, derive } = setup();
    const result = await protocol.prepareUnshield({ asset: ASSET, amount: 100n }, RECIPIENT, {
      mode: 'paymaster', delegation: { mode: 'external', signer }, refundRecipient: account.address, exact: {},
    });
    expect(result.exact).toEqual({ requestedNet: 100n, grossAmount: 110n, expectedNet: 100n, fee: 10n });
    expect(manager.getPaymasterWithdrawalPayloads).toHaveBeenCalledWith(expect.objectContaining({ amount: 110n, delegation: { mode: 'external', signer } }));
    expect(derive).not.toHaveBeenCalled();
  });
  it('does not ask for delegation or UserOperation signatures for a read-only quote', async () => {
    const { protocol, manager, signer, derive } = setup();
    await protocol.estimateUnshield({ asset: ASSET, amount: 100n }, RECIPIENT, { mode: 'paymaster' });
    expect(manager.getUnshieldEstimate).toHaveBeenCalledOnce();
    expect(manager.getPaymasterWithdrawalPayloads).not.toHaveBeenCalled();
    expect(signer.signAuthorization).not.toHaveBeenCalled(); expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(derive).not.toHaveBeenCalled();
  });
});
