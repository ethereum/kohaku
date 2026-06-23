import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AssetAmount } from "@kohaku-eth/plugins";
import { chainConfigSepolia, Bundler, Signer, UtxoSyncer, RailgunBuilder, RailgunSigner, ensureInitialized, SimpleSmartAccount } from "../sdk/lib.js";
import { RailgunPlugin } from "../sdk/plugin.js";
import { SignerPool } from "../sdk/signer-pool.js";
import { EthereumProviderAdapter } from "../sdk/ethereum-provider.js";
import { viem } from "@kohaku-eth/provider/viem";
import { WALLET_PK, DELEGATOR_PK, ALTO_EXECUTOR_PK, ALTO_UTILITY_PK, startAnvil, startAlto, fundAddresses } from "./utils.js";

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
 * Tests a full broadcast flow via the RailgunPlugin API, including shielding,
 * transferring, and unshielding via 4337 UserOperations.
 *
 * This integration test verifies that gas estimation, 7702-authorization, and
 * on-chain paymaster execution all work correctly end-to-end.
 *
 * This integration test DOES NOT verify any TXID or POI functionality.
 */
test("plugin-transact-broadcast", async () => {
    if (!INTEGRATION) {
        console.warn("Skipping integration test. Set INTEGRATION=1 to run.");
        return;
    }

    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
        account: privateKeyToAccount(WALLET_PK),
        chain: sepolia,
        transport: http(rpcUrl),
    });
    const eip1193 = new EthereumProviderAdapter(viem(publicClient));

    console.log("Setup Railgun");
    const syncer = UtxoSyncer.chained([UtxoSyncer.subsquid(CHAIN), UtxoSyncer.rpc(CHAIN, eip1193, 1000n)]);
    const railgunProvider = await new RailgunBuilder(CHAIN, eip1193).withUtxoSyncer(syncer).build();

    const signer1 = RailgunSigner.random(BigInt(CHAIN.id));
    const signer2 = RailgunSigner.random(BigInt(CHAIN.id));
    railgunProvider.register(signer1);
    railgunProvider.register(signer2);

    console.log("Sync Railgun");
    await railgunProvider.sync();

    const plugin1 = new RailgunPlugin(CHAIN, railgunProvider, new SignerPool(signer1));
    plugin1.setBundler(Bundler.pimlico("http://127.0.0.1:3000"));

    const smartAccountSigner = Signer.privateKey(DELEGATOR_PK);
    const smartAccount = new SimpleSmartAccount(
        smartAccountSigner.address,
        BigInt(CHAIN.id),
        eip1193,
    );
    plugin1.setSmartAccount(smartAccount, smartAccountSigner);

    const plugin2 = new RailgunPlugin(CHAIN, railgunProvider, new SignerPool(signer2));

    const wethBalance = (balances: AssetAmount[]) =>
        balances.find(b => b.asset.__type === 'erc20' && b.asset.contract === CHAIN.wrappedBaseToken)?.amount;

    console.log("Testing shield");
    {
        const txDatas = await plugin1.prepareShield({ asset: { __type: 'native' }, amount: 1_000_000_000_000_000_000n });
        for (const tx of txDatas) {
            const hash = await walletClient.sendTransaction({ to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: tx.value });
            await publicClient.waitForTransactionReceipt({ hash });
        }

        const balance1 = wethBalance(await plugin1.balance(undefined));
        const balance2 = wethBalance(await plugin2.balance(undefined));

        expect(balance1).toBe(997_500_000_000_000_000n);
        expect(balance2).toBeUndefined();
    }

    console.log("Testing transfer via broadcast");
    {
        const op = await plugin1.prepareTransfer(
            { asset: { __type: 'erc20', contract: CHAIN.wrappedBaseToken }, amount: 5_000n },
            signer2.address,
        );
        await plugin1.broadcast(op);

        const balance1 = wethBalance(await plugin1.balance(undefined));
        const balance2 = wethBalance(await plugin2.balance(undefined));

        expect(balance1).toBeLessThan(997_499_999_999_995_000n);
        expect(balance2).toBe(5_000n);
    }

    console.log("Testing ERC20 unshield via broadcast");
    {
        const delegatorAddress = privateKeyToAccount(DELEGATOR_PK).address;
        const wethBalanceBefore = await publicClient.readContract({
            abi: erc20Abi,
            address: CHAIN.wrappedBaseToken,
            functionName: "balanceOf",
            args: [delegatorAddress],
        });

        const op = await plugin1.prepareUnshield(
            { asset: { __type: 'erc20', contract: CHAIN.wrappedBaseToken }, amount: 5_000n },
            delegatorAddress,
        );
        await plugin1.broadcast(op);

        const wethBalanceAfter = await publicClient.readContract({
            abi: erc20Abi,
            address: CHAIN.wrappedBaseToken,
            functionName: "balanceOf",
            args: [delegatorAddress],
        });

        expect(wethBalanceAfter - wethBalanceBefore).toBe(5_000n);
    }

    console.log("Testing native unshield via broadcast");
    {
        const delegatorAddress = privateKeyToAccount(DELEGATOR_PK).address;
        const nativeBalanceBefore = await publicClient.getBalance({ address: delegatorAddress });
        const op = await plugin1.prepareUnshield(
            { asset: { __type: 'native' }, amount: 5_000n },
            delegatorAddress,
        );
        await plugin1.broadcast(op);

        const nativeBalanceAfter = await publicClient.getBalance({ address: delegatorAddress });
        expect(nativeBalanceAfter - nativeBalanceBefore).toBe(5_000n);
    }
}, 300 * 1000);
