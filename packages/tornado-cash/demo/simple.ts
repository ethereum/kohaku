// Minimal Tornado Cash classic example: derive a deposit commitment from a
// mnemonic and produce a deposit transaction for a fixed-denomination pool.
// No network calls and nothing is broadcast — this script just exposes the
// math/encoding pipeline so the deterministic value flow is easy to inspect.
//
// Run:
//   pnpm -r build   # once, from repo root, so workspace packages link
//   pnpm demo       # from this package directory

import { HDNodeWallet, Mnemonic } from "ethers";
import type { Keystore } from "@kohaku-eth/plugins";

import { SecretManager } from "../src/account/keys";
import { prepareNativeShield } from "../src/account/tx/shield";

// ---------------------------------------------------------------------------
// 1. Build a BIP32 keystore from a mnemonic.
//
//    SecretManager derives nullifier/salt deterministically from this
//    keystore (path m/29795'/1'/account'/secretType'/depositIndex'), so
//    backing up the mnemonic is enough to recover every deposit — no
//    note file to store, unlike the original Tornado Cash UI.
// ---------------------------------------------------------------------------
const MNEMONIC =
  "test test test test test test test test test test test junk"; // demo only — never reuse on mainnet
const masterNode = HDNodeWallet.fromSeed(
  Mnemonic.fromPhrase(MNEMONIC).computeSeed(),
);
const keystore: Keystore = {
  deriveAt: (path) =>
    masterNode.derivePath(path).privateKey as `0x${string}`,
};

const secretManager = await SecretManager({ host: { keystore }, accountIndex: 0 });

// ---------------------------------------------------------------------------
// 2. Derive secrets for one deposit slot.
//
//    `chainId` and `poolAddress` are folded into the secrets so that the
//    same mnemonic produces independent secrets per pool deployment.
//    Classic pools have a fixed denomination per instance; this is the
//    canonical mainnet 0.1 ETH pool.
// ---------------------------------------------------------------------------
const CHAIN_ID = 1n; // Ethereum mainnet
const POOL_ADDRESS = "0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc"; // 0.1 ETH instance
const POOL_DENOMINATION = 100_000_000_000_000_000n; // 0.1 ETH
const DEPOSIT_INDEX = 0;

const secrets = await secretManager.getDepositSecrets({
  chainId: CHAIN_ID,
  poolAddress: BigInt(POOL_ADDRESS),
  depositIndex: DEPOSIT_INDEX,
});

console.log(
  `--- Derived secrets (chainId=${CHAIN_ID}, depositIndex=${DEPOSIT_INDEX}) ---`,
);
console.log("nullifier      :", secrets.nullifier);
console.log("salt           :", secrets.salt);
console.log(
  "commitment     :",
  secrets.commitment,
  " <-- this is what lands on-chain",
);
console.log(
  "nullifierHash  :",
  secrets.nullifierHash,
  " <-- revealed on withdraw to prevent double-spend",
);

// ---------------------------------------------------------------------------
// 3. Encode the deposit transaction.
//
//    Calldata carries only `commitment` — the nullifier/salt never leave
//    the keystore. The pool's fixed denomination goes into `value`.
// ---------------------------------------------------------------------------
const tx = prepareNativeShield({
  commitment: secrets.commitment,
  poolAddress: POOL_ADDRESS,
  poolDenomination: POOL_DENOMINATION,
});

console.log("\n--- Deposit transaction (not broadcast) ---");
console.log("to    :", tx.to);
console.log("value :", tx.value, "wei");
console.log("data  :", tx.data);

// To actually broadcast on mainnet, plug in a viem WalletClient. For example:
//
//   import { createWalletClient, http } from "viem";
//   import { privateKeyToAccount } from "viem/accounts";
//   import { mainnet } from "viem/chains";
//
//   const wallet = createWalletClient({
//     account: privateKeyToAccount("0x..."),
//     chain: mainnet,
//     transport: http(),
//   });
//   await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
