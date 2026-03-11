import { AbiCoder, Contract, getAddress, JsonRpcProvider, keccak256, SigningKey, toBeHex, Wallet, zeroPadValue } from 'ethers';

import { type AnvilPool } from './anvil';
import type { Host } from '@kohaku-eth/plugins';

export function createProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: 0, batchMaxCount: 1, staticNetwork: true });
}

export type EthProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
};

export function createMockHost(provider: JsonRpcProvider, overrides?: Partial<Host>): { host: Host; ethProvider: EthProvider } {
  const ethProvider: EthProvider = {
    request: ({ method, params }) =>
      provider.send(method, Array.isArray(params) ? params : []),
  };
  const keystore = { deriveAt: (_path: string) => '0x1' as `0x${string}` };
  const host = { provider: ethProvider, keystore, ...overrides } as unknown as Host;

  return { host, ethProvider };
}

async function fundAccountWithETH(pool: AnvilPool, address: string, balance: bigint): Promise<void> {
  await pool.setBalance(address, `0x${balance.toString(16)}`);
}

export async function setupWallet(pool: AnvilPool, pk: string | SigningKey): Promise<Wallet> {
  const provider = await pool.getProvider();
  const signer = new Wallet(pk, provider);

  await fundAccountWithETH(pool, signer.address, 100000000000000000000n); // 100 ETH

  return signer;
}

export async function transferERC20FromWhale(
  rpcUrl: string,
  tokenAddress: string,
  whaleAddress: string,
  recipient: string,
  amount: bigint
): Promise<void> {
  const provider = createProvider(rpcUrl);
  const normalizedWhale = getAddress(whaleAddress.toLowerCase());

  await provider.send('anvil_impersonateAccount', [normalizedWhale]);
  await provider.send('anvil_setBalance', [normalizedWhale, '0x56BC75E2D63100000']); // 100 ETH

  const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
  const impersonatedSigner = await provider.getSigner(normalizedWhale);
  const token = new Contract(tokenAddress, erc20Abi, impersonatedSigner);

  await (await token.transfer(recipient, amount)).wait();

  await provider.send('anvil_stopImpersonatingAccount', [normalizedWhale]);
}

export async function mintERC20(
  pool: AnvilPool,
  tokenAddress: string,
  recipient: string,
  amount: bigint,
  balanceSlot = 9
): Promise<void> {
  const slot = keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [recipient, balanceSlot])
  );
  const value = zeroPadValue(toBeHex(amount), 32);

  await pool.setStorageAt(tokenAddress, slot, value);
}

export async function approveERC20(
  signer: Wallet,
  tokenAddress: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
  const token = new Contract(tokenAddress, erc20Abi, signer);

  await (await token.approve(spender, amount)).wait();
}

export async function sendTx(signer: Wallet, { to, data, value }: { to: string; data: string; value: bigint; }) {
  const response = await signer.sendTransaction({ to, data, value, gasLimit: 6000000n });

  return response.wait();
}
