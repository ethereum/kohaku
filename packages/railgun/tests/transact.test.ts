import { checksumAddress, createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { expect, test } from "vitest";
import { erc20, initLogging, JsRailgunProvider, JsSigner, JsSyncer } from "../src/index.js";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { viem } from "@kohaku-eth/provider/viem";
import { EthereumProviderAdapter } from "../src/ethereum-provider.js";
import { GrothProverAdapter, RemoteArtifactLoader } from "../src/prover-adapter.js";

const CHAIN_ID = 1n;
const INTEGRATION = process.env.INTEGRATION === "1";
const RPC_URL = "http://localhost:8545";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ARTIFACTS_URL = "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/";

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/**
 * Tests a full transact flow, including shielding, transferring, and unshielding.
 * 
 * This integration test ensures that the entire transact flow works correctly using
 * the public RailgunProvider interface. Includes internal syncing, tx building, UTXO
 * management, and UTXO proof generation.
 * 
 * This integration test DOES NOT verify any TXID or POI functionality.
 */
test("transact-utxo", async () => {
  if (!INTEGRATION) {
    console.warn("Skipping integration test. Set INTEGRATION=1 to run.");

    return;
  }

  initLogging();

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
  const rpcAdapter = new EthereumProviderAdapter(viem(publicClient));
  const syncer = await JsSyncer.newRpc(rpcAdapter, CHAIN_ID, 10n);
  const railgun = await JsRailgunProvider.new(rpcAdapter, syncer, prover);

  const state = readFileSync("./provider_state_utxo_1.json");

  railgun.setState(state);

  const account1 = JsSigner.random(CHAIN_ID);
  const account2 = JsSigner.random(CHAIN_ID);

  console.log("Sync Railgun");
  await railgun.sync();
  railgun.register(account1);
  railgun.register(account2);

  console.log("Testing Shield");
  {
    const txs = railgun.shield().shield(account1.address, USDC, 1_000_000n).build();
    const tx = txs[0];
    if (!tx) {
      throw new Error("Expected at least one shield transaction");
    }
    const shieldHash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
    });

    await publicClient.waitForTransactionReceipt({ hash: shieldHash });

    await railgun.sync();
    const balance1 = railgun.balance(account1.address);
    const balance2 = railgun.balance(account2.address);

    expect(balance1.find((entry) => JSON.stringify(entry.assetId) === JSON.stringify(USDC))?.balance).toBe(997500n);
    expect(balance2.find((entry) => JSON.stringify(entry.assetId) === JSON.stringify(USDC))?.balance).toBeUndefined();
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

    expect(balance1.find((entry) => JSON.stringify(entry.assetId) === JSON.stringify(USDC))?.balance).toBe(992500n);
    expect(balance2.find((entry) => JSON.stringify(entry.assetId) === JSON.stringify(USDC))?.balance).toBe(5000n);
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

    expect(balance1.find((entry) => JSON.stringify(entry.assetId) === JSON.stringify(USDC))?.balance).toBe(991500n);
    expect(balance2.find((entry) => JSON.stringify(entry.assetId) === JSON.stringify(USDC))?.balance).toBe(5000n);

    const eoaBalance = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [unshieldRecipient as `0x${string}`],
    });

    expect(eoaBalance).toBe(998n);
  }
}, 300 * 1000);
