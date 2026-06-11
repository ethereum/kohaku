// Minimal Privacy Pools v1 example: derive a deposit precommitment from a
// mnemonic and produce a deposit (shield) transaction. No network calls
// and nothing is broadcast — this script just exposes the math/encoding
// pipeline so the deterministic value flow is easy to inspect.
//
// Run:
//   pnpm -r build   # once, from repo root, so workspace packages link
//   pnpm demo       # from this package directory

import { HDNodeWallet, Mnemonic } from "ethers";
import type { Host, Keystore } from "@kohaku-eth/plugins";

import { SecretManager } from "../src/account/keys";
import { prepareNativeShield } from "../src/account/tx/shield";
import { PrivacyPoolsV1_0xBow } from "../src/config";

// ---------------------------------------------------------------------------
// 1. Build a BIP32 keystore from a mnemonic.
//
//    SecretManager derives nullifier/salt deterministically from this
//    keystore, so backing up the mnemonic is enough to recover every
//    deposit (same HD-wallet idea as a regular EOA seed phrase).
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

// SecretManager only reads `keystore` from Host; leaving the rest unfilled
// is safe for this offline demo.
const host = { keystore } as unknown as Host;

const secretManager = SecretManager({ host, accountIndex: 0 });

// ---------------------------------------------------------------------------
// 2. Derive secrets for one deposit slot.
//
//    `entrypointAddress` is folded into the Poseidon hash so that the same
//    mnemonic produces independent secrets per pool deployment.
// ---------------------------------------------------------------------------
const CHAIN_ID = 1n; // Ethereum mainnet
const ENTRYPOINT = PrivacyPoolsV1_0xBow[1].entrypoint.entrypointAddress;
const DEPOSIT_INDEX = 0;

const secrets = secretManager.getDepositSecrets({
  chainId: CHAIN_ID,
  entrypointAddress: BigInt(ENTRYPOINT),
  depositIndex: DEPOSIT_INDEX,
});

console.log(
  `--- Derived secrets (chainId=${CHAIN_ID}, depositIndex=${DEPOSIT_INDEX}) ---`,
);
console.log("nullifier      :", secrets.nullifier);
console.log("salt           :", secrets.salt);
console.log(
  "precommitment  :",
  secrets.precommitment,
  " <-- this is what lands on-chain",
);
console.log(
  "nullifierHash  :",
  secrets.nullifierHash,
  " <-- revealed on withdraw to prevent double-spend",
);

// ---------------------------------------------------------------------------
// 3. Encode the deposit (shield) transaction.
//
//    Calldata carries only `precommitment` — the nullifier/salt never leave
//    the keystore. The ETH amount goes into `value`, not calldata.
// ---------------------------------------------------------------------------
const AMOUNT_WEI = 1_000_000_000_000_000n; // 0.001 ETH
const tx = prepareNativeShield({
  precommitment: secrets.precommitment,
  amount: AMOUNT_WEI,
  entrypointAddress: ENTRYPOINT,
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
