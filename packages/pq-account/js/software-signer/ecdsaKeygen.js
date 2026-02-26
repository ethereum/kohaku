import { ethers } from 'ethers';

export async function getAddress(config) {
    const address = new ethers.Wallet(config.privateKey).address;
    console.log("✅ Pre-quantum address: " + address);
    return address;
}
