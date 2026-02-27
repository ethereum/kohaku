pub mod circuit_input;
mod proof;
mod prover;

pub use circuit_input::{FromU256, IntoSignalVec, IntoU256};
pub use proof::{G1Affine, G2Affine, Proof};
pub use prover::{Prover, ProverError};

#[cfg(target_arch = "wasm32")]
mod wasm_impl;

#[cfg(target_arch = "wasm32")]
pub use wasm_impl::JsProverAdapter;
