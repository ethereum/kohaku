import { ethers } from 'ethers';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

function hexToU8(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length !== 64) {
    throw new Error("Seed must be 32 bytes (64 hex chars)");
  }
  return Uint8Array.from(
    hex.match(/.{2}/g).map(b => parseInt(b, 16))
  );
}

async function main() {
    const privateKey = process.argv[2];
    const providerUrl = "https://eth-sepolia-testnet.api.pocket.network";
    const factoryAddress = "0x6aA545dE6Dc114192f2EA34Dde63ba77aABaC6CF";
    
    // message to be signed
    const message = new Uint8Array([0xAB, 0xCD, 0xEF, 0x01]);

    // pre-quantum signature
    const prequantum_seed = "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafc";
    const wallet = new ethers.Wallet(prequantum_seed);
    const prequantum_pubkey = wallet.address;
    const prequantum_signature = await wallet.signMessage(message);

    // post-quantum signature
    const postquantum_seed = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const { postquantum_pubkey, secretKey } = ml_dsa44.keygen(hexToU8(postquantum_seed));
    const postquantum_sig = ml_dsa44.sign(message, secretKey);

    // Verification
    console.log(prequantum_pubkey);
    console.log(ethers.verifyMessage(message, prequantum_signature));
    assert(ml_dsa44.verify(sig, message, publicKey));
}

main().catch(console.error);