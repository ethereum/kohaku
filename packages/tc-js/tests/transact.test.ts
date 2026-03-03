import { createPublicClient, createWalletClient, http } from "viem";
import { test } from "vitest";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { TornadoClassicProver } from "../src/prover-adapter.js";
import { RemoteArtifactLoader } from "../src/artifact-loader.js";
import { JsPool, JsSyncer, JsTornadoProvider } from "../src/pkg/tc_rs.js";
import { ViemEthRpcAdapter } from "../../eth-rpc/src/viem.js";

const RPC_URL = "http://localhost:8545";
const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Tests the full transaction flow for depositing and withdrawing a note from a tornado pool.
test("transact", async () => {
  console.log("Setup viem");
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  console.log("Setup TC");
  const pool = JsPool.sepoliaEther1;
  const loader = new RemoteArtifactLoader(
    "https://raw.githubusercontent.com/Robert-MacWha/privacy-protocol-artifacts/refs/heads/main/artifacts/tornadocash-classic/tornado.json",
    "https://raw.githubusercontent.com/Robert-MacWha/privacy-protocol-artifacts/refs/heads/main/artifacts/tornadocash-classic/tornadoProvingKey.bin"
  );
  const prover = new TornadoClassicProver(loader);
  const rpcAdapter = new ViemEthRpcAdapter(publicClient);
  const cacheSyncer = JsSyncer.newCache(
    await (await fetch("https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/cache/tornadocash-classic/cache_sepolia_eth_1.json")).text()
  );
  const rpcSyncer = await JsSyncer.newRpc(rpcAdapter, 10000n);
  const syncer = JsSyncer.newChained([cacheSyncer, rpcSyncer]);
  const tornado = JsTornadoProvider.new(rpcAdapter, syncer, prover);
  tornado.addPool(pool);

  console.log("Syncing");
  await tornado.sync();

  console.log("Testing Deposit");
  const deposit = tornado.deposit(pool);
  const note = deposit.note;
  const depositTx = deposit.txData;

  console.log("Sending deposit transaction");
  const depositHash = await walletClient.sendTransaction({
    to: depositTx.to,
    data: depositTx.data,
    value: BigInt(depositTx.value),
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });

  console.log("Syncing");
  await tornado.sync();

  console.log("Testing Withdraw");
  const withdrawTx = await tornado.withdraw(pool, note, account.address);

  console.log("Sending withdraw transaction");
  const withdrawHash = await walletClient.sendTransaction({
    to: withdrawTx.to,
    data: withdrawTx.data,
    value: BigInt(withdrawTx.value),
  });
  await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
}, 300 * 1000);
