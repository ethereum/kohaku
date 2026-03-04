import { ERC20AssetId, Host } from '@kohaku-eth/plugins';
import { AbiCoder, CallExceptionError, Contract, ContractTransactionResponse, getAddress, JsonRpcProvider, keccak256, SigningKey, toBeHex, Wallet } from "ethers";

import { PrivacyPoolsV1Protocol } from '../../src';
import { type AnvilPool } from './anvil';
import { InitialState, loadInitialState, MAINNET_ENTRYPOINT } from './common';
import { createMockHost } from './mock-host';

/**
 * Fund an account with ETH using anvil pool's setBalance
 */
export async function fundAccountWithETH(
  pool: AnvilPool,
  address: string,
  balance: bigint
): Promise<void> {
  await pool.setBalance(address, `0x${balance.toString(16)}`);
}

/**
 * Calculate storage slot for a mapping(address => uint256)
 * slot = keccak256(abi.encode(key, baseSlot))
 */
function getMappingStorageSlot(address: string, baseSlot: number): string {
  const abiCoder = new AbiCoder();
  const encoded = abiCoder.encode(['address', 'uint256'], [address, baseSlot]);

  return keccak256(encoded);
}

/**
 * Fund an account with ERC20 tokens using anvil's setStorageAt
 * Works by directly manipulating the token's balance mapping in storage
 */
export async function fundAccountWithERC20(
  rpcUrl: string,
  tokenAddress: string,
  recipient: string,
  amount: bigint,
  balanceSlot: number = 9 // USDC uses slot 9 for balances
): Promise<void> {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });

  // Calculate the storage slot for the recipient's balance
  const slot = getMappingStorageSlot(recipient, balanceSlot);

  // Encode the amount as a 32-byte hex value
  const value = toBeHex(amount, 32);

  await provider.send('anvil_setStorageAt', [tokenAddress, slot, value]);
}

/**
 * Approve ERC20 spending
 */
export async function approveERC20(
  signer: Wallet,
  tokenAddress: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
  const token = new Contract(tokenAddress, erc20Abi, signer);
  const tx = await token.approve(spender, amount);

  await tx.wait();
}

/**
 * Impersonate an account and transfer ERC20 tokens
 * Useful when storage manipulation doesn't work for proxy contracts
 */
export async function transferERC20FromWhale(
  rpcUrl: string,
  tokenAddress: string,
  whaleAddress: string,
  recipient: string,
  amount: bigint
): Promise<void> {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });

  // Normalize addresses
  const normalizedWhale = getAddress(whaleAddress.toLowerCase());

  // Impersonate the whale
  await provider.send('anvil_impersonateAccount', [normalizedWhale]);

  // Fund whale with ETH for gas
  await provider.send('anvil_setBalance', [normalizedWhale, '0x56BC75E2D63100000']); // 100 ETH

  const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
  const impersonatedSigner = await provider.getSigner(normalizedWhale);
  const token = new Contract(tokenAddress, erc20Abi, impersonatedSigner);

  const tx = await token.transfer(recipient, amount);

  await tx.wait();

  // Stop impersonating
  await provider.send('anvil_stopImpersonatingAccount', [normalizedWhale]);
}

interface Callback<T> {
  (): Promise<T>;
}
async function impersonate<T>(provider: JsonRpcProvider, address: string, f: Callback<T>): Promise<T> {
  await provider.send('anvil_impersonateAccount', [address]);
  const r = await f();

  await provider.send('anvil_stopImpersonatingAccount', [address]);

  return r;
}

