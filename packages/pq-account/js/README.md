# Deploy an ERC 4337 account

## Prerequisites
Deploying an ERC 4337 account requires the installation of `noble` library
```
npm install ethers
npm install @noble/hashes
npm install @noble/post-quantum
```

## Deploying a generated public key
In order to deploy an ERC4337 account using MLDSA (NIST version) and ECDSA on-chain using javascript, simply run
```
node execute.js <wallet_private_key>
```
Note that for now, this deploys a dummy MLDSA key whose seed is `deadbeef...deadbeef`, on Arbitrum Sepolia.

## Deploying a signed transaction
TODO