import { createPublicClient, createWalletClient, http } from "viem";
import { test } from "vitest";
import { createProver } from "../src/prover-adapter.js";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { JsPool, JsSyncer, JsTornadoProvider, JsVerifier } from "../src/pkg/tc_rs.js";
import { readFileSync } from "node:fs";

const RPC_URL = "http://localhost:8545";
const CACHE_PATH = "../../crates/tc-rs/tests/fixtures";
const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Tests the full transaction flow for depositing and withdrawing a note from a tornado pool.
test("transact", async () => {
  console.log("Setup Railgun");
  const pool = JsPool.ethereumEther100;
  const prover = createProver();
  const cache_syncer = JsSyncer.newCache(
    readFileSync(`${CACHE_PATH}/cache_ethereum_eth_100.json`, "utf-8")
  );
  const rpc_syncer = await JsSyncer.newRpc(RPC_URL, 10000n);
  const syncer = JsSyncer.newChained([cache_syncer, rpc_syncer]);
  const verifier = await JsVerifier.newRpc(RPC_URL);
  const tornado = JsTornadoProvider.new(syncer, verifier, prover);
  tornado.addPool(pool);

  console.log("Setup viem");
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(RPC_URL),
  });

  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http(RPC_URL),
  });

  console.log("Syncing");
  await tornado.sync();

  console.log("Testing Deposit");
  const deposit = tornado.deposit(pool);
  const note = deposit.note;
  const depositTx = deposit.txData;

  console.log("Sending deposit transaction");
  const depositHash = await walletClient.sendTransaction({
    to: depositTx.to as `0x${string}`,
    data: depositTx.dataHex as `0x${string}`,
    value: BigInt(depositTx.value),
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });

  console.log("Syncing");
  await tornado.sync();

  console.log("Testing Withdraw");
  const withdrawTx = await tornado.withdraw(pool, note, account.address);

  console.log("Sending withdraw transaction");
  const withdrawHash = await walletClient.sendTransaction({
    to: withdrawTx.to as `0x${string}`,
    data: withdrawTx.dataHex as `0x${string}`,
    value: BigInt(withdrawTx.value),
  });
  await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
}, 300 * 1000);
