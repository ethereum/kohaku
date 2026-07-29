import { checksumAddress, createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { afterAll, beforeAll, expect, test } from "vitest";
import { chainConfigSepolia, erc20, UtxoSyncer, RailgunBuilder, RailgunSigner, BalanceEntry, Bundler, SimpleSmartAccount, Signer } from "../sdk/lib.js";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ensureInitialized } from "../sdk/lib.js";
import { EthereumProviderAdapter } from "../sdk/ethereum-provider.js";
import { viem } from "@kohaku-eth/provider/viem";
import { ALTO_EXECUTOR_PK, ALTO_UTILITY_PK, DELEGATOR_PK, WALLET_PK, fundAddresses, startAlto, startAnvil } from "./utils.js";

await ensureInitialized();
const CHAIN = chainConfigSepolia();
const INTEGRATION = process.env.INTEGRATION === "1";
const SEPOLIA_RPC_URL: string | undefined = process.env.RPC_URL_SEPOLIA;
if (!SEPOLIA_RPC_URL)
    throw new Error("RPC_URL_SEPOLIA env must be defined");

const erc20Abi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
]);

let rpcUrl: string;
let anvilServer: Awaited<ReturnType<typeof startAnvil>>["server"];
let altoServer: Awaited<ReturnType<typeof startAlto>>;

beforeAll(async () => {
    const anvil = await startAnvil(SEPOLIA_RPC_URL, CHAIN.id);
    anvilServer = anvil.server;
    rpcUrl = anvil.rpcUrl;

    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    await fundAddresses(publicClient, [
        privateKeyToAccount(ALTO_EXECUTOR_PK).address,
        privateKeyToAccount(ALTO_UTILITY_PK).address,
    ]);

    altoServer = await startAlto(rpcUrl);
}, 60_000);

afterAll(async () => {
    await altoServer?.stop();
    await anvilServer?.stop();
});

/**
 * Tests a full broadcast flow, including shielding, transferring, and unshielding.
 * 
 * This integration test ensures that the entire broadcast flow works correctly using
 * the public RailgunProvider interface. Includes internal syncing, tx building, UTXO
 * management, and UTXO proof generation.
 * 
 * This integration test DOES NOT verify any TXID or POI functionality.
 */
test("broadcast-utxo", async () => {
    if (!INTEGRATION) {
        console.warn("Skipping integration test. Set INTEGRATION=1 to run.");
        return;
    }

    const WETH = erc20(CHAIN.wrappedBaseToken);

    console.log("Setup viem");
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
    });
    const viemClient = new EthereumProviderAdapter(viem(publicClient));

    const account = privateKeyToAccount(WALLET_PK);
    const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
    });

    console.log("Setup Railgun");
    const syncer = UtxoSyncer.chained([UtxoSyncer.subsquid(CHAIN), UtxoSyncer.rpc(CHAIN, viemClient, 1000n)]);
    const railgun = await new RailgunBuilder(CHAIN, viemClient).withUtxoSyncer(syncer).build();
    const bundler = Bundler.pimlico("http://127.0.0.1:3000");
    const smartAccountSigner = Signer.privateKey(DELEGATOR_PK);
    const smartAccount = new SimpleSmartAccount(smartAccountSigner.address, BigInt(CHAIN.id), viemClient);

    const account1 = RailgunSigner.random(BigInt(CHAIN.id));
    const account2 = RailgunSigner.random(BigInt(CHAIN.id));

    const wethBalance = (balances: BalanceEntry[]) =>
        balances.find(b => b.asset.value === CHAIN.wrappedBaseToken)?.amount;

    console.log("Sync Railgun");
    await railgun.sync();
    railgun.register(account1);
    railgun.register(account2);

    console.log("Testing Shield");
    {
        const txs = railgun.shield().shieldNative(account1.address, 1_000_000_000_000_000_000n).build();
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

        expect(wethBalance(balance1)).toBe(997500000000000000n);
        expect(wethBalance(balance2)).toBeUndefined();
    }

    console.log("Testing Transfer");
    {
        const builder = railgun.transact().transfer(account1, account2.address, WETH, 5000n, "test transfer");
        const signableUserOp = await railgun.prepareUserOp(builder, bundler, smartAccount, account1, CHAIN.wrappedBaseToken);
        const signedUserOp = await signableUserOp.sign(smartAccountSigner);
        const userOpHash = await bundler.sendUserOperation(signedUserOp);
        const userOpReceipt = await bundler.waitForReceipt(userOpHash);
        console.log("User operation receipt:", userOpReceipt);

        await railgun.sync();
        const balance2 = await railgun.balance(account2.address);

        expect(wethBalance(balance2)).toBe(5000n);
    }

    console.log("Testing Unshield");
    {
        const unshieldRecipient = checksumAddress("0xe03747a83E600c3ab6C2e16dd1989C9b419D3a86");
        const builder = railgun.transact().unshield(account1, unshieldRecipient, WETH, 1000n);
        const signableUserOp = await railgun.prepareUserOp(builder, bundler, smartAccount, account1, CHAIN.wrappedBaseToken);
        const signedUserOp = await signableUserOp.sign(smartAccountSigner);
        const userOpHash = await bundler.sendUserOperation(signedUserOp);
        const userOpReceipt = await bundler.waitForReceipt(userOpHash);
        console.log("User operation receipt:", userOpReceipt);

        const eoaBalance = await publicClient.readContract({
            address: CHAIN.wrappedBaseToken,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [unshieldRecipient as `0x${string}`],
        });

        expect(eoaBalance).toBe(998n);
    }
}, 300 * 1000);
