use std::collections::HashMap;

use prover::{Proof, Prover, ProverError};
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = "ProverAdapter")]
    pub type JsProverAdapter;

    /// Generate a proof for the TC withdraw circuit
    ///
    /// @param inputs The circuit inputs, as a `Record<string, string[]>` serialized via serde_wasm_bindgen.
    #[wasm_bindgen(method, catch, js_name = "prove")]
    async fn prove(this: &JsProverAdapter, inputs: JsValue) -> Result<JsValue, JsValue>;
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
    proof: Proof,
    // Public input hex strings
    #[tsify(type = "string[]")]
    public_inputs: Vec<U256>,
}

#[wasm_bindgen]
impl JsProver {
    #[wasm_bindgen(constructor)]
    pub fn new(adapter: JsProverAdapter) -> Self {
        Self { adapter }
    }
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl Prover for JsProver {
    async fn prove(
        &self,
        _circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<(Proof, Vec<U256>), ProverError> {
        let js_inputs = serialize_inputs(inputs)?;

        let result = self
            .adapter
            .prove(js_inputs)
            .await
            .map_err(|e| ProverError::Other(format!("JS error: {:?}", e)))?;

        let response: JsProofResponse = serde_wasm_bindgen::from_value(result)
            .map_err(|e| ProverError::Other(format!("Deserialization error: {:?}", e)))?;

        Ok((response.proof, response.public_inputs))
    }
}

fn serialize_inputs(inputs: HashMap<String, Vec<U256>>) -> Result<JsValue, ProverError> {
    let js_inputs: JsCircuitInputs = inputs.into();
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_maps_as_objects(true)
        .serialize_large_number_types_as_bigints(true);
    let serialized = js_inputs
        .serialize(&serializer)
        .map_err(|e| ProverError::Other(format!("Serialization error: {:?}", e)))?;
    Ok(serialized)
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
