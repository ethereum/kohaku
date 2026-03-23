#[cfg(not(target_arch = "wasm32"))]
mod sync_indexer;
#[cfg(all(not(target_arch = "wasm32"), feature = "relay"))]
mod sync_relayer;
