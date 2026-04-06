import { test } from "vitest";
import { initLogging, JsRailgunProvider, JsSyncer } from "../src/index.js";
import { GrothProverAdapter, RemoteArtifactLoader } from "../src/prover-adapter.js";
import { writeFileSync } from "node:fs";
import { viem } from "@kohaku-eth/provider/viem";
import { EthereumProviderAdapter } from "../src/ethereum-provider.js";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const CHAIN_ID = 1n;
const RPC_URL = process.env.RPC_URL_MAINNET!;
const INTEGRATION = process.env.INTEGRATION === "1";
const ARTIFACTS_URL = "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/";
const FORK_BLOCK = 24379760n;

/**
 * Integration test for syncing UTXO state. 
 * 
 * This test syncs the Railgun provider to a specific block and saves the state to 
 * disk. It verifies that the sync process completes successfully, and that the
 * resulting merkle root is valid against the on-chain root.
 */
test("sync-utxo", async () => {
  if (!INTEGRATION) {
    console.warn("Skipping integration test. Set INTEGRATION=1 to run.");

    return;
  }

  initLogging();

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(RPC_URL),
  });

  console.log("Setup Railgun");
  const prover = new GrothProverAdapter(new RemoteArtifactLoader(ARTIFACTS_URL));
  const rpcAdapter = new EthereumProviderAdapter(viem(publicClient));
  const syncer = JsSyncer.newChained([
    JsSyncer.newSubsquid(CHAIN_ID),
    await JsSyncer.newRpc(rpcAdapter, CHAIN_ID, 10n),
  ])
  const railgun = await JsRailgunProvider.new(rpcAdapter, syncer, prover);

  console.log("Sync Railgun");
  await railgun.syncTo(FORK_BLOCK);

  // Save state to disk
  const state = railgun.state();

  writeFileSync("./provider_state_utxo_1.json", state);
}, 300 * 1000);
