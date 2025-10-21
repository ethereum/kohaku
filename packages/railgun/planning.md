# The plan

Rework lib to include these concise features:
- RailgunAccount
- RailgunIndexer

## Function based approach

The goal is to mirror wevm/viem's implementation style. They have a very clean function oriented approach to their API.
Exposing functions like `createRailgunAccount` and `createRailgunIndexer` that return the respective objects.
Please ensure to do some research on their style.

Ensure to check the https://github.com/wevm/viem repository for inspiration.

This means files should be setup in the manner of
```ts
export type MyType = {};

export const createMyAccount = (): MyType => {
  const storage = new InMemoryAccountStorage();
  
  return {
    doThing: async() => {

    }
  };
}


```

## RailgunAccount

A railgun account is an account of which we hold the keys.
Upon creation of the account keys are either input as `privateKey` or as `mnemonic` + `accountIndex`.

The railgun account internally keeps track of notes, stored in the `noteBooks` array.
Each note corresponds to funds in the railgun system.

The account must support a storage module (explained in the RailgunIndexer section) to persist the account state (notebooks).

Creating a railgun account should be done like this:

```ts
const provider = new EthersProviderAdapter(new JsonRpcProvider(RPC_URL));
const regularWallet = new Wallet(PRIVATE_KEY);

const indexer = createRailgunIndexer({
  chainId: '11155111',
  provider,
});

const account = createRailgunAccount({
  credentials: {
    mnemonic: 'test test test test test test test test test test test junk',
    accountIndex: 0,
  },
  indexer,
});

await indexer.sync(); // sync indexer (infer chain from indexer)
const root = await indexer.getMerkleRoot();
console.log('synced to latest root: ', root);

const zkAddress = account.getRailgunAddress(); // compute 0zkaddress
const balance = account.getBalance(WETH_ADDRESS); // get balance of private WETH
const amount = 10000000000000n; // 0.00001 WETH

const shieldTx = await account.shield(WETH_ADDRESS, amount);
// or alternatively
const shieldTx2 = await createShieldTx(WETH_ADDRESS, zkAddress, amount);

await regularWallet.sendTransaction(shieldTx);

const friendZkAddress = "0zk..." // friend's 0zkaddress
const privateTx = await account.transfer(WETH_ADDRESS, friendZkAddress, amount);
const privateTx2 = await createPrivateTransferTx(account, WETH_ADDRESS, friendZkAddress, amount);

await regularWallet.sendTransaction(privateTx);

const withdrawAddress = "0x..." // withdraw address
const unshieldTx = await account.unshield(WETH_ADDRESS, withdrawAddress, amount);
const unshieldTx2 = await createNativeUnshieldTx(account, WETH_ADDRESS, amount, withdrawAddress);

await regularWallet.sendTransaction(unshieldTx);
```

I expect the account api to look like this:
```ts
.connect(indexer: RailgunIndexer)
.getRailgunAddress()
.getBalance(token: Address)
and then have wrappers for tx building
.transfer(token: Address, to: RailgunAddress, amount: bigint)
.shield(token: Address, amount: bigint)
.unshield(token: Address, to: Address, amount: bigint)
```

## RailgunIndexer

A railgun indexer is an indexer that keeps track of the state of the railgun system on a particular chain.
When an indexer is initialized it requires a chainId and a provider (ethers or viem).

The indexer keeps track of the current block its at on the chain, aswell as the merkle trees, and exposes the functions to get the latest root etc. The indexer is passed to txbuilders when necessary.

The indexer must clearly expose load and dump features as we want people who consume our SDK to be able to initialize an indexer with the cached state, aswell as being able to dump the state to somewhere.

For example a browser extension like metamask or ambire might want to be able to load from localstorage upon init, and dump to local storage on mutation of the state.

I think this will require some form of storage abstraction.
Think when you create the railgun indexer (or account) you should be able to pass a `storage` into the initialization params. The default value for storage should be in memory storage.

This is similar to how viem does this https://github.com/wevm/viem

The indexer api would take as input params
`{ storage, provider }`

and have the functions
```ts
.getMerkleRoot()
.sync() // simply syncs to the last block
.syncWithLogs(logs: RailgunLog[]) // for manual syncing
etc
```

## Repository Layout

```
packages/railgun/
├── src/
    ├── account/ # account logic
    ├── tx/ # transaction logic / builder
    ├── indexer/ # indexer logic
    ├── provider/ # abstraction around ethers and viem
    ├── storage/ # storage abstraction
    ├── railgun/ # Railgun Forks
        ├── logic/ # forked from railgun-community do not modify
        ├── lib/ # forked from railgun-community do not modify
    ├── config/
        ├── sepolia.ts
        ├── mainnet.ts
        ├── ...
    ├── utils/
    ├── index.ts
├── tests/
├── demo/
├── docs/
├── .env.example
```

## Transaction builder

as there are several methods of creating a transaction (from a relayer, an eoa directly), shielding, private transfer, relay adapt, unshielidng, etc. I propose we use the `tx` folder to house the transaction builder.

Depending on the transaction type we will or will not require a RailgunAccount vs just an 0zk address.
For example for shielding we will only require a 0zk address, whereas most other transactions will require a RailgunAccount.

The goal for the transaction builder is to expose a variety of simple functions for transaction building, and then inside the account logic we can add shortcuts for the most common transactions, which would call the transaction builder functions under the hood.

## Validation

To verify code changes you must perform the following steps:

```sh
pnpm lint:fix # fixes all linting errors (throws if unable to fix and needs your help)
pnpm test # runs the full test suite to verify core functionality was maintained.
pnpm build # verify that typescript compiles without errors, and docs is typescript-sound.
```

The documentation leverages twoslash, which means that it attempts to compile the code snippets to verify that they are still accurate to the codebase. This is done on build in the above step.

## Styling

Because we forked some code directly form railgun id like to use the `~railgun/lib` and `~railgun/logic` paths in the codebase. Please ensure this is consistently done.

## Perspective

We are currently on a branch that is actively being refactored.
I, the author, am taking periodic snapshots using git commits to ensure our progress is preserved.

The original implementation was 700 lines and a single file.
It was fully handwritten and operational.
You can compare our refactoring against it to ensure we stick to the correct process.

```sh
curl https://raw.githubusercontent.com/ethereum/kohaku/refs/heads/master/packages/railgun/src/account-utils/railgun-account.ts
```

## Migrations left to do

Move instances of `getMerkleRoot` and `getLatestMerkleRoot` to the indexer (away from account).
Rename functions like `createShieldTx` to `shield`.
And `createUnshieldTx` to `unshield`.
And `createPrivateTransferTx` to `transfer`. etc etc.

Ensure the tests match the desired spec.
Ensure the demo matches the desired spec.
Ensure the docs snippets match the desired spec.

Migrate merkle tree storage to the indexer.
Migrate notebook storage to the account.

Use transaction builders for all the logic, they are fed account via arguments.
And tx builder uses accounts getNotes etc functions to build the transactions.

We should be getting rid of any type of `chainstate` or `accountchainstate` or related.

the state of the merkletrees should be stored in the indexer, the state of the notebooks should be 
stored in the account.

Types should be included in their respective topic as opposed to a `types` file or folder.
So for example the account related types can be found in the accounts folder (in index, subtopics, etc). This keeps the types close to the code that uses them. Ideally at the head of the file.
