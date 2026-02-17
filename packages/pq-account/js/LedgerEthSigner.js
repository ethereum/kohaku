/**
 * LedgerEthSigner – ethers v6 AbstractSigner backed by the Ledger secure element.
 *
 * Uses the custom ECDSA_SIGN_HASH (INS 0x15) APDU exposed by the zknox
 * firmware so the private key never leaves the device.
 *
 * Usage:
 *   const transport = await openTransport();
 *   const signer = new LedgerEthSigner(transport, provider);
 *   const tx = await factory.connect(signer).createAccount(pre, post);
 */

import { ethers } from 'ethers';
import { getEcdsaPublicKey, signEcdsaHash } from './hardware-signer/ledgerTransport.js';

const DEFAULT_BIP32_PATH = "m/44'/60'/0'/0/0";

export class LedgerEthSigner extends ethers.AbstractSigner {
    /**
     * @param {Transport}       transport  – open WebHID transport
     * @param {ethers.Provider}  provider
     * @param {string}          [bip32Path="m/44'/60'/0'/0/0"]
     */
    constructor(transport, provider, bip32Path) {
        super(provider);
        this._transport = transport;
        this._bip32Path = bip32Path || DEFAULT_BIP32_PATH;
        this._address = null;
    }

    // ── address ─────────────────────────────────────────────────────────

    async getAddress() {
        if (!this._address) {
            const pubkey = await getEcdsaPublicKey(this._transport, this._bip32Path);
            // pubkey layout: length(1) | 04(1) | x(32) | y(32) | [chaincode]
            const raw = pubkey.subarray(2, 66);
            const hash = ethers.keccak256(raw);
            this._address = ethers.getAddress('0x' + hash.slice(-40));
        }
        return this._address;
    }

    // ── core signing helpers ────────────────────────────────────────────

    /**
     * Sign a raw 32-byte digest on the Ledger and return an ethers Signature.
     */
    async _signDigest(digest) {
        const hashBytes = ethers.getBytes(digest);
        if (hashBytes.length !== 32) throw new Error('Digest must be 32 bytes');

        const { v, r, s } = await signEcdsaHash(
            this._transport, this._bip32Path, hashBytes
        );

        return ethers.Signature.from({
            r: '0x' + Buffer.from(r).toString('hex'),
            s: '0x' + Buffer.from(s).toString('hex'),
            v: v + 27,
        });
    }

    // ── signTransaction ─────────────────────────────────────────────────

    async signTransaction(txRequest) {
        // Populate missing fields (nonce, gasLimit, chainId …)
        const pop = await this.populateTransaction(txRequest);

        // 'from' is added by populateTransaction but is invalid on unsigned tx
        delete pop.from;

        // Build an unsigned Transaction object
        const tx = ethers.Transaction.from(pop);
        const unsignedHash = tx.unsignedHash;

        // Sign the hash on the Ledger
        const sig = await this._signDigest(unsignedHash);
        tx.signature = sig;

        // Return the RLP-encoded signed transaction
        return tx.serialized;
    }

    // ── signMessage ─────────────────────────────────────────────────────

    async signMessage(message) {
        const digest = ethers.hashMessage(message);
        const sig = await this._signDigest(digest);
        return sig.serialized;
    }

    // ── signTypedData (EIP-712) ─────────────────────────────────────────

    async signTypedData(domain, types, value) {
        const digest = ethers.TypedDataEncoder.hash(domain, types, value);
        const sig = await this._signDigest(digest);
        return sig.serialized;
    }

    // ── connect (required by AbstractSigner) ────────────────────────────

    connect(provider) {
        return new LedgerEthSigner(this._transport, provider, this._bip32Path);
    }
}