export async function pushNewAspRoot(
  rpcUrl: string,
  entrypointAddress: string,
  postmanAddress: string,
  { _root, _ipfsCID }: { _root: bigint, _ipfsCID: string; }
) {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  // Normalize addresses
  const normalizedPostman = getAddress(postmanAddress.toLowerCase());

  // const postmanAbi = ['function updateRoot(_root uint256, _ipfsCID string) returns (_index uint256)'];
  const postmanAbi = [{
    "type": "function",
    "name": "updateRoot",
    "inputs": [
      { "name": "_root", "type": "uint256", "internalType": "uint256" },
      { "name": "_ipfsCID", "type": "string", "internalType": "string" }
    ],
    "outputs": [
      { "name": "_index", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "nonpayable"
  }] as const;

  // Impersonate the postman
  const { hash, data, to } = await impersonate(provider, normalizedPostman, async () => {
    const impersonatedSigner = await provider.getSigner(normalizedPostman);
    const entrypoint = new Contract(getAddress(entrypointAddress), postmanAbi, impersonatedSigner);

    return (await entrypoint.updateRoot(_root, _ipfsCID)) as ContractTransactionResponse;
  });

  return { hash, txData: { data, to, from: normalizedPostman } };
}

export async function assetVettingFee(provider: JsonRpcProvider, entrypointAddress: bigint, asset: ERC20AssetId) {
  const epAbi = [{
    "type": "function",
    "name": "assetConfig",
    "inputs":
      [
        { "name": "_asset", "type": "address", "internalType": "contract IERC20" }
      ],
    "outputs":
      [
        { "name": "pool", "type": "address", "internalType": "contract IPrivacyPool" },
        { "name": "minimumDepositAmount", "type": "uint256", "internalType": "uint256" },
        { "name": "vettingFeeBPS", "type": "uint256", "internalType": "uint256" },
        { "name": "maxRelayFeeBPS", "type": "uint256", "internalType": "uint256" }
      ],
    "stateMutability": "view"
  }] as const;
  const eadd = toBeHex(entrypointAddress);
  const ep = new Contract(eadd, epAbi, provider);
  const assetConfig = await ep.assetConfig(asset.contract);
  const [
    _pool,                      // eslint-disable-line @typescript-eslint/no-unused-vars
    _minimumDepositAmount,      // eslint-disable-line @typescript-eslint/no-unused-vars
    vettingFeeBPS,
  ] = assetConfig;

  return vettingFeeBPS as bigint;
}

export async function getPoolStateRoot(pool: AnvilPool, poolAddress: bigint) {
  const poolRootAbi = [{
    "type": "function",
    "name": "currentRoot",
    "inputs": [],
    "outputs": [{ "name": "root", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  }] as const;
  const provider = await pool.getProvider();
  const padd = toBeHex(poolAddress);
  const poolSC = new Contract(padd, poolRootAbi, provider);
  const root = await poolSC.currentRoot();

  return root as bigint;
}

interface SimplifiedProtocolParams {
  host: Host,
  initialState: InitialState;
}
export const getProtocolWithState = ({
  host = createMockHost(),
  initialState = loadInitialState()
}: Partial<SimplifiedProtocolParams> = {}) => new PrivacyPoolsV1Protocol(host, {
  initialState,
  entrypoint: MAINNET_ENTRYPOINT,
});

export const getProtocol = (host = createMockHost()) => new PrivacyPoolsV1Protocol(host, {
  entrypoint: MAINNET_ENTRYPOINT,
});

export async function sendTx(signer: Wallet, { to, data, value }: { to: string; data: string; value: bigint; }) {
  return signer.sendTransaction({ to, data, value, gasLimit: 6000000n });
}

export async function sendTxAndWait(signer: Wallet, { to, data, value }: { to: string; data: string; value: bigint; }) {
  return signer.sendTransaction({ to, data, value, gasLimit: 6000000n })
    .then(tx => tx.wait())
    .catch(e => {
      if (e?.code === "CALL_EXCEPTION") {
        const { receipt } = e as CallExceptionError;

        return receipt;
      } else {
        console.log(e);

        return { status: 0 };
      }
    });
}

export async function setupWallet(pool: AnvilPool, pk: string | SigningKey): Promise<Wallet> {
  const jsonRpcProvider = await pool.getProvider();
  const signer = new Wallet(pk, jsonRpcProvider);

  // Fund with enough ETH for multiple deposits
  await fundAccountWithETH(pool, signer.address, BigInt('100000000000000000000')); // 100 ETH

  return signer;
}


export function deductVettingFees(amount: bigint, vettingFeeBPS: bigint) {
  const vettingFees = amount * vettingFeeBPS / 10000n;

  return amount - vettingFees;
}

