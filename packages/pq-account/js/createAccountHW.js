import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import { ethers } from "ethers";
import { to_expanded_encoded_bytes } from "./utils_mldsa.js";
import { deployERC4337Account } from "./createAccount.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SW_OK = "9000";

// Derivation path: m/44'/60'/0'/0/0
const BIP32_PATH = "058000002c8000003c800000000000000000000000";

const INS = {
  GET_PUBLIC_KEY: "05",
  MLDSA_KEYGEN: "0c",
  MLDSA_GET_PK: "13",
  MLDSA_SEED: "14",
};

// MLDSA public key: 1312 bytes → 5 × 255 + 37
const PK_CHUNK_SIZES = [0xff, 0xff, 0xff, 0xff, 0xff, 0x25];

// ── APDU helpers ─────────────────────────────────────────────────────────────

function buildChunkApdus(ins, sizes) {
  return sizes.map((size, i) => ({
    name: `chunk_${i + 1}`,
    command: `e0${ins}${i.toString(16).padStart(2, "0")}${size.toString(16).padStart(2, "0")}00`,
  }));
}

async function sendApdu(transport, name, command) {
  const buffer = Buffer.from(command, "hex");
  const response = await transport.exchange(buffer);
  const statusWord = response.slice(-2).toString("hex");
  const data = response.slice(0, -2).toString("hex");

  if (statusWord !== SW_OK) {
    throw new Error(`APDU "${name}" failed — status ${statusWord}`);
  }
  return data;
}

async function fetchChunked(transport, ins, sizes) {
  const apdus = buildChunkApdus(ins, sizes);
  let result = "";
  for (const { name, command } of apdus) {
    result += await sendApdu(transport, name, command);
  }
  return result;
}

// ── Ledger key retrieval ─────────────────────────────────────────────────────

async function getECDSAPublicKey(transport) {
  const raw = await sendApdu(
    transport,
    "ecdsa_pubkey",
    `e0${INS.GET_PUBLIC_KEY}000015${BIP32_PATH}`
  );
  // raw = 41 04 <64 bytes pubkey> 20 <32 bytes chaincode>
  return raw.slice(4, 132); // 64 bytes x||y
}

async function getMLDSAPublicKey(transport) {
  await sendApdu(transport, "mldsa_seed", `e0${INS.MLDSA_SEED}000015${BIP32_PATH}`);
  await sendApdu(transport, "mldsa_keygen", `e0${INS.MLDSA_KEYGEN}000000`);
  return fetchChunked(transport, INS.MLDSA_GET_PK, PK_CHUNK_SIZES);
}

function pubkeyToAddress(pubkeyHex) {
  const pubkeyBytes = Uint8Array.from(
    pubkeyHex.match(/.{2}/g).map((b) => parseInt(b, 16))
  );
  return ethers.getAddress("0x" + ethers.keccak256(pubkeyBytes).slice(-40));
}

// ── Main flow ────────────────────────────────────────────────────────────────

async function mainHW() {
  // 1. Connect browser wallet for funding the deployment tx
  if (!window.ethereum) {
    throw new Error("No browser wallet detected. Install MetaMask or Rabby.");
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const signerAddr = await signer.getAddress();
  const balance = await provider.getBalance(signerAddr);

  console.log("✅ Wallet connected");
  console.log("- Address: " + signerAddr);
  console.log("- Balance: " + ethers.formatEther(balance) + " ETH");

  const network = await provider.getNetwork();
  console.log("- Network: " + network.name + " (Chain ID: " + network.chainId + ")");
  console.log("");

  const factoryAddress = document.getElementById("factory").textContent.trim();
  if (!factoryAddress || factoryAddress === "—") {
    throw new Error("No factory address found for this network.");
  }

  // 2. Connect Ledger via WebHID
  console.log("🔌 Connecting to Ledger — approve the WebHID prompt...");
  let transport;
  try {
    transport = await TransportWebHID.create();
    console.log("✅ Ledger connected");
  } catch (err) {
    throw new Error("Ledger connection failed: " + err.message);
  }

  try {
    // 3. Retrieve ECDSA key
    console.log("");
    console.log("🔑 Retrieving ECDSA public key from Ledger...");
    const ecdsaPubKey = await getECDSAPublicKey(transport);
    const preQuantumAddress = pubkeyToAddress(ecdsaPubKey);
    console.log("✅ ECDSA address: " + preQuantumAddress);

    // 4. Retrieve MLDSA key
    console.log("");
    console.log("🔑 Retrieving ML-DSA public key from Ledger (may take a moment)...");
    const mldsaPubKeyHex = await getMLDSAPublicKey(transport);
    console.log("✅ ML-DSA public key retrieved (" + mldsaPubKeyHex.length / 2 + " bytes)");

    // 5. Encode keys for the contract
    console.log("");
    console.log("📦 Encoding keys for ERC-4337 account...");
    const mldsaPubKeyBytes = Uint8Array.from(
      mldsaPubKeyHex.match(/.{2}/g).map((b) => parseInt(b, 16))
    );
    const postQuantumPubKey = to_expanded_encoded_bytes(mldsaPubKeyBytes);
    console.log("✅ Keys encoded");

    // 6. Deploy using shared deployment function
    console.log("");
    console.log("📦 Deploying ERC4337 Account...");
    const result = await deployERC4337Account(
      factoryAddress,
      preQuantumAddress,
      postQuantumPubKey,
      signer
    );

    if (result.success) {
      console.log("");
      console.log("============================================================");
      console.log("🎉 DEPLOYMENT COMPLETE!");
      console.log("============================================================");
      console.log("📍 ERC4337 Account: " + result.address);
      if (result.transactionHash) {
        console.log("📝 Transaction Hash: " + result.transactionHash);
      }
      if (result.alreadyExists) {
        console.log("ℹ️  Note: Account already existed at this address");
      }
      console.log("============================================================");
    } else {
      console.error("Deployment failed: " + (result.error || "unknown error"));
    }
  } finally {
    await transport.close();
    console.log("🔌 Ledger disconnected");
  }
}

// ── Button wiring ────────────────────────────────────────────────────────────

const button = document.getElementById("deploy-ledger");
const output = document.getElementById("output");

if (button && output) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    output.textContent = "";

    try {
      await mainHW();
    } catch (error) {
      console.error("Error: " + error.message);
      if (error.code === "ACTION_REJECTED" || error.code === 4001) {
        console.log("(User rejected the transaction in wallet)");
      }
    } finally {
      button.disabled = false;
    }
  });
}