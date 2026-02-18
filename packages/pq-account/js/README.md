# Deploy an ERC 4337 account

We provide in this directory a web interface to deploy a post-quantum account and sign transactions.

## Prerequisites
Deploying an ERC 4337 account requires the installation of several javascript libraries. From the root of the repository:
```
npm install
```
In order to run the web interface, simply use (also from the root of the repository):
```
npm run dev
```
and open `chromium` at the corresponding `localhost` port.

## Creating an account
Open `create-account.html` and follow the instructions in order to deploy an ERC4337 account using the factory (i.e. MLDSA + ECDSA-k1 available for now).

## Send a transaction
Open `send-tx.html` and follow the instructions in order to send ETH to another address. Note that the created ERC4337 account needs to be funded before performing a transaction.
