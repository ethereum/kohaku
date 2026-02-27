use ruint::aliases::U256;

#[cfg(feature = "poi")]
use crate::circuit::inputs::PoiCircuitInputs;
use crate::circuit::inputs::TransactCircuitInputs;

pub type PublicInputs = Vec<U256>;

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
pub trait TransactProver {
    async fn prove_transact(
        &self,
        inputs: &TransactCircuitInputs,
    ) -> Result<(prover::Proof, PublicInputs), Box<dyn std::error::Error>>;
}

#[cfg(feature = "poi")]
#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
pub trait PoiProver {
    async fn prove_poi(
        &self,
        inputs: &PoiCircuitInputs,
    ) -> Result<(prover::Proof, PublicInputs), Box<dyn std::error::Error>>;
}
