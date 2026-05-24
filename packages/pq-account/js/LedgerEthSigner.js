/**
 * LedgerEthSigner — ethers v6 AbstractSigner backed by the Ledger secure element.
 *
 * Uses the custom ECDSA_SIGN_HASH (INS 0x15) APDU so the private key
 * never leaves the device.
 */

import { ethers } from 'ethers';
import { getEcdsaPublicKey, signEcdsaHash } from './hardware-signer/ledgerTransport.js';

const DEFAULT_BIP32_PATH = "m/44'/60'/0'/0/0";

export class LedgerEthSigner extends ethers.AbstractSigner {
    constructor(transport, provider, bip32Path) {
        super(provider);
        this._transport = transport;
        this._bip32Path = bip32Path || DEFAULT_BIP32_PATH;
        this._address   = null;
    }

    async getAddress() {
        if (!this._address) {
            const pubkey = await getEcdsaPublicKey(this._transport, this._bip32Path);
            const raw  = pubkey.subarray(2, 66);
            const hash = ethers.keccak256(raw);
            this._address = ethers.getAddress('0x' + hash.slice(-40));
        }
        return this._address;
    }

    async _signDigest(digest) {
        const hashBytes = ethers.getBytes(digest);
        if (hashBytes.length !== 32) throw new Error('Digest must be 32 bytes');

        const { v, r, s } = await signEcdsaHash(this._transport, this._bip32Path, hashBytes);

        return ethers.Signature.from({
            r: '0x' + Buffer.from(r).toString('hex'),
            s: '0x' + Buffer.from(s).toString('hex'),
            v: v + 27,
        });
    }

    async signTransaction(txRequest) {
        const pop = await this.populateTransaction(txRequest);
        delete pop.from;

        const tx = ethers.Transaction.from(pop);
        tx.signature = await this._signDigest(tx.unsignedHash);
        return tx.serialized;
    }

    async signMessage(message) {
        const sig = await this._signDigest(ethers.hashMessage(message));
        return sig.serialized;
    }

    async signTypedData(domain, types, value) {
        const sig = await this._signDigest(ethers.TypedDataEncoder.hash(domain, types, value));
        return sig.serialized;
    }

    connect(provider) {
        return new LedgerEthSigner(this._transport, provider, this._bip32Path);
    }
}
