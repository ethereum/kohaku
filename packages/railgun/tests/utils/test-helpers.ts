import { RailgunProvider } from '../../src/provider/index';
import { type AnvilInstance } from './anvil';

/**
 * Fund an account with ETH using anvil's setBalance
 */
export async function fundAccountWithETH(
  anvil: AnvilInstance,
  address: string,
  balance: bigint
): Promise<void> {
  await anvil.setBalance(address, `0x${balance.toString(16)}`);
}

/**
 * Get ETH balance of an address
 */
export async function getETHBalance(
  provider: RailgunProvider,
  address: string
): Promise<bigint> {
  return await provider.getProvider().getBalance(address);
}
