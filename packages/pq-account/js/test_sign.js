import assert from "assert";
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
    const recovered  = ethers.verifyMessage(message, prequantum_signature);
    assert.strictEqual(recovered, prequantum_pubkey);

    // post-quantum signature
    const postquantum_seed = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const { secretKey: postquantum_secretkey, publicKey: postquantum_pubkey } = ml_dsa44.keygen(hexToU8(postquantum_seed));

    const zeroNonce = new Uint8Array(32); // all zeros
    const postquantum_sig = ml_dsa44.sign(message, postquantum_secretkey,{ random: zeroNonce });
    assert(ml_dsa44.verify(postquantum_sig, message, postquantum_pubkey));
    console.log(postquantum_sig);
}

main().catch(console.error);