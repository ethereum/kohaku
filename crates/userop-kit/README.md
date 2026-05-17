# userop-kit

ERC-4337 user operation builder and bundler client (EntryPoint 0.7 & 0.8).

## Usage

```rust
use userop_kit::{
    builder::UserOperationBuilder,
    bundler::{BundlerProvider, pimlico::PimlicoBundler},
    entry_point::{ENTRY_POINT_08, entry_point_08_domain},
};

let bundler = PimlicoBundler::new("https://api.pimlico.io/v2/1/rpc?apikey=...");

let signed_op = UserOperationBuilder::new(sender, ENTRY_POINT_08, entry_point_08_domain(chain_id), ())
    .with_nonce(nonce)
    .with_calldata(calldata)
    .with_gas_estimate(&bundler).await?
    .build()
    .sign(&signer).await?;

let hash = bundler.send_user_operation(&signed_op).await?;
let receipt = bundler.wait_for_receipt(&hash).await?;
```

## Features

| Feature   | Description                                                                  |
| --------- | ---------------------------------------------------------------------------- |
| `railgun` | Railgun protocol support. See [`builder::UserOperationBuilder::new_railgun`] |
| `js`      | WASM / TypeScript bindings via `wasm-bindgen`.                               |
