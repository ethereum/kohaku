import { checksumAddress, createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { expect, test } from "vitest";
import { chainConfigSepolia, erc20, NoteSyncer, RailgunProvider, RailgunSigner } from "../sdk/lib.js";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ensureInitialized, initLogging, EthereumProviderAdapter } from "../sdk/lib.js";
import { viem } from "@kohaku-eth/provider/viem";

await ensureInitialized();
initLogging("Info");
const CHAIN = chainConfigSepolia();
const INTEGRATION = process.env.INTEGRATION === "1";
const RPC_URL = "http://localhost:8545";

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

    const WETH = erc20(CHAIN.wrapped_base_token);

    console.log("Setup viem");
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(RPC_URL),
    });
    const viemClient = new EthereumProviderAdapter(viem(publicClient));

    const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(RPC_URL),
    });

    console.log("Setup Railgun");
    // const prover = new GrothProverAdapter(new RemoteArtifactLoader(ARTIFACTS_URL));
    const syncer = NoteSyncer.chained([NoteSyncer.subsquid(CHAIN), NoteSyncer.rpc(CHAIN, viemClient, 1000n)]);
    const railgun = new RailgunProvider(CHAIN, viemClient, syncer);

    const account1 = RailgunSigner.random(BigInt(CHAIN.id));
    const account2 = RailgunSigner.random(BigInt(CHAIN.id));

    console.log("Sync Railgun");
    await railgun.sync();
    railgun.register(account1);
    railgun.register(account2);

    console.log("Testing Shield");
    {
        const txs = railgun.shield().shieldNative(account1.address, 1_000_000n).build();
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
        const balance1 = await railgun.balance(account1.address);
        const balance2 = await railgun.balance(account2.address);

        expect(balance1.find((entry) => JSON.stringify(entry[0]) === JSON.stringify(WETH))?.[1]).toBe(997500n);
        expect(balance2.find((entry) => JSON.stringify(entry[0]) === JSON.stringify(WETH))?.[1]).toBeUndefined();
    }

    console.log("Testing Transfer");
    {
        const builder = railgun.transact().transfer(account1, account2.address, WETH, 5000n, "test transfer");
        const tx = await railgun.build(builder);
        const transferHash = await walletClient.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
        });

        await publicClient.waitForTransactionReceipt({ hash: transferHash });

        await railgun.sync();
        const balance1 = await railgun.balance(account1.address);
        const balance2 = await railgun.balance(account2.address);

        expect(balance1.find((entry) => JSON.stringify(entry[0]) === JSON.stringify(WETH))?.[1]).toBe(992500n);
        expect(balance2.find((entry) => JSON.stringify(entry[0]) === JSON.stringify(WETH))?.[1]).toBe(5000n);
    }

    console.log("Testing Unshield");
    {
        const unshieldRecipient = checksumAddress("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86");
        const builder = railgun.transact().unshield(account1, unshieldRecipient, WETH, 1000n);
        const tx = await railgun.build(builder);
        const unshieldHash = await walletClient.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
        });

        await publicClient.waitForTransactionReceipt({ hash: unshieldHash });

        await railgun.sync();
        const balance1 = await railgun.balance(account1.address);
        const balance2 = await railgun.balance(account2.address);

        expect(balance1.find((entry) => JSON.stringify(entry[0]) === JSON.stringify(WETH))?.[1]).toBe(991500n);
        expect(balance2.find((entry) => JSON.stringify(entry[0]) === JSON.stringify(WETH))?.[1]).toBe(5000n);
        const eoaBalance = await publicClient.readContract({
            address: CHAIN.wrapped_base_token as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [unshieldRecipient as `0x${string}`],
        });

        expect(eoaBalance).toBe(998n);
    }
}, 300 * 1000);
