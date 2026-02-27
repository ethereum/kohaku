use std::collections::HashMap;

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::info;
use tsify::Tsify;
use wasm_bindgen::prelude::*;

#[cfg(feature = "poi")]
use crate::circuit::{inputs::PoiCircuitInputs, prover::PoiProver};
use crate::circuit::{
    inputs::TransactCircuitInputs,
    prover::{PublicInputs, TransactProver},
};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = "ProverAdapter")]
    pub type JsProverAdapter;

    /// Prove a transact circuit.
    ///
    /// @param circuit_name The name of the circuit
    /// @param inputs The circuit inputs, as a `Record<string, string[]>` serialized via serde_wasm_bindgen.
    #[wasm_bindgen(method, catch, js_name = "proveTransact")]
    async fn prove_transact(
        this: &JsProverAdapter,
        circuit_name: &str,
        inputs: JsValue,
    ) -> Result<JsValue, JsValue>;

    /// Prove a POI circuit.
    ///
    /// @param circuit_name The name of the circuit
    /// @param inputs The circuit inputs, as a `Record<string, string[]>` serialized via serde_wasm_bindgen.
    #[cfg(feature = "poi")]
    #[wasm_bindgen(method, catch, js_name = "provePoi")]
    async fn prove_poi(
        this: &JsProverAdapter,
        circuit_name: &str,
        inputs: JsValue,
    ) -> Result<JsValue, JsValue>;
}

#[wasm_bindgen]
pub struct JsProver {
    adapter: JsProverAdapter,
}

#[derive(Serialize)]
struct JsCircuitInputs {
    #[serde(flatten)]
    inputs: HashMap<String, Vec<String>>,
}

/// Response from JS prover, containing the proof and public inputs as hex strings.
#[derive(Deserialize, Tsify)]
#[tsify(from_wasm_abi)]
#[serde(rename_all = "camelCase")]
struct JsProofResponse {
    proof: prover::Proof,
    // Public input hex strings
    #[tsify(type = "string[]")]
    public_inputs: Vec<U256>,
}

#[derive(Debug, Error)]
pub enum JsProverError {
    #[error("Serde error: {0}")]
    Serde(#[from] serde_wasm_bindgen::Error),
    #[error("JS error: {0:?}")]
    Js(JsValue),
}

#[wasm_bindgen]
impl JsProver {
    #[wasm_bindgen(constructor)]
    pub fn new(adapter: JsProverAdapter) -> Self {
        Self { adapter }
    }
}

#[async_trait::async_trait(?Send)]
impl TransactProver for JsProver {
    async fn prove_transact(
        &self,
        inputs: &TransactCircuitInputs,
    ) -> Result<(prover::Proof, PublicInputs), Box<dyn std::error::Error>> {
        let circuit_name = format!(
            "transact/{:02}x{:02}",
            inputs.nullifiers.len(),
            inputs.commitments_out.len()
        );

        info!("Proving transaction with circuit {}", circuit_name);

        let js_inputs = serialize_inputs(inputs.as_flat_map())?;
        let result = self
            .adapter
            .prove_transact(&circuit_name, js_inputs)
            .await
            .map_err(|e| JsProverError::Js(e))?;

        let response: JsProofResponse = serde_wasm_bindgen::from_value(result)?;
        Ok((response.proof, response.public_inputs))
    }
}

#[cfg(feature = "poi")]
#[async_trait::async_trait(?Send)]
impl PoiProver for JsProver {
    async fn prove_poi(
        &self,
        inputs: &PoiCircuitInputs,
    ) -> Result<(prover::Proof, PublicInputs), Box<dyn std::error::Error>> {
        let circuit_name = format!(
            "poi/{:02}x{:02}",
            inputs.nullifiers.len(),
            inputs.commitments.len()
        );

        info!("Proving POI with circuit {}", circuit_name);

        let js_inputs = serialize_inputs(inputs.as_flat_map())?;
        let result = self
            .adapter
            .prove_poi(&circuit_name, js_inputs)
            .await
            .map_err(|e| JsProverError::Js(e))?;

        let response: JsProofResponse = serde_wasm_bindgen::from_value(result)?;
        Ok((response.proof, response.public_inputs))
    }
}

fn serialize_inputs(inputs: HashMap<String, Vec<U256>>) -> Result<JsValue, JsProverError> {
    let js_inputs: JsCircuitInputs = inputs.into();
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_maps_as_objects(true)
        .serialize_large_number_types_as_bigints(true);
    Ok(js_inputs.serialize(&serializer)?)
}

impl From<HashMap<String, Vec<U256>>> for JsCircuitInputs {
    fn from(inputs: HashMap<String, Vec<U256>>) -> Self {
        let inputs = inputs
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().map(|x| x.to_string()).collect()))
            .collect();
        JsCircuitInputs { inputs }
    }
}
