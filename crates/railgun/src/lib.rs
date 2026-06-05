#![doc = include_str!("../README.md")]

mod abis;
pub mod account;
mod adapter_data;
pub mod builder;
pub mod caip;
pub mod chain_config;
mod circuit;
pub mod crypto;
pub mod database;
pub mod indexer;
mod merkle_tree;
mod note;
mod poi;
pub mod provider;
pub mod transact;

#[cfg(all(wasm, parallel))]
compile_error!("The `parallel` feature is not supported in WASM builds.");

#[cfg(bench)]
pub mod bench_helpers {
    pub use crate::{indexer::indexed_account::*, note::*};
}
