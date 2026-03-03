import { checksumAddress, createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { expect, test } from "vitest";
import { erc20, JsRailgunProvider, JsSigner, JsSyncer } from "../src/pkg/railgun_rs.js";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { ViemEthRpcAdapter } from "../../eth-rpc/src/viem.js";
import { GrothProverAdapter, RemoteArtifactLoader } from "../src/prover-adapter.js";

const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const CHAIN_ID = 1n;
const RPC_URL = "http://localhost:8545";
const ARTIFACTS_URL = "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/";
const FORK_BLOCK = 24379760n;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

test("transact-utxo", async () => {
  const USDC = erc20(USDC_ADDRESS);

  console.log("Setup viem");
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(RPC_URL),
  });

  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(RPC_URL),
  });

  console.log("Setup Railgun");
  const prover = new GrothProverAdapter(new RemoteArtifactLoader(ARTIFACTS_URL));
  const rpcAdapter = new ViemEthRpcAdapter(publicClient);
  const syncer = await JsSyncer.newRpc(rpcAdapter, CHAIN_ID, 10n);
  const railgun = await JsRailgunProvider.new(rpcAdapter, syncer, prover);

  const state = readFileSync("./provider_state_utxo_1.json");
  railgun.set_state(state);

  const account1 = JsSigner.random(CHAIN_ID);
  const account2 = JsSigner.random(CHAIN_ID);

  console.log("Sync Railgun");
  await railgun.sync_to(FORK_BLOCK);
  railgun.register(account1);
  railgun.register(account2);

  console.log("Testing Shield");
  {
    const tx = railgun.shield().shield(account1.address, USDC, 1_000_000n).build();
    const shieldHash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
    });
    await publicClient.waitForTransactionReceipt({ hash: shieldHash });

    await railgun.sync();
    const balance1 = railgun.balance(account1.address);
    const balance2 = railgun.balance(account2.address);

    expect(balance1.get(USDC)).toBe(997500n);
    expect(balance2.get(USDC)).toBeUndefined();
  }

  console.log("Testing Transfer");
  {
    const builder = railgun.transact().transfer(account1, account2.address, USDC, 5000n, "test transfer");
    const tx = await railgun.build(builder);
    const transferHash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
    });
    await publicClient.waitForTransactionReceipt({ hash: transferHash });

    await railgun.sync();
    const balance1 = railgun.balance(account1.address);
    const balance2 = railgun.balance(account2.address);

    expect(balance1.get(USDC)).toBe(992500n);
    expect(balance2.get(USDC)).toBe(5000n);
  }

  console.log("Testing Unshield");
  {
    const unshieldRecipient = checksumAddress("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86");
    const builder = railgun.transact().unshield(account1, unshieldRecipient, USDC, 1000n);
    const tx = await railgun.build(builder);
    const unshieldHash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
    });
    await publicClient.waitForTransactionReceipt({ hash: unshieldHash });

    await railgun.sync();
    const balance1 = railgun.balance(account1.address);
    const balance2 = railgun.balance(account2.address);

    expect(balance1.get(USDC)).toBe(991500n);
    expect(balance2.get(USDC)).toBe(5000n);

    const eoaBalance = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [unshieldRecipient as `0x${string}`],
    });
    expect(eoaBalance).toBe(998n);
  }
}, 300 * 1000);
