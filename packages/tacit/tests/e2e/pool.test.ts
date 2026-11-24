import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InsufficientBalanceError, type ERC20AssetId } from '@kohaku-eth/plugins';
import { parseEther } from 'viem';
import {
  createSnarkjsProver,
  createTacitPlugin,
  E_ADDRESS,
  TacitConfigs,
  TacitFragmentedBalanceError,
  type TacitInstance,
} from '../../src';
import { ACCOUNTS, fundedWallet } from '../utils/accounts';
import { startAnvilFork, type AnvilFork } from '../utils/anvil';
import { testArtifacts } from '../utils/artifacts';
import { createHost, MNEMONIC_A, MNEMONIC_B } from '../utils/host';

// Runs the plugin against the live Ethereum pool on a fork: real history, real ceremony proofs, real verifier.
//   RPC_URL_MAINNET=<archive node> pnpm --filter @kohaku-eth/tacit test:e2e
const forkUrl = process.env['RPC_URL_MAINNET'];
const forkBlock = Number(process.env['TACIT_MAINNET_FORK_BLOCK'] ?? 26261700);
const ETH: ERC20AssetId = { __type: 'erc20', contract: E_ADDRESS };

// No relayer: every spend is sent by an account of the test's choosing.
const SELF = { ...TacitConfigs[1]!, relayerUrl: undefined, relayerAddress: undefined };

describe.skipIf(!forkUrl)('Tacit pool on a mainnet fork', () => {
  let fork: AnvilFork;
  let rpcUrl: string;
  let alice: TacitInstance;
  let bob: TacitInstance;

  const open = async (mnemonic: string) => {
    const host = createHost({ rpcUrl, mnemonic });

    return createTacitPlugin(host, {
      config: SELF,
      proverFactory: () => createSnarkjsProver({ artifacts: () => testArtifacts(host), singleThread: false }),
    });
  };

  beforeAll(async () => {
    fork = await startAnvilFork({ forkUrl: forkUrl!, forkBlockNumber: forkBlock, chainId: 1 });
    rpcUrl = fork.rpcUrl(1);
    alice = await open(MNEMONIC_A);
    bob = await open(MNEMONIC_B);
  }, 300_000);

  afterAll(async () => {
    await fork?.stop();
  });

  it('reads the pool and finds nothing for a new key', async () => {
    expect((await alice.balance(undefined))[0]!.amount).toBe(0n);
    expect(await alice.notes?.()).toEqual([]);
    expect(await alice.instanceId()).toMatch(/^bp1/);
  });

  it('shields, pays another address privately, and unshields', async () => {
    const sender = await fundedWallet(rpcUrl, ACCOUNTS.alice);
    const other = await fundedWallet(rpcUrl, ACCOUNTS.charlie);

    // Shield 0.02 ETH to Alice.
    const shield = await alice.prepareShield({ asset: ETH, amount: parseEther('0.02') });

    await sender.send(shield.txns[0]!);
    expect((await alice.balance(undefined))[0]!.amount).toBe(parseEther('0.02'));

    // Alice pays Bob 0.005 ETH; a different account sends it, so Alice's depositing account stays off the transfer.
    const transfer = await alice.prepareTransfer({ asset: ETH, amount: parseEther('0.005') }, await bob.instanceId());

    expect(transfer.mode).toBe('self');
    expect(transfer.fee).toBe(0n);

    const receipt = await other.send(transfer.txns[0]!);

    expect(receipt.from.toLowerCase()).toBe(other.address.toLowerCase());
    expect((await alice.balance(undefined))[0]!.amount).toBe(parseEther('0.015'));
    expect((await bob.balance(undefined))[0]!.amount).toBe(parseEther('0.005'));

    // Bob withdraws 0.003 ETH to a fresh address.
    const fresh = '0x00000000000000000000000000000000000dead1';
    const before = await sender.client.getBalance({ address: fresh });
    const unshield = await bob.prepareUnshield({ asset: ETH, amount: parseEther('0.003') }, fresh);

    await other.send(unshield.txns[0]!);
    expect((await sender.client.getBalance({ address: fresh })) - before).toBe(parseEther('0.003'));
    expect((await bob.balance(undefined))[0]!.amount).toBe(parseEther('0.002'));

    // A restored plugin finds the same balance from the key and the chain alone.
    const again = await open(MNEMONIC_B);

    expect((await again.balance(undefined))[0]!.amount).toBe(parseEther('0.002'));
  });

  it('refuses what the balance cannot cover, and consolidates a fragmented one', async () => {
    const sender = await fundedWallet(rpcUrl, ACCOUNTS.alice);
    const other = await fundedWallet(rpcUrl, ACCOUNTS.charlie);
    const have = (await alice.balance(undefined))[0]!.amount;

    await expect(alice.prepareUnshield({ asset: ETH, amount: have + 1n }, '0x00000000000000000000000000000000000dead2')).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );

    // Alice holds 0.015 in one note; two small shields make three notes.
    for (const amount of ['0.004', '0.003']) {
      await sender.send((await alice.prepareShield({ asset: ETH, amount: parseEther(amount) })).txns[0]!);
    }

    const total = parseEther('0.022');
    const want = parseEther('0.021');

    expect((await alice.balance(undefined))[0]!.amount).toBe(total);
    await expect(alice.prepareUnshield({ asset: ETH, amount: want }, '0x00000000000000000000000000000000000dead2')).rejects.toBeInstanceOf(
      TacitFragmentedBalanceError,
    );

    await other.send((await alice.prepareConsolidate()).txns[0]!);
    expect(await alice.notes?.()).toHaveLength(2);

    const op = await alice.prepareUnshield({ asset: ETH, amount: want }, '0x00000000000000000000000000000000000dead2');

    await other.send(op.txns[0]!);
    expect((await alice.balance(undefined))[0]!.amount).toBe(parseEther('0.001'));
  });
});
