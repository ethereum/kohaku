use std::collections::HashMap;

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{Proof, Prover, ProverError};

#[wasm_bindgen(typescript_custom_section)]
const TS_INTERFACE: &str = r#"
export interface ProverAdapter {
    /** Generate a proof for the TC withdraw circuit
     * 
     * @param circuitName The name of the circuit to prove for
     * @param inputs The circuit inputs
     * @returns Generated groth16 proof and public inputs
     */
    prove(circuitName: string, inputs: Record<string, `0x${string}`[]>): Promise<JsProof>;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "ProverAdapter")]
    pub type JsProverAdapter;

    #[wasm_bindgen(method, catch, js_name = "prove")]
    async fn prove(
        this: &JsProverAdapter,
        circuit_name: &str,
        inputs: JsValue,
    ) -> Result<JsValue, JsValue>;
}

/// Generated proof and public inputs
#[derive(Deserialize, Tsify)]
#[tsify(from_wasm_abi)]
#[serde(rename_all = "camelCase")]
struct JsProof {
    proof: Proof,
    #[tsify(type = "`0x${string}`[]")]
    public_inputs: Vec<U256>,
}

#[async_trait::async_trait(?Send)]
impl Prover for JsProverAdapter {
    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<(Proof, Vec<U256>), ProverError> {
        println!("Proving circuit: {:?}", inputs);
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        let js_inputs = inputs
            .serialize(&serializer)
            .map_err(|e| ProverError::Other(format!("Failed to serialize inputs: {:?}", e)))?;

        let result = self
            .prove(circuit_name, js_inputs)
            .await
            .map_err(|e| ProverError::Other(format!("JS error: {:?}", e)))?;

        let result: JsProof = serde_wasm_bindgen::from_value(result).map_err(|e| {
            ProverError::Other(format!("Failed to deserialize proof response: {:?}", e))
        })?;

        Ok((result.proof, result.public_inputs))
    }
}
