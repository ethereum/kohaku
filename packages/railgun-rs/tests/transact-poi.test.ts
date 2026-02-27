import { checksumAddress, createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { expect, test } from "vitest";
import { erc20, JsPoiProvider, JsSigner, type AssetId, type RailgunAddress, type ListKey, type PoiStatus } from "../src/pkg/railgun_rs.js";
import { createProver } from "../src/prover-adapter.js";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const USDC_ADDRESS = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const CHAIN_ID = 11155111n;
const RPC_URL = process.env.RPC_URL_SEPOLIA!;
const SIGNER_KEY = `0x${process.env.DEV_KEY!}` as `0x${string}`;
const ARTIFACTS_PATH = "../../artifacts/railgun";

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("transact-poi", async () => {
  const USDC = erc20(USDC_ADDRESS);

  console.log("Setup Railgun POI Provider");
  const prover = createProver({ artifactsPath: ARTIFACTS_PATH });
  const railgun = await JsPoiProvider.new_from_rpc(CHAIN_ID, RPC_URL, 10n, prover);

  const listKeys = railgun.list_keys();
  expect(listKeys.length).toBeGreaterThan(0);
  const listKey = listKeys[0]!;

  console.log("Setup viem");
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const account = privateKeyToAccount(SIGNER_KEY);
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const account1 = JsSigner.random(CHAIN_ID);
  const account2 = JsSigner.random(CHAIN_ID);

  console.log("Sync Railgun");
  await railgun.sync();
  railgun.register(account1);
  railgun.register(account2);

  console.log("Testing Shield");
  {
    const tx = railgun.shield().shield(account1.address, USDC, 10n).build();
    const shieldHash = await walletClient.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.dataHex as `0x${string}`,
      value: BigInt(tx.value),
    });
    await publicClient.waitForTransactionReceipt({ hash: shieldHash });
    console.log(`Executed shield: ${shieldHash}`);

    await awaitBalanceUpdate(railgun, account1.address, listKey, USDC, 10n);
    await awaitBalanceUpdate(railgun, account2.address, listKey, USDC, undefined);
  }

  console.log("Testing Transfer");
  {
    const builder = railgun.transact().transfer(account1, account2.address, USDC, 5n, "test transfer");
    const tx = await railgun.build(builder);
    const transferHash = await walletClient.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.dataHex as `0x${string}`,
      value: tx.value,
    });
    await publicClient.waitForTransactionReceipt({ hash: transferHash });
    console.log(`Executed transfer: ${transferHash}`);

    await awaitBalanceUpdate(railgun, account1.address, listKey, USDC, 5n);
    await awaitBalanceUpdate(railgun, account2.address, listKey, USDC, 5n);
  }

  console.log("Testing Unshield");
  {
    const unshieldRecipient = checksumAddress("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86");

    const preUnshieldBalance = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [unshieldRecipient as `0x${string}`],
    });

    const builder = railgun.transact().unshield(account1, unshieldRecipient, USDC, 2n);
    const tx = await railgun.build(builder);
    const unshieldHash = await walletClient.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.dataHex as `0x${string}`,
      value: tx.value,
    });
    await publicClient.waitForTransactionReceipt({ hash: unshieldHash });
    console.log(`Executed unshield: ${unshieldHash}`);

    await awaitBalanceUpdate(railgun, account1.address, listKey, USDC, 3n);
    await awaitBalanceUpdate(railgun, account2.address, listKey, USDC, 5n);

    const postUnshieldBalance = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [unshieldRecipient as `0x${string}`],
    });
    expect(postUnshieldBalance - preUnshieldBalance).toBe(2n);
  }
}, 500 * 1000);

async function awaitBalanceUpdate(
  railgun: JsPoiProvider,
  address: RailgunAddress,
  listKey: ListKey,
  asset: AssetId,
  expected: bigint | undefined,
  timeoutMs = 100_000,
  pollMs = 10_000,
) {
  const start = Date.now();

  while (true) {
    console.log("Waiting for balance to update...");
    await sleep(pollMs);

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Balance did not update within ${timeoutMs / 1000} seconds`);
    }

    await railgun.sync();
    const balance = await railgun.balance(address, listKey);
    const validBalance = balance.get("Valid", asset);
    console.log(`Balance: ${validBalance}`);

    if (expected === undefined && (validBalance === undefined || validBalance === 0n)) {
      return;
    }
    if (expected !== undefined && validBalance === expected) {
      return;
    }
  }
}
