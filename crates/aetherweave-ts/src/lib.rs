use aetherweave::api::{BraidRequest, BraidResponse, MeasureRequest, MeasureResponse, VortexCreate, VortexResponse};
use aetherweave::oracle::{SlashingOracle as RustSlashingOracle};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn create_vortex_pair(req_val: JsValue) -> Result<JsValue, JsValue> {
    let req: VortexCreate = serde_wasm_bindgen::from_value(req_val)?;
    // Mock implementation for TS bindings
    let res = VortexResponse {
        vortex_id: "VXT-1001".to_string(),
        status: "CREATED".to_string(),
        kappa: req.gamma * 1.5,
        tau: req.alpha * 2.0,
    };
    Ok(serde_wasm_bindgen::to_value(&res)?)
}

#[wasm_bindgen]
pub fn braid_anyons(req_val: JsValue) -> Result<JsValue, JsValue> {
    let _req: BraidRequest = serde_wasm_bindgen::from_value(req_val)?;
    // Mock implementation
    let res = BraidResponse {
        braid_id: "B-2025-0522-001".to_string(),
        status: "COMPLETED".to_string(),
        unitary_matrix: vec![vec![1.0, 0.0], vec![0.0, 1.0]],
        new_ti: 0.9987,
    };
    Ok(serde_wasm_bindgen::to_value(&res)?)
}

#[wasm_bindgen]
pub fn measure_fusion(req_val: JsValue) -> Result<JsValue, JsValue> {
    let req: MeasureRequest = serde_wasm_bindgen::from_value(req_val)?;
    let res = MeasureResponse {
        vortex_id: req.braid_id.clone(),
        measured_charge: "σ".to_string(),
        probability: 0.5,
        timestamp: "2026-05-22T14:22:01Z".to_string(),
    };
    Ok(serde_wasm_bindgen::to_value(&res)?)
}

#[wasm_bindgen]
pub struct SlashingOracle {
    inner: RustSlashingOracle,
}

#[wasm_bindgen]
impl SlashingOracle {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: RustSlashingOracle::new(),
        }
    }

    #[wasm_bindgen]
    pub fn monitor(&mut self) -> Result<JsValue, JsValue> {
        let events = self.inner.monitor();
        serde_wasm_bindgen::to_value(&events).map_err(|e| e.into())
    }

    #[wasm_bindgen]
    pub fn slash(&self, vortex_id: &str, reason: &str) -> Result<JsValue, JsValue> {
        if let Some(event) = self.inner.slash(vortex_id, reason) {
            serde_wasm_bindgen::to_value(&event).map_err(|e| e.into())
        } else {
            Ok(JsValue::NULL)
        }
    }

    #[wasm_bindgen]
    pub fn has_failed_proofs(&self, vortex_id: &str, count: u32) -> bool {
        self.inner.has_failed_proofs(vortex_id, count)
    }

    #[wasm_bindgen]
    pub fn build_slash_proof(&self, vortex_id: &str, deposit_id: &str) -> String {
        self.inner.build_slash_proof(vortex_id, deposit_id)
    }
}
