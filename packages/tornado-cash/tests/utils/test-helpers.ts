import { ERC20AssetId, Host } from '@kohaku-eth/plugins';
import { AbiCoder, CallExceptionError, Contract, getAddress, JsonRpcProvider, keccak256, SigningKey, toBeHex, TransactionRequest, Wallet } from "ethers";

import { TornadoCashConfigs, TornadoCashProtocol, createTCBroadcaster } from '@kohaku-eth/tornado-cash';
import { type AnvilPool } from './anvil';
import { InitialState } from './common';
import { IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { createMockRelayerClient } from './mock-relayer';
import { poolAbi } from '../../src/data/abis/pool.abi';
import { TornadoPaymasterConfigs } from '../../src/config';
import { ITornadoArtifacts } from '../../src/plugin/interfaces/protocol-params.interface';
import { defaultArtifactsLoader } from '../../src/utils/default-artifacts-loader';
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

function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('sqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Overrides a Uniswap V3 pool's price on the fork so quotes/TWAPs are sane.
 *
 * The real Sepolia WETH/DAI pools are arbitrarily priced (testnet liquidity),
 * which makes both the SDK fee quote and the paymaster's on-chain TWAP value gas
 * at absurd rates. This rewrites the pool's `slot0` (sqrtPriceX96 + tick) and a
 * deep `liquidity` value via storage, then advances time past the TWAP window so
 * `OracleLibrary.consult` reflects the new tick.
 *
 * Assumes token0 = stable (18 decimals), token1 = WETH (18 decimals).
 */
export async function setUniswapV3PoolPrice(
  pool: AnvilPool,
  poolAddress: string,
  tokenPerEth: bigint,
  twapPeriodSeconds = 300,
): Promise<void> {
  const provider = new JsonRpcProvider(pool.rpcUrl, undefined, { staticNetwork: true });

  // price = token1/token0 (raw) = WETH per stable = 1 / tokenPerEth (both 18 decimals)
  const sqrtPriceX96 = bigintSqrt((1n << 192n) / tokenPerEth);

  // tick = floor(log_1.0001(price))
  const tick = Math.floor(Math.log(1 / Number(tokenPerEth)) / Math.log(1.0001));
  const tickU = BigInt(tick < 0 ? (1 << 24) + tick : tick) & ((1n << 24n) - 1n);

  // slot0 (storage slot 0) packs: sqrtPriceX96[0:160] | tick[160:184] | <observation/lock bits>
  const current = BigInt(await provider.send('eth_getStorageAt', [poolAddress, '0x0', 'latest']));
  const preservedHighBits = current & ~((1n << 184n) - 1n);
  const newSlot0 = preservedHighBits | sqrtPriceX96 | (tickU << 160n);
  await provider.send('anvil_setStorageAt', [poolAddress, toBeHex(0, 32), toBeHex(newSlot0, 32)]);

  // liquidity is storage slot 4 — set it deep so a small quote swap has ~no slippage
  await provider.send('anvil_setStorageAt', [poolAddress, toBeHex(4, 32), toBeHex(10n ** 24n, 32)]);

  // Advance past the TWAP window so consult() extrapolates the new tick
  await provider.send('evm_increaseTime', [twapPeriodSeconds * 2]);
  await provider.send('anvil_mine', ['0x1']);
}

/**
 * Get the ERC20 balance of an account
 */
export async function getERC20Balance(
  rpcUrl: string,
  tokenAddress: string,
  account: string
): Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const erc20Abi = ['function balanceOf(address account) view returns (uint256)'];
  const token = new Contract(tokenAddress, erc20Abi, provider);

  return token.balanceOf(account) as Promise<bigint>;
}

/**
 * Approve ERC20 spending
 */
export async function approveERC20(
  signer: Wallet,
  tokenAddress: string,
  spender: string,
  amount: bigint
) {
  const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
  const token = new Contract(tokenAddress, erc20Abi, signer);
  const tx = await token.approve(spender, amount);

  return tx.wait() as Promise<{ status: number; }>;
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
) {
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
  const r = await tx.wait();

  // Stop impersonating
  await provider.send('anvil_stopImpersonatingAccount', [normalizedWhale]);

  return r;
}

interface GetAssetConfigParams {
  provider: JsonRpcProvider;
  entrypointAddress: bigint;
  asset: ERC20AssetId;
}

export async function getAssetConfig({ provider, entrypointAddress, asset }: GetAssetConfigParams) {
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
    pool,
    minimumDepositAmount,
    vettingFeeBPS,
    maxRelayFeeBPS
  ] = assetConfig;

  return {
    pool: getAddress(pool),
    minimumDepositAmount: BigInt(minimumDepositAmount),
    vettingFeeBPS: BigInt(vettingFeeBPS),
    maxRelayFeeBPS: BigInt(maxRelayFeeBPS)
  };
}

