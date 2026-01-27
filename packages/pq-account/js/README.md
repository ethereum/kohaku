# Deploy an ERC 4337 account

We provide in this directory a web interface to deploy a post-quantum account and sign transactions.

## Prerequisites
Deploying an ERC 4337 account requires the installation of `noble` libraries and `ethers`:

```
npm init -y
npm install ethers
npm install @noble/hashes
npm install @noble/post-quantum
npm install vite
```
In order to run the web interface, simply use:
```
npx vite
```
and open `chromium` at the corresponding `localhost` port.

## Creating an account
Open `create-account.html` and follow the instructions in order to deploy an ERC4337 account using the factory (i.e. MLDSA + ECDSA-k1 available for now).

## Send a transaction
Open `send-tx.html` and follow the instructions in order to send ETH to another address. Note that the created ERC4337 account needs to be funded before performing a transaction.

This works only on Arbitrum Sepolia for now, due to the gas cost that is above the limit of 15M for the bundler PimLico.

TODO debug this!!!