export async function assetVettingFee({ provider, entrypointAddress, asset }: GetAssetConfigParams) {
  const { vettingFeeBPS } = await getAssetConfig({ provider, entrypointAddress, asset });

  return vettingFeeBPS;
}

export async function getPoolStateRoot(pool: AnvilPool, poolAddress: bigint) {
  const poolRootAbi = [poolAbi[0]];
  const provider = await pool.getProvider();
  const padd = toBeHex(poolAddress);
  const poolSC = new Contract(padd, poolRootAbi, provider);
  const root = await poolSC.getLastRoot();

  return BigInt(root);
}

interface SimplifiedProtocolParams {
  host: Host,
  bundlerUrl?: string;
  initialState?: () => Promise<InitialState>;
  rpcUrl: string;
  chainId: 1 | 11155111;
  relayerClientFactory?: () => IRelayerClient
}

const cachedArtifactsLoader = () => {
  let artifacts: ITornadoArtifacts | null = null;
  
  return async () => {
    if (artifacts) {
      return artifacts;
    }

    artifacts = await defaultArtifactsLoader();
    
    return artifacts;
  }
}

export const getProtocolWithState = async ({
  host,
  chainId,
  relayerClientFactory = () => createMockRelayerClient({ chainId }),
  bundlerUrl,
  ...rest
}: SimplifiedProtocolParams) => {
  const paymasterConfig = {
    [chainId]: {
      ...TornadoPaymasterConfigs[chainId],
      ...(bundlerUrl ? { bundlerUrl } : {}),
    }
  }
  const protocolConfig = TornadoCashConfigs[chainId];
  const broadcaster = createTCBroadcaster(host, { relayerClientFactory, paymasterConfig });
  const protocol = new TornadoCashProtocol(host, {
    protocolConfig,
    relayerClientFactory,
    paymasterConfig,
    artifactsLoader: cachedArtifactsLoader(),
    ...rest,
  });

  return {protocol, broadcaster};
};

export async function sendTx(signer: Wallet, { to, data, value }: TransactionRequest) {
  return signer.sendTransaction({ to, data, value, gasLimit: 6000000n });
}

export async function sendTxAndWait(signer: Wallet, { to, data, value }: TransactionRequest) {
  return signer.sendTransaction({ to, data, value, gasLimit: 6000000n })
    .then(tx => tx.wait())
    .catch(e => {
      if (e?.code === "CALL_EXCEPTION") {
        const { receipt } = e as CallExceptionError;

        return receipt;
      } else {
        return { status: 0 };
      }
    });
}

export async function sendMultipleTxsAndWait(signer: Wallet, txs: TransactionRequest[]) {
  const responses: Awaited<ReturnType<typeof sendTxAndWait>>[] = [];

  for (const tx of txs) {
    responses.push(await sendTxAndWait(signer, tx));
  }

  return responses;
}

export async function setupWallet(pool: AnvilPool, pk: string | SigningKey): Promise<Wallet> {
  const jsonRpcProvider = await pool.getProvider();
  const signer = new Wallet(pk, jsonRpcProvider);

  // Fund with enough ETH for multiple deposits
  await fundAccountWithETH(pool, signer.address, BigInt('100000000000000000000')); // 100 ETH

  return signer;
}
